import {
  ADMIN_CHARACTER,
  ADMIN_COLOR,
  ADMIN_ID,
  ADMIN_NICKNAME,
  ANSWER_CIRCLES,
  CHARACTERS,
  FIELD_HEIGHT,
  FIELD_WIDTH,
  TICK_MS,
  TILE_SIZE,
  characterImageUrl,
  circleAt,
} from '../../shared/constants.ts';
import type {
  AdminCharacterKey,
  CharacterKey,
  Choice,
  PlayerPosition,
  RevealPayload,
  StateSnapshot,
} from '../../shared/types.ts';

const CHARACTER_SIZE = 76;
const TILE_COLORS = ['#7cc576', '#6db767'];
// 스냅샷 간격보다 조금 길게 보간해 네트워크 지터에도 끊기지 않게 한다
const LERP_MS = TICK_MS + 30;
const MOVE_SEND_INTERVAL_MS = 100;
const POPUP_RISE_MS = 700;

type AnyCharacter = CharacterKey | AdminCharacterKey;

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
  shownAt: number;
}

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

function placeholderInfo(key: AnyCharacter): { name: string; color: string } {
  if (key === ADMIN_CHARACTER) return { name: ADMIN_NICKNAME, color: ADMIN_COLOR };
  return CHARACTERS.find((c) => c.key === key) ?? { name: '?', color: '#999' };
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
    this.setReveal(snapshot.phase === 'REVEAL' ? snapshot.lastRound : null);
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
    this.reveal = {
      questionId: round.questionId,
      correct: round.correct,
      deltas: new Map(Object.entries(round.perPlayer).map(([id, r]) => [id, r.total])),
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
    this.host.style.setProperty('--field-width', `${cssW}px`);
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
    this.drawTouchMarker(ctx, now);
    for (const d of drawn) this.drawCharacter(ctx, d.sprite, d.x, d.y, d.moving, now);
    if (this.reveal) for (const d of drawn) this.drawPopup(ctx, d.sprite.entity.id, d.x, d.y, now);
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
        ctx.font = '900 36px system-ui, sans-serif';
        ctx.fillStyle = '#ffd23f';
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
        ctx.lineWidth = 6;
        ctx.strokeText('정답', c.x, c.y - c.r - 30);
        ctx.fillText('정답', c.x, c.y - c.r - 30);
      }
      ctx.restore();
    }
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
      const info = placeholderInfo(entity.character);
      ctx.beginPath();
      ctx.arc(x, top + size / 2, size / 2 - 4, 0, Math.PI * 2);
      ctx.fillStyle = info.color;
      ctx.fill();
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.2)';
      ctx.stroke();
      ctx.font = '800 34px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#fff';
      ctx.fillText(info.name.slice(0, 1), x, top + size / 2 + 2);
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
