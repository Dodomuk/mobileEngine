// 10장 데이터 모델. 서버 전용 필드(sessionToken, 정답 등)는 Public* 타입으로 걸러서 보낸다.

export type CharacterKey = 'orange_mushroom' | 'snail' | 'slime' | 'pepe' | 'pig';
export type AdminCharacterKey = 'admin'; // 관리자 전용, 플레이어 선택 불가
export type Choice = 'A' | 'B' | 'C';
export type Phase = 'LOBBY' | 'QUESTION' | 'REVEAL' | 'RESULT';
export type Stage = 'PRACTICE' | 'MAIN';
export type ActionType = 'BET_CORRECT' | 'BET_WRONG' | 'LAUGH' | 'NONE';

export interface Player {
  id: string; sessionToken: string; nickname: string; character: CharacterKey;
  x: number; y: number; targetX: number; targetY: number;
  score: number; correctCount: number; connected: boolean;
}

// 다른 클라이언트에게 보내는 플레이어 정보 (sessionToken, 이동 목표 제외)
export type PublicPlayer = Pick<Player,
  'id' | 'nickname' | 'character' | 'x' | 'y' | 'score' | 'correctCount' | 'connected'>;

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

export interface StateSnapshot {
  phase: Phase;
  stage: Stage;
  players: PublicPlayer[];
  maxPlayers: number;
  question: PublicQuestion | null;
  deadline: number | null;
}

export type ErrorCode =
  | 'INVALID_PAYLOAD'
  | 'INVALID_NICKNAME'
  | 'INVALID_CHARACTER'
  | 'NICKNAME_TAKEN'
  | 'ROOM_FULL'
  | 'SESSION_NOT_FOUND';

export interface ErrorPayload { code: ErrorCode; message: string }

export interface JoinPayload { nickname: string; character: CharacterKey }
export interface ResumePayload { sessionToken: string }

export type JoinAck =
  | { ok: true; playerId: string; sessionToken: string }
  | { ok: false; error: ErrorPayload };
