import { describe, expect, it } from 'vitest';
import viteConfigFn, { desktopRendererManualChunks } from './vite.config.js';

describe('desktop renderer vite config', () => {
  it('emits stable asset filenames for file:// lazy imports', () => {
    const viteConfig =
      typeof viteConfigFn === 'function'
        ? (viteConfigFn as (env: { mode: string; command: string }) => Record<string, unknown>)({
            mode: 'production',
            command: 'build',
          })
        : viteConfigFn;

    const build = viteConfig.build as Record<string, unknown> | undefined;
    const rollupOptions = build?.rollupOptions as Record<string, unknown> | undefined;
    const output = rollupOptions?.output;

    expect(build?.emptyOutDir).toBe(true);
    expect(output).toMatchObject({
      assetFileNames: 'assets/[name][extname]',
      chunkFileNames: 'assets/[name].js',
      entryFileNames: 'assets/[name].js',
    });
  });

  it('groups node_modules into vendor chunks and canvas panels into named chunks', () => {
    expect(desktopRendererManualChunks('C:/repo/node_modules/react/index.js')).toBe('vendor');
    expect(desktopRendererManualChunks('C:\\repo\\node_modules\\@xyflow\\react\\dist\\index.mjs')).toBe('vendor-reactflow');
    expect(desktopRendererManualChunks('C:/repo/src/components/canvas/CommanderPanel.tsx')).toBe('panel-commander');
    expect(desktopRendererManualChunks('C:/repo/src/components/canvas/AssetBrowserPanel.tsx')).toBe('panel-assets');
    expect(desktopRendererManualChunks('C:/repo/src/components/canvas/InspectorPanel.tsx')).toBe('panel-inspector');
    expect(desktopRendererManualChunks('C:/repo/src/components/canvas/HistoryPanel.tsx')).toBe('panels');
    expect(desktopRendererManualChunks('C:/repo/src/store/slices/canvas.ts')).toBeUndefined();
  });
});
