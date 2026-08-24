import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  canonicalJson,
  LegacySkillContentV1Schema,
} from '../packages/target-contracts/src/index.js';
import type {
  HostCatalogProvisioning,
  SkillRegistrationBatchInput,
  SkillRegistrationBatchResult,
  SkillRegistrationInput,
} from '../packages/target-storage/src/host/index.js';
import { buildLegacyClassificationReport } from '../packages/target-storage/src/migration/classification-report.js';
import type { LegacyClassificationRow } from '../packages/target-storage/src/migration/classification-subjects.js';
import { buildBuiltInLegacySkills } from './legacy-skill-pack.js';
import {
  composeLegacySkillMigrationBundle,
  createLegacySkillRowClassifier,
  legacySkillDatabaseFingerprint,
  migrateLegacySkills,
  planLegacySkillMigration,
  type LegacySkillMigrationBundleV1,
} from './migrate-legacy-skills.js';

function rendererExport(payload: unknown) {
  const rawJson = canonicalJson(payload);
  return {
    storageKey: 'lucid-skills-v2' as const,
    rawJson,
    rawHash: createHash('sha256').update(rawJson, 'utf8').digest('hex'),
  };
}

function sealBundle(bundle: LegacySkillMigrationBundleV1): LegacySkillMigrationBundleV1 {
  return {
    ...bundle,
    databaseFingerprint: legacySkillDatabaseFingerprint(bundle),
  };
}

function baseBundle(
  processPromptOverrides: LegacySkillMigrationBundleV1['processPromptOverrides'],
): LegacySkillMigrationBundleV1 {
  return {
    schema: 'lucid-fin.legacy-skill-migration-bundle/v1' as const,
    cutoverAt: '2026-08-17T00:00:01.000Z',
    databaseFingerprint: '0'.repeat(64),
    rendererExport: rendererExport({ builtInCustoms: {}, builtInNames: {}, customSkills: [] }),
    presetOverrides: [],
    customShotTemplates: [],
    processPromptOverrides,
    promptTemplateOverrides: [],
  };
}

async function emptyBundle() {
  const processPromptOverrides = (await buildBuiltInLegacySkills())
    .map(({ content }) => LegacySkillContentV1Schema.parse(JSON.parse(content)))
    .filter(({ source }) => source.kind === 'process_prompt')
    .map(({ sourceRecord }, index) => {
      const record = sourceRecord as {
        processKey: string;
        name: string;
        description: string;
        defaultValue: string;
      };
      return {
        id: index + 1,
        ...record,
        customValue: null,
        createdAt: 0,
        updatedAt: 0,
      };
    });
  return sealBundle(baseBundle(processPromptOverrides));
}

function recordingHost() {
  const rows = new Map<string, string>();
  const calls: SkillRegistrationInput[][] = [];
  const host = {
    registerProviderProfile() {
      throw new Error('unused');
    },
    registerSkill() {
      throw new Error('unused');
    },
    buildRootCapabilityCatalog() {
      throw new Error('unused');
    },
    registerSkillBatch(input: SkillRegistrationBatchInput): SkillRegistrationBatchResult {
      calls.push([...input.entries]);
      return {
        sourceFingerprint: input.sourceFingerprint,
        results: input.entries.map((entry) => {
          const key = `${entry.document.skillId}\u0000${entry.document.version}`;
          const exact = canonicalJson(entry);
          const existing = rows.get(key);
          if (existing !== undefined && existing !== exact) throw new Error('conflict');
          rows.set(key, exact);
          return { ...entry, status: existing === undefined ? 'inserted' : 'unchanged' };
        }),
      };
    },
  } as HostCatalogProvisioning;
  return { host, calls };
}

