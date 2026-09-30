import { randomBytes, randomUUID } from 'node:crypto';
import {
  ADMIN_CHARACTER,
  ADMIN_ID,
  CHARACTERS,
  DEFAULT_TIME_LIMIT_SEC,
  betDeadline,
  EMOTE_COOLDOWN_MS,
  EMOTES,
  FIELD_HEIGHT,
  FIELD_WIDTH,
  FIELD_MARGIN,
  FIELD_MARGIN_BOTTOM,
  MAX_PLAYERS,
  MOVE_SPEED,
  SPAWN_AREA,
  circleAt,
} from '../../shared/constants.ts';
import {
  isReservedNickname,
  isValidNicknameLength,
  nicknameKey,
  normalizeNickname,
} from '../../shared/nickname.ts';
import type {
  ActionType,
  AdminAvatar,
  AnswerTally,
  CharacterKey,
  ErrorPayload,
  Player,
  PlayerPosition,
  PublicPlayer,
  PublicQuestion,
  Question,
  RankingEntry,
  RevealPayload,
  Room,
  RoundAction,
  StateSnapshot,
} from '../../shared/types.ts';
import { judgeRound, rankPlayers } from './scoring.ts';

export type JoinResult = { ok: true; player: Player } | { ok: false; error: ErrorPayload };
export type CommandResult = { ok: true } | { ok: false; error: ErrorPayload };

const OK: CommandResult = { ok: true };
const ACTION_TYPES = new Set<ActionType>(['BET_CORRECT', 'BET_WRONG', 'NONE']);
const EMOTE_TYPES = new Set<string>(EMOTES.map((e) => e.type));
export type ActionResult = { ok: true; action: RoundAction } | { ok: false; error: ErrorPayload };
const WRONG_PHASE = () => fail('INVALID_PHASE', '지금 단계에서는 할 수 없는 동작입니다.');

const CHARACTER_KEYS = new Set<string>(CHARACTERS.map((c) => c.key));

