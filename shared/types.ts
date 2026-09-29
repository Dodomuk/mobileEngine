// 10장 데이터 모델. 서버 전용 필드(sessionToken, 정답 등)는 Public* 타입으로 걸러서 보낸다.

export type CharacterKey =
  | 'orange_mushroom' | 'snail' | 'slime' | 'pepe' | 'pig'
  | 'green_mushroom' | 'ribbon_pig' | 'red_snail' | 'blue_slime' | 'dark_pepe'
  | 'warrior' | 'archer' | 'magician' | 'thief' | 'pirate';
export type AdminCharacterKey = 'admin'; // 관리자 전용, 플레이어 선택 불가
export type Choice = 'A' | 'B' | 'C';
export type Phase = 'LOBBY' | 'QUESTION' | 'REVEAL' | 'RESULT';
export type Stage = 'PRACTICE' | 'MAIN';
// 찍기 기술. NONE은 「초기화」(찍지 않음)
export type ActionType = 'BET_CORRECT' | 'BET_WRONG' | 'NONE';
// 이모티콘은 찍기와 별개로 언제든(대기실·문제·정답 공개) 보낼 수 있고 점수와 무관하다
export type EmoteType = 'LAUGH' | 'CRY' | 'ANGRY' | 'THUMBS_UP' | 'THUMBS_DOWN';

export interface Player {
  id: string; sessionToken: string; nickname: string; character: CharacterKey;
  x: number; y: number; targetX: number; targetY: number;
  score: number; correctCount: number; connected: boolean;
}

// 다른 클라이언트에게 보내는 플레이어 정보 (sessionToken, 이동 목표 제외)
export type PublicPlayer = Pick<Player,
  'id' | 'nickname' | 'character' | 'x' | 'y' | 'score' | 'correctCount' | 'connected'>;

export interface PlayerPosition { id: string; x: number; y: number }
export interface MovePayload { x: number; y: number }

export interface Question {
  id: string; stage: Stage; topic: string;
  text: string;                 // 관리자 전용
  choices: { A: string; B: string; C: string };
  answer: Choice;               // 관리자 전용 (REVEAL 전까지)
  explanation?: string;         // 관리자 전용
  imageUrl?: string;
  timeLimitSec?: number;        // 기본 120
}

// 플레이어에게 보내는 문제 형태: text, answer, explanation 제거
export type PublicQuestion = Pick<Question, 'id' | 'stage' | 'topic' | 'choices' | 'imageUrl'> & {
  number: number; total: number; // 연습: 1~3 / 3, 본 게임: 1~20 / 20
};

export interface RoundAction { type: ActionType; targetId?: string }

export interface RoundResult {
  questionId: string; stage: Stage; correct: Choice;
  perPlayer: Record<string, {
    answer: Choice | null; isCorrect: boolean;
    action: RoundAction; baseDelta: number; actionDelta: number; total: number;
  }>;
}

export interface Room {
  phase: Phase; stage: Stage; players: Record<string, Player>; adminSocketId?: string;
  questions: Question[]; currentIndex: number; deadline?: number; // epoch ms
  actions: Record<string, RoundAction>; history: RoundResult[];  // 본 게임 시작 때 비움
}

// 관리자 고정 캐릭터(4장). 점수·순위·찍기 대상에서 빠지므로 플레이어와 따로 둔다.
export interface AdminAvatar {
  x: number; y: number; targetX: number; targetY: number; connected: boolean;
}
export type PublicAdmin = Pick<AdminAvatar, 'x' | 'y' | 'connected'>;

// round:reveal 페이로드: RoundResult + 갱신된 점수
export interface RevealPayload extends RoundResult {
  scores: Record<string, { score: number; correctCount: number }>;
}

export interface RankingEntry {
  rank: number; id: string; nickname: string; character: CharacterKey;
  score: number; correctCount: number;
}

export interface AnswerTally { A: number; B: number; C: number; none: number }

export interface StateSnapshot {
  phase: Phase;
  stage: Stage;
  players: PublicPlayer[];
  maxPlayers: number;
  admin: PublicAdmin | null;
  question: PublicQuestion | null;
  questionStartedAt: number | null; // epoch ms, 타이머 바 전체 길이 계산용
  deadline: number | null;          // epoch ms
  serverNow: number;                // 기기 시계 차이 보정용
  lastRound: RevealPayload | null;  // REVEAL 단계에서만
  ranking: RankingEntry[] | null;   // RESULT 단계에서만
}

export type ErrorCode =
  | 'INVALID_PAYLOAD'
  | 'INVALID_NICKNAME'
  | 'INVALID_CHARACTER'
  | 'NICKNAME_TAKEN'
  | 'ROOM_FULL'
  | 'SESSION_NOT_FOUND'
  | 'NOT_ADMIN'
  | 'INVALID_PIN'
  | 'INVALID_PHASE'
  | 'INVALID_TARGET'
  | 'COOLDOWN'
  | 'ADMIN_REPLACED';

export interface ErrorPayload { code: ErrorCode; message: string }

export interface JoinPayload { nickname: string; character: CharacterKey }
export interface ResumePayload { sessionToken: string }

export type JoinAck =
  // action: 새로고침으로 복귀했을 때 이번 문제에서 이미 고른 행동
  | { ok: true; playerId: string; sessionToken: string; action: RoundAction }
  | { ok: false; error: ErrorPayload };

export interface ActionPayload { type: ActionType; targetId?: string }
export interface EmotePayload { emote: EmoteType }
export interface EmoteEvent { playerId: string; emote: EmoteType }
export type ActionAck = { ok: true; action: RoundAction } | { ok: false; error: ErrorPayload };

export interface AdminAuthPayload { pin?: string; token?: string }
export type AdminAuthAck =
  | { ok: true; token: string }
  | { ok: false; error: ErrorPayload };
