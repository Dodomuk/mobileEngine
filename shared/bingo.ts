// 빙고 게임 공용 규칙·타입. 서버(판정)와 클라이언트(입력 검사)가 같은 함수를 쓴다.
import type { CharacterKey, ErrorPayload } from './types.ts';

export const BINGO_SIZE = 5;
export const BINGO_CELLS = BINGO_SIZE * BINGO_SIZE;
export const BINGO_WIN_LINES = 3;
export const BINGO_MAX_PLAYERS = 15;
export const BINGO_MIN_PLAYERS = 2;
export const BINGO_CELL_MAX = 20;
export const BINGO_TOPIC_MAX = 40;

// 같은 답인지 비교할 때 쓰는 키: 모든 공백(전각 공백 포함)을 지우고 영문 대소문자를 무시한다.
// '안녕', ' 안녕', '안 녕', '     안       녕      '는 모두 같은 키가 된다.
export function bingoKey(text: string): string {
  return text.normalize('NFC').replace(/\s+/g, '').toLowerCase();
}

// 가로 5줄, 세로 5줄, 대각선 2줄 = 12줄
export const BINGO_LINES: number[][] = (() => {
  const lines: number[][] = [];
  const idx = (r: number, c: number) => r * BINGO_SIZE + c;
  for (let r = 0; r < BINGO_SIZE; r++) lines.push([...Array(BINGO_SIZE)].map((_, c) => idx(r, c)));
  for (let c = 0; c < BINGO_SIZE; c++) lines.push([...Array(BINGO_SIZE)].map((_, r) => idx(r, c)));
  lines.push([...Array(BINGO_SIZE)].map((_, i) => idx(i, i)));
  lines.push([...Array(BINGO_SIZE)].map((_, i) => idx(i, BINGO_SIZE - 1 - i)));
  return lines;
})();

export function completedLines(marked: boolean[]): number[][] {
  return BINGO_LINES.filter((line) => line.every((i) => marked[i]));
}

export interface BoardProblem { index: number; reason: 'EMPTY' | 'TOO_LONG' | 'DUPLICATE' }

// 25칸 모두 채웠는지, 같은 답(공백·대소문자 무시)을 두 번 쓰지 않았는지 검사한다.
export function checkBoard(cells: readonly string[]): BoardProblem[] {
  const problems: BoardProblem[] = [];
  const firstIndex = new Map<string, number>();
  for (let i = 0; i < BINGO_CELLS; i++) {
    const text = (cells[i] ?? '').trim();
    const key = bingoKey(text);
    if (!key) {
      problems.push({ index: i, reason: 'EMPTY' });
      continue;
    }
    if ([...text].length > BINGO_CELL_MAX) problems.push({ index: i, reason: 'TOO_LONG' });
    const first = firstIndex.get(key);
    if (first === undefined) firstIndex.set(key, i);
    else {
      if (!problems.some((p) => p.index === first && p.reason === 'DUPLICATE')) {
        problems.push({ index: first, reason: 'DUPLICATE' });
      }
      problems.push({ index: i, reason: 'DUPLICATE' });
    }
  }
  return problems;
}

export type BingoPhase = 'LOBBY' | 'FILLING' | 'PLAYING' | 'FINISHED';

export interface BingoPublicPlayer {
  id: string;
  nickname: string;
  character: CharacterKey;
  connected: boolean;
  submitted: boolean;
  lines: number;       // 완성한 줄 수(모두에게 공개)
  inGame: boolean;     // 이번 판 순서에 들어 있는지(시작 때 제출한 사람)
  usedPeek: boolean;
  usedTaunt: boolean;
}

export interface BingoCall { playerId: string; nickname: string; text: string }

// 나에게만 보내는 정보
export interface BingoMe {
  id: string;
  board: string[] | null;  // 제출한 판(제출 전이면 null)
  marked: boolean[];
  submitted: boolean;
  usedPeek: boolean;
  usedTaunt: boolean;
}

export interface BingoSnapshot {
  phase: BingoPhase;
  topic: string;
  players: BingoPublicPlayer[];
  maxPlayers: number;
  order: string[];                 // 부르는 순서(플레이어 id)
  turnPlayerId: string | null;
  calls: BingoCall[];
  winners: string[];
  me: BingoMe | null;
}

// 관리자에게만 보내는 전체 판
export interface BingoAdminBoards {
  boards: Record<string, { board: string[] | null; marked: boolean[] }>;
}

export type BingoJoinAck =
  | { ok: true; playerId: string; sessionToken: string }
  | { ok: false; error: ErrorPayload };

export type BingoPeekAck =
  | { ok: true; targetNickname: string; index: number; text: string; marked: boolean }
  | { ok: false; error: ErrorPayload };

export type BingoAck = { ok: true } | { ok: false; error: ErrorPayload };

export interface BingoClientEvents {
  'bingo:join': (payload: { nickname: string; character: CharacterKey }, ack: (res: BingoJoinAck) => void) => void;
  'bingo:resume': (payload: { sessionToken: string }, ack: (res: BingoJoinAck) => void) => void;
  'bingo:submit': (payload: { cells: string[] }, ack: (res: BingoAck) => void) => void;
  'bingo:unsubmit': (ack: (res: BingoAck) => void) => void;
  'bingo:call': (payload: { index: number }, ack: (res: BingoAck) => void) => void;
  'bingo:peek': (payload: { targetId: string; index: number }, ack: (res: BingoPeekAck) => void) => void;
  'bingo:taunt': (payload: { targetId: string }, ack: (res: BingoAck) => void) => void;
  'bingo:admin:auth': (payload: { pin?: string; token?: string }, ack: (res: { ok: true; token: string } | { ok: false; error: ErrorPayload }) => void) => void;
  'bingo:admin:topic': (payload: { topic: string }, ack: (res: BingoAck) => void) => void;
  'bingo:admin:start': (ack: (res: BingoAck) => void) => void;
  'bingo:admin:skip': (ack: (res: BingoAck) => void) => void;
  'bingo:admin:newRound': (ack: (res: BingoAck) => void) => void;
  'bingo:admin:kickAll': (ack: (res: BingoAck) => void) => void;
}

export interface BingoServerEvents {
  'bingo:snapshot': (snapshot: BingoSnapshot) => void;
  'bingo:admin:boards': (payload: BingoAdminBoards) => void;
  'bingo:called': (call: BingoCall & { markedFor: string[] }) => void;
  'bingo:peeked': (payload: { byNickname: string }) => void;
  'bingo:taunted': (payload: { byNickname: string; byCharacter: CharacterKey }) => void;
  'bingo:kicked': () => void;
  'error': (error: ErrorPayload) => void;
}
