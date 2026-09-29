import { readFileSync } from 'node:fs';
import { MAIN_COUNT, PRACTICE_COUNT } from '../../shared/constants.ts';
import type { Question } from '../../shared/types.ts';

const CHOICES = ['A', 'B', 'C'] as const;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

// 문제가 있으면 전부 모아서 던진다. 서버는 이 에러로 실행을 멈춘다.
export function validateQuestions(data: unknown): Question[] {
  const problems: string[] = [];
  if (!Array.isArray(data)) throw new Error('questions.json은 배열이어야 합니다.');

  const ids = new Set<string>();
  data.forEach((q: Record<string, unknown>, i) => {
    const where = `[${i}]${isNonEmptyString(q?.id) ? ` ${q.id}` : ''}`;
    if (typeof q !== 'object' || q === null) {
      problems.push(`${where}: 객체가 아닙니다.`);
      return;
    }
    if (!isNonEmptyString(q.id)) problems.push(`${where}: id가 없습니다.`);
    else if (ids.has(q.id)) problems.push(`${where}: id가 중복됩니다.`);
    else ids.add(q.id);
    if (q.stage !== 'PRACTICE' && q.stage !== 'MAIN') problems.push(`${where}: stage는 PRACTICE 또는 MAIN이어야 합니다.`);
    if (!isNonEmptyString(q.topic)) problems.push(`${where}: topic이 없습니다.`);
    if (!isNonEmptyString(q.text)) problems.push(`${where}: text가 없습니다.`);
    const choices = q.choices as Record<string, unknown> | undefined;
    for (const c of CHOICES) {
      if (!isNonEmptyString(choices?.[c])) problems.push(`${where}: choices.${c}가 없습니다.`);
    }
    if (!CHOICES.includes(q.answer as never)) problems.push(`${where}: answer는 A/B/C 중 하나여야 합니다.`);
    if (q.explanation !== undefined && typeof q.explanation !== 'string') problems.push(`${where}: explanation은 문자열이어야 합니다.`);
    if (q.imageUrl !== undefined && typeof q.imageUrl !== 'string') problems.push(`${where}: imageUrl은 문자열이어야 합니다.`);
    if (q.timeLimitSec !== undefined && !(typeof q.timeLimitSec === 'number' && q.timeLimitSec > 0)) {
      problems.push(`${where}: timeLimitSec은 양수여야 합니다.`);
    }
  });

  const stages = data.map((q: Record<string, unknown>) => q?.stage);
  const practice = stages.filter((s) => s === 'PRACTICE').length;
  const main = stages.filter((s) => s === 'MAIN').length;
  if (practice !== PRACTICE_COUNT) problems.push(`연습 문제는 ${PRACTICE_COUNT}개여야 합니다 (현재 ${practice}개).`);
  if (main !== MAIN_COUNT) problems.push(`본 게임 문제는 ${MAIN_COUNT}개여야 합니다 (현재 ${main}개).`);
  if (stages.slice(0, practice).some((s) => s !== 'PRACTICE')) problems.push('연습 문제가 배열 맨 앞에 와야 합니다.');

  if (problems.length > 0) throw new Error(`questions.json 검증 실패\n- ${problems.join('\n- ')}`);
  return data as Question[];
}

export function loadQuestions(filePath: string): Question[] {
  return validateQuestions(JSON.parse(readFileSync(filePath, 'utf8')));
}
