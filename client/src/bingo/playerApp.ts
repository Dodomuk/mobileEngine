import {
  BINGO_CELLS,
  BINGO_SIZE,
  BINGO_WIN_LINES,
  checkBoard,
  type BingoPublicPlayer,
  type BingoSnapshot,
} from '../../../shared/bingo.ts';
import { createAvatar } from '../avatar.ts';
import { renderEntry } from '../screens/entry.ts';
import { BINGO_SESSION_KEY, clearSession, loadSession, saveSession, type Session } from '../session.ts';
import { showToast } from '../ui/notice.ts';
import { BingoBoard, type BoardMode } from './board.ts';
import { bingoSocket as socket } from './socket.ts';

const DRAFT_KEY = 'abc-quiz:bingo-draft';

function loadDraft(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? '[]');
    if (Array.isArray(parsed)) return Array.from({ length: BINGO_CELLS }, (_, i) => String(parsed[i] ?? ''));
  } catch {
    // 무시
  }
  return Array(BINGO_CELLS).fill('');
}

function saveDraft(cells: string[] | null): void {
  try {
    if (cells) localStorage.setItem(DRAFT_KEY, JSON.stringify(cells));
    else localStorage.removeItem(DRAFT_KEY);
  } catch {
    // 무시: 새로고침하면 다시 채우면 된다
  }
}

const cellName = (i: number) => `${Math.floor(i / BINGO_SIZE) + 1}행 ${(i % BINGO_SIZE) + 1}열`;

