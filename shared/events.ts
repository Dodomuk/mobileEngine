// 10장 이벤트 이름. 이후 단계에서 쓰는 이벤트도 미리 모아 둔다.
import type { ErrorPayload, JoinAck, JoinPayload, ResumePayload, StateSnapshot } from './types.ts';

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

// M1에서 쓰는 이벤트의 Socket.IO 타입. 단계가 진행되며 추가한다.
export interface ServerToClientEvents {
  'state:snapshot': (snapshot: StateSnapshot) => void;
  'room:reset': () => void;
  'error': (error: ErrorPayload) => void;
}

export interface ClientToServerEvents {
  'player:join': (payload: JoinPayload, ack: (res: JoinAck) => void) => void;
  'player:resume': (payload: ResumePayload, ack: (res: JoinAck) => void) => void;
}
