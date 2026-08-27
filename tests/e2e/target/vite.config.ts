import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root,
  plugins: [react()],
  resolve: {
    alias: {
      vitest: fileURLToPath(new URL('./vitest-stub.ts', import.meta.url)),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 4179,
    strictPort: true,
  },
});
