import { randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server, type Socket } from 'socket.io';
import { ADMIN_ID, TICK_MS } from '../shared/constants.ts';
import type { ClientToServerEvents, ServerToClientEvents } from '../shared/events.ts';
import type { ErrorPayload, JoinAck } from '../shared/types.ts';
import { registerBingo } from './bingo/socket.ts';
import { loadQuestions } from './game/questions.ts';
import { GameRoom, type CommandResult, type JoinResult } from './game/room.ts';

interface SocketData { playerId?: string; authFailures?: number }
type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envFile = path.join(rootDir, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const PORT = Number(process.env.PORT ?? 3000);
const ADMIN_PIN = process.env.ADMIN_PIN?.trim() ?? '';
const MAX_AUTH_FAILURES = 5;
const TALLY_INTERVAL_MS = 1000;
const clientDist = path.join(rootDir, 'client', 'dist');

// 6장: 시작할 때 문제 파일을 검증하고, 잘못됐으면 실행을 멈춘다
let questions;
try {
  questions = loadQuestions(process.env.QUESTIONS_PATH ?? path.join(rootDir, 'server', 'data', 'questions.json'));
} catch (error) {
  console.error(`[server] ${(error as Error).message}`);
  process.exit(1);
}
if (!ADMIN_PIN) console.warn('[server] ADMIN_PIN이 설정되지 않아 관리자 인증이 불가능합니다.');

const app = express();
const httpServer = createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>(httpServer);

const room = new GameRoom(questions);
// 플레이어별 현재 소켓. 같은 세션으로 새 탭이 붙으면 마지막 소켓이 이긴다.
const playerSockets = new Map<string, string>();
// 11장: 관리자는 방당 1명, 마지막 인증 우선
let adminSocketId: string | undefined;
let adminToken: string | undefined;
let deadlineTimer: NodeJS.Timeout | undefined;

const bingo = registerBingo(io, ADMIN_PIN);

app.get('/healthz', (_req, res) => {
  res.json({
    ok: true,
    players: room.playerCount,
    phase: room.state.phase,
    bingo: { players: bingo.playerCount, phase: bingo.phase },
  });
});

// 개발 중에는 Vite가 클라이언트를 서빙하고, 배포 때는 빌드 결과물을 여기서 서빙한다.
if (existsSync(clientDist)) {
  app.use(express.static(clientDist));
  // 없는 이미지가 index.html로 대체되지 않도록 화면 경로만 받는다
  app.get(['/', '/admin', '/bingo', '/bingo/admin'], (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

function broadcastSnapshot(): void {
  io.emit('state:snapshot', room.snapshot());
}

// 문제 텍스트·정답·해설은 인증된 관리자 소켓에만 보낸다
function sendAdminQuestion(): void {
  if (adminSocketId) io.to(adminSocketId).emit('admin:question', room.currentQuestion());
}

function sendTally(): void {
  if (adminSocketId) io.to(adminSocketId).emit('admin:tally', room.tally());
}

function scheduleDeadline(): void {
  clearTimeout(deadlineTimer);
  const { phase, deadline } = room.state;
  if (phase !== 'QUESTION' || deadline === undefined) return;
  deadlineTimer = setTimeout(revealNow, Math.max(0, deadline - Date.now()));
}

function revealNow(): CommandResult {
  clearTimeout(deadlineTimer);
  const result = room.reveal();
  if (!result.ok) return result;
  const payload = room.revealPayload();
  if (payload) io.emit('round:reveal', payload);
  broadcastSnapshot();
  sendTally();
  return result;
}

function afterTransition(): void {
  scheduleDeadline();
  broadcastSnapshot();
  sendAdminQuestion();
  sendTally();
}

function resetRoom(): void {
  clearTimeout(deadlineTimer);
  // 플레이어 소켓과 세션을 끊어 모두 입장 화면으로 돌려보낸다
  for (const [, socketId] of playerSockets) {
    const s = io.sockets.sockets.get(socketId);
    if (s) s.data.playerId = undefined;
  }
  playerSockets.clear();
  room.reset();
  io.except(adminSocketId ?? []).emit('room:reset');
  afterTransition();
}

io.on('connection', (socket: GameSocket) => {
  socket.emit('state:snapshot', room.snapshot());

  const isAdmin = (): boolean => socket.id === adminSocketId;
  const sendError = (error: ErrorPayload): void => {
    socket.emit('error', error);
  };

  const bindPlayer = (result: JoinResult, ack: (res: JoinAck) => void): void => {
    if (!result.ok) {
      sendError(result.error);
      ack({ ok: false, error: result.error });
      return;
    }
    const { player } = result;
    socket.data.playerId = player.id;
    playerSockets.set(player.id, socket.id);
    ack({ ok: true, playerId: player.id, sessionToken: player.sessionToken, action: room.actionOf(player.id) });
    broadcastSnapshot();
  };

  socket.on('player:join', (payload, ack) => {
    if (typeof ack !== 'function') return;
    if (socket.data.playerId || isAdmin()) {
      ack({ ok: false, error: { code: 'INVALID_PAYLOAD', message: '이미 입장했습니다.' } });
      return;
    }
    bindPlayer(room.join(payload?.nickname, payload?.character), ack);
  });

  socket.on('player:resume', (payload, ack) => {
    if (typeof ack !== 'function') return;
    bindPlayer(room.resume(payload?.sessionToken), ack);
  });

  socket.on('player:move', (payload) => {
    const id = isAdmin() ? ADMIN_ID : socket.data.playerId;
    if (!id) return;
    room.setTarget(id, payload?.x, payload?.y);
  });

  // 7장: 누가 누구를 찍었는지는 정답 공개 전까지 본인에게만 알려 준다(ack)
  socket.on('player:action', (payload, ack) => {
    if (typeof ack !== 'function') return;
    const { playerId } = socket.data;
    if (!playerId) {
      ack({ ok: false, error: { code: 'INVALID_PAYLOAD', message: '먼저 입장해 주세요.' } });
      return;
    }
    const result = room.setAction(playerId, payload?.type, payload?.targetId);
    if (!result.ok) {
      ack(result);
      return;
    }
    ack({ ok: true, action: result.action });
  });

  socket.on('player:emote', (payload) => {
    const { playerId } = socket.data;
    if (!playerId) return;
    const emote = payload?.emote;
    if (room.emote(playerId, emote).ok) io.emit('player:emote', { playerId, emote });
  });

  socket.on('admin:auth', (payload, ack) => {
    if (typeof ack !== 'function') return;
    const pin = typeof payload?.pin === 'string' ? payload.pin.trim() : '';
    const token = typeof payload?.token === 'string' ? payload.token : '';
    const byPin = ADMIN_PIN !== '' && pin !== '' && safeEqual(pin, ADMIN_PIN);
    const byToken = !!adminToken && token !== '' && safeEqual(token, adminToken);
    if (!byPin && !byToken) {
      // PIN 대입을 막기 위해 한 연결에서 5번 틀리면 끊는다
      socket.data.authFailures = (socket.data.authFailures ?? 0) + 1;
      const error: ErrorPayload = token && !pin
        ? { code: 'NOT_ADMIN', message: '관리자 세션이 만료되었습니다. PIN을 다시 입력해 주세요.' }
        : { code: 'INVALID_PIN', message: 'PIN이 올바르지 않습니다.' };
      ack({ ok: false, error });
      if (socket.data.authFailures >= MAX_AUTH_FAILURES) socket.disconnect(true);
      return;
    }
    if (byPin) adminToken = randomBytes(24).toString('base64url');
    if (adminSocketId && adminSocketId !== socket.id) {
      io.to(adminSocketId).emit('error', {
        code: 'ADMIN_REPLACED',
        message: '다른 기기에서 관리자로 접속해 이 화면의 관리자 권한이 해제되었습니다.',
      });
    }
    adminSocketId = socket.id;
    socket.data.authFailures = 0;
    room.ensureAdmin();
    ack({ ok: true, token: adminToken! });
    broadcastSnapshot();
    sendAdminQuestion();
    sendTally();
  });

  const adminCommand = (event: keyof ClientToServerEvents & `admin:${string}`, run: () => CommandResult) => {
    socket.on(event, () => {
      if (!isAdmin()) {
        sendError({ code: 'NOT_ADMIN', message: '관리자만 할 수 있는 동작입니다.' });
        return;
      }
      const result = run();
      if (!result.ok) sendError(result.error);
    });
  };

  const transition = (result: CommandResult): CommandResult => {
    if (result.ok) afterTransition();
    return result;
  };

  adminCommand('admin:start', () => transition(room.start()));
  adminCommand('admin:revealNow', revealNow);
  adminCommand('admin:next', () => transition(room.next()));
  adminCommand('admin:startMain', () => {
    const result = room.startMain();
    if (result.ok) io.emit('game:mainStart');
    return transition(result);
  });
  adminCommand('admin:finish', () => {
    const result = room.finish();
    if (result.ok && room.ranking) io.emit('game:result', room.ranking);
    return transition(result);
  });
  adminCommand('admin:reset', () => {
    resetRoom();
    return { ok: true };
  });

  socket.on('disconnect', () => {
    if (isAdmin()) {
      // 11장: 관리자가 끊겨도 게임은 현재 단계에서 기다린다
      adminSocketId = undefined;
      room.setAdminConnected(false);
      broadcastSnapshot();
      return;
    }
    const { playerId } = socket.data;
    if (!playerId || playerSockets.get(playerId) !== socket.id) return;
    playerSockets.delete(playerId);
    room.setConnected(playerId, false);
    broadcastSnapshot();
  });
});

// 5장: 초당 10틱으로 이동시키고, 움직인 캐릭터가 있을 때만 위치를 브로드캐스트한다
let lastTick = Date.now();
setInterval(() => {
  const now = Date.now();
  const moved = room.tick((now - lastTick) / 1000);
  lastTick = now;
  if (moved) io.emit('state:positions', room.positions());
}, TICK_MS);

setInterval(sendTally, TALLY_INTERVAL_MS);

httpServer.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`);
});
