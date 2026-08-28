import { describe, expect, it, vi } from 'vitest';

vi.mock('rollup-plugin-visualizer', () => ({ visualizer: () => ({}) }));

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

  it('groups contracts separately and all remaining dependencies into one vendor chunk', () => {
    expect(desktopRendererManualChunks('C:/repo/node_modules/react/index.js')).toBe('vendor');
    expect(
      desktopRendererManualChunks('C:\\repo\\node_modules\\@lucid-fin\\contracts\\dist\\index.js'),
    ).toBe('vendor-contracts');
    expect(desktopRendererManualChunks('C:/repo/src/ProjectShell.tsx')).toBeUndefined();
  });
});
