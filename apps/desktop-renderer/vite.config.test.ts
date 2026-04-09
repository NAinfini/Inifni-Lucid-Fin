import { describe, expect, it } from 'vitest';
import viteConfig from './vite.config.js';

describe('desktop renderer vite config', () => {
  it('emits stable asset filenames for file:// lazy imports', () => {
    const output = viteConfig.build?.rollupOptions?.output;

    expect(viteConfig.build?.emptyOutDir).toBe(true);
    expect(output).toMatchObject({
      assetFileNames: 'assets/[name][extname]',
      chunkFileNames: 'assets/[name].js',
      entryFileNames: 'assets/[name].js',
    });
  });
});
