import {
  ADMIN_CHARACTER,
  ADMIN_ID,
  ADMIN_NICKNAME,
  ANSWER_CIRCLES,
  FIELD_HEIGHT,
  EMOTE_BUBBLE_MS,
  EMOTES,
  FIELD_WIDTH,
  TICK_MS,
  characterImageUrl,
  circleAt,
} from '../../shared/constants.ts';
import type {
  Choice,
  EmoteType,
  PlayerPosition,
  PublicQuestion,
  RevealPayload,
  RoundAction,
  StateSnapshot,
} from '../../shared/types.ts';
import { drawCharacterArt, type AnyCharacter } from './characters.ts';
import { drawScenery, drawWater } from './scenery.ts';

const CHARACTER_SIZE = 76;
// 스냅샷 간격보다 조금 길게 보간해 네트워크 지터에도 끊기지 않게 한다
const LERP_MS = TICK_MS + 30;
const MOVE_SEND_INTERVAL_MS = 100;
const POPUP_RISE_MS = 700;

interface Entity {
  id: string;
  nickname: string;
  character: AnyCharacter;
  connected: boolean;
  isAdmin: boolean;
}

interface Sprite {
  entity: Entity;
  fromX: number; fromY: number;
  toX: number; toY: number;
  start: number;
  facing: 1 | -1; // 1: 오른쪽
}

interface RevealState {
  questionId: string;
  correct: Choice;
  deltas: Map<string, number>;
  bets: { from: string; to: string; action: RoundAction; delta: number }[];
  shownAt: number;
}

const CHOICE_FONT = '700 30px system-ui, -apple-system, sans-serif';
const CHOICE_LINE = 36;
const CHOICE_MAX_WIDTH = 360; // 카드 폭(알맹이 포함)이 원 간격 420을 넘지 않도록

// A·B·C 테두리·알맹이 색: 밝은 쪽 → 기본 → 짙은 쪽
const CIRCLE_PALETTE: Record<Choice, { light: string; base: string; deep: string }> = {
  A: { light: 'rgba(255, 190, 190, 0.92)', base: 'rgba(240, 82, 82, 0.8)', deep: 'rgba(170, 30, 40, 0.88)' },
  B: { light: 'rgba(200, 230, 255, 0.92)', base: 'rgba(66, 140, 235, 0.8)', deep: 'rgba(20, 70, 160, 0.88)' },
  C: { light: 'rgba(200, 245, 200, 0.92)', base: 'rgba(55, 178, 90, 0.8)', deep: 'rgba(20, 110, 50, 0.88)' },
};

// 캐릭터 이미지: 없으면 색 원 + 이름 첫 글자로 그린다(4장 플레이스홀더)
const images = new Map<AnyCharacter, HTMLImageElement | null>();
function characterImage(key: AnyCharacter): HTMLImageElement | null {
  if (!images.has(key)) {
    const img = new Image();
    images.set(key, null);
    img.onload = () => images.set(key, img);
    img.src = characterImageUrl(key);
  }
  return images.get(key) ?? null;
}

// 선택지 사진(보기가 사진인 문제). 불러오는 동안은 null.
const choiceImageCache = new Map<string, HTMLImageElement | null>();
function choiceImage(url: string): HTMLImageElement | null {
  if (!choiceImageCache.has(url)) {
    const img = new Image();
    choiceImageCache.set(url, null);
    img.onload = () => choiceImageCache.set(url, img);
    img.src = url;
  }
  return choiceImageCache.get(url) ?? null;
}

// 사진 카드 크기(논리 좌표). 원 윗부분만 살짝 덮고, 오른쪽 위 이모티콘 버튼 줄(약 y 210까지)은 피한다.
const PHOTO_H = 150;
const PHOTO_OVERLAP = 66;

// 선택지 글자를 최대 폭에 맞춰 줄바꿈한다(한글은 글자 단위, 공백이 있으면 단어 단위)
function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const ch of [...text]) {
    const next = line + ch;
    if (ctx.measureText(next).width > maxWidth && line) {
      const cut = line.lastIndexOf(' ');
      if (cut > 0 && ch !== ' ') {
        lines.push(line.slice(0, cut));
        line = line.slice(cut + 1) + ch;
      } else {
        lines.push(line);
        line = ch === ' ' ? '' : ch;
      }
      if (lines.length === maxLines) break;
    } else {
      line = next;
    }
  }
  if (lines.length < maxLines && line) lines.push(line);
  else if (lines.length === maxLines && line) lines[maxLines - 1] = lines[maxLines - 1].replace(/.$/, '…');
  return lines;
}

export interface FieldOptions {
  // 필드를 host 안 어디에 붙일지. 플레이어 화면은 위쪽에 문제 UI 자리를 남기려고 아래에 붙인다.
  align: 'bottom' | 'center';
  onMove: (x: number, y: number) => void;
  onChoiceChange?: (choice: Choice | null) => void;
}

