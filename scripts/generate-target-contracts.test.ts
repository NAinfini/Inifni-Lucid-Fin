import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { BUILT_IN_PRESET_LIBRARY } from '../packages/contracts/src/dto/presets/library.js';
import { BUILT_IN_SHOT_TEMPLATES } from '../packages/contracts/src/dto/presets/shot-templates.js';
import {
  buildTargetContractArtifacts,
  generateTargetContracts,
} from './generate-target-contracts.js';
import { normalizeLegacySourceRecord } from './legacy-skill-pack.js';

const ARTIFACT_NAMES = [
  'built-in-skills.v1.json',
  'legacy-skill-dispositions.v1.json',
  'manifest.v1.json',
  'public-wire.v1.json',
  'schema-bindings.v1.json',
  'tool-catalog.v1.json',
] as const;

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

describe('target contract generator', () => {
  it('builds deterministic canonical v1 artifacts with exact catalog and push contracts', async () => {
    const first = await buildTargetContractArtifacts();
    const second = await buildTargetContractArtifacts();
    expect(second).toEqual(first);

    for (const name of ARTIFACT_NAMES) {
      expect(first[name].endsWith('\n')).toBe(true);
      expect(() => JSON.parse(first[name])).not.toThrow();
    }

    const tools = JSON.parse(first['tool-catalog.v1.json']) as {
      capabilityIndex: { name: string }[];
      parserPolicyVersion: string;
      tools: { id: string }[];
      version: number;
    };
    expect(tools.version).toBe(1);
    expect(tools.parserPolicyVersion).toBe('strict-json-v1');
    expect(tools.tools).toHaveLength(40);
    expect(tools.tools.map(({ id }) => id)).toEqual(tools.capabilityIndex.map(({ name }) => name));

    const builtInSkills = JSON.parse(first['built-in-skills.v1.json']) as Array<{
      content: string;
    }>;
    expect(builtInSkills).toHaveLength(287);
    const legacyContents = builtInSkills.map(
      ({ content }) =>
        JSON.parse(content) as {
          source: { kind: string; logicalKey: string };
          sourceRecord: unknown;
        },
    );
    expect(
      Object.fromEntries(
        ['preset', 'shot_template', 'renderer_skill', 'process_prompt', 'prompt_template'].map(
          (kind) => [kind, legacyContents.filter(({ source }) => source.kind === kind).length],
        ),
      ),
    ).toEqual({
      preset: 216,
      shot_template: 19,
      renderer_skill: 26,
      process_prompt: 21,
      prompt_template: 5,
    });
    const allSourceKeys = legacyContents.map(
      ({ source }) => `${source.kind}\u0000${source.logicalKey}`,
    );
    expect(new Set(allSourceKeys).size).toBe(allSourceKeys.length);
    const migratedPresetSources = legacyContents.filter(({ source }) =>
      ['preset', 'shot_template'].includes(source.kind),
    );
    const migratedSourceRecords = new Map(
      migratedPresetSources.map(({ source, sourceRecord }) => [
        `${source.kind}\u0000${source.logicalKey}`,
        sourceRecord,
      ]),
    );
    expect(migratedSourceRecords.size).toBe(migratedPresetSources.length);
    expect(migratedSourceRecords.size).toBe(
      BUILT_IN_PRESET_LIBRARY.length + BUILT_IN_SHOT_TEMPLATES.length,
    );
    for (const preset of BUILT_IN_PRESET_LIBRARY) {
      expect(migratedSourceRecords.get(`preset\u0000${preset.id}`), preset.id).toEqual(
        normalizeLegacySourceRecord(preset),
      );
    }
    for (const template of BUILT_IN_SHOT_TEMPLATES) {
      expect(migratedSourceRecords.get(`shot_template\u0000${template.id}`), template.id).toEqual(
        normalizeLegacySourceRecord(template),
      );
    }

    const dispositions = JSON.parse(first['legacy-skill-dispositions.v1.json']) as {
      orphanArtifacts: Array<{ path: string }>;
    };
    expect(dispositions.orphanArtifacts.map(({ path }) => path)).toEqual([
      'docs/ai-video-prompt-guide/14-reference-image-generation.md',
      'docs/ai-video-prompt-guide/README.md',
    ]);

    const wire = JSON.parse(first['public-wire.v1.json']) as {
      parserPolicyVersion: string;
      pushMethods: { method: string }[];
      version: number;
    };
    expect(wire.version).toBe(1);
    expect(wire.parserPolicyVersion).toBe('strict-json-v1');
    expect(wire.pushMethods).toEqual([
      { method: 'run.events.appended', payloadSchema: expect.any(Object) },
    ]);

    const manifest = JSON.parse(first['manifest.v1.json']) as {
      artifacts: Record<string, string>;
    };
    expect(manifest.artifacts['built-in-skills.v1.json']).toBe(
      sha256(first['built-in-skills.v1.json']),
    );
    expect(manifest.artifacts['legacy-skill-dispositions.v1.json']).toBe(
      sha256(first['legacy-skill-dispositions.v1.json']),
    );
    expect(manifest.artifacts['tool-catalog.v1.json']).toBe(sha256(first['tool-catalog.v1.json']));
    expect(manifest.artifacts['public-wire.v1.json']).toBe(sha256(first['public-wire.v1.json']));
    expect(manifest.artifacts['schema-bindings.v1.json']).toBe(
      sha256(first['schema-bindings.v1.json']),
    );
  }, 30_000);

  it('matches every checked-in generated artifact byte for byte', async () => {
    const expected = await buildTargetContractArtifacts();
    for (const name of ARTIFACT_NAMES) {
      const actual = await readFile(
        new URL(`../packages/target-contracts/generated/${name}`, import.meta.url),
        'utf8',
      );
      expect(actual).toBe(expected[name]);
    }
    await expect(generateTargetContracts('check')).resolves.toBeUndefined();
  }, 30_000);
});
