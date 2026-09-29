import { MAIN_COUNT } from '../../../shared/constants.ts';
import type { Choice, PlayerPosition, StateSnapshot } from '../../../shared/types.ts';
import { FieldView } from '../field.ts';
import { socket } from '../socket.ts';
import { renderRanking } from '../ui/ranking.ts';
import { TimerBar } from '../ui/timer.ts';

export interface GameScreen {
  update(snapshot: StateSnapshot, myId: string): void;
  applyPositions(positions: PlayerPosition[]): void;
  destroy(): void;
}

const CHOICES = ['A', 'B', 'C'] as const;

// 3장 대기실·게임 화면: 필드 캔버스 위에 DOM 오버레이를 얹는다.
// 문제 텍스트는 플레이어 화면에 절대 표시하지 않는다(서버도 보내지 않음).
export function renderGame(root: HTMLElement): GameScreen {
  root.innerHTML = `
    <main class="game">
      <div class="game-top">
        <div class="lobby-banner" role="status"></div>
        <section class="question-card" hidden>
          <div class="q-meta">
            <span class="badge-practice" hidden>연습게임</span>
            <span class="q-topic"></span>
            <span class="q-number"></span>
          </div>
          <div class="q-timer-slot"></div>
          <img class="q-image" alt="" hidden />
          <ol class="q-choices">
            ${CHOICES.map((c) => `<li data-choice="${c}"><b>${c}</b><span></span></li>`).join('')}
          </ol>
          <p class="reveal-note" hidden></p>
        </section>
      </div>
      <div class="game-bottom">
        <span class="my-score"></span>
        <span class="my-choice"></span>
      </div>
      <div class="result-overlay" hidden></div>
    </main>
  `;
  const main = root.querySelector<HTMLElement>('.game')!;
  const banner = root.querySelector<HTMLDivElement>('.lobby-banner')!;
  const card = root.querySelector<HTMLElement>('.question-card')!;
  const practiceBadge = root.querySelector<HTMLElement>('.badge-practice')!;
  const topic = root.querySelector<HTMLElement>('.q-topic')!;
  const number = root.querySelector<HTMLElement>('.q-number')!;
  const image = root.querySelector<HTMLImageElement>('.q-image')!;
  const choiceItems = new Map(
    CHOICES.map((c) => [c, root.querySelector<HTMLLIElement>(`.q-choices [data-choice="${c}"]`)!]),
  );
  const revealNote = root.querySelector<HTMLParagraphElement>('.reveal-note')!;
  const myScore = root.querySelector<HTMLSpanElement>('.my-score')!;
  const myChoice = root.querySelector<HTMLSpanElement>('.my-choice')!;
  const resultOverlay = root.querySelector<HTMLDivElement>('.result-overlay')!;

  const timer = new TimerBar();
  root.querySelector('.q-timer-slot')!.append(timer.el);

  // 이미지 파일이 없으면 영역을 숨긴다
  image.addEventListener('error', () => {
    image.hidden = true;
  });

  let phase: StateSnapshot['phase'] = 'LOBBY';
  let shownResultFor: string | null = null;

  const showChoice = (choice: Choice | null): void => {
    myChoice.textContent = choice ? `${choice} 선택 중` : '미선택';
    myChoice.classList.toggle('selected', choice !== null);
  };
  showChoice(null);

  const field = new FieldView(main, {
    align: 'bottom',
    onMove: (x, y) => socket.emit('player:move', { x, y }),
    onChoiceChange: showChoice,
  });

  return {
    update(snapshot, myId) {
      phase = snapshot.phase;
      field.update(snapshot, myId);
      const me = snapshot.players.find((p) => p.id === myId);
      const q = snapshot.question;
      const isPractice = snapshot.stage === 'PRACTICE';

      // 대기실 안내: 끊긴 플레이어도 자리를 차지하므로 입장 제한과 같은 기준(전체 인원)으로 센다
      banner.hidden = phase !== 'LOBBY';
      banner.textContent = `관리자가 게임을 시작하길 기다리는 중 (현재 ${snapshot.players.length}/${snapshot.maxPlayers}명)`;

      // 문제 카드: 주제·번호·타이머·선택지(문제 텍스트 없음)
      card.hidden = !q;
      if (q) {
        practiceBadge.hidden = q.stage !== 'PRACTICE';
        topic.textContent = q.topic;
        number.textContent = q.stage === 'PRACTICE' ? `연습 ${q.number}/${q.total}` : `${q.number}/${q.total}`;
        for (const c of CHOICES) choiceItems.get(c)!.querySelector('span')!.textContent = q.choices[c];
        if (q.imageUrl) {
          if (image.getAttribute('src') !== q.imageUrl) image.src = q.imageUrl;
          image.hidden = false;
        } else {
          image.hidden = true;
          image.removeAttribute('src');
        }
      }
      timer.set(snapshot.questionStartedAt, snapshot.deadline);

      // 정답 공개
      const round = snapshot.lastRound;
      for (const c of CHOICES) {
        choiceItems.get(c)!.classList.toggle('correct', round?.correct === c);
        choiceItems.get(c)!.classList.toggle('wrong', !!round && round.correct !== c);
      }
      revealNote.hidden = !round;
      if (round) {
        const mine = round.perPlayer[myId];
        const verdict = !mine ? '이번 문제는 참여하지 않았어요' : mine.isCorrect ? `정답! ${signed(mine.total)}점` : `아쉬워요 ${signed(mine.total)}점`;
        revealNote.textContent = `정답은 ${round.correct} · ${verdict}`;
        if (round.stage === 'PRACTICE') revealNote.textContent += '\n연습게임 점수는 본 게임에 반영되지 않습니다';
      }

      // 하단: 내 점수(연습 중에는 「(연습)」 표시)
      const showPracticeTag = isPractice && phase !== 'LOBBY';
      myScore.textContent = me ? `내 점수 ${me.score}점${showPracticeTag ? ' (연습)' : ''}` : '';
      myChoice.hidden = phase === 'RESULT';

      // 최종 결과
      resultOverlay.hidden = phase !== 'RESULT';
      if (phase === 'RESULT' && snapshot.ranking) {
        const key = JSON.stringify(snapshot.ranking);
        if (key !== shownResultFor) {
          shownResultFor = key;
          resultOverlay.replaceChildren(renderRanking(snapshot.ranking, myId, MAIN_COUNT));
        }
      } else {
        shownResultFor = null;
      }
    },
    applyPositions(positions) {
      field.applyPositions(positions);
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
