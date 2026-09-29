import { io, type Socket } from 'socket.io-client';
import type { BingoClientEvents, BingoServerEvents } from '../../../shared/bingo.ts';

// 빙고 방(/bingo 네임스페이스). 빙고 화면에서만 connect()한다.
export const bingoSocket: Socket<BingoServerEvents, BingoClientEvents> = io('/bingo', {
  transports: ['websocket', 'polling'],
  reconnectionDelayMax: 3000,
  autoConnect: false,
});
