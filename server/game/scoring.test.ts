import { describe, expect, it } from 'vitest';
import type { Player } from '../../shared/types.ts';
import { judgeRound, rankPlayers } from './scoring.ts';

describe('judgeRound', () => {
  // 8장 계산 예시 (정답 B)
  it('기획서 8장 계산 예시 5개 케이스', () => {
    const result = judgeRound(
      'q1', 'MAIN', 'B',
      [
        { id: '철수', answer: 'B', connected: true },
        { id: '영희', answer: 'A', connected: true },
        { id: '민수', answer: null, connected: true },
        { id: '지연', answer: 'B', connected: true },
        { id: '현우', answer: 'C', connected: true },
      ],
      {
        철수: { type: 'BET_CORRECT', targetId: '영희' },
        영희: { type: 'BET_WRONG', targetId: '철수' },
        민수: { type: 'BET_WRONG', targetId: '영희' },
        지연: { type: 'BET_CORRECT', targetId: '철수' },
        현우: { type: 'LAUGH' },
      },
    );
    const summary = Object.fromEntries(
      Object.entries(result.perPlayer).map(([id, r]) => [id, [r.baseDelta, r.actionDelta, r.total]]),
    );
    expect(summary).toEqual({
      철수: [10, -2, 8],
      영희: [0, -2, -2],
      민수: [0, 2, 2],
      지연: [10, 2, 12],
      현우: [0, 0, 0],
    });
    expect(result.perPlayer.민수.answer).toBeNull();
    expect(result.perPlayer.민수.isCorrect).toBe(false);
  });

  it('행동이 없으면 NONE, 행동 점수 0', () => {
    const result = judgeRound('p1', 'PRACTICE', 'A', [{ id: 'a', answer: 'A', connected: true }], {});
    expect(result.perPlayer.a).toMatchObject({ action: { type: 'NONE' }, baseDelta: 10, actionDelta: 0, total: 10 });
  });

  it('대상이 판정 시점에 끊겨 있거나 없으면 찍기 무효', () => {
    const result = judgeRound(
      'q1', 'MAIN', 'A',
      [
        { id: 'a', answer: 'A', connected: true },
        { id: 'b', answer: 'A', connected: false },
      ],
      { a: { type: 'BET_CORRECT', targetId: 'b' }, b: { type: 'BET_CORRECT', targetId: 'ghost' } },
    );
    expect(result.perPlayer.a.actionDelta).toBe(0);
    expect(result.perPlayer.b.actionDelta).toBe(0);
  });

  it('자기 자신을 찍으면 무효, 서로 찍기는 각자 계산', () => {
    const result = judgeRound(
      'q1', 'MAIN', 'A',
      [
        { id: 'a', answer: 'A', connected: true },
        { id: 'b', answer: 'C', connected: true },
      ],
      { a: { type: 'BET_CORRECT', targetId: 'a' }, b: { type: 'BET_CORRECT', targetId: 'a' } },
    );
    expect(result.perPlayer.a.actionDelta).toBe(0);
    expect(result.perPlayer.b.actionDelta).toBe(2);
  });
});

describe('rankPlayers', () => {
  const p = (nickname: string, score: number, correctCount: number) =>
    ({ id: nickname, nickname, character: 'pig', score, correctCount }) as Player;

  it('동점자는 같은 순위(1, 1, 3위), 정답 수 → 가나다순으로 정렬', () => {
    const ranking = rankPlayers([p('다', 30, 3), p('나', 50, 4), p('가', 50, 4), p('라', 50, 5), p('마', -2, 0)]);
    expect(ranking.map((r) => [r.rank, r.nickname])).toEqual([
      [1, '라'], [1, '가'], [1, '나'], [4, '다'], [5, '마'],
    ]);
  });
});
