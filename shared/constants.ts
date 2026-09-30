import type { CharacterKey, Choice, EmoteType } from './types.ts';

// 5장: 1440×800 논리 좌표계(가로 화면)
export const FIELD_WIDTH = 1440;
export const FIELD_HEIGHT = 800;
export const TILE_SIZE = 80;
// 캐릭터가 화면 밖으로 반쯤 나가지 않도록 목표 지점을 경계에서 이만큼 안쪽으로 자른다
export const FIELD_MARGIN = 32;
// 아래쪽은 발밑 닉네임 라벨까지 보이도록 더 넉넉히 둔다
export const FIELD_MARGIN_BOTTOM = 72;

// 5장: 시작 위치는 하단 대기 영역(y 670~720)
export const SPAWN_AREA = { minX: 220, maxX: FIELD_WIDTH - 220, minY: 670, maxY: 720 }; // 광장 안쪽

// 5장: 상단 약 300은 문제 UI와 선택지 글자 자리라 원을 두지 않는다.
// 세 원은 한 줄로 놓이고 서로 겹치지 않는다(중심 간 거리 420 ≥ 지름 300).
export const ANSWER_CIRCLES: Record<Choice, { x: number; y: number; r: number; color: string }> = {
  A: { x: 300, y: 470, r: 150, color: 'rgba(235, 64, 52, 0.55)' },
  B: { x: 720, y: 470, r: 150, color: 'rgba(40, 110, 230, 0.55)' },
  C: { x: 1140, y: 470, r: 150, color: 'rgba(20, 150, 70, 0.55)' },
};

export const MOVE_SPEED = 320; // 논리 단위/초
export const TICK_HZ = 10;
export const TICK_MS = 1000 / TICK_HZ;

// 1장: 플레이어 최대 15명(관리자 미포함)
export const MAX_PLAYERS = 15;

export const NICKNAME_MIN = 1;
export const NICKNAME_MAX = 8;

// 1장·6장: 연습 3문제가 맨 앞, 이어서 본 게임 20문제
export const PRACTICE_COUNT = 3;
export const MAIN_COUNT = 20;

export const DEFAULT_TIME_LIMIT_SEC = 120;
// 7장: 찍기(맞힘·틀림·초기화)는 문제 시작 후 30초까지만. 이모티콘·이동은 계속 가능.
export const BET_WINDOW_MS = 30_000;

// 찍기 마감 시각: 시작 + 30초, 단 문제 제한 시간이 더 짧으면 그때까지
export function betDeadline(questionStartedAt: number, deadline: number): number {
  return Math.min(questionStartedAt + BET_WINDOW_MS, deadline);
}
export const SCORE_CORRECT = 10;
export const SCORE_BET = 3;
// 7장: 이모티콘 말풍선 표시 시간과 연타 방지 쿨다운
export const EMOTE_BUBBLE_MS = 3000;
export const EMOTE_COOLDOWN_MS = 1000;

export const EMOTES: { type: EmoteType; emoji: string; label: string }[] = [
  { type: 'LAUGH', emoji: '😆', label: '웃기' },
  { type: 'CRY', emoji: '😭', label: '울기' },
  { type: 'ANGRY', emoji: '😡', label: '화내기' },
  { type: 'THUMBS_UP', emoji: '👍', label: '따봉' },
  { type: 'THUMBS_DOWN', emoji: '👎', label: '역따봉' },
];

export const CHARACTERS: { key: CharacterKey; name: string; color: string }[] = [
  { key: 'orange_mushroom', name: '주황버섯', color: '#f39c3d' },
  { key: 'snail', name: '달팽이', color: '#8e6b4a' },
  { key: 'slime', name: '슬라임', color: '#5cc26b' },
  { key: 'pepe', name: '페페', color: '#3f9bd8' },
  { key: 'pig', name: '돼지', color: '#f08bb0' },
  { key: 'green_mushroom', name: '초록 버섯', color: '#40c057' },
  { key: 'ribbon_pig', name: '리본 돼지', color: '#f06595' },
  { key: 'red_snail', name: '빨간 달팽이', color: '#e8453c' },
  { key: 'blue_slime', name: '파란 슬라임', color: '#4dabf7' },
  { key: 'dark_pepe', name: '다크 페페', color: '#495057' },
  { key: 'warrior', name: '전사', color: '#c92a2a' },
  { key: 'archer', name: '궁수', color: '#37b24d' },
  { key: 'magician', name: '마법사', color: '#4263eb' },
  { key: 'thief', name: '도적', color: '#6741d9' },
  { key: 'pirate', name: '해적', color: '#1c5ea8' },
];

// 4장: 관리자 고정 캐릭터·닉네임. 플레이어는 선택·사용 불가
export const ADMIN_CHARACTER = 'admin' as const;
export const ADMIN_ID = 'admin'; // 위치 브로드캐스트에서 관리자를 가리키는 id (플레이어 id는 UUID)
export const ADMIN_NICKNAME = '관리자';
export const ADMIN_COLOR = '#d4a017';

export function characterImageUrl(key: CharacterKey | typeof ADMIN_CHARACTER): string {
  return `/assets/characters/${key}.png`;
}

// 5장 답 판정: 캐릭터 중심과 원 중심의 거리가 반지름 이하인 원. 원끼리 겹치지 않으므로 최대 1개.
export function circleAt(x: number, y: number): Choice | null {
  for (const choice of ['A', 'B', 'C'] as const) {
    const c = ANSWER_CIRCLES[choice];
    if (Math.hypot(x - c.x, y - c.y) <= c.r) return choice;
  }
  return null;
}
