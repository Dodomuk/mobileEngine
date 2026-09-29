import { randomBytes, randomUUID } from 'node:crypto';
import { ADMIN_CHARACTER, CHARACTERS, MAX_PLAYERS, SPAWN_AREA } from '../../shared/constants.ts';
import {
  isReservedNickname,
  isValidNicknameLength,
  nicknameKey,
  normalizeNickname,
} from '../../shared/nickname.ts';
import type {
  CharacterKey,
  ErrorPayload,
  Player,
  PublicPlayer,
  Room,
  StateSnapshot,
} from '../../shared/types.ts';

export type JoinResult = { ok: true; player: Player } | { ok: false; error: ErrorPayload };

const CHARACTER_KEYS = new Set<string>(CHARACTERS.map((c) => c.key));

function fail(code: ErrorPayload['code'], message: string): { ok: false; error: ErrorPayload } {
  return { ok: false, error: { code, message } };
}

function randomBetween(min: number, max: number): number {
  return Math.round(min + Math.random() * (max - min));
}

export function isCharacterKey(value: unknown): value is CharacterKey {
  return typeof value === 'string' && value !== ADMIN_CHARACTER && CHARACTER_KEYS.has(value);
}

export class GameRoom {
  state: Room = GameRoom.emptyRoom();

  private static emptyRoom(): Room {
    return {
      phase: 'LOBBY',
      stage: 'PRACTICE',
      players: {},
      questions: [],
      currentIndex: -1,
      actions: {},
      history: [],
    };
  }

  get playerCount(): number {
    return Object.keys(this.state.players).length;
  }

  join(rawNickname: unknown, character: unknown): JoinResult {
    if (typeof rawNickname !== 'string') {
      return fail('INVALID_PAYLOAD', '잘못된 요청입니다.');
    }
    if (!isCharacterKey(character)) {
      return fail('INVALID_CHARACTER', '캐릭터를 선택해 주세요.');
    }
    const nickname = normalizeNickname(rawNickname);
    if (!isValidNicknameLength(nickname)) {
      return fail('INVALID_NICKNAME', '닉네임은 1~8자로 입력해 주세요.');
    }
    if (isReservedNickname(nickname) || this.findByNickname(nickname)) {
      return fail('NICKNAME_TAKEN', '이미 사용 중인 닉네임입니다.');
    }
    // 끊긴 플레이어도 복귀할 수 있으므로 자리를 차지한 것으로 센다(가정)
    if (this.playerCount >= MAX_PLAYERS) {
      return fail('ROOM_FULL', `방이 가득 찼습니다 (${MAX_PLAYERS}/${MAX_PLAYERS})`);
    }

    const x = randomBetween(SPAWN_AREA.minX, SPAWN_AREA.maxX);
    const y = randomBetween(SPAWN_AREA.minY, SPAWN_AREA.maxY);
    const player: Player = {
      id: randomUUID(),
      sessionToken: randomBytes(24).toString('base64url'),
      nickname,
      character,
      x, y, targetX: x, targetY: y,
      score: 0,
      correctCount: 0,
      connected: true,
    };
    this.state.players[player.id] = player;
    return { ok: true, player };
  }

  resume(sessionToken: unknown): JoinResult {
    if (typeof sessionToken !== 'string' || sessionToken.length === 0) {
      return fail('INVALID_PAYLOAD', '잘못된 요청입니다.');
    }
    const player = Object.values(this.state.players).find((p) => p.sessionToken === sessionToken);
    if (!player) {
      return fail('SESSION_NOT_FOUND', '세션이 만료되었습니다. 다시 입장해 주세요.');
    }
    player.connected = true;
    return { ok: true, player };
  }

  setConnected(playerId: string, connected: boolean): void {
    const player = this.state.players[playerId];
    if (player) player.connected = connected;
  }

  snapshot(): StateSnapshot {
    return {
      phase: this.state.phase,
      stage: this.state.stage,
      players: Object.values(this.state.players).map(toPublicPlayer),
      maxPlayers: MAX_PLAYERS,
      question: null,
      deadline: this.state.deadline ?? null,
    };
  }

  private findByNickname(nickname: string): Player | undefined {
    const key = nicknameKey(nickname);
    return Object.values(this.state.players).find((p) => nicknameKey(p.nickname) === key);
  }
}

export function toPublicPlayer(p: Player): PublicPlayer {
  return {
    id: p.id,
    nickname: p.nickname,
    character: p.character,
    x: p.x,
    y: p.y,
    score: p.score,
    correctCount: p.correctCount,
    connected: p.connected,
  };
}
