import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { visualizer } from 'rollup-plugin-visualizer';

export function desktopRendererManualChunks(id: string) {
  const normalizedId = id.replaceAll('\\', '/');

  if (normalizedId.includes('@lucid-fin/contracts')) {
    return 'vendor-contracts';
  }
  if (normalizedId.includes('node_modules')) {
    return 'vendor';
  }
}

export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [
    react(),
    ...(mode === 'production'
      ? [visualizer({ filename: 'dist/bundle-stats.html', gzipSize: true, template: 'treemap' })]
      : []),
  ],
  server: {
    port: 5173,
    strictPort: true,
  },
  define:
    mode === 'development'
      ? {
          'process.env.NODE_ENV': '"development"',
        }
      : undefined,
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    minify: mode !== 'development',
    // Electron loads from local disk — chunk size doesn't affect load time.
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name][extname]',
        manualChunks: desktopRendererManualChunks,
      },
    },
  },
}));
