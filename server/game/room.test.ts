import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ADMIN_ID, ANSWER_CIRCLES, circleAt, FIELD_HEIGHT, FIELD_MARGIN, FIELD_MARGIN_BOTTOM, FIELD_WIDTH, MAX_PLAYERS, MOVE_SPEED, SPAWN_AREA } from '../../shared/constants.ts';
import { loadQuestions } from './questions.ts';
import { GameRoom } from './room.ts';

function joinOk(room: GameRoom, nickname: string, character = 'slime') {
  const result = room.join(nickname, character);
  if (!result.ok) throw new Error(`join failed: ${result.error.code}`);
  return result.player;
}

describe('GameRoom.join', () => {
  it('닉네임 앞뒤 공백을 제거하고 하단 대기 영역에 배치한다', () => {
    const room = new GameRoom();
    const player = joinOk(room, '  철수  ');
    expect(player.nickname).toBe('철수');
    expect(player.x).toBeGreaterThanOrEqual(SPAWN_AREA.minX);
    expect(player.x).toBeLessThanOrEqual(SPAWN_AREA.maxX);
    expect(player.y).toBeGreaterThanOrEqual(SPAWN_AREA.minY);
    expect(player.y).toBeLessThanOrEqual(SPAWN_AREA.maxY);
    expect(player.score).toBe(0);
  });

  it.each([
    ['', 'INVALID_NICKNAME'],
    ['   ', 'INVALID_NICKNAME'],
    ['아홉글자닉네임이다', 'INVALID_NICKNAME'],
  ])('닉네임 %j는 거부한다', (nickname, code) => {
    const result = new GameRoom().join(nickname, 'pig');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(code);
  });

  it('한글 8자는 허용한다', () => {
    expect(new GameRoom().join('여덟글자닉네임임', 'pig').ok).toBe(true);
  });

  it('캐릭터가 없거나 관리자 전용 캐릭터면 거부한다', () => {
    const room = new GameRoom();
    for (const character of [undefined, '', 'dragon', 'admin']) {
      const result = room.join('철수', character);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('INVALID_CHARACTER');
    }
  });

  it('같은 캐릭터는 여러 명이 고를 수 있다', () => {
    const room = new GameRoom();
    joinOk(room, '철수', 'pepe');
    expect(room.join('영희', 'pepe').ok).toBe(true);
  });

  it('닉네임 중복은 대소문자를 무시하고 거부한다', () => {
    const room = new GameRoom();
    joinOk(room, 'Alice');
    const result = room.join(' alice ', 'pig');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toBe('이미 사용 중인 닉네임입니다.');
  });

  it('관리자 닉네임은 예약어라 쓸 수 없다', () => {
    const result = new GameRoom().join('관리자', 'pig');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NICKNAME_TAKEN');
  });

  it('16번째 플레이어는 거부한다', () => {
    const room = new GameRoom();
    for (let i = 0; i < MAX_PLAYERS; i++) joinOk(room, `p${i}`);
    const result = room.join('p15', 'pig');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('ROOM_FULL');
      expect(result.error.message).toBe('방이 가득 찼습니다 (15/15)');
    }
  });
});

describe('GameRoom.resume', () => {
  it('sessionToken으로 같은 플레이어에 복귀한다', () => {
    const room = new GameRoom();
    const player = joinOk(room, '철수', 'snail');
    room.setConnected(player.id, false);

    const result = room.resume(player.sessionToken);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.player.id).toBe(player.id);
      expect(result.player.nickname).toBe('철수');
      expect(result.player.character).toBe('snail');
      expect(result.player.connected).toBe(true);
    }
  });

  it('모르는 토큰은 SESSION_NOT_FOUND', () => {
    const result = new GameRoom().resume('nope');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('SESSION_NOT_FOUND');
  });
});

describe('GameRoom.snapshot', () => {
  it('sessionToken과 이동 목표를 노출하지 않는다', () => {
    const room = new GameRoom();
    joinOk(room, '철수');
    const [publicPlayer] = room.snapshot().players;
    expect(publicPlayer).not.toHaveProperty('sessionToken');
    expect(publicPlayer).not.toHaveProperty('targetX');
  });
});

