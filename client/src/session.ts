// 4장: playerId·sessionToken을 localStorage에 저장해 새로고침·재접속 때 복귀한다.
// 퀴즈와 빙고는 세션을 따로 저장한다
export const QUIZ_SESSION_KEY = 'abc-quiz:session';
export const BINGO_SESSION_KEY = 'abc-quiz:bingo-session';

export interface Session { playerId: string; sessionToken: string }

export function loadSession(key = QUIZ_SESSION_KEY): Session | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Session>;
    if (typeof parsed.playerId === 'string' && typeof parsed.sessionToken === 'string') {
      return { playerId: parsed.playerId, sessionToken: parsed.sessionToken };
    }
  } catch {
    // 저장소 접근 불가(사생활 보호 모드 등)면 매번 새로 입장
  }
  return null;
}

export function saveSession(session: Session, key = QUIZ_SESSION_KEY): void {
  try {
    localStorage.setItem(key, JSON.stringify(session));
  } catch {
    // 무시: 이번 탭 안에서는 메모리 상태로 계속 진행된다
  }
}

export function clearSession(key = QUIZ_SESSION_KEY): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // 무시
  }
}
