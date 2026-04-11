import { describe, expect, it } from 'vitest';
import viteConfig, { desktopRendererManualChunks } from './vite.config.js';

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

  it('splits large panels into dedicated chunks', () => {
    expect(desktopRendererManualChunks('C:/repo/src/components/canvas/CommanderPanel.tsx')).toBe(
      'panel-commander',
    );
    expect(
      desktopRendererManualChunks('C:\\repo\\src\\components\\canvas\\AssetBrowserPanel.tsx'),
    ).toBe('panel-assets');
    expect(desktopRendererManualChunks('C:/repo/src/components/canvas/InspectorPanel.tsx')).toBe(
      'panel-inspector',
    );
    expect(
      desktopRendererManualChunks('C:/repo/src/components/canvas/InspectorPanelHeader.tsx'),
    ).toBe('panel-inspector');
    expect(desktopRendererManualChunks('C:/repo/src/components/canvas/HistoryPanel.tsx')).toBe(
      'panels',
    );
  });
});