describe('이동', () => {
  function placed(room: GameRoom, x: number, y: number) {
    const p = joinOk(room, '철수');
    p.x = p.targetX = x;
    p.y = p.targetY = y;
    return p;
  }

  it('틱마다 초속 320으로 목표를 향해 직선 이동한다', () => {
    const room = new GameRoom();
    const p = placed(room, 100, 700);
    room.setTarget(p.id, 100 + 5000, 700); // 경계로 잘림
    expect(room.tick(0.1)).toBe(true);
    expect(p.x).toBeCloseTo(100 + MOVE_SPEED * 0.1);
    expect(p.y).toBe(700);
  });

  it('대각선 이동도 속도가 같다', () => {
    const room = new GameRoom();
    const p = placed(room, 100, 700);
    room.setTarget(p.id, 600, 200);
    room.tick(0.5);
    expect(Math.hypot(p.x - 100, p.y - 700)).toBeCloseTo(MOVE_SPEED * 0.5);
  });

  it('목표를 지나치지 않고 도착하면 멈춘다', () => {
    const room = new GameRoom();
    const p = placed(room, 100, 700);
    room.setTarget(p.id, 110, 700);
    room.tick(0.1);
    expect(p.x).toBe(110);
    expect(room.tick(0.1)).toBe(false);
  });

  it('이동 중 다시 터치하면 목표만 바뀐다', () => {
    const room = new GameRoom();
    const p = placed(room, 100, 700);
    room.setTarget(p.id, 900, 700);
    room.tick(0.1);
    const x = p.x;
    room.setTarget(p.id, x, 200);
    room.tick(0.1);
    expect(p.x).toBeCloseTo(x);
    expect(p.y).toBeCloseTo(700 - MOVE_SPEED * 0.1);
  });

  it('필드 밖 좌표는 경계로 자른다', () => {
    const room = new GameRoom();
    const p = placed(room, 100, 700);
    room.setTarget(p.id, -500, 99999);
    expect(p.targetX).toBe(FIELD_MARGIN);
    expect(p.targetY).toBe(FIELD_HEIGHT - FIELD_MARGIN_BOTTOM);
    room.setTarget(p.id, 99999, -1);
    expect(p.targetX).toBe(FIELD_WIDTH - FIELD_MARGIN);
    expect(p.targetY).toBe(FIELD_MARGIN);
  });

  it('잘못된 좌표는 무시한다', () => {
    const room = new GameRoom();
    const p = placed(room, 100, 700);
    for (const [x, y] of [[NaN, 1], [1, Infinity], ['1', 2], [null, undefined]]) {
      expect(room.setTarget(p.id, x, y)).toBe(false);
    }
    expect(p.targetX).toBe(100);
  });

  it('REVEAL·RESULT 단계에서는 이동 입력을 무시한다', () => {
    const room = new GameRoom();
    const p = placed(room, 100, 700);
    for (const phase of ['REVEAL', 'RESULT'] as const) {
      room.state.phase = phase;
      expect(room.setTarget(p.id, 300, 300)).toBe(false);
    }
    room.state.phase = 'QUESTION';
    expect(room.setTarget(p.id, 300, 300)).toBe(true);
  });

  it('positions는 정수 좌표만 보낸다', () => {
    const room = new GameRoom();
    const p = placed(room, 100.4, 700.6);
    expect(room.positions()).toEqual([{ id: p.id, x: 100, y: 701 }]);
  });
});

describe('circleAt', () => {
  it('원 중심·경계 안은 해당 알파벳, 밖은 null', () => {
    expect(circleAt(300, 470)).toBe('A');
    expect(circleAt(720 + 150, 470)).toBe('B'); // 경계 포함
    expect(circleAt(1140, 470 + 151)).toBeNull();
    expect(circleAt(720, 720)).toBeNull(); // 대기 영역
    expect(circleAt(510, 470)).toBeNull(); // A·B 사이
  });
});

