import type { AdminCharacterKey, CharacterKey } from '../../shared/types.ts';

// 캐릭터를 코드로 그린다. 빛이 왼쪽 위에서 온다고 보고 방사형 그라데이션·하이라이트·외곽선으로
// 입체감을 준다. /assets/characters/*.png가 있으면 그림 대신 그 이미지를 쓴다(field.ts, avatar.ts).
//
// 모든 캐릭터는 100×100 상자 안에 그린다: x -50~50, y -100(머리 끝)~0(발바닥).

export type AnyCharacter = CharacterKey | AdminCharacterKey;

export interface DrawOptions {
  t?: number;        // 애니메이션 시간(ms)
  facing?: 1 | -1;   // 1: 오른쪽
  moving?: boolean;
}

const OUTLINE = 'rgba(45, 28, 18, 0.9)';

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// amount > 0이면 밝게, < 0이면 어둡게
function shade(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex);
  const mix = (c: number) => Math.round(amount >= 0 ? c + (255 - c) * amount : c * (1 + amount));
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}

// 왼쪽 위가 밝고 가장자리가 어두운 공 모양 그라데이션
function ball(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, base: string): CanvasGradient {
  const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.45, r * 0.05, x, y, r * 1.1);
  g.addColorStop(0, shade(base, 0.55));
  g.addColorStop(0.45, base);
  g.addColorStop(1, shade(base, -0.35));
  return g;
}

function stroke(ctx: CanvasRenderingContext2D, width = 2.6): void {
  ctx.lineWidth = width;
  ctx.strokeStyle = OUTLINE;
  ctx.lineJoin = 'round';
  ctx.stroke();
}

function gloss(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, rot = -0.5, alpha = 0.7): void {
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
  ctx.fill();
  ctx.restore();
}

function eye(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.ellipse(x, y, r * 0.8, r, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#1b1210';
  ctx.fill();
  gloss(ctx, x - r * 0.25, y - r * 0.4, r * 0.3, r * 0.35, 0, 0.95);
}

function blush(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.beginPath();
  ctx.ellipse(x, y, 5, 3, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255, 90, 110, 0.35)';
  ctx.fill();
}

function groundShadow(ctx: CanvasRenderingContext2D, rx: number): void {
  ctx.beginPath();
  ctx.ellipse(0, -1, rx, 6, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
  ctx.fill();
}

// ─── 버섯 (주황버섯, 관리자 파란버섯) ───
function mushroom(ctx: CanvasRenderingContext2D, capColor: string, walk: number): void {
  groundShadow(ctx, 30);
  // 발
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(side * 14 + walk * side * 2, -5, 10, 6, 0, 0, Math.PI * 2);
    ctx.fillStyle = ball(ctx, side * 14, -6, 10, '#d9a86c');
    ctx.fill();
    stroke(ctx, 2.2);
  }
  // 몸통(기둥)
  ctx.beginPath();
  ctx.moveTo(-24, -52);
  ctx.bezierCurveTo(-30, -30, -26, -8, 0, -6);
  ctx.bezierCurveTo(26, -8, 30, -30, 24, -52);
  ctx.closePath();
  ctx.fillStyle = ball(ctx, 0, -30, 30, '#fbe4bd');
  ctx.fill();
  stroke(ctx);
  // 얼굴
  eye(ctx, -9, -30, 5);
  eye(ctx, 9, -30, 5);
  ctx.beginPath(); // 살짝 화난 눈썹
  ctx.moveTo(-15, -40); ctx.lineTo(-5, -37);
  ctx.moveTo(15, -40); ctx.lineTo(5, -37);
  ctx.lineWidth = 2.4; ctx.strokeStyle = OUTLINE; ctx.lineCap = 'round'; ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, -19, 4, 0.15 * Math.PI, 0.85 * Math.PI);
  ctx.lineWidth = 2; ctx.stroke();
  blush(ctx, -15, -22); blush(ctx, 15, -22);
  // 갓
  ctx.beginPath();
  ctx.moveTo(-50, -50);
  ctx.bezierCurveTo(-54, -92, -22, -104, 0, -104);
  ctx.bezierCurveTo(22, -104, 54, -92, 50, -50);
  ctx.bezierCurveTo(30, -42, -30, -42, -50, -50);
  ctx.closePath();
  ctx.fillStyle = ball(ctx, 0, -75, 55, capColor);
  ctx.fill();
  stroke(ctx, 3);
  // 갓 무늬
  const spot = shade(capColor, 0.55);
  for (const [x, y, r] of [[-26, -74, 9], [6, -90, 7], [28, -70, 8], [-6, -66, 5]] as const) {
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * 0.8, 0, 0, Math.PI * 2);
    ctx.fillStyle = spot;
    ctx.fill();
  }
  gloss(ctx, -20, -90, 12, 6, -0.4, 0.55);
}

