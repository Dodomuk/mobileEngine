import { ADMIN_ID, MAIN_COUNT, PRACTICE_COUNT } from '../../shared/constants.ts';
import type { AnswerTally, EmoteType, Question, RoundAction, StateSnapshot } from '../../shared/types.ts';
import { syncClock } from './clock.ts';
import { FieldView } from './field.ts';
import { socket } from './socket.ts';
import { showFullscreenNotice, showToast } from './ui/notice.ts';
import { renderRanking } from './ui/ranking.ts';
import { TimerBar } from './ui/timer.ts';

const TOKEN_KEY = 'abc-quiz:admin-token';
const CHOICES = ['A', 'B', 'C'] as const;

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
    // 무시: 새로고침하면 PIN을 다시 입력하면 된다
  }
}

type Command = 'admin:start' | 'admin:revealNow' | 'admin:next' | 'admin:startMain' | 'admin:finish' | 'admin:reset';

// 6장 관리자 버튼. 현재 단계에서 쓸 수 없는 버튼은 숨긴다.
const BUTTONS: { command: Command; label: string; tone: string; visible: (s: StateSnapshot) => boolean }[] = [
  { command: 'admin:start', label: '게임 시작', tone: 'primary', visible: (s) => s.phase === 'LOBBY' },
  { command: 'admin:revealNow', label: '정답 바로 발표', tone: 'primary', visible: (s) => s.phase === 'QUESTION' },
  {
    command: 'admin:next', label: '다음 문제', tone: 'primary',
    visible: (s) => s.phase === 'REVEAL' && !!s.question && s.question.number < s.question.total,
  },
  {
    command: 'admin:startMain', label: '본 게임 시작', tone: 'primary',
    visible: (s) => s.phase === 'REVEAL' && s.stage === 'PRACTICE' && s.question?.number === s.question?.total,
  },
  {
    command: 'admin:finish', label: '결과 발표', tone: 'primary',
    visible: (s) => s.phase === 'REVEAL' && s.stage === 'MAIN' && s.question?.number === s.question?.total,
  },
  { command: 'admin:reset', label: '새 게임', tone: 'danger', visible: () => true },
];

