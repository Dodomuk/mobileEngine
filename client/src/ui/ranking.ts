import type { RankingEntry } from '../../../shared/types.ts';
import { createAvatar } from '../avatar.ts';

// 9장 최종 결과 목록. 롤링 애니메이션은 M5에서 추가한다.
export function renderRanking(ranking: RankingEntry[], myId: string | null, totalQuestions: number): HTMLElement {
  const wrap = document.createElement('section');
  wrap.className = 'ranking';
  const title = document.createElement('h2');
  title.className = 'ranking-title';
  title.textContent = '최종 결과';
  const list = document.createElement('ol');
  list.className = 'ranking-list';

  for (const entry of ranking) {
    const li = document.createElement('li');
    li.className = 'ranking-row';
    if (entry.rank <= 3) li.classList.add(`medal-${entry.rank}`);
    if (entry.id === myId) li.classList.add('me');

    const rank = document.createElement('span');
    rank.className = 'ranking-rank';
    rank.textContent = String(entry.rank);
    const name = document.createElement('span');
    name.className = 'ranking-name';
    name.textContent = entry.nickname;
    const score = document.createElement('span');
    score.className = 'ranking-score';
    score.innerHTML = `<b></b><small></small>`;
    score.querySelector('b')!.textContent = `${entry.score}점`;
    score.querySelector('small')!.textContent = `${entry.correctCount}/${totalQuestions}`;
    li.append(rank, createAvatar(entry.character, 40), name, score);
    list.append(li);
  }
  if (ranking.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'ranking-empty';
    empty.textContent = '참가한 플레이어가 없습니다.';
    wrap.append(title, empty);
    return wrap;
  }
  wrap.append(title, list);
  return wrap;
}
