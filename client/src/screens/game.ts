import { MAIN_COUNT } from '../../../shared/constants.ts';
import type {
  ActionType,
  Choice,
  PlayerPosition,
  PublicPlayer,
  RoundAction,
  StateSnapshot,
} from '../../../shared/types.ts';
import { createAvatar } from '../avatar.ts';
import { serverTime } from '../clock.ts';
import { FieldView } from '../field.ts';
import { socket } from '../socket.ts';
import { showToast } from '../ui/notice.ts';
import { renderRanking } from '../ui/ranking.ts';
import { TimerBar } from '../ui/timer.ts';

export interface GameScreen {
  update(snapshot: StateSnapshot, myId: string): void;
  applyPositions(positions: PlayerPosition[]): void;
  setMyAction(action: RoundAction): void;
  showLaugh(playerId: string): void;
  destroy(): void;
}

// 7장 추가 행동 아이콘(우측 상단)
const ACTIONS: { type: ActionType; icon: string; label: string }[] = [
  { type: 'BET_CORRECT', icon: '👍', label: '맞히기 찍기' },
  { type: 'BET_WRONG', icon: '👎', label: '틀리기 찍기' },
  { type: 'LAUGH', icon: '😆', label: '그저 웃는다' },
  { type: 'NONE', icon: '✕', label: '아무것도 안 함' },
];

const NO_ACTION: RoundAction = { type: 'NONE' };

