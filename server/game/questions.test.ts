import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadQuestions, validateQuestions } from './questions.ts';

const file = path.resolve(__dirname, '../data/questions.json');

describe('questions.json', () => {
  it('실제 문제 파일(연습 3 + 본 게임 20)이 검증을 통과한다', () => {
    const questions = loadQuestions(file);
    expect(questions).toHaveLength(23);
    expect(questions.slice(0, 3).every((q) => q.stage === 'PRACTICE')).toBe(true);
    expect(questions[2].imageUrl).toBe('/assets/questions/ahnlab-logo.png');
    const answers = questions.filter((q) => q.stage === 'MAIN').map((q) => q.answer);
    expect(answers.filter((a) => a === 'A')).toHaveLength(6);
  });

  it('필수 필드가 빠지거나 개수가 틀리면 모든 문제를 모아 에러', () => {
    const questions = loadQuestions(file);
    const broken = structuredClone(questions);
    delete (broken[4] as Partial<(typeof broken)[number]>).text;
    broken[5].answer = 'D' as never;
    broken.pop();
    expect(() => validateQuestions(broken)).toThrowError(/text가 없습니다[\s\S]*answer는[\s\S]*본 게임 문제는 20개/);
  });

  it('연습 문제가 맨 앞이 아니면 에러', () => {
    const questions = loadQuestions(file);
    const swapped = [questions[3], questions[0], questions[1], questions[2], ...questions.slice(4)];
    expect(() => validateQuestions(swapped)).toThrowError(/맨 앞/);
  });
});
