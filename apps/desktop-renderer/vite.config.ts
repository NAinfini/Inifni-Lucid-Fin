import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export function desktopRendererManualChunks(id: string) {
  const normalizedId = id.replaceAll('\\', '/');

  if (normalizedId.includes('@xyflow/react') || normalizedId.includes('reactflow')) {
    return 'vendor-reactflow';
  }
  if (normalizedId.includes('/components/canvas/CommanderPanel.')) {
    return 'panel-commander';
  }
  if (normalizedId.includes('/components/canvas/AssetBrowserPanel.')) {
    return 'panel-assets';
  }
  if (
    normalizedId.includes('/components/canvas/Inspector')
    || normalizedId.includes('/components/canvas/inspector-')
  ) {
    return 'panel-inspector';
  }
  if (normalizedId.includes('/components/canvas/')) {
    return 'panels';
  }
  if (normalizedId.includes('node_modules')) {
    return 'vendor';
  }
}

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
    minify: false,
    rollupOptions: {
      output: {
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name][extname]',
        manualChunks: desktopRendererManualChunks,
      },
    },
  },
});
