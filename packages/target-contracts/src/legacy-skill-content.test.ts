import { describe, expect, it } from 'vitest';
import { canonicalJson, parseCanonical } from './canonical.js';
import { LegacySkillContentV1Schema } from './legacy-skill-content.js';

describe('legacy Skill content envelope', () => {
  it('round-trips structured source records without flattening arrays', () => {
    const sourceRecord = {
      id: 'template.one',
      tracks: {
        camera: {
          entries: [
            { order: 1, presetId: 'camera.pan' },
            { order: 0, presetId: 'camera.push' },
          ],
        },
      },
    };
    const envelope = parseCanonical(LegacySkillContentV1Schema, {
      schema: 'lucid-fin.legacy-skill-content/v1',
      source: {
        kind: 'shot_template',
        logicalKey: sourceRecord.id,
        state: 'built_in',
        store: 'contracts.shot-templates',
      },
      effectiveInstruction: 'Apply the preserved shot-template structure.',
      sourceRecord,
    });

    expect(JSON.parse(canonicalJson(envelope))).toEqual(envelope);
    expect(envelope.sourceRecord).toEqual(sourceRecord);
    expect((envelope.sourceRecord as typeof sourceRecord).tracks.camera.entries).toEqual(
      sourceRecord.tracks.camera.entries,
    );
  });

  it('rejects unknown envelope fields and non-JSON source values', () => {
    expect(() =>
      LegacySkillContentV1Schema.parse({
        schema: 'lucid-fin.legacy-skill-content/v1',
        source: {
          kind: 'preset',
          logicalKey: 'preset.one',
          state: 'custom',
          store: 'preset_overrides',
        },
        effectiveInstruction: 'Use it.',
        sourceRecord: { bad: undefined },
        autoInject: true,
      }),
    ).toThrow();
  });
});
