import { describe, expect, it } from 'vitest';
import {
  PUBLIC_WIRE_METHODS_V1,
  TARGET_DESKTOP_API_GLOBAL_V1,
  TARGET_WIRE_INVOKE_CHANNEL_V1,
  TARGET_WIRE_PUSH_CHANNEL_V1,
} from '../packages/target-contracts/src/wire.js';
import { buildTargetPreloadArtifacts, generateTargetPreload } from './generate-target-preload.js';

const source = {
  PUBLIC_WIRE_METHODS_V1,
  TARGET_DESKTOP_API_GLOBAL_V1,
  TARGET_WIRE_INVOKE_CHANNEL_V1,
  TARGET_WIRE_PUSH_CHANNEL_V1,
};

describe('target preload generation', () => {
  it('generates every canonical method and only one invoke channel', async () => {
    const artifacts = await buildTargetPreloadArtifacts(source);
    for (const method of Object.keys(PUBLIC_WIRE_METHODS_V1)) {
      expect(artifacts.preload).toContain(`invoke('${method}', request)`);
      expect(artifacts.rendererTypes).toContain(`TargetDesktopCallV1<'${method}'>`);
    }
    expect(artifacts.preload.match(/ipcRenderer\.invoke\(/g)).toHaveLength(1);
    expect(artifacts.preload).not.toMatch(/preset|template|processPrompt|workflow/i);
  });

  it('matches the checked-in generated artifacts exactly', async () => {
    await expect(generateTargetPreload('check', source)).resolves.toBeUndefined();
  });
});
