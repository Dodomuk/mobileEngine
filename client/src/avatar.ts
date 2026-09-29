import { characterImageUrl } from '../../shared/constants.ts';
import { drawCharacterArt, type AnyCharacter } from './characters.ts';

// 입장 화면·결과 목록용 캐릭터 그림. PNG가 있으면 PNG, 없으면 코드로 그린 캐릭터.
export function createAvatar(key: AnyCharacter, size: number): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'avatar';
  wrap.style.width = wrap.style.height = `${size}px`;

  const canvas = document.createElement('canvas');
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  canvas.width = canvas.height = Math.round(size * dpr);
  canvas.style.width = canvas.style.height = '100%';
  const ctx = canvas.getContext('2d')!;
  ctx.scale(dpr, dpr);
  drawCharacterArt(ctx, key, size / 2, size * 0.97, size * 0.92);
  wrap.append(canvas);

  const img = new Image();
  img.draggable = false;
  img.onload = () => wrap.replaceChildren(img);
  img.src = characterImageUrl(key);
  return wrap;
}
