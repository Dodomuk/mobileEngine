import { CHARACTERS, NICKNAME_MAX } from '../../../shared/constants.ts';
import { isValidNicknameLength, nicknameLength, normalizeNickname } from '../../../shared/nickname.ts';
import type { CharacterKey, ErrorPayload } from '../../../shared/types.ts';
import { createAvatar } from '../avatar.ts';

export type EntryAck = { ok: true; playerId: string; sessionToken: string } | { ok: false; error: ErrorPayload };

export interface EntryOptions {
  title: string;
  // 오른쪽 위 작은 버튼: 퀴즈 ↔ 빙고 이동
  switchTo: { href: string; label: string };
  join: (payload: { nickname: string; character: CharacterKey }, done: (res: EntryAck) => void) => void;
}

// 3장 입장 화면: 캐릭터 1개 + 닉네임 → 「입장하기」. 퀴즈와 빙고가 함께 쓴다.
export function renderEntry(
  root: HTMLElement,
  options: EntryOptions,
  onJoined: (ack: Extract<EntryAck, { ok: true }>) => void,
): void {
  root.innerHTML = `
    <main class="screen entry">
      <a class="game-switch" href="${options.switchTo.href}">${options.switchTo.label}</a>
      <header class="entry-header">
        <h1></h1>
        <p>캐릭터와 닉네임을 정하면 입장할 수 있어요.<br />입장 후에는 바꿀 수 없어요.</p>
      </header>
      <section class="panel">
        <h2>캐릭터 선택</h2>
        <div class="character-grid" role="radiogroup" aria-label="캐릭터"></div>
      </section>
      <form class="panel entry-form" novalidate>
        <label for="nickname">닉네임</label>
        <div class="nickname-row">
          <input id="nickname" name="nickname" type="text" autocomplete="off"
                 autocapitalize="off" spellcheck="false" enterkeyhint="go" placeholder="1~${NICKNAME_MAX}자" />
          <span class="nickname-count">0/${NICKNAME_MAX}</span>
        </div>
        <p class="form-error" role="alert"></p>
        <button type="submit" class="primary-button" disabled>입장하기</button>
      </form>
    </main>
  `;

  root.querySelector('.entry-header h1')!.textContent = options.title;
  const grid = root.querySelector<HTMLDivElement>('.character-grid')!;
  const form = root.querySelector<HTMLFormElement>('.entry-form')!;
  const input = root.querySelector<HTMLInputElement>('#nickname')!;
  const count = root.querySelector<HTMLSpanElement>('.nickname-count')!;
  const errorText = root.querySelector<HTMLParagraphElement>('.form-error')!;
  const button = root.querySelector<HTMLButtonElement>('.primary-button')!;

  let selected: CharacterKey | null = null;
  let submitting = false;

  for (const c of CHARACTERS) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'character-card';
    card.setAttribute('role', 'radio');
    card.setAttribute('aria-checked', 'false');
    card.dataset.key = c.key;
    const label = document.createElement('span');
    label.textContent = c.name;
    card.append(createAvatar(c.key, 64), label);
    card.addEventListener('click', () => {
      selected = c.key;
      for (const el of grid.querySelectorAll<HTMLButtonElement>('.character-card')) {
        el.setAttribute('aria-checked', String(el.dataset.key === c.key));
      }
      update();
    });
    grid.append(card);
  }

  function update(): void {
    const nickname = normalizeNickname(input.value);
    const len = nicknameLength(nickname);
    count.textContent = `${len}/${NICKNAME_MAX}`;
    count.classList.toggle('over', len > NICKNAME_MAX);
    button.disabled = submitting || !selected || !isValidNicknameLength(nickname);
  }

  input.addEventListener('input', () => {
    errorText.textContent = '';
    update();
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const nickname = normalizeNickname(input.value);
    if (!selected || !isValidNicknameLength(nickname) || submitting) return;

    submitting = true;
    button.textContent = '입장 중…';
    update();
    options.join({ nickname, character: selected }, (res) => {
      submitting = false;
      button.textContent = '입장하기';
      if (res.ok) {
        onJoined(res);
        return;
      }
      errorText.textContent = res.error.message;
      update();
    });
  });

  update();
}
