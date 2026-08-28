import { describe, expect, it } from 'vitest';
import {
  PUBLIC_WIRE_METHODS_V1,
  LUCID_FIN_DESKTOP_API_GLOBAL_V1,
  LUCID_FIN_WIRE_INVOKE_CHANNEL_V1,
  LUCID_FIN_WIRE_PUSH_CHANNEL_V1,
} from '../packages/contracts/src/wire.js';
import { buildPreloadArtifacts, generatePreload } from './generate-preload.js';

const source = {
  PUBLIC_WIRE_METHODS_V1,
  LUCID_FIN_DESKTOP_API_GLOBAL_V1,
  LUCID_FIN_WIRE_INVOKE_CHANNEL_V1,
  LUCID_FIN_WIRE_PUSH_CHANNEL_V1,
};

describe('preload generation', () => {
  it('generates every canonical method and only one invoke channel', async () => {
    const artifacts = await buildPreloadArtifacts(source);
    for (const method of Object.keys(PUBLIC_WIRE_METHODS_V1)) {
      expect(artifacts.preload).toContain(`invoke('${method}', request)`);
      expect(artifacts.rendererTypes).toContain(`DesktopCallV1<'${method}'>`);
    }
    expect(artifacts.preload.match(/ipcRenderer\.invoke\(/g)).toHaveLength(1);
    expect(artifacts.preload).not.toMatch(/preset|template|processPrompt|workflow/i);
  });

  it('matches the checked-in generated artifacts exactly', async () => {
    await expect(generatePreload('check', source)).resolves.toBeUndefined();
  });
});
