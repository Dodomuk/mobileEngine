import { FIELD_HEIGHT, FIELD_WIDTH, TILE_SIZE } from '../../shared/constants.ts';

// 광장(블록 타일)과 양옆 자연 배경. 장식일 뿐 이동·판정과는 무관하다(위로 걸어 다닐 수 있음).
// 모든 좌표는 필드 논리 좌표(1440×800).

// 광장은 A원 왼쪽 끝(150)부터 C원 오른쪽 끝(1290)까지
export const PLAZA_LEFT = 150;
export const PLAZA_RIGHT = FIELD_WIDTH - 150;

const TILE_COLORS = ['#8fd18a', '#7fc47a'];
const GRASS = '#5aa84e';

// 왼쪽 강의 중심선: 위에서 아래로 살짝 굽이친다
const RIVER_WIDTH = 58;
function riverX(y: number): number {
  return 62 + Math.sin(y / 120) * 16;
}

// 매 판 똑같은 배치가 나오도록 고정 시드 난수
function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

// 움직이지 않는 부분. 해상도가 바뀔 때만 오프스크린 캔버스에 한 번 그린다.
export function drawScenery(ctx: CanvasRenderingContext2D): void {
  // 풀밭
  ctx.fillStyle = GRASS;
  ctx.fillRect(0, 0, FIELD_WIDTH, FIELD_HEIGHT);
  const rand = seeded(7);
  for (let i = 0; i < 260; i++) {
    const x = rand() * FIELD_WIDTH;
    const y = rand() * FIELD_HEIGHT;
    if (x > PLAZA_LEFT && x < PLAZA_RIGHT) continue;
    ctx.fillStyle = rand() > 0.5 ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 60, 0, 0.12)';
    ctx.beginPath();
    ctx.ellipse(x, y, 6 + rand() * 8, 3 + rand() * 3, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  drawRiver(ctx);

  // 광장 블록 타일 + 테두리 돌
  ctx.save();
  ctx.beginPath();
  ctx.rect(PLAZA_LEFT, 0, PLAZA_RIGHT - PLAZA_LEFT, FIELD_HEIGHT);
  ctx.clip();
  for (let row = 0; row * TILE_SIZE < FIELD_HEIGHT; row++) {
    for (let col = 0; PLAZA_LEFT + col * TILE_SIZE < PLAZA_RIGHT; col++) {
      const x = PLAZA_LEFT + col * TILE_SIZE;
      const y = row * TILE_SIZE;
      ctx.fillStyle = TILE_COLORS[(row + col) % 2];
      ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);
      // 블록 입체감: 위·왼쪽 밝게, 아래·오른쪽 어둡게
      ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
      ctx.fillRect(x, y, TILE_SIZE, 4);
      ctx.fillRect(x, y, 4, TILE_SIZE);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.08)';
      ctx.fillRect(x, y + TILE_SIZE - 4, TILE_SIZE, 4);
      ctx.fillRect(x + TILE_SIZE - 4, y, 4, TILE_SIZE);
    }
  }
  ctx.restore();
  for (const x of [PLAZA_LEFT, PLAZA_RIGHT]) {
    for (let y = 0; y < FIELD_HEIGHT; y += 40) {
      ctx.beginPath();
      ctx.roundRect(x - 7, y + 2, 14, 36, 5);
      ctx.fillStyle = y % 80 === 0 ? '#c9c2b0' : '#b8b09c';
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = 'rgba(80, 70, 50, 0.45)';
      ctx.stroke();
    }
  }

  // 왼쪽: 강가의 나무·바위·갈대
  rock(ctx, 22, 205, 16);
  rock(ctx, 118, 560, 13);
  reeds(ctx, 104, 330);
  reeds(ctx, 20, 640);
  tree(ctx, 122, 120, 44, '#3f9142');
  tree(ctx, 124, 440, 38, '#4a9d3b');
  tree(ctx, 118, 760, 46, '#37853a');

  // 오른쪽: 숲과 꽃밭
  flowers(ctx, 1310, 1430, 60, 780, 11);
  bush(ctx, 1318, 250, 22);
  bush(ctx, 1410, 560, 26);
  rock(ctx, 1330, 690, 14);
  tree(ctx, 1385, 110, 48, '#3f9142');
  tree(ctx, 1345, 380, 40, '#4a9d3b');
  tree(ctx, 1400, 470, 44, '#2f7d32');
  tree(ctx, 1380, 740, 50, '#37853a');
}