export class FieldView {
  readonly canvas = document.createElement('canvas');
  private ctx = this.canvas.getContext('2d')!;
  private sprites = new Map<string, Sprite>();
  private myId = '';
  private scale = 1;
  private dpr = 1;
  private raf = 0;
  private resizeObserver: ResizeObserver;
  private lastMoveSent = 0;
  private pendingMove: { x: number; y: number } | null = null;
  private pendingTimer = 0;
  private touchMarker: { x: number; y: number; at: number } | null = null;
  private currentChoice: Choice | null = null;
  private reveal: RevealState | null = null;
  private inputEnabled = true;
  private choices: PublicQuestion['choices'] | null = null;
  private choiceImages: PublicQuestion['choiceImages'] | null = null;
  private showChoiceText = false;
  private emotes = new Map<string, { emote: EmoteType; start: number }>(); // 플레이어 id → 말풍선
  private background = document.createElement('canvas'); // 광장·자연 배경(해상도가 바뀔 때만 다시 그림)

  constructor(private host: HTMLElement, private options: FieldOptions) {
    this.canvas.className = 'field-canvas';
    host.append(this.canvas);
    this.canvas.addEventListener('pointerdown', this.handlePointerDown);
    this.canvas.addEventListener('pointermove', this.handlePointerMove);
    this.resizeObserver = new ResizeObserver(this.resize);
    this.resizeObserver.observe(host);
    this.resize();
    this.raf = requestAnimationFrame(this.frame);
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    clearTimeout(this.pendingTimer);
    this.resizeObserver.disconnect();
    this.canvas.remove();
  }

  // 스냅샷의 플레이어 + 관리자 캐릭터를 필드에 반영한다
  update(snapshot: StateSnapshot, myId: string): void {
    this.myId = myId;
    const entities: { entity: Entity; x: number; y: number }[] = snapshot.players.map((p) => ({
      entity: { id: p.id, nickname: p.nickname, character: p.character, connected: p.connected, isAdmin: false },
      x: p.x,
      y: p.y,
    }));
    if (snapshot.admin) {
      entities.push({
        entity: {
          id: ADMIN_ID, nickname: ADMIN_NICKNAME, character: ADMIN_CHARACTER,
          connected: snapshot.admin.connected, isAdmin: true,
        },
        x: snapshot.admin.x,
        y: snapshot.admin.y,
      });
    }

    const now = performance.now();
    const seen = new Set<string>();
    for (const { entity, x, y } of entities) {
      seen.add(entity.id);
      const sprite = this.sprites.get(entity.id);
      if (sprite) {
        sprite.entity = entity;
        this.retarget(sprite, x, y, now);
      } else {
        this.sprites.set(entity.id, { entity, fromX: x, fromY: y, toX: x, toY: y, start: now, facing: 1 });
      }
    }
    for (const id of this.sprites.keys()) {
      if (!seen.has(id)) this.sprites.delete(id);
    }

    // 대기실·문제·정답 공개 중에 움직일 수 있다(최종 결과 화면만 막음)
    this.inputEnabled = snapshot.phase !== 'RESULT';
    this.choices = snapshot.question?.choices ?? null;
    this.choiceImages = snapshot.question?.choiceImages ?? null;
    this.showChoiceText = snapshot.question?.showChoiceText ?? false;
    this.setReveal(snapshot.phase === 'REVEAL' ? snapshot.lastRound : null);
  }

  // 7장: 이모티콘 말풍선 3초
  showEmote(playerId: string, emote: EmoteType): void {
    this.emotes.set(playerId, { emote, start: performance.now() });
  }

  applyPositions(positions: PlayerPosition[]): void {
    const now = performance.now();
    for (const pos of positions) {
      const sprite = this.sprites.get(pos.id);
      if (sprite) this.retarget(sprite, pos.x, pos.y, now);
    }
  }

  private setReveal(round: RevealPayload | null): void {
    if (!round) {
      this.reveal = null;
      return;
    }
    if (this.reveal?.questionId === round.questionId) return;
    const bets = Object.entries(round.perPlayer)
      .filter(([, r]) => (r.action.type === 'BET_CORRECT' || r.action.type === 'BET_WRONG') && r.action.targetId)
      .map(([id, r]) => ({ from: id, to: r.action.targetId!, action: r.action, delta: r.actionDelta }));
    this.reveal = {
      questionId: round.questionId,
      correct: round.correct,
      deltas: new Map(Object.entries(round.perPlayer).map(([id, r]) => [id, r.total])),
      bets,
      shownAt: performance.now(),
    };
  }

  private retarget(sprite: Sprite, x: number, y: number, now: number): void {
    if (x === sprite.toX && y === sprite.toY) return;
    const cur = this.interpolated(sprite, now);
    if (x !== cur.x) sprite.facing = x > cur.x ? 1 : -1;
    sprite.fromX = cur.x;
    sprite.fromY = cur.y;
    sprite.toX = x;
    sprite.toY = y;
    sprite.start = now;
  }

  private interpolated(sprite: Sprite, now: number): { x: number; y: number; moving: boolean } {
    const t = Math.min(1, (now - sprite.start) / LERP_MS);
    return {
      x: sprite.fromX + (sprite.toX - sprite.fromX) * t,
      y: sprite.fromY + (sprite.toY - sprite.fromY) * t,
      moving: t < 1,
    };
  }

