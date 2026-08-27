import { describe, expect, it, vi } from 'vitest';

vi.mock('@vitejs/plugin-react', () => ({ default: () => ({ name: 'react' }) }));

import config, {
  TARGET_RC_CONTENT_SECURITY_POLICY,
  TARGET_RC_RENDERER_OUTPUT_DIRECTORY,
  targetRcRendererHtml,
} from './vite.target-rc.config.js';

describe('target RC renderer Vite config', () => {
  it('builds only the target renderer entry with a stable standalone HTML shell', () => {
    const build = config.build as Record<string, unknown>;
    const rollupOptions = build.rollupOptions as Record<string, unknown>;
    expect(build.outDir).toBe(TARGET_RC_RENDERER_OUTPUT_DIRECTORY);
    expect(build.emptyOutDir).toBe(false);
    expect(rollupOptions.input).toEqual({
      'target-entry': expect.stringMatching(/target-entry\.tsx$/),
    });
    expect(targetRcRendererHtml()).toContain('assets/target-entry.js');
    expect(targetRcRendererHtml()).not.toContain('main.tsx');
    expect(targetRcRendererHtml()).toContain(
      `http-equiv="Content-Security-Policy" content="${TARGET_RC_CONTENT_SECURITY_POLICY}"`,
    );
    expect(TARGET_RC_CONTENT_SECURITY_POLICY).toContain("default-src 'none'");
    expect(TARGET_RC_CONTENT_SECURITY_POLICY).toContain("script-src 'self'");
    expect(TARGET_RC_CONTENT_SECURITY_POLICY).toContain("media-src 'self' lucid-target-media:");
    expect(TARGET_RC_CONTENT_SECURITY_POLICY).not.toContain("script-src 'unsafe-inline'");
  });
});
