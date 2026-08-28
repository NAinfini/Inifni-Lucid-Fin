import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { canonicalUserDataLayout } from '../apps/desktop-main/src/production-paths.js';
import { checkProductionClosure } from './check-production-closure.js';

const root = resolve(import.meta.dirname, '..');

describe('production cutover contract', () => {
  it('owns a fresh canonical profile without probing any prior database', () => {
    const userDataPath = resolve('C:/Users/test/AppData/Roaming/Lucid Fin');
    const profileRoot = join(userDataPath, 'lucid-fin-v1');
    expect(canonicalUserDataLayout(userDataPath)).toEqual({
      root: profileRoot,
      databasePath: join(profileRoot, 'project.sqlite'),
      mediaRoot: join(profileRoot, 'media'),
      recoveryKeyAccount: 'recovery-key-v1',
    });
  });

  it('ships direct canonical built-in Skill content and identities', async () => {
    const pack = JSON.parse(
      await readFile(resolve(root, 'packages/contracts/generated/built-in-skills.v1.json'), 'utf8'),
    ) as {
      readonly skills: readonly {
        readonly skillId: string;
        readonly version: string;
        readonly content: string;
      }[];
    };
    expect(pack.skills).toHaveLength(287);
    expect(
      pack.skills.every(({ skillId }) => /^builtin\.[a-z-]+\.[a-z0-9.-]+$/u.test(skillId)),
    ).toBe(true);
    expect(pack.skills.every(({ version }) => /^\d+\.\d+\.\d+$/u.test(version))).toBe(true);
    expect(pack.skills.every(({ content }) => !content.includes('legacy-skill-content'))).toBe(
      true,
    );
  });

  it('has one official, zero-Legacy production closure', async () => {
    await expect(checkProductionClosure({ repositoryRoot: root })).resolves.toMatchObject({
      ok: true,
      violations: [],
    });
  });
});
