import { randomBytes, randomUUID } from 'node:crypto';
import {
  BINGO_CELLS,
  BINGO_MAX_PLAYERS,
  BINGO_MIN_PLAYERS,
  BINGO_TOPIC_MAX,
  BINGO_WIN_LINES,
  bingoKey,
  checkBoard,
  completedLines,
  type BingoAdminBoards,
  type BingoCall,
  type BingoPhase,
  type BingoSnapshot,
} from '../../shared/bingo.ts';
import { isReservedNickname, isValidNicknameLength, nicknameKey, normalizeNickname } from '../../shared/nickname.ts';
import type { CharacterKey, ErrorPayload } from '../../shared/types.ts';
import { isCharacterKey } from '../game/room.ts';

export interface BingoPlayer {
  id: string;
  sessionToken: string;
  nickname: string;
  character: CharacterKey;
  connected: boolean;
  board: string[] | null;   // 제출한 판(표시용 원문)
  keys: string[];           // 판 각 칸의 비교용 키
  marked: boolean[];
  usedPeek: boolean;
  usedTaunt: boolean;
}

type Fail = { ok: false; error: ErrorPayload };
export type BingoResult<T = object> = ({ ok: true } & T) | Fail;

function fail(code: ErrorPayload['code'], message: string): Fail {
  return { ok: false, error: { code, message } };
}

const WRONG_PHASE = () => fail('INVALID_PHASE', '지금 단계에서는 할 수 없는 동작입니다.');

function emptyMarks(): boolean[] {
  return Array(BINGO_CELLS).fill(false);
}

export class BingoRoom {
  phase: BingoPhase = 'LOBBY';
  topic = '';
  players: Record<string, BingoPlayer> = {};
  order: string[] = [];
  turnIndex = 0;
  calls: BingoCall[] = [];
  winners: string[] = [];

  constructor(private shuffle: <T>(items: T[]) => T[] = defaultShuffle) {}

  get playerCount(): number {
    return Object.keys(this.players).length;
  }

  get turnPlayerId(): string | null {
    return this.phase === 'PLAYING' ? this.order[this.turnIndex] ?? null : null;
  }

  // 입장: 대기·칸 채우기 단계에서만. 게임 중에는 새로 들어올 수 없다(세션 복귀는 가능).
  join(rawNickname: unknown, character: unknown): BingoResult<{ player: BingoPlayer }> {
    if (typeof rawNickname !== 'string') return fail('INVALID_PAYLOAD', '잘못된 요청입니다.');
    if (!isCharacterKey(character)) return fail('INVALID_CHARACTER', '캐릭터를 선택해 주세요.');
    const nickname = normalizeNickname(rawNickname);
    if (!isValidNicknameLength(nickname)) return fail('INVALID_NICKNAME', '닉네임은 1~8자로 입력해 주세요.');
    const key = nicknameKey(nickname);
    if (isReservedNickname(nickname) || Object.values(this.players).some((p) => nicknameKey(p.nickname) === key)) {
      return fail('NICKNAME_TAKEN', '이미 사용 중인 닉네임입니다.');
    }
    if (this.phase === 'PLAYING' || this.phase === 'FINISHED') {
      return fail('GAME_IN_PROGRESS', '빙고 게임이 진행 중입니다. 다음 판에 들어와 주세요.');
    }
    if (this.playerCount >= BINGO_MAX_PLAYERS) {
      return fail('ROOM_FULL', `방이 가득 찼습니다 (${BINGO_MAX_PLAYERS}/${BINGO_MAX_PLAYERS})`);
    }
    const player: BingoPlayer = {
      id: randomUUID(),
      sessionToken: randomBytes(24).toString('base64url'),
      nickname,
      character,
      connected: true,
      board: null,
      keys: [],
      marked: emptyMarks(),
      usedPeek: false,
      usedTaunt: false,
    };
    this.players[player.id] = player;
    return { ok: true, player };
  }

  resume(sessionToken: unknown): BingoResult<{ player: BingoPlayer }> {
    if (typeof sessionToken !== 'string' || !sessionToken) return fail('INVALID_PAYLOAD', '잘못된 요청입니다.');
    const player = Object.values(this.players).find((p) => p.sessionToken === sessionToken);
    if (!player) return fail('SESSION_NOT_FOUND', '세션이 만료되었습니다. 다시 입장해 주세요.');
    player.connected = true;
    return { ok: true, player };
  }

  setConnected(playerId: string, connected: boolean): void {
    const player = this.players[playerId];
    if (player) player.connected = connected;
  }

  // ─── 관리자 ───

