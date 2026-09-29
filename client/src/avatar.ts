import {
  ADMIN_CHARACTER,
  ADMIN_COLOR,
  ADMIN_NICKNAME,
  CHARACTERS,
  characterImageUrl,
} from '../../shared/constants.ts';
import type { AdminCharacterKey, CharacterKey } from '../../shared/types.ts';

type AnyCharacter = CharacterKey | AdminCharacterKey;

function characterInfo(key: AnyCharacter): { name: string; color: string } {
  if (key === ADMIN_CHARACTER) return { name: ADMIN_NICKNAME, color: ADMIN_COLOR };
  return CHARACTERS.find((c) => c.key === key) ?? { name: '?', color: '#999' };
}

// 4장: 이미지가 없으면 캐릭터별 색 원 + 이름 첫 글자로 대체한다.
export function createAvatar(key: AnyCharacter, size: number): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'avatar';
  wrap.style.width = wrap.style.height = `${size}px`;

  const { name, color } = characterInfo(key);
  const showPlaceholder = () => {
    wrap.replaceChildren();
    const circle = document.createElement('div');
    circle.className = 'avatar-placeholder';
    circle.style.background = color;
    circle.style.fontSize = `${Math.round(size * 0.42)}px`;
    circle.textContent = name.slice(0, 1);
    wrap.append(circle);
  };

  const img = new Image();
  img.alt = name;
  img.draggable = false;
  img.onerror = showPlaceholder;
  img.src = characterImageUrl(key);
  wrap.append(img);
  return wrap;
}
