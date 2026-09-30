import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadQuestions, validateQuestions } from './questions.ts';

const file = path.resolve(__dirname, '../data/questions.json');

describe('questions.json', () => {
  it('실제 문제 파일(연습 3 + 본 게임)이 검증을 통과한다', () => {
    const questions = loadQuestions(file);
    expect(questions.slice(0, 3).every((q) => q.stage === 'PRACTICE')).toBe(true);
    expect(questions.filter((q) => q.stage === 'PRACTICE')).toHaveLength(3);
    expect(questions.filter((q) => q.stage === 'MAIN').length).toBeGreaterThanOrEqual(20);
    expect(questions[2].imageUrl).toBe('/assets/questions/ahnlab-logo.png');
    // 맥주 사진 문제: 보기 3개 모두 사진, 정답은 하이네켄(beer-1)
    const beer = questions.find((q) => q.id === 'q21')!;
    expect(beer.choiceImages?.[beer.answer]).toBe('/assets/questions/beer-1.jpg');
  });

  it('필수 필드가 빠지면 모든 문제를 모아 에러', () => {
    const questions = loadQuestions(file);
    const broken = structuredClone(questions);
    delete (broken[4] as Partial<(typeof broken)[number]>).text;
    broken[5].answer = 'D' as never;
    broken[6].choiceImages = { A: 'a.jpg', B: 'b.jpg' } as never;
    expect(() => validateQuestions(broken)).toThrowError(/text가 없습니다[\s\S]*answer는[\s\S]*choiceImages\.C가 없습니다/);
  });

  it('연습 문제가 3개가 아니거나 본 게임 문제가 없으면 에러', () => {
    const questions = loadQuestions(file);
    expect(() => validateQuestions(questions.slice(1))).toThrowError(/연습 문제는 3개/);
    expect(() => validateQuestions(questions.slice(0, 3))).toThrowError(/본 게임 문제가 1개 이상/);
  });

  it('연습 문제가 맨 앞이 아니면 에러', () => {
    const questions = loadQuestions(file);
    const swapped = [questions[3], questions[0], questions[1], questions[2], ...questions.slice(4)];
    expect(() => validateQuestions(swapped)).toThrowError(/맨 앞/);
  });
});