describe('문제 진행 (6장)', () => {
  const questions = loadQuestions(path.resolve(__dirname, '../data/questions.json'));

  function setup() {
    const room = new GameRoom(questions);
    const a = joinOk(room, '철수');
    const b = joinOk(room, '영희');
    return { room, a, b };
  }

  function stand(p: { x: number; y: number; targetX: number; targetY: number }, choice: 'A' | 'B' | 'C' | null) {
    const pos = choice ? ANSWER_CIRCLES[choice] : { x: 720, y: 720 };
    p.x = p.targetX = pos.x;
    p.y = p.targetY = pos.y;
  }

  function codeOf(result: { ok: boolean; error?: { code: string } }) {
    return result.ok ? 'OK' : result.error!.code;
  }

  it('LOBBY에서만 게임 시작, 연습 1번이 120초 타이머로 시작', () => {
    const { room } = setup();
    expect(codeOf(room.next())).toBe('INVALID_PHASE');
    expect(codeOf(room.start(1000))).toBe('OK');
    expect(room.state.phase).toBe('QUESTION');
    expect(room.state.deadline).toBe(1000 + 120_000);
    expect(codeOf(room.start())).toBe('INVALID_PHASE');
    expect(room.snapshot().question).toMatchObject({ id: 'p1', number: 1, total: 3, stage: 'PRACTICE' });
  });

  it('플레이어용 스냅샷에는 문제 텍스트·정답·해설이 없다', () => {
    const { room } = setup();
    room.start();
    const json = JSON.stringify(room.snapshot());
    expect(json).not.toContain(questions[0].text);
    expect(json).not.toContain(questions[0].explanation!);
    expect(room.snapshot().question).not.toHaveProperty('answer');
  });

  it('판정: 원 안이면 해당 답, 밖이면 미제출. 정답 +10', () => {
    const { room, a, b } = setup();
    room.start(); // p1 정답 B
    stand(a, 'B');
    stand(b, null);
    expect(room.tally()).toEqual({ A: 0, B: 1, C: 0, none: 1 });
    expect(codeOf(room.reveal())).toBe('OK');
    const round = room.revealPayload()!;
    expect(round.correct).toBe('B');
    expect(round.perPlayer[a.id]).toMatchObject({ answer: 'B', isCorrect: true, total: 10 });
    expect(round.perPlayer[b.id]).toMatchObject({ answer: null, isCorrect: false, total: 0 });
    expect(a.score).toBe(10);
    expect(a.correctCount).toBe(1);
    expect(room.snapshot().lastRound?.scores[a.id].score).toBe(10);
  });

  it('판정 후에는 이동할 수 없고, 타이머가 지난 QUESTION에서도 이동할 수 없다', () => {
    const { room, a } = setup();
    room.start(0);
    expect(room.setTarget(a.id, 100, 100, 1000)).toBe(true);
    expect(room.setTarget(a.id, 100, 100, 120_000)).toBe(false);
    room.reveal();
    expect(room.setTarget(a.id, 100, 100)).toBe(false);
  });

  it('게임 중 새로 들어온 플레이어도 판정에 포함된다', () => {
    const { room } = setup();
    room.start();
    const late = joinOk(room, '민수');
    stand(late, 'B');
    room.reveal();
    expect(late.score).toBe(10);
  });

  it('연습 3번 뒤에는 다음 문제 대신 본 게임 시작, 점수·정답 수·기록 초기화', () => {
    const { room, a } = setup();
    room.start();
    for (let i = 0; i < 3; i++) {
      stand(a, questions[i].answer);
      room.reveal();
      if (i < 2) expect(codeOf(room.next())).toBe('OK');
    }
    expect(a.score).toBe(30);
    expect(codeOf(room.next())).toBe('INVALID_PHASE');
    expect(codeOf(room.finish())).toBe('INVALID_PHASE');
    expect(codeOf(room.startMain())).toBe('OK');
    expect(a.score).toBe(0);
    expect(a.correctCount).toBe(0);
    expect(room.state.history).toEqual([]);
    expect(room.snapshot().question).toMatchObject({ id: 'q1', number: 1, total: 20, stage: 'MAIN' });
  });

  it('본 게임 20번 뒤에만 결과 발표, 캐릭터 위치는 문제가 바뀌어도 유지', () => {
    const { room, a, b } = setup();
    room.start();
    for (let i = 0; i < 3; i++) {
      room.reveal();
      if (i < 2) room.next();
    }
    room.startMain();
    stand(b, 'C');
    for (let i = 0; i < 20; i++) {
      stand(a, questions[3 + i].answer);
      if (i === 0) expect(b.x).toBe(ANSWER_CIRCLES.C.x);
      room.reveal();
      if (i < 19) {
        expect(codeOf(room.finish())).toBe('INVALID_PHASE');
        expect(codeOf(room.startMain())).toBe('INVALID_PHASE');
        room.next();
      }
    }
    expect(codeOf(room.next())).toBe('INVALID_PHASE');
    expect(codeOf(room.finish())).toBe('OK');
    expect(room.state.phase).toBe('RESULT');
    const ranking = room.snapshot().ranking!;
    expect(ranking[0]).toMatchObject({ nickname: '철수', score: 200, correctCount: 20, rank: 1 });
    expect(ranking[1]).toMatchObject({ nickname: '영희', score: 70, correctCount: 7, rank: 2 });
  });

  it('새 게임은 플레이어를 모두 내보내고 관리자는 남긴다', () => {
    const { room } = setup();
    room.ensureAdmin();
    room.start();
    room.reset();
    expect(room.state.phase).toBe('LOBBY');
    expect(room.playerCount).toBe(0);
    expect(room.admin).not.toBeNull();
    expect(room.state.questions).toHaveLength(23);
  });

  it('관리자는 점수·집계에서 빠지고 위치만 브로드캐스트된다', () => {
    const { room } = setup();
    const admin = room.ensureAdmin();
    admin.x = admin.targetX = ANSWER_CIRCLES.A.x;
    admin.y = admin.targetY = ANSWER_CIRCLES.A.y;
    expect(room.tally().A).toBe(0);
    expect(room.positions().some((p) => p.id === ADMIN_ID)).toBe(true);
    expect(room.setTarget(ADMIN_ID, 300, 300)).toBe(true);
    expect(room.snapshot().players.some((p) => p.nickname === '관리자')).toBe(false);
  });
});

