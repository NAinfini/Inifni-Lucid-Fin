import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { buildCanonicalContractArtifacts } from './generate-contracts.js';

const EXPECTED_COUNTS = {
  preset: 216,
  'shot-template': 19,
  'renderer-skill': 26,
  'process-prompt': 21,
  'prompt-template': 5,
} as const;

interface BuiltInSkill {
  readonly content: string;
  readonly contentHash: string;
  readonly provenance: string;
  readonly skillId: string;
  readonly trust: string;
  readonly version: string;
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function skillKind(skillId: string): keyof typeof EXPECTED_COUNTS {
  const [, kind] = skillId.split('.', 3);
  if (!(kind in EXPECTED_COUNTS)) throw new Error(`Unexpected built-in Skill id: ${skillId}`);
  return kind as keyof typeof EXPECTED_COUNTS;
}

describe('canonical built-in Skill pack', () => {
  it('is the reviewed, direct-consumption source of truth', async () => {
    const pack = JSON.parse(
      await readFile(
        new URL('../packages/contracts/generated/built-in-skills.v1.json', import.meta.url),
        'utf8',
      ),
    ) as { readonly version: number; readonly skills: readonly BuiltInSkill[] };

    expect(pack.version).toBe(1);
    expect(pack.skills).toHaveLength(287);
    expect(
      Object.fromEntries(
        Object.keys(EXPECTED_COUNTS).map((kind) => [
          kind,
          pack.skills.filter((skill) => skillKind(skill.skillId) === kind).length,
        ]),
      ),
    ).toEqual(EXPECTED_COUNTS);
    expect(pack.skills.map((skill) => skill.skillId)).toEqual(
      [...pack.skills.map((skill) => skill.skillId)].sort(),
    );
    expect(pack.skills.every((skill) => skill.provenance === 'built_in')).toBe(true);
    expect(
      pack.skills.every(
        (skill) =>
          /^builtin\.(preset|shot-template|renderer-skill|process-prompt|prompt-template)\.[a-z0-9.-]+$/u.test(
            skill.skillId,
          ) &&
          /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u.test(skill.version) &&
          skill.contentHash === sha256(skill.content) &&
          skill.content.startsWith('# ') &&
          skill.content.includes('## Purpose') &&
          skill.content.includes('## Constraints') &&
          !/\blegacy\b|backwards? compatibility|legacy-skill-content|sourceRecord|wrapper/iu.test(
            `${skill.description}\n${skill.content}`,
          ),
      ),
    ).toBe(true);
    expect(pack.skills.filter((skill) => skill.trust === 'trusted')).toHaveLength(287);
    expect(pack.skills.filter((skill) => skill.trust !== 'trusted')).toEqual([]);
  });

  it('validates the checked-in source without deriving Skills from retired records', async () => {
    const first = await buildCanonicalContractArtifacts();
    const second = await buildCanonicalContractArtifacts();
    const checkedIn = await readFile(
      new URL('../packages/contracts/generated/built-in-skills.v1.json', import.meta.url),
      'utf8',
    );
    expect(second).toEqual(first);
    const skills = JSON.parse(first['built-in-skills.v1.json']) as {
      readonly skills: readonly BuiltInSkill[];
    };
    const manifest = JSON.parse(first['manifest.v1.json']) as {
      readonly artifacts: Readonly<Record<string, string>>;
    };
    expect(skills.skills).toHaveLength(287);
    expect(first['built-in-skills.v1.json']).toBe(checkedIn);
    expect(first['built-in-skills.v1.json']).toContain('"version": 1');
    expect(manifest.artifacts['built-in-skills.v1.json']).toBe(
      sha256(first['built-in-skills.v1.json']),
    );
  });
});
