import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from '../shared/events.ts';
import type { JoinAck } from '../shared/types.ts';
import { GameRoom, type JoinResult } from './game/room.ts';

interface SocketData { playerId?: string }

const PORT = Number(process.env.PORT ?? 3000);
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const clientDist = path.join(rootDir, 'client', 'dist');

const app = express();
const httpServer = createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>(httpServer);

const room = new GameRoom();
// 플레이어별 현재 소켓. 같은 세션으로 새 탭이 붙으면 마지막 소켓이 이긴다.
const playerSockets = new Map<string, string>();

app.get('/healthz', (_req, res) => {
  res.json({ ok: true, players: room.playerCount });
});

// 개발 중에는 Vite가 클라이언트를 서빙하고, 배포 때는 빌드 결과물을 여기서 서빙한다.
if (existsSync(clientDist)) {
  app.use(express.static(clientDist));
  // 없는 이미지가 index.html로 대체되지 않도록 화면 경로만 받는다
  app.get(['/', '/admin'], (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

function broadcastSnapshot(): void {
  io.emit('state:snapshot', room.snapshot());
}

io.on('connection', (socket) => {
  socket.emit('state:snapshot', room.snapshot());

  const bindPlayer = (result: JoinResult, ack: (res: JoinAck) => void): void => {
    if (!result.ok) {
      socket.emit('error', result.error);
      ack({ ok: false, error: result.error });
      return;
    }
    const { player } = result;
    socket.data.playerId = player.id;
    playerSockets.set(player.id, socket.id);
    ack({ ok: true, playerId: player.id, sessionToken: player.sessionToken });
    broadcastSnapshot();
  };

  socket.on('player:join', (payload, ack) => {
    if (typeof ack !== 'function') return;
    if (socket.data.playerId) {
      ack({ ok: false, error: { code: 'INVALID_PAYLOAD', message: '이미 입장했습니다.' } });
      return;
    }
    bindPlayer(room.join(payload?.nickname, payload?.character), ack);
  });

  socket.on('player:resume', (payload, ack) => {
    if (typeof ack !== 'function') return;
    bindPlayer(room.resume(payload?.sessionToken), ack);
  });

  socket.on('disconnect', () => {
    const { playerId } = socket.data;
    if (!playerId || playerSockets.get(playerId) !== socket.id) return;
    playerSockets.delete(playerId);
    room.setConnected(playerId, false);
    broadcastSnapshot();
  });
});

httpServer.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`);
});