  private resize = (): void => {
    const hostW = this.host.clientWidth;
    const hostH = this.host.clientHeight;
    if (hostW === 0 || hostH === 0) return;
    this.scale = Math.min(hostW / FIELD_WIDTH, hostH / FIELD_HEIGHT);
    this.dpr = Math.min(window.devicePixelRatio || 1, 3);
    const cssW = Math.floor(FIELD_WIDTH * this.scale);
    const cssH = Math.floor(FIELD_HEIGHT * this.scale);
    const top = this.options.align === 'bottom' ? hostH - cssH : Math.floor((hostH - cssH) / 2);
    const left = Math.floor((hostW - cssW) / 2);
    Object.assign(this.canvas.style, { width: `${cssW}px`, height: `${cssH}px`, top: `${top}px`, left: `${left}px` });
    this.canvas.width = Math.round(cssW * this.dpr);
    this.canvas.height = Math.round(cssH * this.dpr);
    this.background.width = this.canvas.width;
    this.background.height = this.canvas.height;
    const bg = this.background.getContext('2d')!;
    bg.setTransform(this.canvas.width / FIELD_WIDTH, 0, 0, this.canvas.height / FIELD_HEIGHT, 0, 0);
    drawScenery(bg);
    // 오버레이가 필드에 맞춰 자리 잡도록 필드 위치를 CSS 변수로 알려 준다
    this.host.style.setProperty('--field-top', `${top}px`);
    this.host.style.setProperty('--field-left', `${left}px`);
    this.host.style.setProperty('--field-width', `${cssW}px`);
    this.host.style.setProperty('--field-height', `${cssH}px`);
    this.host.style.setProperty('--field-scale', String(this.scale));
  };

