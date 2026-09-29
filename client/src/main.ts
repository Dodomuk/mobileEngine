import type { StateSnapshot } from '../../shared/types.ts';
import { renderEntry } from './screens/entry.ts';
import { renderLobby } from './screens/lobby.ts';
import { clearSession, loadSession, saveSession, type Session } from './session.ts';
import { socket } from './socket.ts';
import './style.css';

const app = document.querySelector<HTMLDivElement>('#app')!;
const reconnectOverlay = document.querySelector<HTMLDivElement>('#reconnect-overlay')!;

let session: Session | null = loadSession();
let lastSnapshot: StateSnapshot | null = null;
let updateLobby: ((snapshot: StateSnapshot, myId: string) => void) | null = null;

function showEntry(): void {
  updateLobby = null;
  renderEntry(app, (res) => {
    session = { playerId: res.playerId, sessionToken: res.sessionToken };
    saveSession(session);
    showLobby();
  });
}

function showLobby(): void {
  updateLobby = renderLobby(app);
  if (lastSnapshot && session) updateLobby(lastSnapshot, session.playerId);
}

function showConnecting(): void {
  updateLobby = null;
  app.innerHTML = '<main class="screen center"><div class="spinner" aria-hidden="true"></div></main>';
}

function resume(): void {
  if (!session) return;
  socket.emit('player:resume', { sessionToken: session.sessionToken }, (res) => {
    if (res.ok) {
      if (!updateLobby) showLobby();
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
  lastSnapshot = snapshot;
  if (updateLobby && session) updateLobby(snapshot, session.playerId);
});

socket.on('room:reset', () => {
  session = null;
  clearSession();
  showEntry();
});

if (session) showConnecting();
else showEntry();