function fail(code: ErrorPayload['code'], message: string): { ok: false; error: ErrorPayload } {
  return { ok: false, error: { code, message } };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function randomBetween(min: number, max: number): number {
  return Math.round(min + Math.random() * (max - min));
}

function spawnPoint(): { x: number; y: number } {
  return {
    x: randomBetween(SPAWN_AREA.minX, SPAWN_AREA.maxX),
    y: randomBetween(SPAWN_AREA.minY, SPAWN_AREA.maxY),
  };
}

interface Mover { x: number; y: number; targetX: number; targetY: number }

export function isCharacterKey(value: unknown): value is CharacterKey {
  return typeof value === 'string' && value !== ADMIN_CHARACTER && CHARACTER_KEYS.has(value);
}

export class GameRoom {
  state: Room;
  admin: AdminAvatar | null = null;
  ranking: RankingEntry[] | null = null;
  questionStartedAt: number | null = null;
  private lastEmoteAt = new Map<string, number>();

  constructor(questions: Question[] = []) {
    this.state = GameRoom.emptyRoom(questions);
  }

  private static emptyRoom(questions: Question[]): Room {
    return {
      phase: 'LOBBY',
      stage: 'PRACTICE',
      players: {},
      questions,
      currentIndex: -1,
      actions: {},
      history: [],
    };
  }

  get playerCount(): number {
    return Object.keys(this.state.players).length;
  }

  join(rawNickname: unknown, character: unknown): JoinResult {
    if (typeof rawNickname !== 'string') {
      return fail('INVALID_PAYLOAD', '잘못된 요청입니다.');
    }
    if (!isCharacterKey(character)) {
      return fail('INVALID_CHARACTER', '캐릭터를 선택해 주세요.');
    }
    const nickname = normalizeNickname(rawNickname);
    if (!isValidNicknameLength(nickname)) {
      return fail('INVALID_NICKNAME', '닉네임은 1~8자로 입력해 주세요.');
    }
    if (isReservedNickname(nickname) || this.findByNickname(nickname)) {
      return fail('NICKNAME_TAKEN', '이미 사용 중인 닉네임입니다.');
    }
    // 끊긴 플레이어도 복귀할 수 있으므로 자리를 차지한 것으로 센다(가정)
    if (this.playerCount >= MAX_PLAYERS) {
      return fail('ROOM_FULL', `방이 가득 찼습니다 (${MAX_PLAYERS}/${MAX_PLAYERS})`);
    }

    const { x, y } = spawnPoint();
    const player: Player = {
      id: randomUUID(),
      sessionToken: randomBytes(24).toString('base64url'),
      nickname,
      character,
      x, y, targetX: x, targetY: y,
      score: 0,
      correctCount: 0,
      connected: true,
    };
    this.state.players[player.id] = player;
    return { ok: true, player };
  }

  resume(sessionToken: unknown): JoinResult {
    if (typeof sessionToken !== 'string' || sessionToken.length === 0) {
      return fail('INVALID_PAYLOAD', '잘못된 요청입니다.');
    }
    const player = Object.values(this.state.players).find((p) => p.sessionToken === sessionToken);
    if (!player) {
      return fail('SESSION_NOT_FOUND', '세션이 만료되었습니다. 다시 입장해 주세요.');
    }
    player.connected = true;
    return { ok: true, player };
  }

  setConnected(playerId: string, connected: boolean): void {
    const player = this.state.players[playerId];
    if (player) player.connected = connected;
  }

  // 관리자 고정 캐릭터. 처음 인증할 때 만들고, 이후에는 접속 상태만 바꾼다.
  ensureAdmin(): AdminAvatar {
    if (!this.admin) {
      const { x, y } = spawnPoint();
      this.admin = { x, y, targetX: x, targetY: y, connected: true };
    }
    this.admin.connected = true;
    return this.admin;
  }

  setAdminConnected(connected: boolean): void {
    if (this.admin) this.admin.connected = connected;
  }

  // 5장: 터치한 목표 지점. 필드 밖 좌표는 경계로 자른다. id가 ADMIN_ID면 관리자 캐릭터.
  setTarget(id: string, x: unknown, y: unknown, now = Date.now()): boolean {
    const mover: Mover | undefined = id === ADMIN_ID ? this.admin ?? undefined : this.state.players[id];
    if (!mover || !this.canMove(now)) return false;
    if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) {
      return false;
    }
    mover.targetX = clamp(x, FIELD_MARGIN, FIELD_WIDTH - FIELD_MARGIN);
    mover.targetY = clamp(y, FIELD_MARGIN, FIELD_HEIGHT - FIELD_MARGIN_BOTTOM);
    return true;
  }

  // 모든 캐릭터를 목표 지점 쪽으로 직선 이동. 움직인 캐릭터가 있으면 true.
  tick(dtSec: number): boolean {
    const step = MOVE_SPEED * dtSec;
    let moved = false;
    const movers: Mover[] = Object.values(this.state.players);
    if (this.admin) movers.push(this.admin);
    for (const p of movers) {
      const dx = p.targetX - p.x;
      const dy = p.targetY - p.y;
      const dist = Math.hypot(dx, dy);
      if (dist === 0) continue;
      if (dist <= step) {
        p.x = p.targetX;
        p.y = p.targetY;
      } else {
        p.x += (dx / dist) * step;
        p.y += (dy / dist) * step;
      }
      moved = true;
    }
    return moved;
  }

  positions(): PlayerPosition[] {
    const list = Object.values(this.state.players).map((p) => ({
      id: p.id,
      x: Math.round(p.x),
      y: Math.round(p.y),
    }));
    if (this.admin) list.push({ id: ADMIN_ID, x: Math.round(this.admin.x), y: Math.round(this.admin.y) });
    return list;
  }

  // 6장: 관리자 화면의 「현재 A/B/C/미제출 인원 수」
  tally(): AnswerTally {
    const tally: AnswerTally = { A: 0, B: 0, C: 0, none: 0 };
    for (const p of Object.values(this.state.players)) {
      const choice = circleAt(p.x, p.y);
      if (choice) tally[choice]++;
      else tally.none++;
    }
    return tally;
  }

  currentQuestion(): Question | null {
    return this.state.questions[this.state.currentIndex] ?? null;
  }

  // ─── 7장 추가 행동 ───

  actionOf(playerId: string): RoundAction {
    return this.state.actions[playerId] ?? { type: 'NONE' };
  }

  // 찍기는 문제 진행 중(타이머가 도는 동안)에만 고르고 바꿀 수 있다. 판정 시점의 선택이 최종.
  // NONE은 「초기화」: 찍기를 취소한다.
  setAction(playerId: string, type: unknown, targetId: unknown, now = Date.now()): ActionResult {
    const player = this.state.players[playerId];
    if (!player) return fail('INVALID_PAYLOAD', '잘못된 요청입니다.');
    const { phase, deadline } = this.state;
    if (phase !== 'QUESTION' || (deadline !== undefined && now >= deadline)) return WRONG_PHASE();
    if (this.questionStartedAt !== null && deadline !== undefined && now >= betDeadline(this.questionStartedAt, deadline)) {
      return fail('INVALID_PHASE', '찍기는 문제 시작 후 30초까지만 할 수 있어요.');
    }
    if (typeof type !== 'string' || !ACTION_TYPES.has(type as ActionType)) {
      return fail('INVALID_PAYLOAD', '잘못된 행동입니다.');
    }

    let action: RoundAction;
    if (type === 'BET_CORRECT' || type === 'BET_WRONG') {
      if (typeof targetId !== 'string' || targetId === playerId || !this.state.players[targetId]) {
        return fail('INVALID_TARGET', '찍을 수 없는 플레이어입니다.');
      }
      action = { type, targetId };
    } else {
      action = { type: 'NONE' };
    }
    this.state.actions[playerId] = action;
    return { ok: true, action };
  }

  // 이모티콘: 찍기와 별개로 대기실·문제 진행·정답 공개 중에 말풍선을 띄운다(1초 쿨다운, 점수 무관).
  emote(playerId: string, emote: unknown, now = Date.now()): CommandResult {
    if (!this.state.players[playerId]) return fail('INVALID_PAYLOAD', '잘못된 요청입니다.');
    if (typeof emote !== 'string' || !EMOTE_TYPES.has(emote)) return fail('INVALID_PAYLOAD', '잘못된 이모티콘입니다.');
    if (this.state.phase === 'RESULT') return WRONG_PHASE();
    const last = this.lastEmoteAt.get(playerId);
    if (last !== undefined && now - last < EMOTE_COOLDOWN_MS) return fail('COOLDOWN', '잠시 후 다시 눌러 주세요.');
    this.lastEmoteAt.set(playerId, now);
    return OK;
  }

  // ─── 6장 단계 전환 (관리자 버튼과 타이머) ───

  start(now = Date.now()): CommandResult {
    if (this.state.phase !== 'LOBBY' || this.state.questions.length === 0) return WRONG_PHASE();
    this.startQuestion(0, now);
    return OK;
  }

  // 타이머 종료 또는 「정답 바로 발표」: 지금 서버 위치로 판정한다.
  reveal(): CommandResult {
    const question = this.currentQuestion();
    if (this.state.phase !== 'QUESTION' || !question) return WRONG_PHASE();

    const players = Object.values(this.state.players);
    const result = judgeRound(
      question.id,
      question.stage,
      question.answer,
      players.map((p) => ({ id: p.id, answer: circleAt(p.x, p.y), connected: p.connected })),
      this.state.actions,
    );
    for (const p of players) {
      const r = result.perPlayer[p.id];
      p.score += r.total;
      if (r.isCorrect) p.correctCount++;
      // 판정 순간 제자리에 멈춘다(정답 공개 중에는 다시 움직일 수 있음)
      p.targetX = p.x;
      p.targetY = p.y;
    }
    if (this.admin) {
      this.admin.targetX = this.admin.x;
      this.admin.targetY = this.admin.y;
    }
    this.state.history.push(result);
    this.state.phase = 'REVEAL';
    this.state.deadline = undefined;
    return OK;
  }

  next(now = Date.now()): CommandResult {
    const nextQuestion = this.state.questions[this.state.currentIndex + 1];
    if (this.state.phase !== 'REVEAL' || !nextQuestion || nextQuestion.stage !== this.state.stage) {
      return WRONG_PHASE();
    }
    this.startQuestion(this.state.currentIndex + 1, now);
    return OK;
  }

  // 연습 마지막 문제 정답 공개 뒤에만. 점수·정답 수·기록을 모두 초기화하고 본 게임 1번 시작.
  startMain(now = Date.now()): CommandResult {
    const nextQuestion = this.state.questions[this.state.currentIndex + 1];
    if (this.state.phase !== 'REVEAL' || this.state.stage !== 'PRACTICE' || nextQuestion?.stage !== 'MAIN') {
      return WRONG_PHASE();
    }
    for (const p of Object.values(this.state.players)) {
      p.score = 0;
      p.correctCount = 0;
    }
    this.state.history = [];
    this.startQuestion(this.state.currentIndex + 1, now);
    return OK;
  }

  // 본 게임 마지막 문제 정답 공개 뒤에만.
  finish(): CommandResult {
    const isLast = this.state.currentIndex === this.state.questions.length - 1;
    if (this.state.phase !== 'REVEAL' || this.state.stage !== 'MAIN' || !isLast) return WRONG_PHASE();
    this.state.phase = 'RESULT';
    this.ranking = rankPlayers(Object.values(this.state.players));
    return OK;
  }

  // 「새 게임」: 플레이어를 모두 내보내고 처음 상태로. 관리자는 그대로 남는다.
  reset(): void {
    this.state = GameRoom.emptyRoom(this.state.questions);
    this.ranking = null;
    this.questionStartedAt = null;
    this.lastEmoteAt.clear();
  }

  revealPayload(): RevealPayload | null {
    const last = this.state.history.at(-1);
    if (this.state.phase !== 'REVEAL' || !last) return null;
    const scores: RevealPayload['scores'] = {};
    for (const p of Object.values(this.state.players)) {
      scores[p.id] = { score: p.score, correctCount: p.correctCount };
    }
    const explanation = this.state.questions.find((q) => q.id === last.questionId)?.explanation;
    return { ...last, scores, ...(explanation ? { explanation } : {}) };
  }

  publicQuestion(): PublicQuestion | null {
    const q = this.currentQuestion();
    if (!q) return null;
    const sameStage = this.state.questions.filter((x) => x.stage === q.stage);
    return {
      id: q.id,
      stage: q.stage,
      topic: q.topic,
      choices: q.choices,
      ...(q.imageUrl ? { imageUrl: q.imageUrl } : {}),
      number: sameStage.indexOf(q) + 1,
      total: sameStage.length,
    };
  }

  snapshot(now = Date.now()): StateSnapshot {
    const { phase } = this.state;
    const inRound = phase === 'QUESTION' || phase === 'REVEAL';
    return {
      phase,
      stage: this.state.stage,
      players: Object.values(this.state.players).map(toPublicPlayer),
      maxPlayers: MAX_PLAYERS,
      admin: this.admin
        ? { x: Math.round(this.admin.x), y: Math.round(this.admin.y), connected: this.admin.connected }
        : null,
      question: inRound ? this.publicQuestion() : null,
      questionStartedAt: phase === 'QUESTION' ? this.questionStartedAt : null,
      deadline: this.state.deadline ?? null,
      serverNow: now,
      lastRound: this.revealPayload(),
      ranking: phase === 'RESULT' ? this.ranking : null,
    };
  }

  private startQuestion(index: number, now: number): void {
    const question = this.state.questions[index];
    this.state.currentIndex = index;
    this.state.stage = question.stage;
    this.state.phase = 'QUESTION';
    this.state.actions = {};
    this.questionStartedAt = now;
    this.state.deadline = now + (question.timeLimitSec ?? DEFAULT_TIME_LIMIT_SEC) * 1000;
  }

  // 대기실·문제 진행 중·정답 공개 중에 움직일 수 있다. 판정은 공개 순간 위치로 이미 끝났으므로
  // 공개 중 이동은 결과에 영향이 없다. 최종 결과 화면에서만 막는다.
  private canMove(now: number): boolean {
    const { phase, deadline } = this.state;
    if (phase === 'LOBBY' || phase === 'REVEAL') return true;
    return phase === 'QUESTION' && (deadline === undefined || now < deadline);
  }

  private findByNickname(nickname: string): Player | undefined {
    const key = nicknameKey(nickname);
    return Object.values(this.state.players).find((p) => nicknameKey(p.nickname) === key);
  }
}

export function toPublicPlayer(p: Player): PublicPlayer {
  return {
    id: p.id,
    nickname: p.nickname,
    character: p.character,
    x: Math.round(p.x),
    y: Math.round(p.y),
    score: p.score,
    correctCount: p.correctCount,
    connected: p.connected,
  };
}
