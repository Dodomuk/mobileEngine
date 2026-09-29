import {
  BINGO_CELLS,
  BINGO_MIN_PLAYERS,
  BINGO_TOPIC_MAX,
  BINGO_WIN_LINES,
  completedLines,
  type BingoAdminBoards,
  type BingoSnapshot,
} from '../../../shared/bingo.ts';
import { createAvatar } from '../avatar.ts';
import { showToast } from '../ui/notice.ts';
import { bingoSocket as socket } from './socket.ts';

const TOKEN_KEY = 'abc-quiz:bingo-admin-token';

function loadToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function saveToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // 무시
  }
}

const PHASE_LABEL: Record<BingoSnapshot['phase'], string> = {
  LOBBY: '대기 중 — 주제를 내 주세요',
  FILLING: '칸 채우는 중',
  PLAYING: '게임 진행 중',
  FINISHED: '게임 종료',
};

// 빙고 관리자 화면(/bingo/admin). 관리자는 판을 채우지 않고 진행만 한다.
export function startBingoAdminApp(app: HTMLElement, reconnectOverlay: HTMLElement): void {
  socket.connect();
  let token = loadToken();
  let authed = false;
  let snap: BingoSnapshot | null = null;
  let boards: BingoAdminBoards['boards'] = {};

  function showPinForm(message = ''): void {
    authed = false;
    app.innerHTML = `
      <main class="screen center">
        <form class="panel pin-form" novalidate>
          <h1>빙고 관리자</h1>
          <label for="pin">관리자 PIN</label>
          <input id="pin" type="password" inputmode="numeric" autocomplete="off" />
          <p class="form-error" role="alert"></p>
          <button type="submit" class="primary-button" disabled>입장하기</button>
        </form>
      </main>`;
    const form = app.querySelector<HTMLFormElement>('.pin-form')!;
    const input = app.querySelector<HTMLInputElement>('#pin')!;
    const errorText = app.querySelector<HTMLParagraphElement>('.form-error')!;
    const button = app.querySelector<HTMLButtonElement>('.primary-button')!;
    errorText.textContent = message;
    input.addEventListener('input', () => {
      errorText.textContent = '';
      button.disabled = input.value.trim() === '';
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      button.disabled = true;
      socket.emit('bingo:admin:auth', { pin: input.value.trim() }, (res) => {
        button.disabled = false;
        if (!res.ok) {
          errorText.textContent = res.error.message;
          return;
        }
        onAuthed(res.token);
      });
    });
    input.focus();
  }

  function onAuthed(newToken: string): void {
    token = newToken;
    saveToken(newToken);
    if (!authed) buildView();
    authed = true;
    render();
  }

  socket.on('connect', () => {
    reconnectOverlay.hidden = true;
    if (!token) {
      showPinForm();
      return;
    }
    socket.emit('bingo:admin:auth', { token }, (res) => {
      if (res.ok) onAuthed(res.token);
      else {
        token = null;
        saveToken(null);
        showPinForm(res.error.message);
      }
    });
  });
  socket.on('disconnect', () => {
    if (authed) reconnectOverlay.hidden = false;
  });
  socket.on('bingo:snapshot', (s) => {
    snap = s;
    if (authed) render();
  });
  socket.on('bingo:admin:boards', (b) => {
    boards = b.boards;
    if (authed) render();
  });
  socket.on('bingo:called', (call) => {
    if (authed) showToast(`📣 ${call.nickname}: 「${call.text}」 (${call.markedFor.length}명 지움)`, 'info');
  });

  app.innerHTML = '<main class="screen center"><div class="spinner" aria-hidden="true"></div></main>';

  // ─── 화면 ───

  let els: Record<string, HTMLElement> = {};
  let confirmingKick = false;

  function send(event: 'bingo:admin:start' | 'bingo:admin:skip' | 'bingo:admin:newRound' | 'bingo:admin:kickAll'): void {
    socket.emit(event, (res) => {
      if (!res.ok) showToast(res.error.message);
    });
  }

  function buildView(): void {
    app.innerHTML = `
      <main class="bingo-admin">
        <header class="bingo-admin-head">
          <h1>빙고 관리자</h1>
          <span class="bingo-admin-phase"></span>
        </header>
        <form class="panel bingo-topic-form" novalidate>
          <label for="topic">주제</label>
          <div class="bingo-topic-row">
            <input id="topic" type="text" maxlength="${BINGO_TOPIC_MAX}" autocomplete="off" placeholder="예: 과일, 아이돌 그룹, 회사 근처 맛집" />
            <button type="submit" class="primary-button">주제 내기</button>
          </div>
        </form>
        <section class="panel bingo-admin-controls">
          <p class="bingo-admin-note"></p>
          <div class="bingo-admin-buttons">
            <button type="button" class="admin-button primary" data-cmd="start">게임 시작</button>
            <button type="button" class="admin-button primary" data-cmd="skip">순서 넘기기</button>
            <button type="button" class="admin-button primary" data-cmd="newRound">새 판</button>
            <button type="button" class="admin-button danger" data-cmd="kickAll">모두 내보내기</button>
          </div>
        </section>
        <section class="panel">
          <h2>플레이어</h2>
          <div class="bingo-admin-boards"></div>
        </section>
        <section class="panel">
          <h2>부른 단어</h2>
          <ol class="bingo-calls"></ol>
        </section>
      </main>`;
    const $ = (sel: string) => app.querySelector<HTMLElement>(sel)!;
    els = {
      phase: $('.bingo-admin-phase'),
      topicForm: $('.bingo-topic-form'),
      topicInput: $('#topic'),
      topicButton: $('.bingo-topic-form button'),
      note: $('.bingo-admin-note'),
      start: $('[data-cmd="start"]'),
      skip: $('[data-cmd="skip"]'),
      newRound: $('[data-cmd="newRound"]'),
      kickAll: $('[data-cmd="kickAll"]'),
      boards: $('.bingo-admin-boards'),
      calls: $('.bingo-calls'),
    };
    els.topicForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const topic = (els.topicInput as HTMLInputElement).value;
      socket.emit('bingo:admin:topic', { topic }, (res) => {
        if (!res.ok) showToast(res.error.message);
      });
    });
    els.start.addEventListener('click', () => send('bingo:admin:start'));
    els.skip.addEventListener('click', () => send('bingo:admin:skip'));
    els.newRound.addEventListener('click', () => send('bingo:admin:newRound'));
    els.kickAll.addEventListener('click', () => {
      // 한 번 더 눌러야 실행
      if (!confirmingKick) {
        confirmingKick = true;
        els.kickAll.textContent = '정말 모두 내보내기?';
        setTimeout(() => {
          confirmingKick = false;
          els.kickAll.textContent = '모두 내보내기';
        }, 4000);
        return;
      }
      confirmingKick = false;
      els.kickAll.textContent = '모두 내보내기';
      send('bingo:admin:kickAll');
    });
  }

  function render(): void {
    const s = snap;
    if (!s || !els.phase) return;
    const turn = s.players.find((p) => p.id === s.turnPlayerId);
    els.phase.textContent = `${PHASE_LABEL[s.phase]} · 입장 ${s.players.length}/${s.maxPlayers}`;

    const topicInput = els.topicInput as HTMLInputElement;
    const canEditTopic = s.phase === 'LOBBY' || s.phase === 'FILLING';
    els.topicForm.hidden = !canEditTopic;
    if (document.activeElement !== topicInput && s.topic) topicInput.value = s.topic;
    els.topicButton.textContent = s.phase === 'FILLING' ? '주제 수정' : '주제 내기';

    // 시작 가능 조건: 접속 중인 플레이어 전원 제출, 제출자 2명 이상
    const connected = s.players.filter((p) => p.connected);
    const submitted = s.players.filter((p) => p.submitted);
    const waiting = connected.filter((p) => !p.submitted);
    const canStart = s.phase === 'FILLING' && waiting.length === 0 && submitted.length >= BINGO_MIN_PLAYERS;
    els.start.hidden = s.phase !== 'FILLING';
    (els.start as HTMLButtonElement).disabled = !canStart;
    els.skip.hidden = s.phase !== 'PLAYING';
    els.newRound.hidden = s.phase === 'LOBBY';

    els.note.textContent =
      s.phase === 'LOBBY' ? '주제를 내면 플레이어가 25칸을 채우기 시작합니다.'
      : s.phase === 'FILLING'
        ? canStart ? `모두 제출했어요 (${submitted.length}명). 게임을 시작할 수 있어요.`
        : waiting.length ? `제출 대기: ${waiting.map((p) => p.nickname).join(', ')} (${submitted.length}/${connected.length})`
        : `제출한 플레이어가 ${BINGO_MIN_PLAYERS}명 이상이어야 합니다.`
      : s.phase === 'PLAYING' ? `지금 차례: ${turn?.nickname ?? '-'}${turn && !turn.connected ? ' (접속 끊김 — 순서 넘기기로 넘길 수 있어요)' : ''}`
      : `🎉 우승: ${s.players.filter((p) => s.winners.includes(p.id)).map((p) => p.nickname).join(', ')}`;

    // 플레이어별 판(관리자만 볼 수 있음)
    const ordered = s.order.length
      ? [...s.order.map((id) => s.players.find((p) => p.id === id)!).filter(Boolean), ...s.players.filter((p) => !s.order.includes(p.id))]
      : s.players;
    els.boards.replaceChildren(...ordered.map((p) => {
      const card = document.createElement('article');
      card.className = 'bingo-admin-card';
      card.classList.toggle('turn', p.id === s.turnPlayerId);
      card.classList.toggle('offline', !p.connected);
      card.classList.toggle('winner', s.winners.includes(p.id));
      const head = document.createElement('header');
      const name = document.createElement('strong');
      name.textContent = p.nickname;
      const info = document.createElement('span');
      info.textContent =
        s.phase === 'FILLING' || s.phase === 'LOBBY' ? (p.submitted ? '제출 ✓' : '작성 중')
        : p.inGame ? `${p.lines}/${BINGO_WIN_LINES}줄` : '관전';
      const skills = document.createElement('span');
      skills.className = 'bingo-admin-skills';
      skills.textContent = `${p.usedPeek ? '👀' : ''}${p.usedTaunt ? '😜' : ''}`;
      head.append(createAvatar(p.character, 30), name, info, skills);
      card.append(head);
      const b = boards[p.id];
      if (b?.board) {
        const lineCells = new Set(completedLines(b.marked).flat());
        const grid = document.createElement('div');
        grid.className = 'bingo-mini';
        for (let i = 0; i < BINGO_CELLS; i++) {
          const cell = document.createElement('span');
          cell.textContent = b.board[i];
          cell.classList.toggle('marked', b.marked[i]);
          cell.classList.toggle('in-line', lineCells.has(i));
          grid.append(cell);
        }
        card.append(grid);
      }
      return card;
    }));
    if (s.players.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'admin-hint';
      empty.textContent = '아직 입장한 플레이어가 없어요. 플레이어는 /bingo 로 들어옵니다.';
      els.boards.replaceChildren(empty);
    }

    els.calls.replaceChildren(...s.calls.map((c) => {
      const li = document.createElement('li');
      li.textContent = `${c.text} · ${c.nickname}`;
      return li;
    }).reverse());
  }
}
