import { startAdminApp } from './adminApp.ts';
import { startBingoAdminApp } from './bingo/adminApp.ts';
import { startBingoPlayerApp } from './bingo/playerApp.ts';
import { startPlayerApp } from './playerApp.ts';
import './style.css';

const app = document.querySelector<HTMLDivElement>('#app')!;
const reconnectOverlay = document.querySelector<HTMLDivElement>('#reconnect-overlay')!;

// 3장: 관리자는 별도 주소(/admin)로 들어온다. 빙고는 /bingo, 빙고 관리자는 /bingo/admin.
const path = location.pathname.replace(/\/+$/, '');
if (path === '/admin') {
  document.title = 'ABC 광장 퀴즈 · 관리자';
  startAdminApp(app, reconnectOverlay);
} else if (path === '/bingo/admin') {
  document.title = '빙고 · 관리자';
  startBingoAdminApp(app, reconnectOverlay);
} else if (path === '/bingo') {
  document.title = '빙고';
  startBingoPlayerApp(app, reconnectOverlay);
} else {
  startPlayerApp(app, reconnectOverlay);
}