  // 5장: 터치 지점을 논리 좌표로 바꿔 목표 지점으로 보낸다
  private toLogical(e: PointerEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * FIELD_WIDTH,
      y: ((e.clientY - rect.top) / rect.height) * FIELD_HEIGHT,
    };
  }

  private handlePointerDown = (e: PointerEvent): void => {
    e.preventDefault();
    if (!this.inputEnabled) return;
    this.canvas.setPointerCapture(e.pointerId);
    this.sendMove(this.toLogical(e), true);
  };

  // 누른 채로 끌면 목표 지점을 따라가게 한다(초당 최대 10회 전송)
  private handlePointerMove = (e: PointerEvent): void => {
    if (!this.inputEnabled || !this.canvas.hasPointerCapture(e.pointerId)) return;
    this.sendMove(this.toLogical(e), false);
  };

  private sendMove(pos: { x: number; y: number }, immediate: boolean): void {
    const x = Math.round(Math.min(FIELD_WIDTH, Math.max(0, pos.x)));
    const y = Math.round(Math.min(FIELD_HEIGHT, Math.max(0, pos.y)));
    this.touchMarker = { x, y, at: performance.now() };
    const now = performance.now();
    if (immediate || now - this.lastMoveSent >= MOVE_SEND_INTERVAL_MS) {
      clearTimeout(this.pendingTimer);
      this.pendingMove = null;
      this.lastMoveSent = now;
      this.options.onMove(x, y);
      return;
    }
    // 마지막 드래그 위치가 빠지지 않도록 남은 간격 뒤에 보낸다
    this.pendingMove = { x, y };
    clearTimeout(this.pendingTimer);
    this.pendingTimer = window.setTimeout(() => {
      if (!this.pendingMove) return;
      this.lastMoveSent = performance.now();
      this.options.onMove(this.pendingMove.x, this.pendingMove.y);
      this.pendingMove = null;
    }, MOVE_SEND_INTERVAL_MS - (now - this.lastMoveSent));
  }

  private frame = (now: number): void => {
    this.raf = requestAnimationFrame(this.frame);
    const ctx = this.ctx;
    const k = this.scale * this.dpr;
    ctx.setTransform(k, 0, 0, k, 0, 0);

    const drawn = [...this.sprites.values()]
      .map((sprite) => ({ sprite, ...this.interpolated(sprite, now) }))
      .sort((a, b) => a.y - b.y);

    const me = drawn.find((d) => d.sprite.entity.id === this.myId);
    const choice = me ? circleAt(me.x, me.y) : null;
    if (choice !== this.currentChoice) {
      this.currentChoice = choice;
      this.options.onChoiceChange?.(choice);
    }

    ctx.drawImage(this.background, 0, 0, FIELD_WIDTH, FIELD_HEIGHT);
    drawWater(ctx, now);
    this.drawCircles(ctx, choice, now);
    this.drawChoiceLabels(ctx, now);
    this.drawTouchMarker(ctx, now);
    for (const d of drawn) this.drawCharacter(ctx, d.sprite, d.x, d.y, d.moving, now);
    const at = new Map(drawn.map((d) => [d.sprite.entity.id, d]));
    if (this.reveal) {
      this.drawBets(ctx, at, now);
      for (const d of drawn) this.drawPopup(ctx, d.sprite.entity.id, d.x, d.y, now);
    }
    for (const [id, { emote, start }] of this.emotes) {
      const d = at.get(id);
      if (!d || now - start > EMOTE_BUBBLE_MS) {
        this.emotes.delete(id);
        continue;
      }
      this.drawEmoteBubble(ctx, d.x, d.y, now - start, emote);
    }
  };

  // A·B·C 원: 반투명 평면 원 + 그라데이션 테두리와 위쪽의 옅은 광택.
  // 정답 공개 때는 정답 원만 금빛 테두리로 빛나고 나머지는 흐려진다.
  private drawCircles(ctx: CanvasRenderingContext2D, myChoice: Choice | null, now: number): void {
    const correct = this.reveal?.correct;
    const pulse = (Math.sin(now / 260) + 1) / 2;
    for (const choice of ['A', 'B', 'C'] as const) {
      const c = ANSWER_CIRCLES[choice];
      const p = CIRCLE_PALETTE[choice];
      const isCorrect = choice === correct;
      const dimmed = correct !== undefined && !isCorrect;
      const active = correct === undefined && choice === myChoice;

      ctx.save();
      ctx.globalAlpha = dimmed ? 0.35 : 1;
      ctx.beginPath();
      ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
      ctx.fillStyle = c.color;
      ctx.fill();
      if (active || isCorrect) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
        ctx.fill();
      }

      // 위쪽 옅은 광택
      ctx.save();
      ctx.clip();
      const gloss = ctx.createLinearGradient(0, c.y - c.r, 0, c.y - c.r * 0.35);
      gloss.addColorStop(0, 'rgba(255, 255, 255, 0.28)');
      gloss.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.beginPath();
      ctx.ellipse(c.x, c.y - c.r * 0.62, c.r * 0.72, c.r * 0.3, 0, 0, Math.PI * 2);
      ctx.fillStyle = gloss;
      ctx.fill();
      ctx.restore();

      // 그라데이션 테두리(정답이면 금빛으로 빛남)
      ctx.beginPath();
      ctx.arc(c.x, c.y, c.r - 3, 0, Math.PI * 2);
      const ring = ctx.createLinearGradient(c.x - c.r, c.y - c.r, c.x + c.r, c.y + c.r);
      if (isCorrect) {
        ring.addColorStop(0, '#fff9db');
        ring.addColorStop(0.4, '#ffd43b');
        ring.addColorStop(0.75, '#f59f00');
        ring.addColorStop(1, '#fff3bf');
        ctx.shadowColor = `rgba(255, 196, 0, ${0.6 + pulse * 0.35})`;
        ctx.shadowBlur = 22 + pulse * 18;
        ctx.lineWidth = 12;
      } else {
        ring.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
        ring.addColorStop(0.5, p.light);
        ring.addColorStop(1, p.deep);
        if (active) {
          ctx.shadowColor = 'rgba(255, 255, 255, 0.9)';
          ctx.shadowBlur = 18;
        }
        ctx.lineWidth = active ? 10 : 6;
      }
      ctx.strokeStyle = ring;
      ctx.stroke();
      ctx.shadowBlur = 0;

      ctx.font = '900 140px system-ui, -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = active || isCorrect ? 'rgba(255, 255, 255, 0.95)' : 'rgba(255, 255, 255, 0.7)';
      ctx.fillText(choice, c.x, c.y + 8);

      if (isCorrect) this.drawGlassPill(ctx, c.x, c.y + c.r - 40, '정답', 'gold', 30);
      ctx.restore();
    }
  }

  // 유리 알약: 반투명 그라데이션 + 윗면 광택 + 흰 테두리 + 그림자
  private drawGlassPill(
    ctx: CanvasRenderingContext2D, cx: number, cy: number, text: string,
    tone: 'gold' | 'red' | 'grey' | 'blue', size: number, scale = 1,
  ): void {
    const tones = {
      gold: { top: 'rgba(255, 243, 191, 0.96)', bottom: 'rgba(250, 176, 5, 0.92)', ink: '#5c3c00', glow: 'rgba(255, 196, 0, 0.7)' },
      red: { top: 'rgba(255, 201, 201, 0.96)', bottom: 'rgba(224, 49, 49, 0.92)', ink: '#ffffff', glow: 'rgba(224, 49, 49, 0.55)' },
      grey: { top: 'rgba(248, 249, 250, 0.95)', bottom: 'rgba(173, 181, 189, 0.9)', ink: '#343a40', glow: 'rgba(0, 0, 0, 0.2)' },
      blue: { top: 'rgba(208, 235, 255, 0.96)', bottom: 'rgba(28, 126, 214, 0.92)', ink: '#ffffff', glow: 'rgba(28, 126, 214, 0.55)' },
    }[tone];
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(scale, scale);
    ctx.font = `900 ${size}px system-ui, -apple-system, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const w = ctx.measureText(text).width + size * 1.1;
    const h = size * 1.45;
    const r = h / 2;

    ctx.save();
    ctx.shadowColor = tone === 'grey' ? 'rgba(0, 0, 0, 0.25)' : tones.glow;
    ctx.shadowBlur = 16;
    ctx.shadowOffsetY = 5;
    ctx.beginPath();
    ctx.roundRect(-w / 2, -h / 2, w, h, r);
    const fill = ctx.createLinearGradient(0, -h / 2, 0, h / 2);
    fill.addColorStop(0, tones.top);
    fill.addColorStop(1, tones.bottom);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.restore();

    // 윗면 광택
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(-w / 2, -h / 2, w, h, r);
    ctx.clip();
    const gloss = ctx.createLinearGradient(0, -h / 2, 0, 0);
    gloss.addColorStop(0, 'rgba(255, 255, 255, 0.75)');
    gloss.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.beginPath();
    ctx.roundRect(-w / 2 + 3, -h / 2 + 2, w - 6, h * 0.48, [r, r, r * 0.4, r * 0.4]);
    ctx.fillStyle = gloss;
    ctx.fill();
    ctx.restore();

    ctx.beginPath();
    ctx.roundRect(-w / 2, -h / 2, w, h, r);
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.stroke();

    if (tones.ink === '#ffffff') {
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.25)';
      ctx.strokeText(text, 0, 2);
    }
    ctx.fillStyle = tones.ink;
    ctx.fillText(text, 0, 2);
    ctx.restore();
  }

  // 보기가 사진인 문제: 각 원 위에 사진 카드(왼쪽 위에 A·B·C). 정답이면 금빛으로 빛난다.
  private drawChoicePhotos(ctx: CanvasRenderingContext2D, now: number): void {
    const images = this.choiceImages!;
    const correct = this.reveal?.correct;
    const pulse = (Math.sin(now / 260) + 1) / 2;
    for (const choice of ['A', 'B', 'C'] as const) {
      const c = ANSWER_CIRCLES[choice];
      const p = CIRCLE_PALETTE[choice];
      const img = choiceImage(images[choice]);
      const imgW = img ? (img.naturalWidth / img.naturalHeight) * PHOTO_H : PHOTO_H * 0.66;
      const pad = 8;
      const w = imgW + pad * 2;
      const h = PHOTO_H + pad * 2;
      const bottom = c.y - c.r + PHOTO_OVERLAP;
      const left = c.x - w / 2;
      const top = bottom - h;
      const isCorrect = choice === correct;

      ctx.save();
      ctx.globalAlpha = correct !== undefined && !isCorrect ? 0.45 : 1;
      // 카드
      ctx.save();
      ctx.shadowColor = isCorrect ? `rgba(255, 196, 0, ${0.6 + pulse * 0.35})` : 'rgba(0, 0, 0, 0.3)';
      ctx.shadowBlur = isCorrect ? 26 + pulse * 16 : 16;
      ctx.shadowOffsetY = isCorrect ? 0 : 6;
      ctx.beginPath();
      ctx.roundRect(left, top, w, h, 18);
      ctx.fillStyle = isCorrect ? 'rgba(255, 243, 191, 0.97)' : 'rgba(255, 255, 255, 0.95)';
      ctx.fill();
      ctx.restore();
      // 사진
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(left + pad, top + pad, imgW, PHOTO_H, 12);
      ctx.clip();
      if (img) ctx.drawImage(img, left + pad, top + pad, imgW, PHOTO_H);
      else {
        ctx.fillStyle = '#e9ecef';
        ctx.fillRect(left + pad, top + pad, imgW, PHOTO_H);
      }
      // 사진 아래쪽에 선택지 글자 띠(예: 영화 제목). 카드 높이는 그대로라 원을 더 가리지 않는다.
      if (this.showChoiceText && this.choices) {
        ctx.font = '800 20px system-ui, -apple-system, sans-serif';
        const lines = wrapText(ctx, this.choices[choice], imgW - 10, 2);
        const bandH = lines.length * 22 + 10;
        const bandTop = top + pad + PHOTO_H - bandH;
        ctx.fillStyle = 'rgba(15, 18, 30, 0.8)';
        ctx.fillRect(left + pad, bandTop, imgW, bandH);
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        lines.forEach((line, i) => ctx.fillText(line, c.x, bandTop + 5 + 22 * (i + 0.5) + 1));
      }
      ctx.restore();
      // 테두리
      ctx.beginPath();
      ctx.roundRect(left, top, w, h, 18);
      if (isCorrect) {
        const ring = ctx.createLinearGradient(left, top, left + w, bottom);
        ring.addColorStop(0, '#fff3bf');
        ring.addColorStop(0.5, '#f59f00');
        ring.addColorStop(1, '#ffe066');
        ctx.lineWidth = 5;
        ctx.strokeStyle = ring;
      } else {
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
      }
      ctx.stroke();
      // 왼쪽 위 A·B·C 알맹이
      const chip = 22;
      const chipX = left + 6;
      const chipY = top + 6;
      const chipFill = ctx.createRadialGradient(chipX - 6, chipY - 8, 2, chipX, chipY, chip);
      chipFill.addColorStop(0, p.light);
      chipFill.addColorStop(1, p.deep);
      ctx.beginPath();
      ctx.arc(chipX, chipY, chip, 0, Math.PI * 2);
      ctx.fillStyle = chipFill;
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#fff';
      ctx.stroke();
      ctx.font = '900 24px system-ui, -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#fff';
      ctx.fillText(choice, chipX, chipY + 1);
      ctx.restore();
    }
  }

  // 선택지 글자: 각 원 위의 유리 카드(왼쪽에 A·B·C 표시). 정답이면 금빛으로 빛난다.
  private drawChoiceLabels(ctx: CanvasRenderingContext2D, now: number): void {
    if (!this.choices) return;
    if (this.choiceImages) {
      this.drawChoicePhotos(ctx, now);
      return;
    }
    const correct = this.reveal?.correct;
    const pulse = (Math.sin(now / 260) + 1) / 2;
    ctx.save();
    ctx.font = CHOICE_FONT;
    ctx.textBaseline = 'middle';
    for (const choice of ['A', 'B', 'C'] as const) {
      const c = ANSWER_CIRCLES[choice];
      const p = CIRCLE_PALETTE[choice];
      ctx.font = CHOICE_FONT;
      const lines = wrapText(ctx, this.choices[choice], CHOICE_MAX_WIDTH - 44, 3);
      const chip = 34;
      const textW = Math.max(...lines.map((l) => ctx.measureText(l).width));
      const w = textW + chip + 46;
      const h = Math.max(lines.length * CHOICE_LINE + 20, chip + 18);
      const bottom = c.y - c.r + 8; // 원 윗부분에 살짝 걸치게 해 상단 아이콘과 겹치지 않도록
      const left = c.x - w / 2;
      const top = bottom - h;
      const isCorrect = choice === correct;
      ctx.globalAlpha = correct !== undefined && !isCorrect ? 0.45 : 1;

      // 카드: 그림자(정답이면 금빛 후광) + 반투명 그라데이션
      ctx.save();
      ctx.shadowColor = isCorrect ? `rgba(255, 196, 0, ${0.6 + pulse * 0.35})` : 'rgba(0, 0, 0, 0.28)';
      ctx.shadowBlur = isCorrect ? 26 + pulse * 16 : 16;
      ctx.shadowOffsetY = isCorrect ? 0 : 6;
      ctx.beginPath();
      ctx.roundRect(left, top, w, h, 18);
      const fill = ctx.createLinearGradient(0, top, 0, bottom);
      if (isCorrect) {
        fill.addColorStop(0, 'rgba(255, 249, 219, 0.97)');
        fill.addColorStop(1, 'rgba(255, 212, 59, 0.9)');
      } else {
        fill.addColorStop(0, 'rgba(255, 255, 255, 0.93)');
        fill.addColorStop(1, 'rgba(255, 255, 255, 0.72)');
      }
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.restore();

      // 윗면 광택
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(left, top, w, h, 18);
      ctx.clip();
      const gloss = ctx.createLinearGradient(0, top, 0, top + h * 0.5);
      gloss.addColorStop(0, 'rgba(255, 255, 255, 0.8)');
      gloss.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.fillStyle = gloss;
      ctx.fillRect(left, top, w, h * 0.5);
      ctx.restore();

      // 테두리: 흰 유리선 + 정답이면 금빛 그라데이션
      ctx.beginPath();
      ctx.roundRect(left, top, w, h, 18);
      if (isCorrect) {
        const ring = ctx.createLinearGradient(left, top, left + w, bottom);
        ring.addColorStop(0, '#fff3bf');
        ring.addColorStop(0.5, '#f59f00');
        ring.addColorStop(1, '#ffe066');
        ctx.lineWidth = 4;
        ctx.strokeStyle = ring;
      } else {
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
      }
      ctx.stroke();

      // 왼쪽 A·B·C 알맹이
      const chipX = left + 14 + chip / 2;
      const chipY = top + h / 2;
      const chipFill = ctx.createRadialGradient(chipX - 6, chipY - 8, 2, chipX, chipY, chip / 2);
      chipFill.addColorStop(0, p.light);
      chipFill.addColorStop(1, p.deep);
      ctx.beginPath();
      ctx.arc(chipX, chipY, chip / 2, 0, Math.PI * 2);
      ctx.fillStyle = chipFill;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.stroke();
      ctx.font = '900 20px system-ui, -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#fff';
      ctx.fillText(choice, chipX, chipY + 1);

      ctx.font = CHOICE_FONT;
      ctx.textAlign = 'left';
      ctx.fillStyle = isCorrect ? '#5c3c00' : '#1f2a24';
      const textX = left + chip + 30;
      lines.forEach((line, i) => ctx.fillText(line, textX, top + (h - lines.length * CHOICE_LINE) / 2 + CHOICE_LINE * (i + 0.5) + 1));
    }
    ctx.restore();
  }

  private drawTouchMarker(ctx: CanvasRenderingContext2D, now: number): void {
    if (!this.touchMarker) return;
    const age = (now - this.touchMarker.at) / 500;
    if (age >= 1) {
      this.touchMarker = null;
      return;
    }
    ctx.beginPath();
    ctx.arc(this.touchMarker.x, this.touchMarker.y, 14 + age * 22, 0, Math.PI * 2);
    ctx.lineWidth = 4;
    ctx.strokeStyle = `rgba(255, 255, 255, ${0.9 * (1 - age)})`;
    ctx.stroke();
  }

  private drawCharacter(
    ctx: CanvasRenderingContext2D, sprite: Sprite, x: number, y: number, moving: boolean, now: number,
  ): void {
    const { entity } = sprite;
    const isMe = entity.id === this.myId;
    const size = CHARACTER_SIZE;
    // 5장: 이동 중에는 살짝 통통 튄다
    const bounce = moving ? Math.abs(Math.sin(now / 80)) * 10 : 0;

    ctx.save();
    ctx.globalAlpha = entity.connected ? 1 : 0.4;

    // 발밑: 내 캐릭터는 노란 하이라이트, 다른 캐릭터는 그림자
    ctx.beginPath();
    ctx.ellipse(x, y + size / 2 - 4, isMe ? 44 : 30, isMe ? 16 : 10, 0, 0, Math.PI * 2);
    ctx.fillStyle = isMe ? 'rgba(255, 224, 70, 0.85)' : 'rgba(0, 0, 0, 0.2)';
    ctx.fill();
    if (isMe) {
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#fff';
      ctx.stroke();
    }

    const top = y - size / 2 - bounce;
    const img = characterImage(entity.character);
    if (img) {
      ctx.save();
      ctx.translate(x, 0);
      ctx.scale(sprite.facing, 1); // 이동 방향에 따라 좌우 반전
      ctx.drawImage(img, -size / 2, top, size, size);
      ctx.restore();
    } else {
      drawCharacterArt(ctx, entity.character, x, top + size, size, { t: now, facing: sprite.facing, moving });
    }
    if (entity.isAdmin) this.drawCrown(ctx, x, top - 4);

    this.drawLabel(ctx, entity.nickname, x, y + size / 2 + 22, isMe);
    ctx.restore();
  }

  private drawCrown(ctx: CanvasRenderingContext2D, x: number, bottom: number): void {
    const w = 44;
    const h = 28;
    ctx.beginPath();
    ctx.moveTo(x - w / 2, bottom);
    ctx.lineTo(x - w / 2, bottom - h * 0.55);
    ctx.lineTo(x - w / 4, bottom - h * 0.25);
    ctx.lineTo(x, bottom - h);
    ctx.lineTo(x + w / 4, bottom - h * 0.25);
    ctx.lineTo(x + w / 2, bottom - h * 0.55);
    ctx.lineTo(x + w / 2, bottom);
    ctx.closePath();
    ctx.fillStyle = '#ffd23f';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#b8860b';
    ctx.stroke();
  }

  private drawLabel(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, isMe: boolean): void {
    ctx.font = '700 24px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const w = ctx.measureText(text).width + 20;
    const h = 34;
    ctx.beginPath();
    ctx.roundRect(x - w / 2, y - h / 2, w, h, h / 2);
    ctx.fillStyle = isMe ? 'rgba(255, 214, 10, 0.95)' : 'rgba(20, 30, 25, 0.65)';
    ctx.fill();
    ctx.fillStyle = isMe ? '#2b2100' : '#fff';
    ctx.fillText(text, x, y + 1);
  }

  // 7장: 정답 공개 때 누가 누구를 찍었는지 입체 화살표로 보여 준다.
  // 성공은 파랑, 실패는 빨강, 무효는 회색. 내가 쏜 화살표는 더 굵고 빛나게, 나머지는 살짝 흐리게.
  private drawBets(
    ctx: CanvasRenderingContext2D,
    at: Map<string, { x: number; y: number }>,
    now: number,
  ): void {
    const progress = Math.min(1, (now - this.reveal!.shownAt) / 600);
    const ease = 1 - (1 - progress) ** 3;
    // 내 화살표가 맨 위에 오도록 마지막에 그린다
    const bets = [...this.reveal!.bets].sort((a, b) => Number(a.from === this.myId) - Number(b.from === this.myId));
    for (const bet of bets) {
      const from = at.get(bet.from);
      const to = at.get(bet.to);
      if (!from || !to) continue;
      const mine = bet.from === this.myId;
      const palette = bet.delta > 0
        ? { base: '#1c7ed6', dark: '#0b4f9c', light: '#a5d8ff' }
        : bet.delta < 0
          ? { base: '#e03131', dark: '#8f1414', light: '#ffc9c9' }
          : { base: '#868e96', dark: '#495057', light: '#e9ecef' };
      const width = mine ? 15 : 10;

      const x1 = from.x;
      const y1 = from.y - CHARACTER_SIZE * 0.55;
      const tx = to.x;
      const ty = to.y - CHARACTER_SIZE * 0.55;
      const cx = (x1 + tx) / 2;
      const cy = Math.min(y1, ty) - 70 - Math.abs(tx - x1) * 0.15;
      // 끝점을 progress만큼 곡선 위에서 따라가게 한다
      const q = (t: number) => ({
        x: (1 - t) ** 2 * x1 + 2 * (1 - t) * t * cx + t * t * tx,
        y: (1 - t) ** 2 * y1 + 2 * (1 - t) * t * cy + t * t * ty,
      });
      const end = q(ease);
      const before = q(Math.max(0, ease - 0.04));
      const angle = Math.atan2(end.y - before.y, end.x - before.x);
      const headLen = width * 2.4;
      // 화살촉 뿌리까지만 몸통을 그린다
      const shaftEnd = { x: end.x - Math.cos(angle) * headLen * 0.7, y: end.y - Math.sin(angle) * headLen * 0.7 };
      const mid = q(ease / 2);
      const ctrl = { x: 2 * mid.x - (x1 + shaftEnd.x) / 2, y: 2 * mid.y - (y1 + shaftEnd.y) / 2 };

      const shaft = () => {
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.quadraticCurveTo(ctrl.x, ctrl.y, shaftEnd.x, shaftEnd.y);
      };
      const head = () => {
        ctx.beginPath();
        ctx.moveTo(end.x, end.y);
        ctx.lineTo(end.x - headLen * Math.cos(angle - 0.5), end.y - headLen * Math.sin(angle - 0.5));
        ctx.lineTo(end.x - headLen * 0.7 * Math.cos(angle), end.y - headLen * 0.7 * Math.sin(angle));
        ctx.lineTo(end.x - headLen * Math.cos(angle + 0.5), end.y - headLen * Math.sin(angle + 0.5));
        ctx.closePath();
      };

      ctx.save();
      ctx.globalAlpha = mine ? 1 : 0.82;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      // 1) 바닥 그림자
      ctx.save();
      ctx.translate(4, 9);
      shaft();
      ctx.lineWidth = width + 4;
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.28)';
      ctx.stroke();
      head();
      ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
      ctx.fill();
      ctx.restore();
      // 2) 흰 테두리 (내 화살표는 색 빛번짐)
      if (mine) {
        ctx.shadowColor = palette.base;
        ctx.shadowBlur = 18 + Math.sin(now / 160) * 6;
      }
      shaft();
      ctx.lineWidth = width + 7;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
      head();
      ctx.lineWidth = 7;
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.shadowBlur = 0;
      // 3) 몸통: 어두운 색 위에 기본 색, 위쪽에 밝은 줄을 얹어 원통처럼
      shaft();
      ctx.lineWidth = width;
      ctx.strokeStyle = palette.dark;
      ctx.stroke();
      shaft();
      ctx.lineWidth = width * 0.7;
      ctx.strokeStyle = palette.base;
      ctx.stroke();
      ctx.save();
      ctx.translate(0, -width * 0.22);
      shaft();
      ctx.lineWidth = width * 0.22;
      ctx.strokeStyle = palette.light;
      ctx.stroke();
      ctx.restore();
      head();
      const hg = ctx.createLinearGradient(end.x, end.y - headLen, end.x, end.y + headLen);
      hg.addColorStop(0, palette.light);
      hg.addColorStop(0.45, palette.base);
      hg.addColorStop(1, palette.dark);
      ctx.fillStyle = hg;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = palette.dark;
      ctx.stroke();

      if (progress === 1) {
        const label = `${bet.action.type === 'BET_CORRECT' ? '⭕' : '❌'} ${bet.delta > 0 ? '+' : ''}${bet.delta}${mine ? ' 나' : ''}`;
        ctx.font = `900 ${mine ? 30 : 24}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const top = q(0.5);
        const w = ctx.measureText(label).width + 22;
        const h = mine ? 40 : 32;
        ctx.beginPath();
        ctx.roundRect(top.x - w / 2, top.y - h / 2 - 4, w, h, h / 2);
        ctx.fillStyle = palette.base;
        ctx.fill();
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#fff';
        ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.fillText(label, top.x, top.y - 3);
      }
      ctx.restore();
    }
  }

  // 7장: 캐릭터 오른쪽 위에 이모티콘 말풍선
  private drawEmoteBubble(ctx: CanvasRenderingContext2D, x: number, y: number, age: number, emote: EmoteType): void {
    const pop = Math.min(1, age / 150);
    const fade = age > EMOTE_BUBBLE_MS - 300 ? (EMOTE_BUBBLE_MS - age) / 300 : 1;
    // 머리 위 점수 팝업과 겹치지 않도록 오른쪽 위에 띄운다
    const cx = x + 78;
    const cy = y - CHARACTER_SIZE * 0.75;
    ctx.save();
    ctx.globalAlpha = Math.max(0, fade);
    ctx.translate(cx, cy);
    ctx.scale(pop, pop);
    // 말풍선과 꼬리를 하나의 외곽선으로 그려 이음매 선이 생기지 않게 한다
    const rx = 40;
    const ry = 34;
    const a1 = Math.PI * 0.62; // 꼬리 오른쪽 뿌리
    const a2 = Math.PI * 0.76; // 꼬리 왼쪽 뿌리
    ctx.beginPath();
    ctx.ellipse(0, 0, rx, ry, 0, a2, a1 + Math.PI * 2);
    ctx.lineTo(-30, 46); // 꼬리 끝
    ctx.closePath();
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.25)';
    ctx.shadowBlur = 10;
    ctx.shadowOffsetY = 4;
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.restore();
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(40, 30, 20, 0.8)';
    ctx.stroke();
    const wobble = Math.sin(age / 90) * 0.08;
    ctx.rotate(wobble);
    ctx.font = '44px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(EMOTES.find((e) => e.type === emote)?.emoji ?? '🙂', 0, 3);
    ctx.restore();
  }

  // 3장: 정답 공개 때 캐릭터 머리 위에 점수 변동(+10, -3 등). 통통 튀어나오는 유리 알약.
  private drawPopup(ctx: CanvasRenderingContext2D, id: string, x: number, y: number, now: number): void {
    const delta = this.reveal?.deltas.get(id);
    if (delta === undefined) return;
    const t = Math.min(1, (now - this.reveal!.shownAt) / POPUP_RISE_MS);
    // easeOutBack: 살짝 커졌다 제자리
    const c1 = 1.70158;
    const pop = 1 + (c1 + 1) * (t - 1) ** 3 + c1 * (t - 1) ** 2;
    const text = delta > 0 ? `+${delta}` : String(delta);
    const py = y - CHARACTER_SIZE / 2 - 34 - Math.min(1, t * 1.4) * 22;
    ctx.save();
    ctx.globalAlpha = Math.min(1, t * 2);
    this.drawGlassPill(ctx, x, py, text, delta > 0 ? 'gold' : delta < 0 ? 'red' : 'grey', 30, Math.max(0.01, pop));
    ctx.restore();
  }
}
