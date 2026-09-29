import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '../../shared/events.ts';

export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

// 같은 오리진(개발 중에는 Vite 프록시)으로 붙는다.
export const socket: GameSocket = io({
  transports: ['websocket', 'polling'],
  reconnectionDelayMax: 3000,
});
