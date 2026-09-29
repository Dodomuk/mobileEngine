import {
  ADMIN_CHARACTER,
  ADMIN_ID,
  ADMIN_NICKNAME,
  ANSWER_CIRCLES,
  FIELD_HEIGHT,
  LAUGH_BUBBLE_MS,
  FIELD_WIDTH,
  TICK_MS,
  TILE_SIZE,
  characterImageUrl,
  circleAt,
} from '../../shared/constants.ts';
import type {
  Choice,
  PlayerPosition,
  PublicQuestion,
  RevealPayload,
  RoundAction,
  StateSnapshot,
} from '../../shared/types.ts';
import { drawCharacterArt, type AnyCharacter } from './characters.ts';

const CHARACTER_SIZE = 76;
const TILE_COLORS = ['#7cc576', '#6db767'];
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
const CHOICE_MAX_WIDTH = 390;

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
  private laughs = new Map<string, number>(); // 플레이어 id → 말풍선 시작 시각

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

    // 5장: 판정 뒤(REVEAL·RESULT)에는 이동 입력을 보내지 않는다
    this.inputEnabled = snapshot.phase === 'LOBBY' || snapshot.phase === 'QUESTION';
    this.choices = snapshot.question?.choices ?? null;
    this.setReveal(snapshot.phase === 'REVEAL' ? snapshot.lastRound : null);
  }

  // 7장: 웃는 표정 말풍선 3초
  showLaugh(playerId: string): void {
    this.laughs.set(playerId, performance.now());
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

    this.drawTiles(ctx);
    this.drawCircles(ctx, choice);
    this.drawChoiceLabels(ctx);
    this.drawTouchMarker(ctx, now);
    for (const d of drawn) this.drawCharacter(ctx, d.sprite, d.x, d.y, d.moving, now);
    const at = new Map(drawn.map((d) => [d.sprite.entity.id, d]));
    if (this.reveal) {
      this.drawBets(ctx, at, now);
      for (const d of drawn) this.drawPopup(ctx, d.sprite.entity.id, d.x, d.y, now);
    }
    for (const [id, start] of this.laughs) {
      const d = at.get(id);
      if (!d || now - start > LAUGH_BUBBLE_MS) {
        this.laughs.delete(id);
        continue;
      }
      this.drawLaughBubble(ctx, d.x, d.y, now - start);
    }
  };

  private drawTiles(ctx: CanvasRenderingContext2D): void {
    for (let row = 0; row < FIELD_HEIGHT / TILE_SIZE; row++) {
      for (let col = 0; col < FIELD_WIDTH / TILE_SIZE; col++) {
        ctx.fillStyle = TILE_COLORS[(row + col) % 2];
        ctx.fillRect(col * TILE_SIZE, row * TILE_SIZE, TILE_SIZE, TILE_SIZE);
      }
    }
  }

  private drawCircles(ctx: CanvasRenderingContext2D, myChoice: Choice | null): void {
    const correct = this.reveal?.correct;
    for (const choice of ['A', 'B', 'C'] as const) {
      const c = ANSWER_CIRCLES[choice];
      // 정답 공개 때는 정답 원만 강조하고 나머지는 흐리게
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
        ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
        ctx.fill();
      }
      ctx.lineWidth = isCorrect ? 14 : active ? 10 : 5;
      ctx.strokeStyle = isCorrect ? '#ffd23f' : active ? 'rgba(255, 255, 255, 0.95)' : 'rgba(255, 255, 255, 0.6)';
      ctx.stroke();

      ctx.font = '900 140px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = active || isCorrect ? 'rgba(255, 255, 255, 0.95)' : 'rgba(255, 255, 255, 0.7)';
      ctx.fillText(choice, c.x, c.y + 8);

      if (isCorrect) {
        ctx.font = '900 34px system-ui, sans-serif';
        ctx.fillStyle = '#ffd23f';
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
        ctx.lineWidth = 6;
        ctx.strokeText('정답', c.x, c.y + c.r - 34);
        ctx.fillText('정답', c.x, c.y + c.r - 34);
      }
      ctx.restore();
    }
  }

  // 선택지 글자를 각 원 바로 위에 보여 준다(문제 텍스트는 없음)
  private drawChoiceLabels(ctx: CanvasRenderingContext2D): void {
    if (!this.choices) return;
    const correct = this.reveal?.correct;
    ctx.save();
    ctx.font = CHOICE_FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const choice of ['A', 'B', 'C'] as const) {
      const c = ANSWER_CIRCLES[choice];
      const lines = wrapText(ctx, this.choices[choice], CHOICE_MAX_WIDTH, 3);
      const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 36;
      const h = lines.length * CHOICE_LINE + 18;
      const bottom = c.y - c.r - 12;
      const isCorrect = choice === correct;
      ctx.globalAlpha = correct !== undefined && !isCorrect ? 0.45 : 1;
      ctx.beginPath();
      ctx.roundRect(c.x - w / 2, bottom - h, w, h, 16);
      ctx.fillStyle = isCorrect ? '#ffe066' : 'rgba(255, 255, 255, 0.94)';
      ctx.fill();
      ctx.lineWidth = isCorrect ? 5 : 3;
      ctx.strokeStyle = isCorrect ? '#f08c00' : c.color.replace(/[\d.]+\)$/, '0.9)');
      ctx.stroke();
      ctx.fillStyle = '#1f2a24';
      lines.forEach((line, i) => ctx.fillText(line, c.x, bottom - h + 9 + CHOICE_LINE * (i + 0.5) + 1));
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

  // 7장: 정답 공개 때 누가 누구를 찍었는지 화살표로 보여 준다(맞히면 초록, 틀리면 빨강)
  private drawBets(
    ctx: CanvasRenderingContext2D,
    at: Map<string, { x: number; y: number }>,
    now: number,
  ): void {
    const progress = Math.min(1, (now - this.reveal!.shownAt) / 600);
    for (const bet of this.reveal!.bets) {
      const from = at.get(bet.from);
      const to = at.get(bet.to);
      if (!from || !to) continue;
      const color = bet.delta > 0 ? '#2fbf71' : bet.delta < 0 ? '#f04848' : '#9aa5a0';
      const x1 = from.x;
      const y1 = from.y - CHARACTER_SIZE * 0.5;
      const x2 = from.x + (to.x - from.x) * progress;
      const y2 = from.y - CHARACTER_SIZE * 0.5 + (to.y - from.y) * progress;
      // 위로 휘는 곡선
      const mx = (x1 + x2) / 2;
      const my = Math.min(y1, y2) - 60 - Math.abs(x2 - x1) * 0.12;

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.quadraticCurveTo(mx, my, x2, y2);
      ctx.lineWidth = 6;
      ctx.strokeStyle = color;
      ctx.setLineDash([14, 10]);
      ctx.stroke();
      ctx.setLineDash([]);
      if (progress === 1) {
        const angle = Math.atan2(y2 - my, x2 - mx);
        ctx.beginPath();
        ctx.moveTo(x2, y2);
        ctx.lineTo(x2 - 20 * Math.cos(angle - 0.45), y2 - 20 * Math.sin(angle - 0.45));
        ctx.lineTo(x2 - 20 * Math.cos(angle + 0.45), y2 - 20 * Math.sin(angle + 0.45));
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.fill();

        const label = `${bet.action.type === 'BET_CORRECT' ? '👍' : '👎'} ${bet.delta > 0 ? '+' : ''}${bet.delta}`;
        ctx.font = '800 24px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const lx = 0.25 * x1 + 0.5 * mx + 0.25 * x2;
        const ly = 0.25 * y1 + 0.5 * my + 0.25 * y2;
        const w = ctx.measureText(label).width + 18;
        ctx.beginPath();
        ctx.roundRect(lx - w / 2, ly - 16, w, 32, 16);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.fillText(label, lx, ly + 1);
      }
      ctx.restore();
    }
  }

  // 7장: 내 캐릭터 위에 웃는 표정 말풍선
  private drawLaughBubble(ctx: CanvasRenderingContext2D, x: number, y: number, age: number): void {
    const pop = Math.min(1, age / 150);
    const fade = age > LAUGH_BUBBLE_MS - 300 ? (LAUGH_BUBBLE_MS - age) / 300 : 1;
    // 머리 위 점수 팝업과 겹치지 않도록 오른쪽 위에 띄운다
    const cx = x + 78;
    const cy = y - CHARACTER_SIZE * 0.75;
    ctx.save();
    ctx.globalAlpha = Math.max(0, fade);
    ctx.translate(cx, cy);
    ctx.scale(pop, pop);
    // 말풍선
    ctx.beginPath();
    ctx.ellipse(0, 0, 40, 32, 0, 0, Math.PI * 2);
    ctx.moveTo(-18, 24);
    ctx.lineTo(-30, 42);
    ctx.lineTo(-4, 30);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(40, 30, 20, 0.8)';
    ctx.stroke();
    // 웃는 얼굴
    ctx.beginPath();
    ctx.arc(0, 0, 22, 0, Math.PI * 2);
    ctx.fillStyle = '#ffd43b';
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.stroke();
    const wobble = Math.sin(age / 90) * 1.5;
    ctx.beginPath();
    ctx.moveTo(-12, -4 + wobble); ctx.quadraticCurveTo(-7, -11 + wobble, -2, -4 + wobble);
    ctx.moveTo(2, -4 + wobble); ctx.quadraticCurveTo(7, -11 + wobble, 12, -4 + wobble);
    ctx.lineWidth = 2.8;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-11, 3);
    ctx.quadraticCurveTo(0, 18, 11, 3);
    ctx.closePath();
    ctx.fillStyle = '#c92a2a';
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  // 3장: 정답 공개 때 캐릭터 머리 위에 점수 변동(+10, -2 등) 팝업
  private drawPopup(ctx: CanvasRenderingContext2D, id: string, x: number, y: number, now: number): void {
    const delta = this.reveal?.deltas.get(id);
    if (delta === undefined) return;
    const t = Math.min(1, (now - this.reveal!.shownAt) / POPUP_RISE_MS);
    const ease = 1 - (1 - t) ** 3;
    const text = delta > 0 ? `+${delta}` : String(delta);
    const py = y - CHARACTER_SIZE / 2 - 20 - ease * 30;

    ctx.save();
    ctx.globalAlpha = t;
    ctx.font = '900 40px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 8;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.strokeText(text, x, py);
    ctx.fillStyle = delta > 0 ? '#ffe14d' : delta < 0 ? '#ff7a7a' : '#ffffff';
    ctx.fillText(text, x, py);
    ctx.restore();
  }
}
