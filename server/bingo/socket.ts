import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { Namespace, Server, Socket } from 'socket.io';
import type { BingoAck, BingoClientEvents, BingoJoinAck, BingoServerEvents } from '../../shared/bingo.ts';
import type { ErrorPayload } from '../../shared/types.ts';
import { BingoRoom, type BingoPlayer, type BingoResult } from './room.ts';

interface BingoSocketData { playerId?: string; authFailures?: number }
type BingoSocket = Socket<BingoClientEvents, BingoServerEvents, Record<string, never>, BingoSocketData>;
type BingoNamespace = Namespace<BingoClientEvents, BingoServerEvents, Record<string, never>, BingoSocketData>;

const MAX_AUTH_FAILURES = 5;

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

// 빙고는 퀴즈와 별개의 방이라 Socket.IO 네임스페이스 /bingo로 분리한다. 관리자 PIN은 퀴즈와 같다.
export function registerBingo(io: Server, adminPin: string): BingoRoom {
  const nsp = io.of('/bingo') as unknown as BingoNamespace;
  const room = new BingoRoom();
  const playerSockets = new Map<string, string>();
  const adminSockets = new Set<string>();
  let adminToken: string | undefined;

  // 스냅샷은 사람마다 다르다(내 판 포함). 관리자에게는 전체 판도 보낸다.
  function broadcast(): void {
    for (const socket of nsp.sockets.values()) {
      socket.emit('bingo:snapshot', room.snapshot(socket.data.playerId ?? null));
      if (adminSockets.has(socket.id)) socket.emit('bingo:admin:boards', room.adminBoards());
    }
  }

  const reply = (ack: unknown, result: BingoResult): result is Extract<BingoResult, { ok: true }> => {
    if (typeof ack === 'function') (ack as (r: BingoAck) => void)(result.ok ? { ok: true } : result);
    return result.ok;
  };

  nsp.on('connection', (socket: BingoSocket) => {
    socket.emit('bingo:snapshot', room.snapshot(null));
    const isAdmin = () => adminSockets.has(socket.id);
    const me = (): BingoPlayer | undefined => (socket.data.playerId ? room.players[socket.data.playerId] : undefined);

    const bind = (result: BingoResult<{ player: BingoPlayer }>, ack: (res: BingoJoinAck) => void): void => {
      if (!result.ok) {
        ack(result);
        return;
      }
      socket.data.playerId = result.player.id;
      playerSockets.set(result.player.id, socket.id);
      ack({ ok: true, playerId: result.player.id, sessionToken: result.player.sessionToken });
      broadcast();
    };

    socket.on('bingo:join', (payload, ack) => {
      if (typeof ack !== 'function') return;
      if (socket.data.playerId) {
        ack({ ok: false, error: { code: 'INVALID_PAYLOAD', message: '이미 입장했습니다.' } });
        return;
      }
      bind(room.join(payload?.nickname, payload?.character), ack);
    });

    socket.on('bingo:resume', (payload, ack) => {
      if (typeof ack !== 'function') return;
      bind(room.resume(payload?.sessionToken), ack);
    });

    socket.on('bingo:submit', (payload, ack) => {
      const player = me();
      if (!player) return reply(ack, { ok: false, error: { code: 'INVALID_PAYLOAD', message: '먼저 입장해 주세요.' } });
      if (reply(ack, room.submit(player.id, payload?.cells))) broadcast();
    });

    socket.on('bingo:unsubmit', (ack) => {
      const player = me();
      if (!player) return;
      if (reply(ack, room.unsubmit(player.id))) broadcast();
    });

    socket.on('bingo:call', (payload, ack) => {
      const player = me();
      if (!player) return;
      const result = room.call(player.id, payload?.index);
      if (!reply(ack, result)) return;
      nsp.emit('bingo:called', { ...result.call, markedFor: result.markedFor });
      broadcast();
    });

    // 훔쳐보기: 결과는 쓴 사람에게만(ack), 대상에게는 누가 훔쳐보는지 알림
    socket.on('bingo:peek', (payload, ack) => {
      if (typeof ack !== 'function') return;
      const player = me();
      if (!player) return;
      const result = room.peek(player.id, payload?.targetId, payload?.index);
      if (!result.ok) {
        ack(result);
        return;
      }
      ack({ ok: true, targetNickname: result.target.nickname, index: payload.index, text: result.text, marked: result.marked });
      const targetSocket = playerSockets.get(result.target.id);
      if (targetSocket) nsp.to(targetSocket).emit('bingo:peeked', { byNickname: player.nickname });
      broadcast();
    });

    socket.on('bingo:taunt', (payload, ack) => {
      const player = me();
      if (!player) return;
      const result = room.taunt(player.id, payload?.targetId);
      if (!reply(ack, result)) return;
      const targetSocket = playerSockets.get(result.target.id);
      if (targetSocket) nsp.to(targetSocket).emit('bingo:taunted', { byNickname: player.nickname, byCharacter: player.character });
      broadcast();
    });

    // ─── 관리자 ───

    socket.on('bingo:admin:auth', (payload, ack) => {
      if (typeof ack !== 'function') return;
      const pin = typeof payload?.pin === 'string' ? payload.pin.trim() : '';
      const token = typeof payload?.token === 'string' ? payload.token : '';
      const byPin = adminPin !== '' && pin !== '' && safeEqual(pin, adminPin);
      const byToken = !!adminToken && token !== '' && safeEqual(token, adminToken);
      if (!byPin && !byToken) {
        socket.data.authFailures = (socket.data.authFailures ?? 0) + 1;
        const error: ErrorPayload = token && !pin
          ? { code: 'NOT_ADMIN', message: '관리자 세션이 만료되었습니다. PIN을 다시 입력해 주세요.' }
          : { code: 'INVALID_PIN', message: 'PIN이 올바르지 않습니다.' };
        ack({ ok: false, error });
        if (socket.data.authFailures >= MAX_AUTH_FAILURES) socket.disconnect(true);
        return;
      }
      // 빙고는 관리자 화면을 여러 개 열어도 된다(퀴즈와 달리 마지막 인증 우선이 아님)
      adminToken ??= randomBytes(24).toString('base64url');
      adminSockets.add(socket.id);
      ack({ ok: true, token: adminToken });
      broadcast();
    });

    const adminCommand = (
      event: 'bingo:admin:start' | 'bingo:admin:skip' | 'bingo:admin:newRound' | 'bingo:admin:kickAll',
      run: () => BingoResult,
    ) => {
      socket.on(event, (ack) => {
        if (!isAdmin()) {
          reply(ack, { ok: false, error: { code: 'NOT_ADMIN', message: '관리자만 할 수 있는 동작입니다.' } });
          return;
        }
        if (reply(ack, run())) broadcast();
      });
    };

    socket.on('bingo:admin:topic', (payload, ack) => {
      if (!isAdmin()) {
        reply(ack, { ok: false, error: { code: 'NOT_ADMIN', message: '관리자만 할 수 있는 동작입니다.' } });
        return;
      }
      if (reply(ack, room.setTopic(payload?.topic))) broadcast();
    });
    adminCommand('bingo:admin:start', () => room.start());
    adminCommand('bingo:admin:skip', () => room.skipTurn());
    adminCommand('bingo:admin:newRound', () => {
      room.newRound();
      return { ok: true };
    });
    adminCommand('bingo:admin:kickAll', () => {
      room.kickAll();
      for (const [, socketId] of playerSockets) {
        const s = nsp.sockets.get(socketId);
        if (s) {
          s.data.playerId = undefined;
          s.emit('bingo:kicked');
        }
      }
      playerSockets.clear();
      return { ok: true };
    });

    socket.on('disconnect', () => {
      adminSockets.delete(socket.id);
      const { playerId } = socket.data;
      if (!playerId || playerSockets.get(playerId) !== socket.id) return;
      playerSockets.delete(playerId);
      room.setConnected(playerId, false);
      broadcast();
    });
  });

  return room;
}
