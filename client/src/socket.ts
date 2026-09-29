import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '../../shared/events.ts';

export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

// 같은 오리진(개발 중에는 Vite 프록시)으로 붙는다.
// 퀴즈 화면에서만 연결한다(빙고 화면이 퀴즈 방에 붙지 않도록). startPlayerApp/startAdminApp에서 connect().
export const socket: GameSocket = io({
  transports: ['websocket', 'polling'],
  reconnectionDelayMax: 3000,
  autoConnect: false,
});
