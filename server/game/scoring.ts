import { SCORE_BET, SCORE_CORRECT } from '../../shared/constants.ts';
import type { Choice, Player, RankingEntry, RoundAction, RoundResult, Stage } from '../../shared/types.ts';

export interface JudgedPlayer {
  id: string;
  answer: Choice | null; // 판정 시점에 들어가 있던 원, 원 밖이면 null(미제출)
  connected: boolean;
}

const NO_ACTION: RoundAction = { type: 'NONE' };

// 8장: 모든 플레이어의 정답 여부를 먼저 확정한 뒤, 그 결과로 행동 점수를 계산한다.
export function judgeRound(
  questionId: string,
  stage: Stage,
  correct: Choice,
  players: JudgedPlayer[],
  actions: Record<string, RoundAction>,
): RoundResult {
  const isCorrect = new Map(players.map((p) => [p.id, p.answer === correct]));
  const connected = new Map(players.map((p) => [p.id, p.connected]));

  const perPlayer: RoundResult['perPlayer'] = {};
  for (const p of players) {
    const action = actions[p.id] ?? NO_ACTION;
    const baseDelta = isCorrect.get(p.id) ? SCORE_CORRECT : 0;
    perPlayer[p.id] = {
      answer: p.answer,
      isCorrect: isCorrect.get(p.id)!,
      action,
      baseDelta,
      actionDelta: actionDelta(p.id, action, isCorrect, connected),
      total: 0,
    };
    perPlayer[p.id].total = perPlayer[p.id].baseDelta + perPlayer[p.id].actionDelta;
  }
  return { questionId, stage, correct, perPlayer };
}

// 7장: 찍기는 대상의 정답 여부만 본다. 대상이 판정 시점에 끊겨 있거나 없으면 무효(0점),
// 대상이 미제출이면 「틀림」으로 본다.
function actionDelta(
  selfId: string,
  action: RoundAction,
  isCorrect: Map<string, boolean>,
  connected: Map<string, boolean>,
): number {
  if (action.type !== 'BET_CORRECT' && action.type !== 'BET_WRONG') return 0;
  const target = action.targetId;
  if (!target || target === selfId || !isCorrect.has(target) || !connected.get(target)) return 0;
  const targetCorrect = isCorrect.get(target)!;
  const won = action.type === 'BET_CORRECT' ? targetCorrect : !targetCorrect;
  return won ? SCORE_BET : -SCORE_BET;
}

// 9장: 총점 순. 동점자는 같은 순위(1, 1, 3위), 표시 순서는 정답 수 많은 순 → 닉네임 가나다순.
export function rankPlayers(players: Player[]): RankingEntry[] {
  const sorted = [...players].sort(
    (a, b) => b.score - a.score || b.correctCount - a.correctCount || a.nickname.localeCompare(b.nickname, 'ko'),
  );
  return sorted.map((p) => ({
    rank: 1 + sorted.filter((q) => q.score > p.score).length,
    id: p.id,
    nickname: p.nickname,
    character: p.character,
    score: p.score,
    correctCount: p.correctCount,
  }));
}