  // 주제를 내면 칸 채우기가 시작된다. 칸 채우기 중에는 주제를 고칠 수 있다.
  setTopic(raw: unknown): BingoResult {
    if (this.phase !== 'LOBBY' && this.phase !== 'FILLING') return WRONG_PHASE();
    const topic = typeof raw === 'string' ? raw.trim() : '';
    if (!topic || [...topic].length > BINGO_TOPIC_MAX) {
      return fail('INVALID_PAYLOAD', `주제는 1~${BINGO_TOPIC_MAX}자로 입력해 주세요.`);
    }
    this.topic = topic;
    this.phase = 'FILLING';
    return { ok: true };
  }

  // 접속 중인 플레이어가 모두 제출했고, 제출한 사람이 2명 이상이면 시작할 수 있다.
  startProblem(): string | null {
    if (this.phase !== 'FILLING') return '주제를 먼저 내 주세요.';
    const waiting = Object.values(this.players).filter((p) => p.connected && !p.board);
    if (waiting.length > 0) return `아직 제출하지 않은 플레이어: ${waiting.map((p) => p.nickname).join(', ')}`;
    const ready = Object.values(this.players).filter((p) => p.board).length;
    if (ready < BINGO_MIN_PLAYERS) return `제출한 플레이어가 ${BINGO_MIN_PLAYERS}명 이상이어야 합니다.`;
    return null;
  }

  start(): BingoResult {
    const problem = this.startProblem();
    if (problem) return fail('NOT_READY', problem);
    // 부르는 순서는 판을 제출한 사람 중에서 무작위로
    this.order = this.shuffle(Object.values(this.players).filter((p) => p.board).map((p) => p.id));
    this.turnIndex = 0;
    this.calls = [];
    this.winners = [];
    this.phase = 'PLAYING';
    this.skipDisconnected();
    return { ok: true };
  }

  skipTurn(): BingoResult {
    if (this.phase !== 'PLAYING') return WRONG_PHASE();
    this.advanceTurn();
    return { ok: true };
  }

  // 새 판: 플레이어는 남기고 주제·판·기술을 초기화한다.
  newRound(): void {
    this.phase = 'LOBBY';
    this.topic = '';
    this.order = [];
    this.turnIndex = 0;
    this.calls = [];
    this.winners = [];
    for (const p of Object.values(this.players)) {
      p.board = null;
      p.keys = [];
      p.marked = emptyMarks();
      p.usedPeek = false;
      p.usedTaunt = false;
    }
  }

  kickAll(): void {
    this.newRound();
    this.players = {};
  }

  // ─── 플레이어 ───

  submit(playerId: string, cells: unknown): BingoResult {
    const player = this.players[playerId];
    if (!player) return fail('INVALID_PAYLOAD', '잘못된 요청입니다.');
    if (this.phase !== 'FILLING') return WRONG_PHASE();
    if (!Array.isArray(cells) || cells.length !== BINGO_CELLS || cells.some((c) => typeof c !== 'string')) {
      return fail('INVALID_BOARD', '25칸을 모두 채워 주세요.');
    }
    const problems = checkBoard(cells as string[]);
    if (problems.length > 0) {
      const reason = problems[0].reason;
      return fail('INVALID_BOARD',
        reason === 'EMPTY' ? '빈 칸이 있습니다.'
        : reason === 'DUPLICATE' ? '같은 답을 두 번 쓸 수 없습니다(띄어쓰기·대소문자 무시).'
        : '한 칸은 20자까지 쓸 수 있습니다.');
    }
    player.board = (cells as string[]).map((c) => c.trim());
    player.keys = player.board.map(bingoKey);
    player.marked = emptyMarks();
    return { ok: true };
  }

  // 게임 시작 전에는 제출을 취소하고 다시 고칠 수 있다.
  unsubmit(playerId: string): BingoResult {
    const player = this.players[playerId];
    if (!player) return fail('INVALID_PAYLOAD', '잘못된 요청입니다.');
    if (this.phase !== 'FILLING') return WRONG_PHASE();
    player.board = null;
    player.keys = [];
    return { ok: true };
  }

  // 내 차례에 아직 지워지지 않은 내 칸 하나를 부른다. 같은 답을 쓴 모든 플레이어의 칸이 지워진다.
  call(playerId: string, index: unknown): BingoResult<{ call: BingoCall; markedFor: string[] }> {
    if (this.phase !== 'PLAYING') return WRONG_PHASE();
    if (this.turnPlayerId !== playerId) return fail('NOT_YOUR_TURN', '내 차례가 아닙니다.');
    const player = this.players[playerId];
    if (!player?.board) return fail('INVALID_PAYLOAD', '잘못된 요청입니다.');
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= BINGO_CELLS) {
      return fail('INVALID_PAYLOAD', '잘못된 칸입니다.');
    }
    if (player.marked[index]) return fail('INVALID_PAYLOAD', '이미 지워진 칸입니다.');

