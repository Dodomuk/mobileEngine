import { serverTime } from '../clock.ts';

// 남은 시간 막대 + 초. deadline이 바뀔 때마다 set으로 갱신한다.
export class TimerBar {
  readonly el = document.createElement('div');
  private bar = document.createElement('div');
  private text = document.createElement('span');
  private startedAt = 0;
  private deadline = 0;
  private raf = 0;

  constructor() {
    this.el.className = 'timer';
    this.bar.className = 'timer-bar';
    this.text.className = 'timer-text';
    this.el.append(this.bar, this.text);
  }

  set(startedAt: number | null, deadline: number | null): void {
    cancelAnimationFrame(this.raf);
    if (startedAt === null || deadline === null) {
      this.el.hidden = true;
      return;
    }
    this.el.hidden = false;
    this.startedAt = startedAt;
    this.deadline = deadline;
    this.tick();
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
  }

  private tick = (): void => {
    const total = Math.max(1, this.deadline - this.startedAt);
    const remaining = Math.max(0, this.deadline - serverTime());
    this.bar.style.transform = `scaleX(${remaining / total})`;
    this.bar.classList.toggle('urgent', remaining <= 10_000);
    const sec = Math.ceil(remaining / 1000);
    this.text.textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
    if (remaining > 0) this.raf = requestAnimationFrame(this.tick);
  };
}