// ─── 달팽이 ───
function snail(ctx: CanvasRenderingContext2D, walk: number, t: number): void {
  groundShadow(ctx, 40);
  // 몸통(발)
  ctx.beginPath();
  ctx.moveTo(-42, -4);
  ctx.bezierCurveTo(-44, -18, -10, -20, 18, -22);
  ctx.bezierCurveTo(30, -40, 46, -40, 46, -22);
  ctx.bezierCurveTo(48, -8, 40, -3, 30, -3);
  ctx.closePath();
  ctx.fillStyle = ball(ctx, 20, -20, 32, '#f3d68a');
  ctx.fill();
  stroke(ctx);
  // 눈자루
  const sway = Math.sin(t / 300) * 2;
  for (const [bx, tip] of [[30, -58], [40, -54]] as const) {
    ctx.beginPath();
    ctx.moveTo(bx, -34);
    ctx.quadraticCurveTo(bx + 2, -44, bx + 3 + sway, tip);
    ctx.lineWidth = 3; ctx.strokeStyle = shade('#f3d68a', -0.25); ctx.lineCap = 'round'; ctx.stroke();
    ctx.beginPath();
    ctx.arc(bx + 3 + sway, tip, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#fff'; ctx.fill(); stroke(ctx, 1.8);
    eye(ctx, bx + 4 + sway, tip, 2.6);
  }
  ctx.beginPath();
  ctx.arc(40, -24, 4, 0.1 * Math.PI, 0.9 * Math.PI);
  ctx.lineWidth = 2; ctx.strokeStyle = OUTLINE; ctx.stroke();
  // 껍데기
  const sx = -10 + walk;
  ctx.beginPath();
  ctx.arc(sx, -42, 32, 0, Math.PI * 2);
  ctx.fillStyle = ball(ctx, sx, -42, 32, '#4caf50');
  ctx.fill();
  stroke(ctx, 3);
  ctx.beginPath(); // 나선
  for (let a = 0; a < Math.PI * 4.2; a += 0.15) {
    const r = 3 + a * 2;
    const x = sx + Math.cos(a) * r;
    const y = -42 + Math.sin(a) * r;
    if (a === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.lineWidth = 3; ctx.strokeStyle = shade('#4caf50', -0.45); ctx.stroke();
  gloss(ctx, sx - 12, -60, 9, 5, -0.6, 0.6);
}

// ─── 슬라임 ───
function slime(ctx: CanvasRenderingContext2D): void {
  groundShadow(ctx, 38);
  ctx.beginPath();
  ctx.moveTo(-40, -4);
  ctx.bezierCurveTo(-52, -30, -30, -62, -6, -70);
  ctx.bezierCurveTo(-2, -84, 6, -84, 8, -70); // 꼭지
  ctx.bezierCurveTo(32, -62, 52, -30, 40, -4);
  ctx.bezierCurveTo(20, 2, -20, 2, -40, -4);
  ctx.closePath();
  const g = ctx.createRadialGradient(-14, -52, 4, 0, -34, 52);
  g.addColorStop(0, 'rgba(200, 255, 190, 0.98)');
  g.addColorStop(0.45, 'rgba(96, 205, 96, 0.95)');
  g.addColorStop(1, 'rgba(40, 140, 60, 0.98)');
  ctx.fillStyle = g;
  ctx.fill();
  stroke(ctx, 3);
  // 안쪽 반사광
  gloss(ctx, -18, -46, 10, 16, 0.5, 0.55);
  gloss(ctx, -20, -62, 4, 4, 0, 0.9);
  // 얼굴
  eye(ctx, -11, -32, 5.5);
  eye(ctx, 11, -32, 5.5);
  ctx.beginPath();
  ctx.arc(0, -22, 6, 0.1 * Math.PI, 0.9 * Math.PI);
  ctx.lineWidth = 2.4; ctx.strokeStyle = OUTLINE; ctx.stroke();
  blush(ctx, -20, -24); blush(ctx, 20, -24);
}

// ─── 페페(펭귄) ───
function penguin(ctx: CanvasRenderingContext2D, walk: number): void {
  groundShadow(ctx, 30);
  // 발
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(side * 12, -4 - (walk * side > 0 ? 2 : 0), 11, 5, 0, 0, Math.PI * 2);
    ctx.fillStyle = ball(ctx, side * 12, -5, 11, '#ff9f1c');
    ctx.fill();
    stroke(ctx, 2);
  }
  // 날개
  for (const side of [-1, 1]) {
    ctx.save();
    ctx.translate(side * 30, -44);
    ctx.rotate(side * (0.35 + walk * 0.05));
    ctx.beginPath();
    ctx.ellipse(0, 0, 8, 20, 0, 0, Math.PI * 2);
    ctx.fillStyle = ball(ctx, 0, 0, 20, '#2c4a8a');
    ctx.fill();
    stroke(ctx, 2.2);
    ctx.restore();
  }
  // 몸통
  ctx.beginPath();
  ctx.ellipse(0, -46, 32, 42, 0, 0, Math.PI * 2);
  ctx.fillStyle = ball(ctx, 0, -46, 42, '#2f5aa8');
  ctx.fill();
  stroke(ctx, 3);
  // 배
  ctx.beginPath();
  ctx.ellipse(0, -36, 22, 28, 0, 0, Math.PI * 2);
  ctx.fillStyle = ball(ctx, 0, -36, 28, '#ffffff');
  ctx.fill();
  // 눈·부리
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(side * 10, -62, 7, 8, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#fff'; ctx.fill(); stroke(ctx, 1.6);
    eye(ctx, side * 9, -61, 4);
  }
  ctx.beginPath();
  ctx.moveTo(-7, -52); ctx.lineTo(7, -52); ctx.lineTo(0, -44); ctx.closePath();
  ctx.fillStyle = ball(ctx, 0, -50, 8, '#ffb020'); ctx.fill(); stroke(ctx, 1.8);
  blush(ctx, -18, -50); blush(ctx, 18, -50);
  gloss(ctx, -14, -78, 8, 4, -0.5, 0.5);
}

// ─── 돼지 ───
function pig(ctx: CanvasRenderingContext2D, walk: number): void {
  groundShadow(ctx, 38);
  // 다리
  for (const [x, phase] of [[-24, 1], [-10, -1], [10, 1], [24, -1]] as const) {
    ctx.beginPath();
    ctx.roundRect(x - 5, -18 + walk * phase * 1.5, 10, 16, 4);
    ctx.fillStyle = ball(ctx, x, -10, 10, '#f29bb7');
    ctx.fill();
    stroke(ctx, 2);
  }
  // 꼬리
  ctx.beginPath();
  ctx.moveTo(-40, -40);
  ctx.bezierCurveTo(-52, -44, -50, -56, -44, -52);
  ctx.bezierCurveTo(-40, -50, -46, -46, -50, -48);
  ctx.lineWidth = 2.5; ctx.strokeStyle = shade('#f29bb7', -0.3); ctx.stroke();
  // 몸통
  ctx.beginPath();
  ctx.ellipse(0, -40, 42, 30, 0, 0, Math.PI * 2);
  ctx.fillStyle = ball(ctx, 0, -40, 42, '#ffb3c8');
  ctx.fill();
  stroke(ctx, 3);
  // 귀
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(side * 14, -64);
    ctx.lineTo(side * 30, -78);
    ctx.lineTo(side * 32, -58);
    ctx.closePath();
    ctx.fillStyle = ball(ctx, side * 26, -66, 12, '#ff9fb9');
    ctx.fill();
    stroke(ctx, 2.2);
  }
  // 얼굴
  eye(ctx, -14, -48, 4.5);
  eye(ctx, 14, -48, 4.5);
  ctx.beginPath();
  ctx.ellipse(0, -36, 13, 9, 0, 0, Math.PI * 2);
  ctx.fillStyle = ball(ctx, 0, -38, 12, '#ff8fb0');
  ctx.fill();
  stroke(ctx, 2);
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(side * 4.5, -36, 2.2, 3.2, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#7a2e45'; ctx.fill();
  }
  blush(ctx, -26, -38); blush(ctx, 26, -38);
  gloss(ctx, -24, -54, 9, 4, -0.4, 0.45);
}

// 발바닥 가운데를 (x, bottom)에 두고 size 크기로 그린다
export function drawCharacterArt(
  ctx: CanvasRenderingContext2D,
  key: AnyCharacter,
  x: number,
  bottom: number,
  size: number,
  { t = 0, facing = 1, moving = false }: DrawOptions = {},
): void {
  // 숨쉬기(위아래로 살짝 늘었다 줄었다)와 걸을 때 몸을 좌우로 기울이기
  const breathe = Math.sin(t / 380) * 0.035;
  const walk = moving ? Math.sin(t / 70) : 0;
  ctx.save();
  ctx.translate(x, bottom);
  ctx.scale((size / 100) * facing * (1 - breathe * 0.6), (size / 100) * (1 + breathe));
  if (moving) ctx.rotate(walk * 0.06);
  switch (key) {
    case 'orange_mushroom': mushroom(ctx, '#ff8a1f', walk); break;
    case 'admin': mushroom(ctx, '#3d7bea', walk); break;
    case 'snail': snail(ctx, walk, t); break;
    case 'slime': slime(ctx); break;
    case 'pepe': penguin(ctx, walk); break;
    case 'pig': pig(ctx, walk); break;
  }
  ctx.restore();
}
