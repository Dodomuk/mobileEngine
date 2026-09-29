// 11장: 모든 기기의 타이머는 서버 deadline 기준. 기기 시계 차이를 스냅샷의 serverNow로 보정한다.
let offsetMs = 0;

export function syncClock(serverNow: number): void {
  offsetMs = serverNow - Date.now();
}

export function serverTime(): number {
  return Date.now() + offsetMs;
}
