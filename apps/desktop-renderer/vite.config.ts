import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export function desktopRendererManualChunks(id: string) {
  const normalizedId = id.replaceAll('\\', '/');

  // ---- Vendor splits (must come before the generic node_modules catch-all) ----

  // ReactFlow + xyflow system — ~200KB combined, used only on canvas page
  if (normalizedId.includes('@xyflow/') || normalizedId.includes('reactflow')) {
    return 'vendor-reactflow';
  }

  // Contracts package — includes the large built-in preset library (~80KB minified)
  if (normalizedId.includes('@lucid-fin/contracts')) {
    return 'vendor-contracts';
  }

  // Radix UI primitives — shared across panels, split to deduplicate
  if (normalizedId.includes('@radix-ui/')) {
    return 'vendor-radix';
  }

  // Markdown rendering stack (react-markdown + remark-* + rehype-katex
  // + katex CSS) — ~500KB transitive, only needed when commander
  // renders formatted message content. Routed into its own vendor
  // chunk and lazy-loaded via Markdown.tsx's React.lazy wrapper.
  if (
    normalizedId.includes('/react-markdown/') ||
    normalizedId.includes('/remark-') ||
    normalizedId.includes('/rehype-') ||
    normalizedId.includes('/katex/') ||
    normalizedId.includes('/micromark') ||
    normalizedId.includes('/mdast-') ||
    normalizedId.includes('/hast-')
  ) {
    return 'vendor-markdown';
  }

  // ---- Panel-level code splitting ----

  // MarkdownInner is lazy-loaded via Markdown.tsx; keep it alongside
  // its heavy vendor deps so the runtime only touches one extra chunk.
  if (normalizedId.includes('/components/canvas/commander/MarkdownInner.')) {
    return 'vendor-markdown';
  }

  if (
    normalizedId.includes('/components/canvas/CommanderPanel.') ||
    normalizedId.includes('/hooks/useCommander.') ||
    normalizedId.includes('/components/canvas/commander/')
  ) {
    return 'panel-commander';
  }
  if (
    normalizedId.includes('/components/canvas/AssetBrowserPanel.') ||
    normalizedId.includes('/components/canvas/asset-browser/')
  ) {
    return 'panel-assets';
  }
  if (
    normalizedId.includes('/components/canvas/Inspector') ||
    normalizedId.includes('/components/canvas/inspector-')
  ) {
    return 'panel-inspector';
  }
  if (normalizedId.includes('/components/canvas/')) {
    return 'panels';
  }

  // ---- Generic vendor catch-all ----
  if (normalizedId.includes('node_modules')) {
    return 'vendor';
  }
}

export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [react(), tailwindcss()],
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