describe('추가 행동 (7장)', () => {
  const questions = loadQuestions(path.resolve(__dirname, '../data/questions.json'));

  function setup() {
    const room = new GameRoom(questions);
    const a = joinOk(room, '철수');
    const b = joinOk(room, '영희');
    room.start(0);
    return { room, a, b };
  }

  it('문제 진행 중에만 고를 수 있고 여러 번 바꿀 수 있다(마지막 선택이 최종)', () => {
    const room = new GameRoom(questions);
    const a = joinOk(room, '철수');
    const b = joinOk(room, '영희');
    expect(room.setAction(a.id, 'LAUGH', undefined, 0).ok).toBe(false); // LOBBY
    room.start(0);
    expect(room.setAction(a.id, 'BET_CORRECT', b.id, 1000).ok).toBe(true);
    expect(room.setAction(a.id, 'BET_WRONG', b.id, 2000).ok).toBe(true);
    expect(room.actionOf(a.id)).toEqual({ type: 'BET_WRONG', targetId: b.id });
    expect(room.setAction(a.id, 'NONE', undefined, 120_000).ok).toBe(false); // 타이머 종료 후
  });

  it('초기화(NONE)를 누르면 찍기가 취소된다', () => {
    const { room, a, b } = setup();
    room.setAction(a.id, 'BET_CORRECT', b.id, 1000);
    room.setAction(a.id, 'NONE', b.id, 2000);
    expect(room.actionOf(a.id)).toEqual({ type: 'NONE' });
  });

  it('자기 자신·없는 플레이어·관리자는 찍을 수 없다', () => {
    const { room, a } = setup();
    for (const target of [a.id, 'ghost', ADMIN_ID, undefined]) {
      const result = room.setAction(a.id, 'BET_CORRECT', target, 1000);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('INVALID_TARGET');
    }
    expect(room.setAction(a.id, 'JUMP', undefined, 1000).ok).toBe(false);
  });

  it('이모티콘은 찍기와 별개: 1초 쿨다운, 대기실·문제·정답 공개에서 가능, 결과 발표 뒤 불가', () => {
    const room = new GameRoom(questions);
    const a = joinOk(room, '철수');
    const b = joinOk(room, '영희');
    expect(room.emote(a.id, 'LAUGH', 0).ok).toBe(true); // LOBBY
    room.start(0);
    room.setAction(b.id, 'BET_CORRECT', a.id, 1000);
    expect(room.emote(b.id, 'CRY', 1000).ok).toBe(true);
    const tooSoon = room.emote(b.id, 'ANGRY', 1500);
    expect(tooSoon.ok).toBe(false);
    if (!tooSoon.ok) expect(tooSoon.error.code).toBe('COOLDOWN');
    expect(room.emote(b.id, 'THUMBS_UP', 2100).ok).toBe(true);
    expect(room.actionOf(b.id)).toEqual({ type: 'BET_CORRECT', targetId: a.id }); // 찍기 유지
    room.reveal();
    expect(room.emote(b.id, 'THUMBS_DOWN', 4000).ok).toBe(true);
    expect(room.emote(b.id, 'DANCE', 6000).ok).toBe(false);
    expect(room.setAction(a.id, 'LAUGH', undefined, 1000).ok).toBe(false); // 웃기는 더 이상 찍기 슬롯이 아님
  });

  it('판정에 찍기 점수가 반영되고, 다음 문제에서는 무행동으로 초기화된다', () => {
    const { room, a, b } = setup(); // p1 정답 B
    a.x = a.targetX = ANSWER_CIRCLES.B.x;
    a.y = a.targetY = ANSWER_CIRCLES.B.y;
    room.setAction(b.id, 'BET_CORRECT', a.id, 1000);
    room.setAction(a.id, 'BET_CORRECT', b.id, 1000);
    room.reveal();
    expect(a.score).toBe(10 - 3);
    expect(b.score).toBe(3);
    expect(room.revealPayload()!.perPlayer[b.id].action).toEqual({ type: 'BET_CORRECT', targetId: a.id });
    room.next(2000);
    expect(room.actionOf(a.id)).toEqual({ type: 'NONE' });
  });

  it('플레이어용 스냅샷에는 다른 사람의 행동이 없다', () => {
    const { room, a, b } = setup();
    room.setAction(a.id, 'BET_WRONG', b.id, 1000);
    expect(JSON.stringify(room.snapshot())).not.toContain('BET_WRONG');
  });
});