function classificationRows(bundle: LegacySkillMigrationBundleV1): LegacyClassificationRow[] {
  let ordinal = 0;
  const row = (
    database: LegacyClassificationRow['database'],
    table: string,
    columns: readonly string[],
    values: Readonly<Record<string, unknown>>,
  ): LegacyClassificationRow => ({
    database,
    table,
    kind: 'table',
    columns,
    subject: {
      database,
      table,
      rowKey: createHash('sha256').update(`${database}:${table}:${ordinal++}`).digest('hex'),
      path: '$',
    },
    values,
  });
  return [
    ...bundle.presetOverrides.map((record) =>
      row(
        'main',
        'preset_overrides',
        [
          'category',
          'created_at',
          'defaults',
          'description',
          'id',
          'is_user',
          'name',
          'params',
          'preset_id',
          'prompt',
          'updated_at',
        ],
        {
          id: record.id,
          preset_id: record.presetId,
          category: record.category,
          name: record.name,
          description: record.description,
          prompt: record.prompt,
          params: record.params === null ? null : canonicalJson(record.params),
          defaults: record.defaults === null ? null : canonicalJson(record.defaults),
          is_user: record.isUser ? 1n : 0n,
          created_at: BigInt(record.createdAt),
          updated_at: BigInt(record.updatedAt),
        },
      ),
    ),
    ...bundle.customShotTemplates.map((record) =>
      row(
        'main',
        'custom_shot_templates',
        ['created_at', 'description', 'id', 'name', 'tracks_json', 'updated_at'],
        {
          id: record.id,
          name: record.name,
          description: record.description,
          tracks_json: canonicalJson(record.tracks),
          created_at: BigInt(record.createdAt),
          updated_at: BigInt(record.updatedAt),
        },
      ),
    ),
    ...bundle.processPromptOverrides.map((record) =>
      row(
        'prompts',
        'process_prompts',
        [
          'created_at',
          'custom_value',
          'default_value',
          'description',
          'id',
          'name',
          'process_key',
          'updated_at',
        ],
        {
          id: BigInt(record.id),
          process_key: record.processKey,
          name: record.name,
          description: record.description,
          default_value: record.defaultValue,
          custom_value: record.customValue,
          created_at: BigInt(record.createdAt),
          updated_at: BigInt(record.updatedAt),
        },
      ),
    ),
    ...bundle.promptTemplateOverrides.map((record) =>
      row('prompts', 't_prompt_overrides', ['code', 'customValue'], {
        code: record.code,
        customValue: record.customValue,
      }),
    ),
  ];
}