    const key = player.keys[index];
    const markedFor: string[] = [];
    for (const p of Object.values(this.players)) {
      const i = p.keys.indexOf(key);
      if (i >= 0 && !p.marked[i]) {
        p.marked[i] = true;
        markedFor.push(p.id);
      }
    }
    const call: BingoCall = { playerId, nickname: player.nickname, text: player.board[index] };
    this.calls.push(call);

    // 누구든 3줄을 완성하면 그 즉시 끝. 같은 순간 완성한 사람은 모두 우승.
    this.winners = Object.values(this.players)
      .filter((p) => p.board && completedLines(p.marked).length >= BINGO_WIN_LINES)
      .map((p) => p.id);
    if (this.winners.length > 0) this.phase = 'FINISHED';
    else this.advanceTurn();
    return { ok: true, call, markedFor };
  }

  // 훔쳐보기: 게임 중 한 판에 한 번. 다른 플레이어의 칸 하나를 본다.
  peek(playerId: string, targetId: unknown, index: unknown): BingoResult<{ target: BingoPlayer; text: string; marked: boolean }> {
    const player = this.players[playerId];
    if (!player) return fail('INVALID_PAYLOAD', '잘못된 요청입니다.');
    if (this.phase !== 'PLAYING') return fail('INVALID_PHASE', '훔쳐보기는 게임 중에만 쓸 수 있습니다.');
    if (player.usedPeek) return fail('ALREADY_USED', '훔쳐보기는 한 판에 한 번만 쓸 수 있습니다.');
    const target = typeof targetId === 'string' ? this.players[targetId] : undefined;
    if (!target || target.id === playerId || !target.board) return fail('INVALID_TARGET', '훔쳐볼 수 없는 플레이어입니다.');
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= BINGO_CELLS) {
      return fail('INVALID_PAYLOAD', '잘못된 칸입니다.');
    }
    player.usedPeek = true;
    return { ok: true, target, text: target.board[index], marked: target.marked[index] };
  }

  // 약올리기: 칸 채우기·게임 중 한 판에 한 번.
  taunt(playerId: string, targetId: unknown): BingoResult<{ target: BingoPlayer }> {
    const player = this.players[playerId];
    if (!player) return fail('INVALID_PAYLOAD', '잘못된 요청입니다.');
    if (this.phase !== 'FILLING' && this.phase !== 'PLAYING') return fail('INVALID_PHASE', '약올리기는 칸 채우기·게임 중에만 쓸 수 있습니다.');
    if (player.usedTaunt) return fail('ALREADY_USED', '약올리기는 한 판에 한 번만 쓸 수 있습니다.');
    const target = typeof targetId === 'string' ? this.players[targetId] : undefined;
    if (!target || target.id === playerId) return fail('INVALID_TARGET', '약올릴 수 없는 플레이어입니다.');
    player.usedTaunt = true;
    return { ok: true, target };
  }

  // ─── 스냅샷 ───

  snapshot(forPlayerId: string | null): BingoSnapshot {
    const me = forPlayerId ? this.players[forPlayerId] : undefined;
    return {
      phase: this.phase,
      topic: this.topic,
      players: Object.values(this.players).map((p) => ({
        id: p.id,
        nickname: p.nickname,
        character: p.character,
        connected: p.connected,
        submitted: p.board !== null,
        lines: p.board ? completedLines(p.marked).length : 0,
        inGame: this.order.includes(p.id),
        usedPeek: p.usedPeek,
        usedTaunt: p.usedTaunt,
      })),
      maxPlayers: BINGO_MAX_PLAYERS,
      order: this.order,
      turnPlayerId: this.turnPlayerId,
      calls: this.calls,
      winners: this.winners,
      me: me
        ? {
            id: me.id,
            board: me.board,
            marked: me.marked,
            submitted: me.board !== null,
            usedPeek: me.usedPeek,
            usedTaunt: me.usedTaunt,
          }
        : null,
    };
  }

  adminBoards(): BingoAdminBoards {
    const boards: BingoAdminBoards['boards'] = {};
    for (const p of Object.values(this.players)) boards[p.id] = { board: p.board, marked: p.marked };
    return { boards };
  }

  // 다음 차례로. 차례가 온 사람이 끊겨 있으면 건너뛴다(모두 끊겼으면 그대로).
  private advanceTurn(): void {
    if (this.order.length === 0) return;
    this.turnIndex = (this.turnIndex + 1) % this.order.length;
    this.skipDisconnected();
  }

  private skipDisconnected(): void {
    for (let i = 0; i < this.order.length; i++) {
      if (this.players[this.order[this.turnIndex]]?.connected) return;
      this.turnIndex = (this.turnIndex + 1) % this.order.length;
    }
  }
}

function defaultShuffle<T>(items: T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
