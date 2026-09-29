import { describe, expect, it } from 'vitest';
import { BINGO_LINES, bingoKey, checkBoard, completedLines } from '../../shared/bingo.ts';
import { BingoRoom, type BingoPlayer } from './room.ts';

// 순서를 섞지 않는 방(테스트용)
const newRoom = () => new BingoRoom((items) => items);

function join(room: BingoRoom, nickname: string): BingoPlayer {
  const r = room.join(nickname, 'slime');
  if (!r.ok) throw new Error(r.error.code);
  return r.player;
}

// prefix0 ~ prefix24
const board = (prefix: string) => Array.from({ length: 25 }, (_, i) => `${prefix}${i}`);

describe('bingoKey', () => {
  it('모든 공백을 무시한다', () => {
    const keys = ['안녕', ' 안녕', '안 녕', '     안       녕      ', '안　녕', '안\t녕'].map(bingoKey);
    expect(new Set(keys).size).toBe(1);
  });

  it('영문 대소문자를 무시한다', () => {
    expect(bingoKey('Apple Pie')).toBe(bingoKey('applepie'));
  });
});

describe('checkBoard', () => {
  it('빈 칸·중복(공백 무시)·20자 초과를 찾는다', () => {
    const cells = board('x');
    cells[3] = '   ';
    cells[5] = '사 과';
    cells[9] = '사과';
    cells[12] = '가'.repeat(21);
    expect(checkBoard(cells)).toEqual([
      { index: 3, reason: 'EMPTY' },
      { index: 5, reason: 'DUPLICATE' },
      { index: 9, reason: 'DUPLICATE' },
      { index: 12, reason: 'TOO_LONG' },
    ]);
    expect(checkBoard(board('ok'))).toEqual([]);
  });
});

describe('completedLines', () => {
  it('가로·세로·대각선 12줄', () => {
    expect(BINGO_LINES).toHaveLength(12);
    const marked = Array(25).fill(false);
    for (const i of [0, 6, 12, 18, 24]) marked[i] = true; // 대각선
    for (const i of [0, 1, 2, 3, 4]) marked[i] = true;    // 첫 줄
    expect(completedLines(marked)).toHaveLength(2);
  });
});

