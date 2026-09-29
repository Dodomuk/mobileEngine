// 10장 이벤트 이름. 이후 단계에서 쓰는 이벤트도 미리 모아 둔다.
import type {
  AdminAuthAck,
  AdminAuthPayload,
  AnswerTally,
  ErrorPayload,
  JoinAck,
  JoinPayload,
  MovePayload,
  PlayerPosition,
  Question,
  RankingEntry,
  ResumePayload,
  RevealPayload,
  StateSnapshot,
} from './types.ts';

export const EV = {
  // 클라이언트 → 서버
  PLAYER_JOIN: 'player:join',
  PLAYER_RESUME: 'player:resume',
  PLAYER_MOVE: 'player:move',
  PLAYER_ACTION: 'player:action',
  PLAYER_LAUGH: 'player:laugh',
  ADMIN_AUTH: 'admin:auth',
  ADMIN_START: 'admin:start',
  ADMIN_REVEAL_NOW: 'admin:revealNow',
  ADMIN_NEXT: 'admin:next',
  ADMIN_START_MAIN: 'admin:startMain',
  ADMIN_FINISH: 'admin:finish',
  ADMIN_RESET: 'admin:reset',
  // 서버 → 클라이언트
  STATE_SNAPSHOT: 'state:snapshot',
  STATE_POSITIONS: 'state:positions',
  ADMIN_QUESTION: 'admin:question',
  ADMIN_TALLY: 'admin:tally',
  ROUND_REVEAL: 'round:reveal',
  GAME_MAIN_START: 'game:mainStart',
  GAME_RESULT: 'game:result',
  ROOM_RESET: 'room:reset',
  ERROR: 'error',
} as const;

// 지금까지 구현한 이벤트의 Socket.IO 타입. 단계가 진행되며 추가한다.
export interface ServerToClientEvents {
  'state:snapshot': (snapshot: StateSnapshot) => void;
  'state:positions': (positions: PlayerPosition[]) => void;
  'admin:question': (question: Question | null) => void;
  'admin:tally': (tally: AnswerTally) => void;
  'round:reveal': (payload: RevealPayload) => void;
  'game:mainStart': () => void;
  'game:result': (ranking: RankingEntry[]) => void;
  'room:reset': () => void;
  'error': (error: ErrorPayload) => void;
}

export interface ClientToServerEvents {
  'player:join': (payload: JoinPayload, ack: (res: JoinAck) => void) => void;
  'player:resume': (payload: ResumePayload, ack: (res: JoinAck) => void) => void;
  'player:move': (payload: MovePayload) => void;
  'admin:auth': (payload: AdminAuthPayload, ack: (res: AdminAuthAck) => void) => void;
  'admin:start': () => void;
  'admin:revealNow': () => void;
  'admin:next': () => void;
  'admin:startMain': () => void;
  'admin:finish': () => void;
  'admin:reset': () => void;
}