export function startBingoPlayerApp(app: HTMLElement, reconnectOverlay: HTMLElement): void {
  socket.connect();
  let session: Session | null = loadSession(BINGO_SESSION_KEY);
  let view: BingoView | null = null;
  let lastSnapshot: BingoSnapshot | null = null;

  function showEntry(): void {
    view?.destroy();
    view = null;
    renderEntry(app, {
      title: '빙고',
      switchTo: { href: '/', label: '🎯 퀴즈' },
      join: (payload, done) => socket.emit('bingo:join', payload, done),
    }, (res) => {
      session = { playerId: res.playerId, sessionToken: res.sessionToken };
      saveSession(session, BINGO_SESSION_KEY);
      showBoard();
    });
  }

  function showBoard(): void {
    view?.destroy();
    view = renderBingoView(app);
    if (lastSnapshot) view.update(lastSnapshot);
  }

  function resume(): void {
    if (!session) return;
    socket.emit('bingo:resume', { sessionToken: session.sessionToken }, (res) => {
      if (res.ok) {
        if (!view) showBoard();
        return;
      }
      session = null;
      clearSession(BINGO_SESSION_KEY);
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
  socket.on('bingo:snapshot', (snapshot) => {
    lastSnapshot = snapshot;
    if (session && snapshot.me) view?.update(snapshot);
  });
  socket.on('bingo:called', (call) => view?.onCalled(call));
  socket.on('bingo:peeked', ({ byNickname }) => view?.onPeeked(byNickname));
  socket.on('bingo:taunted', (payload) => view?.onTaunted(payload.byNickname, payload.byCharacter));
  socket.on('bingo:kicked', () => {
    session = null;
    clearSession(BINGO_SESSION_KEY);
    saveDraft(null);
    showEntry();
  });

  if (session) app.innerHTML = '<main class="screen center"><div class="spinner" aria-hidden="true"></div></main>';
  else showEntry();
}

interface BingoView {
  update(s: BingoSnapshot): void;
  onCalled(call: { nickname: string; text: string; markedFor: string[] }): void;
  onPeeked(byNickname: string): void;
  onTaunted(byNickname: string, byCharacter: BingoPublicPlayer['character']): void;
  destroy(): void;
}

function renderBingoView(app: HTMLElement): BingoView {
  app.innerHTML = `
    <main class="bingo">
      <header class="bingo-header">
        <div class="bingo-title">
          <span class="bingo-badge">빙고</span>
          <h1 class="bingo-topic"></h1>
        </div>
        <p class="bingo-status" role="status"></p>
      </header>
      <section class="bingo-main">
        <div class="bingo-board-slot"></div>
        <div class="bingo-actions">
          <p class="bingo-hint"></p>
          <button type="button" class="primary-button bingo-primary" hidden></button>
          <button type="button" class="bingo-secondary" hidden></button>
        </div>
      </section>
      <aside class="bingo-side">
        <div class="bingo-skills">
          <button type="button" class="bingo-skill" data-skill="peek">👀 훔쳐보기 <small>1회</small></button>
          <button type="button" class="bingo-skill" data-skill="taunt">😜 약올리기 <small>1회</small></button>
        </div>
        <p class="bingo-peek-result" hidden></p>
        <h2>플레이어</h2>
        <ul class="bingo-players"></ul>
        <h2>부른 단어</h2>
        <ol class="bingo-calls"></ol>
      </aside>
      <div class="bingo-modal" hidden>
        <div class="bingo-modal-card" role="dialog" aria-modal="true">
          <h2 class="bingo-modal-title"></h2>
          <div class="bingo-modal-body"></div>
          <button type="button" class="bingo-modal-cancel">취소</button>
        </div>
      </div>
    </main>
  `;
  const $ = <T extends HTMLElement>(sel: string) => app.querySelector<T>(sel)!;
  const topicEl = $('.bingo-topic');
  const statusEl = $('.bingo-status');
  const hintEl = $('.bingo-hint');
  const primary = $<HTMLButtonElement>('.bingo-primary');
  const secondary = $<HTMLButtonElement>('.bingo-secondary');
  const playersEl = $<HTMLUListElement>('.bingo-players');
  const callsEl = $<HTMLOListElement>('.bingo-calls');
  const peekBtn = $<HTMLButtonElement>('[data-skill="peek"]');
  const tauntBtn = $<HTMLButtonElement>('[data-skill="taunt"]');
  const peekResult = $<HTMLParagraphElement>('.bingo-peek-result');
  const modal = $<HTMLElement>('.bingo-modal');
  const modalTitle = $('.bingo-modal-title');
  const modalBody = $('.bingo-modal-body');

  let snap: BingoSnapshot | null = null;
  let selected: number | null = null;
  let busy = false;
  let winnerShownFor: string | null = null;

  const board = new BingoBoard(
    (cells) => {
      saveDraft(cells);
      renderActions();
    },
    (index) => {
      selected = selected === index ? null : index;
      render();
    },
  );
  $('.bingo-board-slot').append(board.el);

  const others = (): BingoPublicPlayer[] => snap?.players.filter((p) => p.id !== snap?.me?.id) ?? [];
  const myTurn = () => snap?.phase === 'PLAYING' && snap.turnPlayerId === snap.me?.id;

  function boardMode(s: BingoSnapshot): BoardMode {
    if (s.phase === 'LOBBY') return 'empty';
    if (s.phase === 'FILLING') return s.me?.submitted ? 'locked' : 'fill';
    return s.me?.board ? 'play' : 'empty';
  }

  function render(): void {
    const s = snap;
    if (!s?.me) return;
    const mode = boardMode(s);
    if (!myTurn() || (selected !== null && s.me.marked[selected])) selected = null;
    board.render({
      mode,
      cells: mode === 'fill' ? loadDraft() : s.me.board ?? [],
      marked: s.me.marked,
      selectable: myTurn(),
      selected,
    });
    renderActions();
  }

  function renderActions(): void {
    const s = snap;
    if (!s?.me) return;
    primary.hidden = true;
    secondary.hidden = true;
    primary.disabled = busy;
    hintEl.textContent = '';
    hintEl.classList.remove('error');

    if (s.phase === 'FILLING' && !s.me.submitted) {
      const problems = checkBoard(board.values());
      const empty = problems.filter((p) => p.reason === 'EMPTY').length;
      const dup = problems.some((p) => p.reason === 'DUPLICATE');
      hintEl.textContent = dup ? '같은 답이 두 칸에 있어요(띄어쓰기·대소문자 무시)'
        : empty > 0 ? `${BINGO_CELLS - empty}/${BINGO_CELLS}칸 채움` : '모두 채웠어요! 제출해 주세요';
      hintEl.classList.toggle('error', dup);
      primary.hidden = false;
      primary.textContent = '제출하기';
      primary.disabled = busy || problems.length > 0;
    } else if (s.phase === 'FILLING') {
      const inRound = s.players.filter((p) => p.connected);
      hintEl.textContent = `제출 완료! 다른 플레이어를 기다리는 중 (${inRound.filter((p) => p.submitted).length}/${inRound.length})`;
      secondary.hidden = false;
      secondary.textContent = '수정하기';
    } else if (myTurn()) {
      hintEl.textContent = selected === null ? '지워지지 않은 내 칸을 하나 골라 주세요' : `「${s.me.board![selected]}」을(를) 부를까요?`;
      primary.hidden = false;
      primary.textContent = '부르기';
      primary.disabled = busy || selected === null;
    }
  }

  primary.addEventListener('click', () => {
    const s = snap;
    if (!s?.me || busy) return;
    if (s.phase === 'FILLING' && !s.me.submitted) {
      busy = true;
      socket.emit('bingo:submit', { cells: board.values() }, (res) => {
        busy = false;
        if (!res.ok) showToast(res.error.message);
        renderActions();
      });
    } else if (myTurn() && selected !== null) {
      busy = true;
      socket.emit('bingo:call', { index: selected }, (res) => {
        busy = false;
        selected = null;
        if (!res.ok) showToast(res.error.message);
        render();
      });
    }
  });

  secondary.addEventListener('click', () => {
    socket.emit('bingo:unsubmit', (res) => {
      if (!res.ok) showToast(res.error.message);
    });
  });

  // ─── 기술 ───

  function openModal(title: string, body: HTMLElement): void {
    modalTitle.textContent = title;
    modalBody.replaceChildren(body);
    modal.hidden = false;
  }
  const closeModal = () => {
    modal.hidden = true;
  };
  $('.bingo-modal-cancel').addEventListener('click', closeModal);

  function playerPicker(list: BingoPublicPlayer[], onPick: (p: BingoPublicPlayer) => void): HTMLElement {
    const ul = document.createElement('ul');
    ul.className = 'target-list';
    for (const p of list) {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'target-option';
      const name = document.createElement('span');
      name.textContent = p.nickname;
      btn.append(createAvatar(p.character, 40), name);
      btn.addEventListener('click', () => onPick(p));
      li.append(btn);
      ul.append(li);
    }
    if (list.length === 0) {
      const empty = document.createElement('p');
      empty.textContent = '고를 수 있는 플레이어가 없어요.';
      return empty;
    }
    return ul;
  }

  peekBtn.addEventListener('click', () => {
    const targets = others().filter((p) => p.inGame);
    openModal('👀 누구의 판을 훔쳐볼까요?', playerPicker(targets, (target) => {
      const grid = document.createElement('div');
      grid.className = 'peek-grid';
      for (let i = 0; i < BINGO_CELLS; i++) {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = '?';
        b.setAttribute('aria-label', cellName(i));
        b.addEventListener('click', () => {
          closeModal();
          socket.emit('bingo:peek', { targetId: target.id, index: i }, (res) => {
            if (!res.ok) {
              showToast(res.error.message);
              return;
            }
            peekResult.hidden = false;
            peekResult.textContent = `👀 ${res.targetNickname}님 ${cellName(res.index)}: 「${res.text}」${res.marked ? ' (이미 지워진 칸)' : ''}`;
          });
        });
        grid.append(b);
      }
      openModal(`👀 ${target.nickname}님의 어느 칸을 볼까요?`, grid);
    }));
  });

  tauntBtn.addEventListener('click', () => {
    openModal('😜 누구를 약올릴까요?', playerPicker(others(), (target) => {
      closeModal();
      socket.emit('bingo:taunt', { targetId: target.id }, (res) => {
        if (!res.ok) showToast(res.error.message);
        else showToast(`${target.nickname}님을 약올렸어요 😜`, 'info');
      });
    }));
  });

  function renderSide(s: BingoSnapshot): void {
    const me = s.me!;
    peekBtn.disabled = me.usedPeek || s.phase !== 'PLAYING' || !me.board;
    tauntBtn.disabled = me.usedTaunt || (s.phase !== 'FILLING' && s.phase !== 'PLAYING');
    peekBtn.classList.toggle('used', me.usedPeek);
    tauntBtn.classList.toggle('used', me.usedTaunt);
    if (s.phase === 'LOBBY') peekResult.hidden = true;

    // 게임 중에는 부르는 순서대로, 아니면 입장 순서대로
    const ordered = s.order.length
      ? [...s.order.map((id) => s.players.find((p) => p.id === id)!).filter(Boolean), ...s.players.filter((p) => !s.order.includes(p.id))]
      : s.players;
    playersEl.replaceChildren(...ordered.map((p) => {
      const li = document.createElement('li');
      li.className = 'bingo-player';
      li.classList.toggle('me', p.id === me.id);
      li.classList.toggle('turn', p.id === s.turnPlayerId);
      li.classList.toggle('offline', !p.connected);
      li.classList.toggle('winner', s.winners.includes(p.id));
      const name = document.createElement('span');
      name.className = 'bingo-player-name';
      name.textContent = p.nickname;
      const info = document.createElement('span');
      info.className = 'bingo-player-info';
      if (s.phase === 'FILLING') info.textContent = p.submitted ? '제출 ✓' : '작성 중…';
      else if (s.phase === 'PLAYING' || s.phase === 'FINISHED') {
        info.textContent = p.inGame ? `${'★'.repeat(p.lines)}${'☆'.repeat(Math.max(0, BINGO_WIN_LINES - p.lines))}` : '관전';
      }
      li.append(createAvatar(p.character, 34), name, info);
      return li;
    }));

    callsEl.replaceChildren(...s.calls.map((c) => {
      const li = document.createElement('li');
      li.textContent = c.text;
      li.title = `${c.nickname}님이 부름`;
      return li;
    }).reverse());
  }

  function renderHeader(s: BingoSnapshot): void {
    topicEl.textContent = s.topic ? `주제: ${s.topic}` : '주제 대기 중';
    const turn = s.players.find((p) => p.id === s.turnPlayerId);
    statusEl.classList.toggle('my-turn', myTurn());
    statusEl.textContent =
      s.phase === 'LOBBY' ? `관리자가 주제를 내길 기다리는 중 (현재 ${s.players.length}/${s.maxPlayers}명)`
      : s.phase === 'FILLING' ? '주제에 맞게 25칸을 채우고 제출하세요. 먼저 3줄을 지우는 사람이 우승!'
      : s.phase === 'PLAYING' ? (myTurn() ? '🔔 내 차례! 칸을 골라 부르세요' : !s.me?.board ? '이번 판은 관전 중이에요' : `지금 차례: ${turn?.nickname ?? '-'}`)
      : '게임 종료';
  }

  function showWinners(s: BingoSnapshot): void {
    const key = s.winners.join(',');
    if (s.phase !== 'FINISHED' || winnerShownFor === key) return;
    winnerShownFor = key;
    const winners = s.players.filter((p) => s.winners.includes(p.id));
    const iWon = s.winners.includes(s.me?.id ?? '');
    const overlay = document.createElement('div');
    overlay.className = 'bingo-winner';
    overlay.innerHTML = `
      <div class="bingo-winner-card">
        <p class="bingo-winner-burst">🎉 빙고! 🎉</p>
        <h2></h2>
        <ul class="bingo-winner-list"></ul>
        <button type="button" class="primary-button">내 판 보기</button>
      </div>`;
    overlay.querySelector('h2')!.textContent = iWon ? '축하해요, 우승입니다!' : `우승자 ${winners.length}명`;
    overlay.querySelector('.bingo-winner-list')!.append(...winners.map((w) => {
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.textContent = w.nickname;
      li.append(createAvatar(w.character, 56), name);
      return li;
    }));
    overlay.querySelector('button')!.addEventListener('click', () => overlay.remove());
    app.querySelector('.bingo')!.append(overlay);
  }

  return {
    update(s) {
      // 입장 직후에는 내 정보가 없는 스냅샷이 먼저 올 수 있다
      if (!s.me) return;
      const prevPhase = snap?.phase;
      snap = s;
      if (s.phase === 'LOBBY' && prevPhase && prevPhase !== 'LOBBY') {
        saveDraft(null); // 새 판
        winnerShownFor = null;
        app.querySelectorAll('.bingo-winner').forEach((el) => el.remove());
      }
      if (s.phase !== 'PLAYING' && s.phase !== 'FILLING') closeModal();
      renderHeader(s);
      render();
      renderSide(s);
      showWinners(s);
    },
    onCalled(call) {
      const mine = snap?.me && call.markedFor.includes(snap.me.id);
      showToast(`📣 ${call.nickname}: 「${call.text}」${mine ? ' — 내 판에도 있어요!' : ''}`, 'info');
    },
    onPeeked(byNickname) {
      const el = document.createElement('div');
      el.className = 'bingo-peek-alert';
      el.setAttribute('role', 'alert');
      el.textContent = `👀 '${byNickname}'가 플레이어님을 훔쳐보는 중입니다`;
      document.body.append(el);
      setTimeout(() => el.remove(), 4000);
    },
    onTaunted(byNickname, byCharacter) {
      const el = document.createElement('div');
      el.className = 'bingo-taunt';
      el.innerHTML = `
        <div class="bingo-taunt-face">😝</div>
        <p class="bingo-taunt-text">메롱~</p>
        <p class="bingo-taunt-by"></p>`;
      el.querySelector('.bingo-taunt-by')!.append(createAvatar(byCharacter, 44), document.createTextNode(`${byNickname}님이 약올려요!`));
      document.body.append(el);
      setTimeout(() => el.remove(), 2800);
    },
    destroy() {
      closeModal();
    },
  };
}
