// 3장: 「본 게임 시작」 전면 안내 등 잠깐 띄우는 전체 화면 메시지
export function showFullscreenNotice(title: string, body: string, durationMs = 3000): void {
  const el = document.createElement('div');
  el.className = 'fullscreen-notice';
  el.innerHTML = '<div class="fullscreen-notice-card"><h2></h2><p></p></div>';
  el.querySelector('h2')!.textContent = title;
  el.querySelector('p')!.textContent = body;
  document.body.append(el);
  setTimeout(() => {
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 300);
  }, durationMs);
}

// 잘못된 요청 등 서버 error 이벤트를 짧게 알린다
export function showToast(message: string): void {
  document.querySelector('.toast')?.remove();
  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'alert');
  el.textContent = message;
  document.body.append(el);
  setTimeout(() => el.remove(), 3000);
}
