import type { StateSnapshot } from '../../shared/types.ts';
import { syncClock } from './clock.ts';
import { renderEntry } from './screens/entry.ts';
import { renderGame, type GameScreen } from './screens/game.ts';
import { clearSession, loadSession, saveSession, type Session } from './session.ts';
import { socket } from './socket.ts';
import { showFullscreenNotice, showToast } from './ui/notice.ts';

export function startPlayerApp(app: HTMLElement, reconnectOverlay: HTMLElement): void {
  socket.connect();
  let session: Session | null = loadSession();
  let lastSnapshot: StateSnapshot | null = null;
  let game: GameScreen | null = null;

  function leaveGame(): void {
    game?.destroy();
    game = null;
  }

  function showEntry(): void {
    leaveGame();
    renderEntry(app, {
      title: 'ABC 광장 퀴즈',
      switchTo: { href: '/bingo', label: '🎱 빙고' },
      join: (payload, done) => socket.emit('player:join', payload, done),
    }, (res) => {
      session = { playerId: res.playerId, sessionToken: res.sessionToken };
      saveSession(session);
      showGame();
    });
  }

  function showGame(): void {
    leaveGame();
    game = renderGame(app);
    if (lastSnapshot && session) game.update(lastSnapshot, session.playerId);
  }

  function showConnecting(): void {
    leaveGame();
    app.innerHTML = '<main class="screen center"><div class="spinner" aria-hidden="true"></div></main>';
  }

  function resume(): void {
    if (!session) return;
    socket.emit('player:resume', { sessionToken: session.sessionToken }, (res) => {
      if (res.ok) {
        if (!game) showGame();
        game?.setMyAction(res.action);
        return;
      }
      // 서버가 재시작됐거나 새 게임으로 초기화된 경우: 처음부터 다시 입장
      session = null;
      clearSession();
      showEntry();
    });
  }

  socket.on('connect', () => {
    reconnectOverlay.hidden = true;
    resume();
  });

  socket.on('disconnect', () => {
    if (session) reconnectOverlay.hidden = false;
  });

  socket.on('connect_error', () => {
    if (session) reconnectOverlay.hidden = false;
  });

  socket.on('state:snapshot', (snapshot) => {
    syncClock(snapshot.serverNow);
    lastSnapshot = snapshot;
    if (game && session) game.update(snapshot, session.playerId);
  });

  socket.on('state:positions', (positions) => {
    game?.applyPositions(positions);
  });

  socket.on('player:emote', ({ playerId, emote }) => {
    game?.showEmote(playerId, emote);
  });

  // 3장: 연습이 끝나고 본 게임이 시작되면 3초간 전면 안내
  socket.on('game:mainStart', () => {
    if (session) showFullscreenNotice('이제부터 진짜 게임!', '점수가 0점으로 초기화됩니다');
  });

  socket.on('error', (error) => {
    // 입장 화면의 검증 에러는 폼 안에서 보여 준다
    if (session) showToast(error.message);
  });

  socket.on('room:reset', () => {
    session = null;
    clearSession();
    showEntry();
  });

  if (session) showConnecting();
  else showEntry();
}