// 3장 대기실·게임 화면(가로): 필드 캔버스 위에 DOM 오버레이를 얹는다.
// 문제 텍스트는 플레이어 화면에 절대 표시하지 않는다(서버도 보내지 않음). 선택지는 필드의 각 원 위에 그린다.
export function renderGame(root: HTMLElement): GameScreen {
  root.innerHTML = `
    <main class="game">
      <div class="hud-top">
        <div class="hud-left">
          <div class="lobby-banner" role="status"></div>
          <div class="q-bar" hidden>
            <span class="badge-practice" hidden>연습게임</span>
            <span class="q-topic"></span>
            <span class="q-number"></span>
            <div class="q-timer-slot"></div>
            <img class="q-image" alt="" hidden />
          </div>
          <p class="reveal-note" hidden></p>
        </div>
        <div class="action-bar" hidden>
          <div class="action-buttons">
            ${ACTIONS.map((a) => `<button type="button" class="action-button" data-action="${a.type}" aria-label="${a.label}">${a.icon}</button>`).join('')}
          </div>
          <span class="action-target"></span>
        </div>
      </div>
      <div class="hud-bottom">
        <span class="my-score"></span>
        <span class="my-choice"></span>
      </div>
      <div class="target-modal" hidden>
        <div class="target-card" role="dialog" aria-modal="true">
          <h2 class="target-title"></h2>
          <ul class="target-list"></ul>
          <button type="button" class="target-cancel">취소</button>
        </div>
      </div>
      <div class="result-overlay" hidden></div>
      <div class="rotate-portrait"><p>📱 가로로 돌려 주세요</p></div>
    </main>
  `;
  const $ = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
  const main = $<HTMLElement>('.game');
  const banner = $<HTMLDivElement>('.lobby-banner');
  const qBar = $<HTMLElement>('.q-bar');
  const practiceBadge = $<HTMLElement>('.badge-practice');
  const topic = $<HTMLElement>('.q-topic');
  const number = $<HTMLElement>('.q-number');
  const image = $<HTMLImageElement>('.q-image');
  const revealNote = $<HTMLParagraphElement>('.reveal-note');
  const actionBar = $<HTMLElement>('.action-bar');
  const actionTarget = $<HTMLElement>('.action-target');
  const myScore = $<HTMLSpanElement>('.my-score');
  const myChoice = $<HTMLSpanElement>('.my-choice');
  const modal = $<HTMLElement>('.target-modal');
  const modalTitle = $<HTMLElement>('.target-title');
  const modalList = $<HTMLUListElement>('.target-list');
  const resultOverlay = $<HTMLDivElement>('.result-overlay');
  const actionButtons = new Map(
    ACTIONS.map((a) => [a.type, root.querySelector<HTMLButtonElement>(`[data-action="${a.type}"]`)!]),
  );

  const timer = new TimerBar();
  $('.q-timer-slot').append(timer.el);
  // 이미지 파일이 없으면 영역을 숨긴다
  image.addEventListener('error', () => {
    image.hidden = true;
  });

  let snapshot: StateSnapshot | null = null;
  let myId = '';
  let myAction: RoundAction = NO_ACTION;
  let actionQuestionId: string | null = null;
  let shownResultFor: string | null = null;

  const showChoice = (choice: Choice | null): void => {
    myChoice.textContent = choice ? `${choice} 선택 중` : '미선택';
    myChoice.classList.toggle('selected', choice !== null);
  };
  showChoice(null);

  const field = new FieldView(main, {
    align: 'center',
    onMove: (x, y) => socket.emit('player:move', { x, y }),
    onChoiceChange: showChoice,
  });

  // 찍을 수 있는 대상: 나와 관리자를 뺀 접속 중인 플레이어
  const targets = (): PublicPlayer[] => snapshot?.players.filter((p) => p.id !== myId && p.connected) ?? [];

  const questionOpen = (): boolean =>
    snapshot?.phase === 'QUESTION' && snapshot.deadline !== null && serverTime() < snapshot.deadline;

  function renderActions(): void {
    const phase = snapshot?.phase;
    actionBar.hidden = phase !== 'QUESTION' && phase !== 'REVEAL';
    const open = phase === 'QUESTION';
    const noTargets = targets().length === 0;
    for (const a of ACTIONS) {
      const btn = actionButtons.get(a.type)!;
      btn.classList.toggle('selected', myAction.type === a.type);
      // 정답 공개 때는 3번 웃기만 누를 수 있다
      const bet = a.type === 'BET_CORRECT' || a.type === 'BET_WRONG';
      btn.disabled = phase === 'REVEAL' ? a.type !== 'LAUGH' : !open || (bet && noTargets);
    }
    const targetName = snapshot?.players.find((p) => p.id === myAction.targetId)?.nickname ?? '';
    actionTarget.textContent =
      myAction.type === 'BET_CORRECT' ? `맞히기: ${targetName}`
      : myAction.type === 'BET_WRONG' ? `틀리기: ${targetName}`
      : myAction.type === 'LAUGH' ? '웃는 중'
      : '';
  }

  function sendAction(type: ActionType, targetId?: string): void {
    socket.emit('player:action', { type, targetId }, (res) => {
      if (!res.ok) {
        showToast(res.error.message);
        return;
      }
      myAction = res.action;
      renderActions();
    });
  }

  function openTargetModal(type: 'BET_CORRECT' | 'BET_WRONG'): void {
    modalTitle.textContent = type === 'BET_CORRECT' ? '👍 이번 문제를 맞힐 사람은?' : '👎 이번 문제를 틀릴 사람은?';
    modalList.replaceChildren(
      ...targets().map((p) => {
        const li = document.createElement('li');
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'target-option';
        const name = document.createElement('span');
        name.textContent = p.nickname;
        btn.append(createAvatar(p.character, 40), name);
        btn.addEventListener('click', () => {
          modal.hidden = true;
          if (questionOpen()) sendAction(type, p.id);
        });
        li.append(btn);
        return li;
      }),
    );
    modal.hidden = false;
  }

  for (const a of ACTIONS) {
    actionButtons.get(a.type)!.addEventListener('click', () => {
      if (snapshot?.phase === 'REVEAL') {
        if (a.type === 'LAUGH') socket.emit('player:laugh');
        return;
      }
      if (!questionOpen()) return;
      if (a.type === 'BET_CORRECT' || a.type === 'BET_WRONG') openTargetModal(a.type);
      else sendAction(a.type);
    });
  }
  $('.target-cancel').addEventListener('click', () => {
    modal.hidden = true; // 취소하면 이전 선택 유지
  });

  return {
    update(next, id) {
      snapshot = next;
      myId = id;
      const { phase } = next;
      field.update(next, id);
      const me = next.players.find((p) => p.id === id);
      const q = next.question;

      // 새 문제가 시작되면 행동은 다시 4번(무행동)
      if (q && phase === 'QUESTION' && q.id !== actionQuestionId) {
        if (actionQuestionId !== null) myAction = NO_ACTION;
        actionQuestionId = q.id;
      }
      if (phase !== 'QUESTION') modal.hidden = true;

      // 대기실 안내: 끊긴 플레이어도 자리를 차지하므로 입장 제한과 같은 기준(전체 인원)으로 센다
      banner.hidden = phase !== 'LOBBY';
      banner.textContent = `관리자가 게임을 시작하길 기다리는 중 (현재 ${next.players.length}/${next.maxPlayers}명)`;

      // 상단 바: 연습 배지·주제·번호·타이머(선택지는 필드의 원 위에 표시)
      qBar.hidden = !q;
      if (q) {
        practiceBadge.hidden = q.stage !== 'PRACTICE';
        topic.textContent = q.topic;
        number.textContent = q.stage === 'PRACTICE' ? `연습 ${q.number}/${q.total}` : `${q.number}/${q.total}`;
        if (q.imageUrl) {
          if (image.getAttribute('src') !== q.imageUrl) image.src = q.imageUrl;
          image.hidden = false;
        } else {
          image.hidden = true;
          image.removeAttribute('src');
        }
      }
      timer.set(next.questionStartedAt, next.deadline);

      // 정답 공개
      const round = next.lastRound;
      revealNote.hidden = !round;
      if (round) {
        const mine = round.perPlayer[id];
        const verdict = !mine ? '이번 문제는 참여하지 않았어요'
          : `${mine.isCorrect ? '정답!' : '오답'} ${signed(mine.total)}점`;
        revealNote.textContent = `정답은 ${round.correct} · ${verdict}`
          + (round.stage === 'PRACTICE' ? ' · 연습게임 점수는 본 게임에 반영되지 않습니다' : '');
      }

      // 하단: 내 점수(연습 중에는 「(연습)」 표시)
      const showPracticeTag = next.stage === 'PRACTICE' && phase !== 'LOBBY';
      myScore.textContent = me ? `내 점수 ${me.score}점${showPracticeTag ? ' (연습)' : ''}` : '';
      myChoice.hidden = phase === 'RESULT';
      renderActions();

      // 최종 결과
      resultOverlay.hidden = phase !== 'RESULT';
      if (phase === 'RESULT' && next.ranking) {
        const key = JSON.stringify(next.ranking);
        if (key !== shownResultFor) {
          shownResultFor = key;
          resultOverlay.replaceChildren(renderRanking(next.ranking, id, MAIN_COUNT));
        }
      } else {
        shownResultFor = null;
      }
    },
    applyPositions(positions) {
      field.applyPositions(positions);
    },
    setMyAction(action) {
      myAction = action;
      actionQuestionId = snapshot?.question?.id ?? actionQuestionId;
      renderActions();
    },
    showLaugh(playerId) {
      field.showLaugh(playerId);
    },
    destroy() {
      timer.destroy();
      field.destroy();
    },
  };
}

function signed(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}