describe('legacy Skill migration', () => {
  it('composes nullable legacy rows and renderer storage without losing structured data', () => {
    const directory = mkdtempSync(join(process.cwd(), '.tmp-legacy-skills-'));
    const legacyPath = join(directory, 'presets.sqlite');
    const promptsPath = join(directory, 'prompts.sqlite');
    const legacy = new DatabaseSync(legacyPath);
    const prompts = new DatabaseSync(promptsPath);
    try {
      legacy.exec(`
        CREATE TABLE preset_overrides (
          id TEXT, preset_id TEXT, category TEXT, name TEXT, description TEXT, prompt TEXT,
          params TEXT, defaults TEXT, is_user INTEGER, created_at INTEGER, updated_at INTEGER
        );
        CREATE TABLE custom_shot_templates (
          id TEXT, name TEXT, description TEXT, tracks_json TEXT,
          created_at INTEGER, updated_at INTEGER
        );
      `);
      legacy
        .prepare(`INSERT INTO preset_overrides VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(
          'preset.override',
          'preset.base',
          'camera',
          'Nullable override',
          null,
          null,
          JSON.stringify([{ key: 'motion', options: ['pan', 'tilt'] }]),
          JSON.stringify({ motion: 'pan' }),
          0,
          1,
          2,
        );
      legacy
        .prepare('INSERT INTO custom_shot_templates VALUES (?, ?, ?, ?, ?, ?)')
        .run(
          'shot.custom',
          'Custom shot',
          'Custom shot description',
          JSON.stringify({ camera: { blends: ['ease-in'], entries: [{ order: 0 }] } }),
          3,
          4,
        );

      prompts.exec(`
        CREATE TABLE process_prompts (
          id INTEGER, process_key TEXT, name TEXT, description TEXT,
          default_value TEXT, custom_value TEXT, created_at INTEGER, updated_at INTEGER
        );
        CREATE TABLE t_prompt_overrides (code TEXT, customValue TEXT);
      `);
      prompts
        .prepare('INSERT INTO process_prompts VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(1, 'base-only', 'Base only', 'No override', 'Default prompt', null, 5, 6);
      prompts
        .prepare('INSERT INTO process_prompts VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(2, 'customized', 'Customized', 'Has override', 'Default', 'Custom', 7, 8);
      prompts
        .prepare('INSERT INTO t_prompt_overrides VALUES (?, ?)')
        .run('agent-system', 'Prompt override');
      const renderer = rendererExport({
        builtInCustoms: { 'meta-prompt': 'Renderer override' },
        builtInNames: { 'meta-prompt': 'Renamed renderer Skill' },
        customSkills: [
          {
            id: 'renderer.custom',
            name: 'Renderer custom',
            category: 'user',
            customContent: 'Custom renderer instructions',
            source: 'user',
            createdAt: 9,
          },
        ],
      });
      const bundle = composeLegacySkillMigrationBundle({
        legacyDatabasePath: legacyPath,
        legacyPromptDatabasePath: promptsPath,
        rendererExport: renderer,
        cutoverAt: '2026-08-17T00:00:01.000Z',
      });

      expect(bundle.presetOverrides).toEqual([
        {
          id: 'preset.override',
          presetId: 'preset.base',
          category: 'camera',
          name: 'Nullable override',
          description: null,
          prompt: null,
          params: [{ key: 'motion', options: ['pan', 'tilt'] }],
          defaults: { motion: 'pan' },
          isUser: false,
          createdAt: 1,
          updatedAt: 2,
        },
      ]);
      expect(bundle.customShotTemplates[0]?.tracks).toEqual({
        camera: { blends: ['ease-in'], entries: [{ order: 0 }] },
      });
      expect(bundle.processPromptOverrides.map(({ customValue }) => customValue)).toEqual([
        null,
        'Custom',
      ]);
      expect(bundle.promptTemplateOverrides).toEqual([
        { code: 'agent-system', customValue: 'Prompt override' },
      ]);
      expect(bundle.rendererExport).toEqual(renderer);
      expect(bundle.databaseFingerprint).toBe(legacySkillDatabaseFingerprint(bundle));
    } finally {
      legacy.close();
      prompts.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('reconciles the exact immutable 216/19/26/21/5 pack', async () => {
    const report = await migrateLegacySkills({ mode: 'dry-run', bundle: await emptyBundle() });
    expect(report.counts).toMatchObject({
      builtIn: 287,
      dynamic: 0,
      total: 287,
      quarantined: 35,
    });
    expect(
      Object.fromEntries(
        ['preset', 'shot_template', 'renderer_skill', 'process_prompt', 'prompt_template'].map(
          (kind) => [kind, report.entries.filter((entry) => entry.source.kind === kind).length],
        ),
      ),
    ).toEqual({
      preset: 216,
      shot_template: 19,
      renderer_skill: 26,
      process_prompt: 21,
      prompt_template: 5,
    });
    expect(report.entries.every(({ registration }) => registration === 'planned')).toBe(true);
  });

  it('uses one migration plan to classify every Legacy Skill database row without private text', async () => {
    const builtIns = await buildBuiltInLegacySkills();
    const presetId = LegacySkillContentV1Schema.parse(
      JSON.parse(builtIns.find(({ skillId }) => skillId.startsWith('legacy.preset.'))!.content),
    ).source.logicalKey;
    const empty = await emptyBundle();
    const bundle = sealBundle({
      ...empty,
      presetOverrides: [
        {
          id: `override:${presetId}`,
          presetId,
          category: 'camera',
          name: 'Private preset override',
          description: 'Private override description',
          prompt: 'Private override prompt',
          params: [],
          defaults: {},
          isUser: false,
          createdAt: 1,
          updatedAt: 2,
        },
        {
          id: 'custom-private-preset',
          presetId: 'custom-private-preset',
          category: 'look',
          name: 'Private custom preset',
          description: 'Private custom description',
          prompt: 'Private custom prompt',
          params: [],
          defaults: {},
          isUser: true,
          createdAt: 3,
          updatedAt: 4,
        },
      ],
      customShotTemplates: [
        {
          id: 'custom-private-shot',
          name: 'Private shot name',
          description: 'Private shot description',
          tracks: { camera: { entries: [] } },
          createdAt: 5,
          updatedAt: 6,
        },
      ],
      processPromptOverrides: empty.processPromptOverrides.map((record, index) =>
        index === 0 ? { ...record, customValue: 'Private process override', updatedAt: 7 } : record,
      ),
      promptTemplateOverrides: [{ code: 'agent-system', customValue: 'Private template override' }],
    });
    const plan = await planLegacySkillMigration(bundle);
    const reorderedPlan = await planLegacySkillMigration(
      sealBundle({
        ...bundle,
        presetOverrides: [...bundle.presetOverrides].reverse(),
        customShotTemplates: [...bundle.customShotTemplates].reverse(),
        processPromptOverrides: [...bundle.processPromptOverrides].reverse(),
        promptTemplateOverrides: [...bundle.promptTemplateOverrides].reverse(),
      }),
    );
    const dryRun = await migrateLegacySkills({ mode: 'dry-run', bundle });
    const rows = classificationRows(bundle);
    expect(() => createLegacySkillRowClassifier({ ...plan, planHash: '0'.repeat(64) })).toThrow(
      'Legacy Skill migration plan hash does not match',
    );
    expect(() =>
      createLegacySkillRowClassifier({
        ...plan,
        documents: [
          { ...plan.documents[0]!, description: 'Tampered migration plan document' },
          ...plan.documents.slice(1),
        ],
      }),
    ).toThrow('Legacy Skill migration plan hash does not match');
    const classify = createLegacySkillRowClassifier(plan);
    const entries = classify([...rows].reverse());
    const report = buildLegacyClassificationReport({
      sourceFingerprint: createHash('sha256').update('legacy-skill-rows').digest('hex'),
      subjects: rows.map(({ subject }) => subject),
      entries,
    });

    expect(plan.rows).toHaveLength(rows.length);
    expect(plan.planHash).toMatch(/^[a-f0-9]{64}$/);
    expect(reorderedPlan.planHash).toBe(plan.planHash);
    expect(reorderedPlan.sourceFingerprint).toBe(plan.sourceFingerprint);
    expect(
      plan.documents.map(({ skillId, version, contentHash }) => ({
        skillId,
        version,
        contentHash,
      })),
    ).toEqual(
      dryRun.entries.map(({ skillId, version, contentHash }) => ({
        skillId,
        version,
        contentHash,
      })),
    );
    expect(
      plan.rows
        .filter(({ source }) => source.state !== 'built_in')
        .every(({ trust }) => trust === 'unreviewed'),
    ).toBe(true);
    expect(report).toMatchObject({
      ok: true,
      counts: {
        subjectCount: rows.length,
        classifiedCount: rows.length,
        targetRefCount: rows.length,
        byDisposition: { migrated_current_state: rows.length },
      },
      blockers: [],
    });
    expect(entries).toEqual(classify(rows));
    expect(entries.flatMap(({ targetRefs }) => targetRefs.map(({ id }) => id)).sort()).toEqual(
      plan.rows.map(({ skillId }) => skillId).sort(),
    );
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain('Private');
    expect(serialized).not.toContain('camera');

    const driftedRows = rows.map((candidate, index) =>
      index === 0
        ? { ...candidate, values: { ...candidate.values, name: 'Drifted private name' } }
        : candidate,
    );
    const drifted = classify(driftedRows);
    expect(drifted).toHaveLength(rows.length);
    expect(drifted.every(({ disposition }) => disposition === 'blocking_error')).toBe(true);
    expect(new Set(drifted.map(({ blockerCode }) => blockerCode))).toEqual(
      new Set(['legacy_skill_source_plan_mismatch']),
    );
  });

  it('round-trips every override/custom class and reruns deterministically unchanged', async () => {
    const builtIns = await buildBuiltInLegacySkills();
    const presetId = LegacySkillContentV1Schema.parse(
      JSON.parse(builtIns.find(({ skillId }) => skillId.startsWith('legacy.preset.'))!.content),
    ).source.logicalKey;
    const empty = await emptyBundle();
    const bundle = sealBundle({
      ...empty,
      rendererExport: rendererExport({
        builtInCustoms: { 'meta-prompt': 'Renderer override' },
        builtInNames: { 'meta-prompt': 'Renamed meta prompt' },
        customSkills: [
          {
            id: 'user-one',
            name: 'User one',
            category: 'user',
            customContent: 'Shared duplicate instruction',
            source: 'user' as const,
            createdAt: 1,
          },
          {
            id: 'user-two',
            name: 'User two',
            category: 'user',
            customContent: 'Shared duplicate instruction',
            source: 'user' as const,
            createdAt: 2,
          },
          {
            id: 'user-null',
            name: '',
            category: '',
            customContent: null,
            source: 'user' as const,
            createdAt: 3,
          },
          {
            id: 'user-empty',
            name: 'Empty renderer Skill',
            category: 'user',
            customContent: '',
            source: 'user' as const,
            createdAt: 4,
          },
        ],
      }),
      presetOverrides: [
        {
          id: `override:${presetId}`,
          presetId,
          category: 'camera',
          name: 'Preset override',
          description: '',
          prompt: 'Override prompt',
          params: [{ key: 'speed', options: ['slow', 'fast'] }],
          defaults: { speed: 'slow' },
          isUser: false,
          createdAt: 1,
          updatedAt: 2,
        },
        {
          id: 'custom-preset',
          presetId: 'custom-preset',
          category: 'look',
          name: 'Custom preset',
          description: 'Custom description',
          prompt: 'Custom prompt',
          params: [],
          defaults: {},
          isUser: true,
          createdAt: 1,
          updatedAt: 2,
        },
      ],
      customShotTemplates: [
        {
          id: 'custom-shot',
          name: 'Custom shot',
          description: 'Custom shot description',
          tracks: { camera: { entries: [{ order: 0, presetId: presetId }] } },
          createdAt: 1,
          updatedAt: 2,
        },
      ],
      processPromptOverrides: empty.processPromptOverrides.map((record) =>
        record.processKey === 'entity-ref-image-generation'
          ? { ...record, customValue: 'Process override', updatedAt: 2 }
          : record,
      ),
      promptTemplateOverrides: [{ code: 'agent-system', customValue: 'Template override' }],
    });
    const { host, calls } = recordingHost();
    const dryRun = await migrateLegacySkills({ mode: 'dry-run', bundle });
    const first = await migrateLegacySkills({
      mode: 'apply',
      bundle,
      host,
      expectedReportHash: dryRun.reportHash,
    });
    const second = await migrateLegacySkills({
      mode: 'apply',
      bundle,
      host,
      expectedReportHash: dryRun.reportHash,
    });
    expect(first.counts).toMatchObject({ builtIn: 287, dynamic: 10, total: 297 });
    expect(first.counts.quarantined).toBe(45);
    expect(first.entries.every(({ registration }) => registration === 'inserted')).toBe(true);
    expect(second.entries.every(({ registration }) => registration === 'unchanged')).toBe(true);
    expect(first.sourceFingerprint).toBe(second.sourceFingerprint);
    expect(calls[0]).toHaveLength(297);
    expect(new Set(calls[0]!.map(({ document }) => document.skillId)).size).toBeLessThan(297);
    expect(first.counts.duplicateInstructions).toBeGreaterThan(0);
    expect(
      first.entries
        .filter(({ source }) => source.state !== 'built_in')
        .every(
          ({ disposition, eligibleToEnable }) => disposition === 'quarantined' && !eligibleToEnable,
        ),
    ).toBe(true);

    const migratedRecords = calls[0]!
      .map(({ document }) => LegacySkillContentV1Schema.parse(JSON.parse(document.content)))
      .filter(({ source }) => source.state !== 'built_in');
    expect(
      migratedRecords.find(
        ({ source }) => source.kind === 'shot_template' && source.state === 'custom',
      )!.sourceRecord,
    ).toEqual(bundle.customShotTemplates[0]);
    expect(
      migratedRecords.find(({ source }) => source.kind === 'preset' && source.state === 'override')!
        .sourceRecord,
    ).toEqual(bundle.presetOverrides[0]);
    const nullableRenderer = migratedRecords.find(
      ({ source }) => source.kind === 'renderer_skill' && source.logicalKey === 'user-null',
    )!;
    expect(nullableRenderer.effectiveInstruction).toBe('');
    expect(nullableRenderer.sourceRecord).toEqual({
      id: 'user-null',
      name: '',
      category: '',
      customContent: null,
      source: 'user',
      createdAt: 3,
    });
  });

  it('stops on a missing renderer export, unmapped sources, and invalid payloads', async () => {
    const empty = await emptyBundle();
    const missingRenderer = { ...empty, rendererExport: undefined };
    await expect(
      migrateLegacySkills({ mode: 'dry-run', bundle: missingRenderer }),
    ).rejects.toThrow();

    const unmapped = sealBundle({
      ...empty,
      rendererExport: rendererExport({
        builtInCustoms: {},
        builtInNames: { missing: 'Missing' },
        customSkills: [],
      }),
    });
    await expect(migrateLegacySkills({ mode: 'dry-run', bundle: unmapped })).rejects.toThrow(
      'Unmapped legacy renderer_skill source',
    );

    const invalid = sealBundle({
      ...empty,
      rendererExport: rendererExport({
        builtInCustoms: {},
        builtInNames: {},
        customSkills: [
          {
            id: '',
            name: 'Bad',
            category: 'user',
            customContent: 'Invalid empty identity',
            source: 'user',
            createdAt: 0,
          },
        ],
      }),
    });
    await expect(migrateLegacySkills({ mode: 'dry-run', bundle: invalid })).rejects.toThrow();

    const overFiveHundred = sealBundle({
      ...empty,
      rendererExport: rendererExport({
        builtInCustoms: {},
        builtInNames: {},
        customSkills: Array.from({ length: 214 }, (_, index) => ({
          id: `custom-${index}`,
          name: `Custom ${index}`,
          category: 'user',
          customContent: `Instruction ${index}`,
          source: 'user' as const,
          createdAt: index,
        })),
      }),
    });
    await expect(
      migrateLegacySkills({ mode: 'dry-run', bundle: overFiveHundred }),
    ).resolves.toMatchObject({ counts: { total: 501 } });
  });
});