// 3장·6장 관리자 화면(/admin): PIN 인증 → 필드 + 문제 텍스트·정답·해설·인원 분포 + 진행 버튼
export function startAdminApp(app: HTMLElement, reconnectOverlay: HTMLElement): void {
  let token = loadToken();
  let authed = false;
  let view: AdminView | null = null;
  let lastSnapshot: StateSnapshot | null = null;
  let lastQuestion: Question | null = null;

  function showPinForm(message = ''): void {
    authed = false;
    view?.destroy();
    view = null;
    app.innerHTML = `
      <main class="screen center">
        <form class="panel pin-form" novalidate>
          <h1>관리자 입장</h1>
          <label for="pin">관리자 PIN</label>
          <input id="pin" type="password" inputmode="numeric" autocomplete="off" />
          <p class="form-error" role="alert"></p>
          <button type="submit" class="primary-button" disabled>입장하기</button>
        </form>
      </main>
    `;
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
      if (!input.value.trim()) return;
      button.disabled = true;
      socket.emit('admin:auth', { pin: input.value.trim() }, (res) => {
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
    authed = true;
    if (!view) view = renderAdminView(app);
    if (lastSnapshot) view.update(lastSnapshot);
    view.setQuestion(lastQuestion);
  }

  function authWithToken(): void {
    if (!token) {
      showPinForm();
      return;
    }
    socket.emit('admin:auth', { token }, (res) => {
      if (res.ok) {
        onAuthed(res.token);
        return;
      }
      // 서버가 재시작됐거나 다른 기기에서 PIN으로 다시 인증한 경우
      token = null;
      saveToken(null);
      showPinForm(res.error.message);
    });
  }

  socket.on('connect', () => {
    reconnectOverlay.hidden = true;
    authWithToken();
  });
  socket.on('disconnect', () => {
    if (authed) reconnectOverlay.hidden = false;
  });
  socket.on('connect_error', () => {
    if (authed) reconnectOverlay.hidden = false;
  });

  socket.on('state:snapshot', (snapshot) => {
    syncClock(snapshot.serverNow);
    lastSnapshot = snapshot;
    view?.update(snapshot);
  });
  socket.on('state:positions', (positions) => view?.applyPositions(positions));
  socket.on('admin:question', (question) => {
    lastQuestion = question;
    view?.setQuestion(question);
  });
  socket.on('admin:tally', (tally) => view?.setTally(tally));
  socket.on('player:emote', ({ playerId, emote }) => view?.showEmote(playerId, emote));
  socket.on('game:mainStart', () => showFullscreenNotice('본 게임 시작', '모든 플레이어의 점수가 0점으로 초기화되었습니다'));
  socket.on('error', (error) => {
    if (error.code === 'ADMIN_REPLACED') {
      token = null;
      saveToken(null);
      showPinForm(error.message);
      return;
    }
    showToast(error.message);
  });

  app.innerHTML = '<main class="screen center"><div class="spinner" aria-hidden="true"></div></main>';
}

interface AdminView {
  update(snapshot: StateSnapshot): void;
  setQuestion(question: Question | null): void;
  setTally(tally: AnswerTally): void;
  applyPositions(positions: Parameters<FieldView['applyPositions']>[0]): void;
  showEmote(playerId: string, emote: EmoteType): void;
  destroy(): void;
}

function renderAdminView(app: HTMLElement): AdminView {
  app.innerHTML = `
    <main class="admin">
      <section class="admin-panel">
        <div class="admin-status">
          <span class="admin-phase"></span>
          <span class="admin-count"></span>
        </div>
        <div class="admin-timer-slot"></div>
        <div class="admin-question">
          <p class="admin-question-meta"></p>
          <p class="admin-question-text"></p>
          <img class="q-image" alt="" hidden />
          <ol class="admin-choices">
            ${CHOICES.map((c) => `<li data-choice="${c}"><b>${c}</b><span></span><em class="tally-count"></em></li>`).join('')}
          </ol>
          <p class="admin-none"></p>
          <p class="admin-explanation" hidden></p>
        </div>
        <div class="admin-scoreboard"></div>
      </section>
      <section class="admin-field"></section>
      <nav class="admin-controls"></nav>
    </main>
  `;
  const phaseEl = app.querySelector<HTMLElement>('.admin-phase')!;
  const countEl = app.querySelector<HTMLElement>('.admin-count')!;
  const questionBox = app.querySelector<HTMLElement>('.admin-question')!;
  const metaEl = app.querySelector<HTMLElement>('.admin-question-meta')!;
  const textEl = app.querySelector<HTMLElement>('.admin-question-text')!;
  const image = app.querySelector<HTMLImageElement>('.q-image')!;
  const choiceEls = new Map(CHOICES.map((c) => [c, app.querySelector<HTMLLIElement>(`.admin-choices [data-choice="${c}"]`)!]));
  const noneEl = app.querySelector<HTMLElement>('.admin-none')!;
  const explanationEl = app.querySelector<HTMLElement>('.admin-explanation')!;
  const scoreboard = app.querySelector<HTMLElement>('.admin-scoreboard')!;
  const controls = app.querySelector<HTMLElement>('.admin-controls')!;
  const timer = new TimerBar();
  app.querySelector('.admin-timer-slot')!.append(timer.el);
  image.addEventListener('error', () => {
    image.hidden = true;
  });

  const field = new FieldView(app.querySelector<HTMLElement>('.admin-field')!, {
    align: 'center',
    onMove: (x, y) => socket.emit('player:move', { x, y }),
  });

  let snapshot: StateSnapshot | null = null;
  let question: Question | null = null;
  let confirmingReset = false;

  const buttons = new Map<Command, HTMLButtonElement>();
  for (const def of BUTTONS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `admin-button ${def.tone}`;
    btn.textContent = def.label;
    btn.addEventListener('click', () => {
      if (def.command === 'admin:reset') {
        // 6장: 새 게임은 확인 창 필수. 한 번 더 눌러야 실행된다.
        if (!confirmingReset) {
          confirmingReset = true;
          btn.textContent = '정말 새 게임? 모두 퇴장됩니다';
          setTimeout(() => {
            confirmingReset = false;
            btn.textContent = def.label;
          }, 4000);
          return;
        }
        confirmingReset = false;
        btn.textContent = def.label;
      }
      socket.emit(def.command);
    });
    buttons.set(def.command, btn);
    controls.append(btn);
  }

  function render(): void {
    if (!snapshot) return;
    const s = snapshot;
    const q = s.question;
    const phaseLabel: Record<StateSnapshot['phase'], string> = {
      LOBBY: '대기 중',
      QUESTION: '문제 진행 중',
      REVEAL: '정답 공개',
      RESULT: '최종 결과',
    };
    phaseEl.textContent = q
      ? `${q.stage === 'PRACTICE' ? `연습 ${q.number}/${q.total}` : `본 게임 ${q.number}/${q.total}`} · ${phaseLabel[s.phase]}`
      : phaseLabel[s.phase];
    const online = s.players.filter((p) => p.connected).length;
    countEl.textContent = `접속 ${online}명 / 입장 ${s.players.length}/${s.maxPlayers}`;
    timer.set(s.questionStartedAt, s.deadline);

    // 문제 텍스트·선택지·정답은 문제가 진행 중일 때 보이고, 해설은 정답 공개 때만 보인다
    const current = q && question?.id === q.id ? question : null;
    questionBox.hidden = !current;
    if (current) {
      metaEl.textContent = `${current.topic} · 정답 ${current.answer}`;
      textEl.textContent = current.text;
      for (const c of CHOICES) {
        const li = choiceEls.get(c)!;
        li.querySelector('span')!.textContent = current.choices[c];
        li.classList.toggle('correct', current.answer === c);
      }
      if (current.imageUrl) {
        if (image.getAttribute('src') !== current.imageUrl) image.src = current.imageUrl;
        image.hidden = false;
      } else {
        image.hidden = true;
      }
      explanationEl.hidden = s.phase !== 'REVEAL' || !current.explanation;
      explanationEl.textContent = current.explanation ? `해설: ${current.explanation}` : '';
    }

    // 정답 공개·결과 때는 점수표
    if (s.phase === 'RESULT' && s.ranking) {
      scoreboard.replaceChildren(renderRanking(s.ranking, null, MAIN_COUNT));
    } else if (s.phase === 'REVEAL' && s.lastRound) {
      const round = s.lastRound;
      const rows = [...s.players]
        .sort((a, b) => b.score - a.score)
        .map((p) => {
          const r = round.perPlayer[p.id];
          const tr = document.createElement('tr');
          tr.innerHTML = '<td></td><td></td><td></td><td></td><td></td>';
          const cells = tr.querySelectorAll('td');
          cells[0].textContent = p.nickname;
          cells[1].textContent = r ? (r.answer ?? '미제출') : '-';
          cells[2].textContent = r ? describeAction(r.action, r.actionDelta, s) : '';
          cells[3].textContent = r ? (r.total > 0 ? `+${r.total}` : String(r.total)) : '';
          cells[4].textContent = `${p.score}점`;
          if (r?.isCorrect) tr.classList.add('correct');
          return tr;
        });
      const table = document.createElement('table');
      table.className = 'admin-table';
      table.innerHTML = '<thead><tr><th>닉네임</th><th>답</th><th>찍기</th><th>변동</th><th>총점</th></tr></thead><tbody></tbody>';
      table.querySelector('tbody')!.append(...rows);
      scoreboard.replaceChildren(table);
    } else if (s.phase === 'LOBBY') {
      const p = document.createElement('p');
      p.className = 'admin-hint';
      p.textContent = `연습 ${PRACTICE_COUNT}문제 → 본 게임 ${MAIN_COUNT}문제. 「게임 시작」을 누르면 연습 1번이 시작됩니다.`;
      scoreboard.replaceChildren(p);
    } else {
      scoreboard.replaceChildren();
    }

    for (const def of BUTTONS) buttons.get(def.command)!.hidden = !def.visible(s);
  }

  return {
    update(next) {
      snapshot = next;
      field.update(next, ADMIN_ID);
      render();
    },
    setQuestion(next) {
      question = next;
      render();
    },
    setTally(tally) {
      for (const c of CHOICES) choiceEls.get(c)!.querySelector('.tally-count')!.textContent = `${tally[c]}명`;
      noneEl.textContent = `미제출(원 밖) ${tally.none}명`;
    },
    applyPositions(positions) {
      field.applyPositions(positions);
    },
    showEmote(playerId, emote) {
      field.showEmote(playerId, emote);
    },
    destroy() {
      timer.destroy();
      field.destroy();
    },
  };
}

// 정답 공개 점수표의 찍기 칸: 「⭕ 영희 +3」
function describeAction(action: RoundAction, delta: number, s: StateSnapshot): string {
  if (action.type === 'NONE') return '';
  const target = s.players.find((p) => p.id === action.targetId)?.nickname ?? '?';
  const icon = action.type === 'BET_CORRECT' ? '⭕' : '❌';
  return `${icon} ${target} ${delta > 0 ? '+' : ''}${delta}`;
}
