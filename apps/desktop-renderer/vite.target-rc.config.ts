import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

export const TARGET_RC_RENDERER_ENTRY = fileURLToPath(
  new URL('./src/target-entry.tsx', import.meta.url),
);
export const TARGET_RC_RENDERER_OUTPUT_DIRECTORY = 'dist-target-rc';
export const TARGET_RC_CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "base-uri 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "form-action 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "img-src 'self' data: lucid-target-media:",
  "media-src 'self' lucid-target-media:",
].join('; ');

export function targetRcRendererHtml(): string {
  return [
    '<!doctype html>',
    '<html lang="en-US">',
    `<head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><meta http-equiv="Content-Security-Policy" content="${TARGET_RC_CONTENT_SECURITY_POLICY}" /><title>Lucid Fin Target RC</title></head>`,
    '<body><div id="root"></div><script type="module" src="./assets/target-entry.js"></script></body>',
    '</html>',
  ].join('');
}

function targetRcHtmlPlugin(): Plugin {
  return {
    name: 'target-rc-html',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'index.html',
        source: targetRcRendererHtml(),
      });
    },
  };
}

export default defineConfig({
  base: './',
  publicDir: false,
  plugins: [react(), targetRcHtmlPlugin()],
  build: {
    outDir: TARGET_RC_RENDERER_OUTPUT_DIRECTORY,
    emptyOutDir: false,
    minify: false,
    rollupOptions: {
      input: { 'target-entry': path.resolve(TARGET_RC_RENDERER_ENTRY) },
      output: {
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
});
