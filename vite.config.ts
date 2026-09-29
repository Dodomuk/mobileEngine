/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

const SERVER_PORT = Number(process.env.PORT ?? 3000);

export default defineConfig({
  root: 'client',
  build: { outDir: 'dist', emptyOutDir: true },
  server: {
    host: true, // 같은 와이파이의 폰에서 접속 테스트
    port: 5173,
    proxy: {
      '/socket.io': { target: `http://localhost:${SERVER_PORT}`, ws: true },
    },
  },
  test: { root: '.', include: ['server/**/*.test.ts', 'shared/**/*.test.ts'] },
});
