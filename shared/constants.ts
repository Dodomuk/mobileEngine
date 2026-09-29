import type { CharacterKey, Choice } from './types.ts';

// 5장: 768×1280 논리 좌표계
export const FIELD_WIDTH = 768;
export const FIELD_HEIGHT = 1280;
export const TILE_SIZE = 64;

// 5장: 시작 위치는 하단 대기 영역(y 1050~1200)
export const SPAWN_AREA = { minX: 64, maxX: FIELD_WIDTH - 64, minY: 1050, maxY: 1200 };

export const ANSWER_CIRCLES: Record<Choice, { x: number; y: number; r: number; color: string }> = {
  A: { x: 192, y: 440, r: 150, color: 'rgba(231, 76, 60, 0.35)' },
  B: { x: 576, y: 440, r: 150, color: 'rgba(52, 120, 219, 0.35)' },
  C: { x: 384, y: 820, r: 150, color: 'rgba(46, 174, 96, 0.35)' },
};

export const MOVE_SPEED = 320; // 논리 단위/초
export const TICK_HZ = 10;

// 1장: 플레이어 최대 15명(관리자 미포함)
export const MAX_PLAYERS = 15;

export const NICKNAME_MIN = 1;
export const NICKNAME_MAX = 8;

export const DEFAULT_TIME_LIMIT_SEC = 120;
export const SCORE_CORRECT = 10;
export const SCORE_BET = 2;

export const CHARACTERS: { key: CharacterKey; name: string; color: string }[] = [
  { key: 'orange_mushroom', name: '주황버섯', color: '#f39c3d' },
  { key: 'snail', name: '달팽이', color: '#8e6b4a' },
  { key: 'slime', name: '슬라임', color: '#5cc26b' },
  { key: 'pepe', name: '페페', color: '#3f9bd8' },
  { key: 'pig', name: '돼지', color: '#f08bb0' },
];

// 4장: 관리자 고정 캐릭터·닉네임. 플레이어는 선택·사용 불가
export const ADMIN_CHARACTER = 'admin' as const;
export const ADMIN_NICKNAME = '관리자';
export const ADMIN_COLOR = '#d4a017';

export function characterImageUrl(key: CharacterKey | typeof ADMIN_CHARACTER): string {
  return `/assets/characters/${key}.png`;
}
