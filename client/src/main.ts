import { startAdminApp } from './adminApp.ts';
import { startPlayerApp } from './playerApp.ts';
import './style.css';

const app = document.querySelector<HTMLDivElement>('#app')!;
const reconnectOverlay = document.querySelector<HTMLDivElement>('#reconnect-overlay')!;

// 3장: 관리자는 별도 주소(/admin)로 들어온다
if (location.pathname.replace(/\/+$/, '') === '/admin') {
  document.title = 'ABC 광장 퀴즈 · 관리자';
  startAdminApp(app, reconnectOverlay);
} else {
  startPlayerApp(app, reconnectOverlay);
}
