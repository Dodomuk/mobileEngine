import { describe, expect, it } from 'vitest';
import { MAX_PLAYERS, SPAWN_AREA } from '../../shared/constants.ts';
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