function drawRiver(ctx: CanvasRenderingContext2D): void {
  const path = (offset: number) => {
    ctx.beginPath();
    ctx.moveTo(riverX(-20) - offset, -20);
    for (let y = -20; y <= FIELD_HEIGHT + 20; y += 20) ctx.lineTo(riverX(y) - offset, y);
    for (let y = FIELD_HEIGHT + 20; y >= -20; y -= 20) ctx.lineTo(riverX(y) + offset, y);
    ctx.closePath();
  };
  // 모래 강둑
  path(RIVER_WIDTH / 2 + 9);
  ctx.fillStyle = '#e0cf98';
  ctx.fill();
  // 물
  path(RIVER_WIDTH / 2);
  const g = ctx.createLinearGradient(20, 0, 110, 0);
  g.addColorStop(0, '#2b83d6');
  g.addColorStop(0.5, '#5cb3f0');
  g.addColorStop(1, '#2b83d6');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(20, 70, 140, 0.5)';
  ctx.stroke();
}

// 움직이는 물결. 매 프레임 배경 위에 덧그린다.
export function drawWater(ctx: CanvasRenderingContext2D, t: number): void {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
  ctx.lineWidth = 3;
  const flow = (t / 18) % 90;
  for (let y = -90 + flow; y < FIELD_HEIGHT + 90; y += 90) {
    for (const [dx, dy] of [[-12, 0], [10, 45]] as const) {
      const yy = y + dy;
      const x = riverX(yy) + dx;
      ctx.beginPath();
      ctx.moveTo(x - 7, yy);
      ctx.quadraticCurveTo(x, yy + 6, x + 7, yy);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function tree(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, leaf: string): void {
  // 그림자
  ctx.beginPath();
  ctx.ellipse(x + 6, y + 6, r * 0.9, r * 0.28, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
  ctx.fill();
  // 줄기
  ctx.beginPath();
  ctx.roundRect(x - r * 0.16, y - r * 0.9, r * 0.32, r * 0.95, 4);
  const trunk = ctx.createLinearGradient(x - r * 0.16, 0, x + r * 0.16, 0);
  trunk.addColorStop(0, '#9c6b3f');
  trunk.addColorStop(1, '#5e3d20');
  ctx.fillStyle = trunk;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(50, 30, 15, 0.8)';
  ctx.stroke();
  // 잎(겹친 원 세 덩이)
  for (const [dx, dy, rr] of [[-0.45, -1.05, 0.62], [0.45, -1.05, 0.62], [0, -1.5, 0.72]] as const) {
    const cx = x + dx * r;
    const cy = y + dy * r;
    const g = ctx.createRadialGradient(cx - rr * r * 0.35, cy - rr * r * 0.4, 2, cx, cy, rr * r);
    g.addColorStop(0, '#8fd46a');
    g.addColorStop(0.5, leaf);
    g.addColorStop(1, '#1f5a24');
    ctx.beginPath();
    ctx.arc(cx, cy, rr * r, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(20, 60, 20, 0.6)';
    ctx.stroke();
  }
}

function bush(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  for (const [dx, dy] of [[-0.6, 0], [0.6, 0], [0, -0.45]] as const) {
    const cx = x + dx * r;
    const cy = y + dy * r;
    const g = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.3, 1, cx, cy, r);
    g.addColorStop(0, '#9ade6f');
    g.addColorStop(1, '#2f7d32');
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.75, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(x + r * 0.3, y - r * 0.5, 3.5, 0, Math.PI * 2);
  ctx.fillStyle = '#ff6b6b';
  ctx.fill();
}

function rock(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.ellipse(x, y, r * 1.3, r, 0, 0, Math.PI * 2);
  const g = ctx.createRadialGradient(x - r * 0.4, y - r * 0.4, 1, x, y, r * 1.3);
  g.addColorStop(0, '#e9ecef');
  g.addColorStop(1, '#868e96');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(40, 40, 40, 0.5)';
  ctx.stroke();
}

function reeds(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.lineCap = 'round';
  for (const [dx, h, lean] of [[-6, 34, -4], [0, 44, 2], [6, 30, 6]] as const) {
    ctx.beginPath();
    ctx.moveTo(x + dx, y);
    ctx.quadraticCurveTo(x + dx + lean * 0.3, y - h * 0.6, x + dx + lean, y - h);
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#3d7a2e';
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(x + dx + lean, y - h, 3, 7, lean * 0.05, 0, Math.PI * 2);
    ctx.fillStyle = '#8b5a2b';
    ctx.fill();
  }
}

function flowers(ctx: CanvasRenderingContext2D, x1: number, x2: number, y1: number, y2: number, seed: number): void {
  const rand = seeded(seed);
  const colors = ['#ff8787', '#ffd43b', '#ffffff', '#da77f2', '#ffa94d'];
  for (let i = 0; i < 26; i++) {
    const x = x1 + rand() * (x2 - x1);
    const y = y1 + rand() * (y2 - y1);
    const color = colors[Math.floor(rand() * colors.length)];
    for (let p = 0; p < 5; p++) {
      const a = (p / 5) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(x + Math.cos(a) * 4, y + Math.sin(a) * 4, 3.2, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(x, y, 2.4, 0, Math.PI * 2);
    ctx.fillStyle = '#f59f00';
    ctx.fill();
  }
}
