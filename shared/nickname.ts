import { ADMIN_NICKNAME, NICKNAME_MAX, NICKNAME_MIN } from './constants.ts';

// 4장: 앞뒤 공백 제거 후 1~8자. 한글·이모지도 한 글자로 센다.
export function normalizeNickname(raw: string): string {
  return raw.trim();
}

export function nicknameLength(nickname: string): number {
  return [...nickname].length;
}

export function isValidNicknameLength(nickname: string): boolean {
  const len = nicknameLength(nickname);
  return len >= NICKNAME_MIN && len <= NICKNAME_MAX;
}

// 중복 비교용 키(대소문자 무시)
export function nicknameKey(nickname: string): string {
  return normalizeNickname(nickname).toLowerCase();
}

export function isReservedNickname(nickname: string): boolean {
  return nicknameKey(nickname) === nicknameKey(ADMIN_NICKNAME);
}
