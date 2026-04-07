import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('@xyflow/react') || id.includes('reactflow')) return 'vendor-reactflow';
          if (id.includes('node_modules')) return 'vendor';
          if (id.includes('/components/canvas/Commander')) return 'panel-commander';
          if (id.includes('/components/canvas/')) return 'panels';
        },
      },
    },
  },
});