describe('BingoRoom 진행', () => {
  function ready() {
    const room = newRoom();
    const a = join(room, '철수');
    const b = join(room, '영희');
    room.setTopic('과일');
    expect(room.submit(a.id, board('a')).ok).toBe(true);
    expect(room.submit(b.id, board('b')).ok).toBe(true);
    return { room, a, b };
  }

  it('주제를 내면 칸 채우기, 모두 제출해야 시작', () => {
    const room = newRoom();
    const a = join(room, '철수');
    const b = join(room, '영희');
    expect(room.start().ok).toBe(false);
    room.setTopic('  과일  ');
    expect(room.topic).toBe('과일');
    expect(room.phase).toBe('FILLING');
    room.submit(a.id, board('a'));
    expect(room.startProblem()).toContain('영희');
    // 제출 안 한 사람이 끊겨 있으면 빼고 시작할 수 있다(단 2명 이상)
    room.setConnected(b.id, false);
    expect(room.startProblem()).toContain('2명 이상');
    room.setConnected(b.id, true);
    room.submit(b.id, board('b'));
    expect(room.start().ok).toBe(true);
    expect(room.phase).toBe('PLAYING');
    expect(room.turnPlayerId).toBe(a.id);
  });

  it('중복·빈 칸이 있는 판은 제출할 수 없고, 시작 전에는 제출을 취소할 수 있다', () => {
    const room = newRoom();
    const a = join(room, '철수');
    room.setTopic('과일');
    const bad = board('a');
    bad[1] = 'A 0';
    expect(room.submit(a.id, bad).ok).toBe(false); // 'a0'과 'A 0'은 같은 답
    expect(room.submit(a.id, board('a').slice(0, 24)).ok).toBe(false);
    expect(room.submit(a.id, board('a')).ok).toBe(true);
    expect(room.unsubmit(a.id).ok).toBe(true);
    expect(room.snapshot(a.id).me?.submitted).toBe(false);
  });

  it('부르면 같은 답을 쓴 상대 칸도 지워지고(공백 무시), 차례가 넘어간다', () => {
    const room = newRoom();
    const a = join(room, '철수');
    const b = join(room, '영희');
    room.setTopic('과일');
    const aBoard = board('a');
    aBoard[0] = '바나나';
    const bBoard = board('b');
    bBoard[7] = ' 바 나 나 ';
    room.submit(a.id, aBoard);
    room.submit(b.id, bBoard);
    room.start();

    expect(room.call(b.id, 0).ok).toBe(false); // 영희 차례 아님
    const r = room.call(a.id, 0);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.markedFor.sort()).toEqual([a.id, b.id].sort());
    expect(b.marked[7]).toBe(true);
    expect(room.calls[0]).toMatchObject({ nickname: '철수', text: '바나나' });
    expect(room.turnPlayerId).toBe(b.id);
    expect(room.call(b.id, 7).ok).toBe(false); // 이미 지워진 칸
  });

  it('누구든 3줄이 되면 즉시 끝, 동시 완성은 모두 우승', () => {
    const room = newRoom();
    const a = join(room, '철수');
    const b = join(room, '영희');
    room.setTopic('숫자');
    // 둘 다 같은 판: 부르는 칸이 양쪽 모두 지워진다
    room.submit(a.id, board('n'));
    room.submit(b.id, board('n'));
    room.start();
    // 가로 3줄(0~14)을 번갈아 부른다
    for (let i = 0; i < 15; i++) {
      const r = room.call(room.turnPlayerId!, i);
      expect(r.ok).toBe(true);
      if (i < 14) expect(room.phase).toBe('PLAYING');
    }
    expect(room.phase).toBe('FINISHED');
    expect(room.winners.sort()).toEqual([a.id, b.id].sort());
    expect(room.call(room.order[0], 20).ok).toBe(false);
  });

  it('끊긴 사람의 차례는 건너뛰고, 관리자가 순서를 넘길 수 있다', () => {
    const room = newRoom();
    const a = join(room, '철수');
    const b = join(room, '영희');
    const c = join(room, '민수');
    room.setTopic('과일');
    for (const p of [a, b, c]) room.submit(p.id, board(p.nickname));
    room.start();
    room.setConnected(b.id, false);
    room.call(a.id, 0);
    expect(room.turnPlayerId).toBe(c.id);
    room.skipTurn();
    expect(room.turnPlayerId).toBe(a.id);
  });

  it('게임 중에는 새로 입장할 수 없다', () => {
    const { room } = ready();
    room.start();
    const r = room.join('늦은이', 'pig');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('GAME_IN_PROGRESS');
  });
});

describe('기술', () => {
  function playing() {
    const room = newRoom();
    const a = join(room, '철수');
    const b = join(room, '영희');
    room.setTopic('과일');
    room.submit(a.id, board('a'));
    room.submit(b.id, board('b'));
    return { room, a, b };
  }

  it('훔쳐보기: 게임 중 한 판에 한 번, 다른 사람의 칸 내용을 본다', () => {
    const { room, a, b } = playing();
    expect(room.peek(a.id, b.id, 3).ok).toBe(false); // 칸 채우기 중
    room.start();
    expect(room.peek(a.id, a.id, 3).ok).toBe(false); // 자기 자신
    const r = room.peek(a.id, b.id, 3);
    expect(r).toMatchObject({ ok: true, text: 'b3', marked: false });
    const again = room.peek(a.id, b.id, 4);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error.code).toBe('ALREADY_USED');
  });

  it('약올리기: 칸 채우기·게임 중 한 판에 한 번', () => {
    const { room, a, b } = playing();
    expect(room.taunt(a.id, b.id).ok).toBe(true);
    expect(room.taunt(a.id, b.id).ok).toBe(false);
    expect(room.taunt(b.id, b.id).ok).toBe(false);
  });

  it('새 판이면 판·기술이 초기화되고 플레이어는 남는다', () => {
    const { room, a, b } = playing();
    room.start();
    room.peek(a.id, b.id, 0);
    room.taunt(a.id, b.id);
    room.newRound();
    expect(room.phase).toBe('LOBBY');
    expect(room.playerCount).toBe(2);
    expect(room.snapshot(a.id).me).toMatchObject({ board: null, usedPeek: false, usedTaunt: false });
  });

  it('스냅샷에는 다른 사람의 판이 없다', () => {
    const { room, a } = playing();
    const json = JSON.stringify(room.snapshot(a.id));
    // 따옴표까지 맞춰 비교한다(무작위 UUID에 'b3'가 섞일 수 있어서)
    expect(json).toContain('"a3"');
    expect(json).not.toContain('"b3"');
  });
});
