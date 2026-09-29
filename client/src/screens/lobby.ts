import type { StateSnapshot } from '../../../shared/types.ts';
import { createAvatar } from '../avatar.ts';

// 3장 대기실. 필드(타일·원·캐릭터 이동)는 M2에서 캔버스로 교체한다.
export function renderLobby(root: HTMLElement): (snapshot: StateSnapshot, myId: string) => void {
  root.innerHTML = `
    <main class="screen lobby">
      <div class="lobby-banner" role="status"></div>
      <section class="panel">
        <h2>입장한 플레이어</h2>
        <ul class="player-list"></ul>
      </section>
    </main>
  `;
  const banner = root.querySelector<HTMLDivElement>('.lobby-banner')!;
  const list = root.querySelector<HTMLUListElement>('.player-list')!;

  return (snapshot, myId) => {
    // 끊긴 플레이어도 자리를 차지하므로 입장 제한과 같은 기준(전체 인원)으로 센다
    banner.textContent = `관리자가 게임을 시작하길 기다리는 중 (현재 ${snapshot.players.length}/${snapshot.maxPlayers}명)`;

    list.replaceChildren(
      ...snapshot.players.map((p) => {
        const li = document.createElement('li');
        li.className = 'player-row';
        li.classList.toggle('me', p.id === myId);
        li.classList.toggle('offline', !p.connected);
        const name = document.createElement('span');
        name.className = 'player-name';
        name.textContent = p.nickname;
        li.append(createAvatar(p.character, 40), name);
        if (p.id === myId) {
          const tag = document.createElement('span');
          tag.className = 'me-tag';
          tag.textContent = '나';
          li.append(tag);
        }
        return li;
      }),
    );
  };
}
