import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  IsoTimestampSchema,
  JsonValueSchema,
  LegacySkillContentV1Schema,
  Sha256Schema,
  SkillDocumentSchema,
  canonicalJson,
  parseCanonical,
  strictObject,
  z,
  type SkillDocument,
} from '@lucid-fin/target-contracts';
import {
  legacyClassificationSourceKey,
  type LegacyClassificationEntryInput,
} from './classification-report.js';
import type { LegacyClassificationRow } from './classification-subjects.js';
import { legacySourceToSkill } from './legacy-skill-catalog.js';
import type { LegacySkillRowClassifier } from './root-row-classification.js';

const RendererCustomSkillSchema = strictObject({
  id: z.string().min(1).max(1_000),
  name: z.string().max(240),
  category: z.string().max(240),
  customContent: z.string().max(190_000).nullable(),
  source: z.enum(['promptTemplate', 'taskSkill', 'taskListGuide', 'user']),
  createdAt: z.number().int().nonnegative().finite(),
});

const RendererSkillsPayloadSchema = strictObject({
  builtInCustoms: z.record(z.string().min(1), z.string().max(190_000).nullable()),
  builtInNames: z.record(z.string().min(1), z.string().min(1).max(240)),
  customSkills: z.array(RendererCustomSkillSchema),
});

const RendererSkillsExportSchema = strictObject({
  storageKey: z.literal('lucid-skills-v2'),
  rawJson: z.string().min(1).max(8_000_000),
  rawHash: Sha256Schema,
});

const PresetOverrideSchema = strictObject({
  id: z.string().min(1).max(1_000),
  presetId: z.string().min(1).max(1_000),
  category: z.string().max(240),
  name: z.string().max(240),
  description: z.string().max(4_000).nullable(),
  prompt: z.string().max(190_000).nullable(),
  params: z.array(JsonValueSchema).nullable(),
  defaults: z.record(z.string(), JsonValueSchema).nullable(),
  isUser: z.boolean(),
  createdAt: z.number().int().nonnegative().finite(),
  updatedAt: z.number().int().nonnegative().finite(),
});

const CustomShotTemplateSchema = strictObject({
  id: z.string().min(1).max(1_000),
  name: z.string().min(1).max(240),
  description: z.string().max(4_000),
  tracks: z.record(z.string(), JsonValueSchema),
  createdAt: z.number().int().nonnegative().finite(),
  updatedAt: z.number().int().nonnegative().finite(),
});

const ProcessPromptOverrideSchema = strictObject({
  id: z.number().int().positive().finite(),
  processKey: z.string().min(1).max(1_000),
  name: z.string().min(1).max(240),
  description: z.string().max(4_000),
  defaultValue: z.string().max(190_000),
  customValue: z.string().max(190_000).nullable(),
  createdAt: z.number().int().nonnegative().finite(),
  updatedAt: z.number().int().nonnegative().finite(),
});

const PromptTemplateOverrideSchema = strictObject({
  code: z.string().min(1).max(1_000),
  customValue: z.string().max(190_000),
});

export const LegacySkillMigrationBundleV1Schema = strictObject({
  schema: z.literal('lucid-fin.legacy-skill-migration-bundle/v1'),
  cutoverAt: IsoTimestampSchema,
  databaseFingerprint: Sha256Schema,
  rendererExport: RendererSkillsExportSchema,
  presetOverrides: z.array(PresetOverrideSchema),
  customShotTemplates: z.array(CustomShotTemplateSchema),
  processPromptOverrides: z.array(ProcessPromptOverrideSchema),
  promptTemplateOverrides: z.array(PromptTemplateOverrideSchema),
});

export type LegacySkillMigrationBundleV1 = z.output<typeof LegacySkillMigrationBundleV1Schema>;

export interface LegacySkillMigrationReportEntry {
  readonly source: {
    readonly kind: string;
    readonly logicalKey: string;
    readonly state: string;
    readonly store: string;
  };
  readonly skillId: string;
  readonly version: string;
  readonly contentHash: string;
  readonly duplicateInstructionOf: string | null;
  readonly disposition: 'cataloged' | 'quarantined';
  readonly eligibleToEnable: boolean;
  readonly registration: 'planned' | 'inserted' | 'unchanged';
}

export interface LegacySkillMigrationReport {
  readonly schema: 'lucid-fin.legacy-skill-migration-report/v1';
  readonly mode: 'dry-run' | 'apply';
  readonly builtInPackHash: string;
  readonly sourceFingerprint: string;
  readonly reportHash: string;
  readonly counts: {
    readonly builtIn: number;
    readonly dynamic: number;
    readonly total: number;
    readonly duplicateInstructions: number;
    readonly quarantined: number;
  };
  readonly entries: readonly LegacySkillMigrationReportEntry[];
}

export const LegacySkillMigrationPlanRowSchema = strictObject({
  database: z.enum(['main', 'prompts']),
  table: z.enum([
    'preset_overrides',
    'custom_shot_templates',
    'process_prompts',
    't_prompt_overrides',
  ]),
  sourceRecordHash: Sha256Schema,
  source: strictObject({
    kind: z.string().min(1).max(120),
    logicalKey: z.string().min(1).max(1_000),
    state: z.string().min(1).max(120),
    store: z.string().min(1).max(1_000),
  }),
  skillId: z.string().min(1).max(200),
  version: z.string().min(1).max(200),
  contentHash: Sha256Schema,
  trust: z.enum(['trusted', 'reviewed', 'unreviewed']),
});

export const LegacySkillMigrationPlanSchema = strictObject({
  schema: z.literal('lucid-fin.legacy-skill-migration-plan/v1'),
  builtInCount: z.number().int().nonnegative().finite(),
  builtInPackHash: Sha256Schema,
  databaseFingerprint: Sha256Schema,
  sourceFingerprint: Sha256Schema,
  planHash: Sha256Schema,
  documents: z.array(SkillDocumentSchema),
  rows: z.array(LegacySkillMigrationPlanRowSchema),
});

export type LegacySkillMigrationPlanRow = z.output<typeof LegacySkillMigrationPlanRowSchema>;
export type LegacySkillMigrationPlan = z.output<typeof LegacySkillMigrationPlanSchema>;

export interface LegacySkillMigrationPlanAuthority {
  readonly builtInDocuments?: readonly SkillDocument[];
  readonly sourceBundle?: unknown;
  readonly expectedPlanHash?: string;
}

type BundleDatabaseRows = Pick<
  LegacySkillMigrationBundleV1,
  'presetOverrides' | 'customShotTemplates' | 'processPromptOverrides' | 'promptTemplateOverrides'
>;
type PresetOverride = z.output<typeof PresetOverrideSchema>;
type CustomShotTemplate = z.output<typeof CustomShotTemplateSchema>;
type ProcessPromptOverride = z.output<typeof ProcessPromptOverrideSchema>;
type PromptTemplateOverride = z.output<typeof PromptTemplateOverrideSchema>;
type LegacySqliteRow = Readonly<Record<string, unknown>>;

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareRecords<T>(left: T, right: T, key: (value: T) => string): number {
  return (
    compareText(key(left), key(right)) || compareText(canonicalJson(left), canonicalJson(right))
  );
}

function orderedBundleDatabaseRows(rows: BundleDatabaseRows): BundleDatabaseRows {
  return {
    presetOverrides: [...rows.presetOverrides].sort((left, right) =>
      compareRecords(left, right, ({ id }) => id),
    ),
    customShotTemplates: [...rows.customShotTemplates].sort((left, right) =>
      compareRecords(left, right, ({ id }) => id),
    ),
    processPromptOverrides: [...rows.processPromptOverrides].sort((left, right) =>
      compareRecords(left, right, ({ processKey }) => processKey),
    ),
    promptTemplateOverrides: [...rows.promptTemplateOverrides].sort((left, right) =>
      compareRecords(left, right, ({ code }) => code),
    ),
  };
}

export function legacySkillDatabaseFingerprint(rows: BundleDatabaseRows): string {
  const ordered = orderedBundleDatabaseRows(rows);
  return sha256(
    canonicalJson({
      customShotTemplates: ordered.customShotTemplates,
      presetOverrides: ordered.presetOverrides,
      processPromptOverrides: ordered.processPromptOverrides,
      promptTemplateOverrides: ordered.promptTemplateOverrides,
    }),
  );
}

function parseJsonColumn<T>(raw: string | null, schema: z.ZodType<T>, label: string): T | null {
  if (raw === null) return null;
  try {
    return parseCanonical(schema, JSON.parse(raw));
  } catch (cause) {
    throw new Error(`Legacy database column ${label} is invalid JSON`, { cause });
  }
}

function sqliteText(value: unknown, label: string, nullable = false): string | null {
  if (value === null && nullable) return null;
  if (typeof value !== 'string') {
    throw new Error(`${label} must be text${nullable ? ' or null' : ''}`);
  }
  return value;
}

function sqliteInteger(value: unknown, label: string): number {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value;
  if (
    typeof value === 'bigint' &&
    value >= BigInt(Number.MIN_SAFE_INTEGER) &&
    value <= BigInt(Number.MAX_SAFE_INTEGER)
  ) {
    return Number(value);
  }
  throw new Error(`${label} must be a safe integer`);
}

function normalizePresetOverride(row: LegacySqliteRow): PresetOverride {
  const id = sqliteText(row.id, 'preset_overrides.id')!;
  const isUser = sqliteInteger(row.is_user, `preset_overrides.${id}.is_user`);
  return parseCanonical(PresetOverrideSchema, {
    id,
    presetId: sqliteText(row.preset_id, `preset_overrides.${id}.preset_id`),
    category: sqliteText(row.category, `preset_overrides.${id}.category`),
    name: sqliteText(row.name, `preset_overrides.${id}.name`),
    description: sqliteText(row.description, `preset_overrides.${id}.description`, true),
    prompt: sqliteText(row.prompt, `preset_overrides.${id}.prompt`, true),
    params: parseJsonColumn(
      sqliteText(row.params, `preset_overrides.${id}.params`, true),
      z.array(JsonValueSchema),
      `preset_overrides.${id}.params`,
    ),
    defaults: parseJsonColumn(
      sqliteText(row.defaults, `preset_overrides.${id}.defaults`, true),
      z.record(z.string(), JsonValueSchema),
      `preset_overrides.${id}.defaults`,
    ),
    isUser:
      isUser === 0
        ? false
        : isUser === 1
          ? true
          : (() => {
              throw new Error(`preset_overrides.${id}.is_user must be 0 or 1`);
            })(),
    createdAt: sqliteInteger(row.created_at, `preset_overrides.${id}.created_at`),
    updatedAt: sqliteInteger(row.updated_at, `preset_overrides.${id}.updated_at`),
  });
}

function normalizeCustomShotTemplate(row: LegacySqliteRow): CustomShotTemplate {
  const id = sqliteText(row.id, 'custom_shot_templates.id')!;
  return parseCanonical(CustomShotTemplateSchema, {
    id,
    name: sqliteText(row.name, `custom_shot_templates.${id}.name`),
    description: sqliteText(row.description, `custom_shot_templates.${id}.description`),
    tracks:
      parseJsonColumn(
        sqliteText(row.tracks_json, `custom_shot_templates.${id}.tracks_json`, true),
        z.record(z.string(), JsonValueSchema),
        `custom_shot_templates.${id}.tracks_json`,
      ) ?? {},
    createdAt: sqliteInteger(row.created_at, `custom_shot_templates.${id}.created_at`),
    updatedAt: sqliteInteger(row.updated_at, `custom_shot_templates.${id}.updated_at`),
  });
}

function normalizeProcessPromptOverride(row: LegacySqliteRow): ProcessPromptOverride {
  const processKey = sqliteText(row.process_key, 'process_prompts.process_key')!;
  return parseCanonical(ProcessPromptOverrideSchema, {
    id: sqliteInteger(row.id, `process_prompts.${processKey}.id`),
    processKey,
    name: sqliteText(row.name, `process_prompts.${processKey}.name`),
    description: sqliteText(row.description, `process_prompts.${processKey}.description`),
    defaultValue: sqliteText(row.default_value, `process_prompts.${processKey}.default_value`),
    customValue: sqliteText(row.custom_value, `process_prompts.${processKey}.custom_value`, true),
    createdAt: sqliteInteger(row.created_at, `process_prompts.${processKey}.created_at`),
    updatedAt: sqliteInteger(row.updated_at, `process_prompts.${processKey}.updated_at`),
  });
}

function normalizePromptTemplateOverride(row: LegacySqliteRow): PromptTemplateOverride {
  const code = sqliteText(row.code, 't_prompt_overrides.code')!;
  return parseCanonical(PromptTemplateOverrideSchema, {
    code,
    customValue: sqliteText(row.customValue, `t_prompt_overrides.${code}.customValue`),
  });
}

function parseBundleDatabaseRows(rows: BundleDatabaseRows): BundleDatabaseRows {
  return parseCanonical(
    strictObject({
      presetOverrides: z.array(PresetOverrideSchema),
      customShotTemplates: z.array(CustomShotTemplateSchema),
      processPromptOverrides: z.array(ProcessPromptOverrideSchema),
      promptTemplateOverrides: z.array(PromptTemplateOverrideSchema),
    }),
    rows,
  );
}

/** Reads only the four Legacy Skill stores and returns normalized source facts. */
export function composeLegacySkillMigrationBundle(options: {
  readonly legacyDatabasePath: string;
  readonly legacyPromptDatabasePath: string;
  readonly rendererExport: unknown;
  readonly cutoverAt: string;
}): LegacySkillMigrationBundleV1 {
  const rendererExport = parseCanonical(RendererSkillsExportSchema, options.rendererExport);
  if (sha256(rendererExport.rawJson) !== rendererExport.rawHash) {
    throw new Error('Renderer legacy export rawHash does not match rawJson');
  }
  parseCanonical(RendererSkillsPayloadSchema, JSON.parse(rendererExport.rawJson));
  const legacy = new DatabaseSync(resolve(options.legacyDatabasePath), { readOnly: true });
  const prompts = new DatabaseSync(resolve(options.legacyPromptDatabasePath), { readOnly: true });
  try {
    const presetOverrides = legacy
      .prepare(
        `SELECT id, preset_id, category, name, description, prompt, params, defaults,
                is_user, created_at, updated_at
         FROM preset_overrides ORDER BY id`,
      )
      .all()
      .map((row) => normalizePresetOverride(row as LegacySqliteRow));
    const customShotTemplates = legacy
      .prepare(
        `SELECT id, name, description, tracks_json, created_at, updated_at
         FROM custom_shot_templates ORDER BY id`,
      )
      .all()
      .map((row) => normalizeCustomShotTemplate(row as LegacySqliteRow));
    const processPromptOverrides = prompts
      .prepare(
        `SELECT id, process_key, name, description, default_value, custom_value,
                created_at, updated_at
         FROM process_prompts ORDER BY process_key`,
      )
      .all()
      .map((row) => normalizeProcessPromptOverride(row as LegacySqliteRow));
    const promptTemplateOverrides = prompts
      .prepare('SELECT code, customValue FROM t_prompt_overrides ORDER BY code')
      .all()
      .map((row) => normalizePromptTemplateOverride(row as LegacySqliteRow));
    const databaseRows = parseBundleDatabaseRows({
      presetOverrides,
      customShotTemplates,
      processPromptOverrides,
      promptTemplateOverrides,
    });
    return parseCanonical(LegacySkillMigrationBundleV1Schema, {
      schema: 'lucid-fin.legacy-skill-migration-bundle/v1',
      cutoverAt: parseCanonical(IsoTimestampSchema, options.cutoverAt),
      databaseFingerprint: legacySkillDatabaseFingerprint(databaseRows),
      rendererExport,
      ...databaseRows,
    });
  } finally {
    legacy.close();
    prompts.close();
  }
}

function rendererPayload(rendererExport: LegacySkillMigrationBundleV1['rendererExport']) {
  if (sha256(rendererExport.rawJson) !== rendererExport.rawHash) {
    throw new Error('Renderer legacy export rawHash does not match rawJson');
  }
  try {
    return parseCanonical(RendererSkillsPayloadSchema, JSON.parse(rendererExport.rawJson));
  } catch (cause) {
    throw new Error('Renderer legacy export rawJson is invalid', { cause });
  }
}

function orderedBuiltInDocuments(documents: readonly SkillDocument[]): readonly SkillDocument[] {
  return Object.freeze(
    documents
      .map((document) => parseCanonical(SkillDocumentSchema, document))
      .sort(
        (left, right) =>
          compareText(left.skillId, right.skillId) || compareText(left.version, right.version),
      ),
  );
}

function builtInBySource(skills: readonly SkillDocument[]) {
  const sources = new Map<
    string,
    {
      readonly document: SkillDocument;
      readonly envelope: z.output<typeof LegacySkillContentV1Schema>;
    }
  >();
  for (const document of skills) {
    const envelope = parseCanonical(LegacySkillContentV1Schema, JSON.parse(document.content));
    if (envelope.source.state !== 'built_in') {
      throw new Error(`Legacy Skill catalog source must be built_in: ${document.skillId}`);
    }
    const key = `${envelope.source.kind}\u0000${envelope.source.logicalKey}`;
    if (sources.has(key)) throw new Error(`Duplicate built-in Legacy Skill source: ${key}`);
    sources.set(key, { document, envelope });
  }
  return sources;
}

function requireBuiltIn(
  builtIns: ReturnType<typeof builtInBySource>,
  kind: string,
  logicalKey: string,
) {
  const source = builtIns.get(`${kind}\u0000${logicalKey}`);
  if (source === undefined) {
    throw new Error(`Unmapped legacy ${kind} source: ${logicalKey}`);
  }
  return source;
}

function assertUniqueSources(documents: readonly SkillDocument[]): void {
  const sources = new Set<string>();
  for (const document of documents) {
    const source = LegacySkillContentV1Schema.parse(JSON.parse(document.content)).source;
    const key = `${source.kind}\u0000${source.logicalKey}\u0000${source.state}`;
    if (sources.has(key)) throw new Error(`Duplicate legacy migration source: ${key}`);
    sources.add(key);
  }
}

function migrationDocuments(
  bundleValue: unknown,
  builtInDocuments: readonly SkillDocument[],
): {
  readonly builtInCount: number;
  readonly builtInPackHash: string;
  readonly bundle: LegacySkillMigrationBundleV1;
  readonly documents: readonly SkillDocument[];
  readonly sourceFingerprint: string;
} {
  const bundle = parseCanonical(LegacySkillMigrationBundleV1Schema, bundleValue);
  if (legacySkillDatabaseFingerprint(bundle) !== bundle.databaseFingerprint) {
    throw new Error('Legacy databaseFingerprint does not match normalized database rows');
  }
  const renderer = rendererPayload(bundle.rendererExport);
  const builtIns = orderedBuiltInDocuments(builtInDocuments);
  const builtInPackHash = sha256(canonicalJson(builtIns));
  const sourceMap = builtInBySource(builtIns);
  const expectedProcessKeys = [...sourceMap.values()]
    .filter(({ envelope }) => envelope.source.kind === 'process_prompt')
    .map(({ envelope }) => envelope.source.logicalKey)
    .sort(compareText);
  const databaseProcessKeys = bundle.processPromptOverrides
    .map(({ processKey }) => processKey)
    .sort(compareText);
  if (canonicalJson(databaseProcessKeys) !== canonicalJson(expectedProcessKeys)) {
    throw new Error('Legacy process_prompts source drift: expected the exact 21 built-in keys');
  }
  const dynamic: SkillDocument[] = [];

  for (const sourceRecord of bundle.presetOverrides) {
    const builtIn = sourceRecord.isUser
      ? undefined
      : requireBuiltIn(sourceMap, 'preset', sourceRecord.presetId);
    dynamic.push(
      legacySourceToSkill({
        kind: 'preset',
        logicalKey: sourceRecord.isUser ? sourceRecord.id : sourceRecord.presetId,
        state: sourceRecord.isUser ? 'custom' : 'override',
        store: 'preset_overrides',
        name: sourceRecord.name || builtIn?.document.name || `Legacy preset ${sourceRecord.id}`,
        description:
          sourceRecord.description ||
          builtIn?.document.description ||
          `Legacy preset ${sourceRecord.name}.`,
        effectiveInstruction: sourceRecord.prompt ?? builtIn?.envelope.effectiveInstruction ?? '',
        sourceRecord,
        createdAt: bundle.cutoverAt,
        provenance: 'installed',
        trust: 'unreviewed',
      }),
    );
  }
  for (const sourceRecord of bundle.customShotTemplates) {
    dynamic.push(
      legacySourceToSkill({
        kind: 'shot_template',
        logicalKey: sourceRecord.id,
        state: 'custom',
        store: 'custom_shot_templates',
        name: sourceRecord.name,
        description: sourceRecord.description || `Legacy shot template ${sourceRecord.name}.`,
        effectiveInstruction: sourceRecord.description,
        sourceRecord,
        createdAt: bundle.cutoverAt,
        provenance: 'installed',
        trust: 'unreviewed',
      }),
    );
  }
  for (const sourceRecord of bundle.processPromptOverrides) {
    requireBuiltIn(sourceMap, 'process_prompt', sourceRecord.processKey);
    if (sourceRecord.customValue === null) continue;
    dynamic.push(
      legacySourceToSkill({
        kind: 'process_prompt',
        logicalKey: sourceRecord.processKey,
        state: 'override',
        store: 'process_prompts',
        name: sourceRecord.name,
        description: sourceRecord.description || `Legacy process prompt ${sourceRecord.name}.`,
        effectiveInstruction: sourceRecord.customValue,
        sourceRecord,
        createdAt: bundle.cutoverAt,
        provenance: 'installed',
        trust: 'unreviewed',
      }),
    );
  }
  for (const sourceRecord of bundle.promptTemplateOverrides) {
    const builtIn = requireBuiltIn(sourceMap, 'prompt_template', sourceRecord.code);
    dynamic.push(
      legacySourceToSkill({
        kind: 'prompt_template',
        logicalKey: sourceRecord.code,
        state: 'override',
        store: 't_prompt_overrides',
        name: builtIn.document.name,
        description: builtIn.document.description,
        effectiveInstruction: sourceRecord.customValue,
        sourceRecord,
        createdAt: bundle.cutoverAt,
        provenance: 'installed',
        trust: 'unreviewed',
      }),
    );
  }

  const rendererBuiltIns = new Map(
    [...sourceMap.values()]
      .filter(({ envelope }) => envelope.source.kind === 'renderer_skill')
      .map((source) => [source.envelope.source.logicalKey, source]),
  );
  const rendererKeys = new Set([
    ...Object.keys(renderer.builtInCustoms),
    ...Object.keys(renderer.builtInNames),
  ]);
  for (const logicalKey of [...rendererKeys].sort(compareText)) {
    const builtIn = rendererBuiltIns.get(logicalKey);
    if (builtIn === undefined) {
      throw new Error(`Unmapped legacy renderer_skill source: ${logicalKey}`);
    }
    const customContent = renderer.builtInCustoms[logicalKey];
    const customName = renderer.builtInNames[logicalKey];
    if (customContent === null && customName === undefined) continue;
    const original = builtIn.envelope.sourceRecord as { [key: string]: unknown };
    const sourceRecord = {
      id: logicalKey,
      name: customName ?? builtIn.document.name,
      category: original.category,
      customContent: customContent ?? null,
      source: original.source,
    };
    dynamic.push(
      legacySourceToSkill({
        kind: 'renderer_skill',
        logicalKey,
        state: 'override',
        store: 'renderer.localStorage[lucid-skills-v2]',
        name: sourceRecord.name,
        description: builtIn.document.description,
        effectiveInstruction: customContent ?? builtIn.envelope.effectiveInstruction,
        sourceRecord,
        createdAt: bundle.cutoverAt,
        provenance: 'installed',
        trust: 'unreviewed',
      }),
    );
  }
  for (const sourceRecord of renderer.customSkills) {
    if (rendererBuiltIns.has(sourceRecord.id)) {
      throw new Error(`Renderer custom Skill reuses built-in ID: ${sourceRecord.id}`);
    }
    dynamic.push(
      legacySourceToSkill({
        kind: 'renderer_skill',
        logicalKey: sourceRecord.id,
        state: 'custom',
        store: 'renderer.localStorage[lucid-skills-v2]',
        name: sourceRecord.name || `Legacy renderer Skill ${sourceRecord.id}`,
        description: sourceRecord.category
          ? `Legacy user renderer Skill in category ${sourceRecord.category}.`
          : 'Legacy user renderer Skill.',
        effectiveInstruction: sourceRecord.customContent ?? '',
        sourceRecord,
        createdAt: bundle.cutoverAt,
        provenance: 'installed',
        trust: 'unreviewed',
      }),
    );
  }

  const documents = [
    ...builtIns,
    ...dynamic.sort(
      (left, right) =>
        compareText(left.skillId, right.skillId) || compareText(left.version, right.version),
    ),
  ];
  assertUniqueSources(documents);
  return {
    builtInCount: builtIns.length,
    builtInPackHash,
    bundle,
    documents,
    sourceFingerprint: sha256(
      canonicalJson({
        builtInPackHash,
        bundle: { ...bundle, ...orderedBundleDatabaseRows(bundle) },
      }),
    ),
  };
}

function migrationSourceKey(
  source: Pick<LegacySkillMigrationReportEntry['source'], 'kind' | 'logicalKey' | 'state'>,
): string {
  return `${source.kind}\u0000${source.logicalKey}\u0000${source.state}`;
}

function planHashInput(
  plan: Readonly<{
    schema: LegacySkillMigrationPlan['schema'];
    builtInCount: number;
    builtInPackHash: string;
    databaseFingerprint: string;
    sourceFingerprint: string;
    documents: readonly SkillDocument[];
    rows: readonly LegacySkillMigrationPlanRow[];
  }>,
) {
  return {
    schema: plan.schema,
    builtInCount: plan.builtInCount,
    builtInPackHash: plan.builtInPackHash,
    databaseFingerprint: plan.databaseFingerprint,
    sourceFingerprint: plan.sourceFingerprint,
    documents: plan.documents,
    rows: plan.rows,
  };
}

/** Constructs a deterministic plan from normalized source data and an immutable catalog. */
export function planLegacySkillMigration(
  bundleValue: unknown,
  builtInDocuments: readonly SkillDocument[],
): LegacySkillMigrationPlan {
  const { builtInCount, builtInPackHash, bundle, documents, sourceFingerprint } =
    migrationDocuments(bundleValue, builtInDocuments);
  const documentsBySource = new Map(
    documents.map((document) => {
      const envelope = LegacySkillContentV1Schema.parse(JSON.parse(document.content));
      return [migrationSourceKey(envelope.source), { document, source: envelope.source }] as const;
    }),
  );
  const row = (
    database: LegacySkillMigrationPlanRow['database'],
    table: LegacySkillMigrationPlanRow['table'],
    sourceRecord: unknown,
    kind: string,
    logicalKey: string,
    state: string,
  ): LegacySkillMigrationPlanRow => {
    const target = documentsBySource.get(migrationSourceKey({ kind, logicalKey, state }));
    if (target === undefined) {
      throw new Error(`Legacy Skill migration target is missing: ${kind}/${logicalKey}/${state}`);
    }
    return {
      database,
      table,
      sourceRecordHash: sha256(canonicalJson(sourceRecord)),
      source: target.source,
      skillId: target.document.skillId,
      version: target.document.version,
      contentHash: target.document.contentHash,
      trust: target.document.trust,
    };
  };
  const rows = [
    ...bundle.presetOverrides.map((record) =>
      row(
        'main',
        'preset_overrides',
        record,
        'preset',
        record.isUser ? record.id : record.presetId,
        record.isUser ? 'custom' : 'override',
      ),
    ),
    ...bundle.customShotTemplates.map((record) =>
      row('main', 'custom_shot_templates', record, 'shot_template', record.id, 'custom'),
    ),
    ...bundle.processPromptOverrides.map((record) =>
      row(
        'prompts',
        'process_prompts',
        record,
        'process_prompt',
        record.processKey,
        record.customValue === null ? 'built_in' : 'override',
      ),
    ),
    ...bundle.promptTemplateOverrides.map((record) =>
      row('prompts', 't_prompt_overrides', record, 'prompt_template', record.code, 'override'),
    ),
  ].sort(
    (left, right) =>
      compareText(left.database, right.database) ||
      compareText(left.table, right.table) ||
      compareText(left.sourceRecordHash, right.sourceRecordHash),
  );
  const withoutHash = {
    schema: 'lucid-fin.legacy-skill-migration-plan/v1' as const,
    builtInCount,
    builtInPackHash,
    databaseFingerprint: bundle.databaseFingerprint,
    sourceFingerprint,
    documents,
    rows,
  };
  return parseCanonical(LegacySkillMigrationPlanSchema, {
    ...withoutHash,
    planHash: sha256(canonicalJson(planHashInput(withoutHash))),
  });
}

/** Parses a plan and rejects any document, row, source, or authority drift. */
export function validateLegacySkillMigrationPlan(
  planValue: unknown,
  authority: LegacySkillMigrationPlanAuthority = {},
): LegacySkillMigrationPlan {
  const plan = parseCanonical(LegacySkillMigrationPlanSchema, planValue);
  const { planHash: _planHash, ...withoutHash } = plan;
  if (sha256(canonicalJson(planHashInput(withoutHash))) !== plan.planHash) {
    throw new Error('Legacy Skill migration plan hash does not match');
  }
  if (authority.expectedPlanHash !== undefined && authority.expectedPlanHash !== plan.planHash) {
    throw new Error('Legacy Skill migration plan hash does not match the approved hash');
  }
  if (plan.builtInCount > plan.documents.length) {
    throw new Error('Legacy Skill migration builtInCount exceeds its document count');
  }

  const documents = new Map<
    string,
    {
      readonly document: SkillDocument;
      readonly source: z.output<typeof LegacySkillContentV1Schema>['source'];
    }
  >();
  const sources = new Set<string>();
  for (const [index, document] of plan.documents.entries()) {
    const envelope = parseCanonical(LegacySkillContentV1Schema, JSON.parse(document.content));
    const identity = `${document.skillId}\u0000${document.version}`;
    if (documents.has(identity)) {
      throw new Error(`Duplicate Legacy Skill migration document: ${identity}`);
    }
    const sourceKey = migrationSourceKey(envelope.source);
    if (sources.has(sourceKey)) {
      throw new Error(`Duplicate legacy migration source: ${sourceKey}`);
    }
    sources.add(sourceKey);
    documents.set(identity, { document, source: envelope.source });
    const builtIn = index < plan.builtInCount;
    if (builtIn && (envelope.source.state !== 'built_in' || document.provenance !== 'built_in')) {
      throw new Error('Legacy Skill migration built-in partition contains a dynamic document');
    }
    if (!builtIn && document.trust !== 'unreviewed') {
      throw new Error('Dynamic Legacy Skill documents must remain unreviewed');
    }
    if (!builtIn && (envelope.source.state === 'built_in' || document.provenance !== 'installed')) {
      throw new Error('Legacy Skill migration dynamic partition has invalid provenance');
    }
  }

  const builtIns = plan.documents.slice(0, plan.builtInCount);
  if (canonicalJson(orderedBuiltInDocuments(builtIns)) !== canonicalJson(builtIns)) {
    throw new Error('Legacy Skill migration built-in documents are not canonically ordered');
  }
  if (sha256(canonicalJson(builtIns)) !== plan.builtInPackHash) {
    throw new Error('Legacy Skill migration built-in pack hash does not match its documents');
  }

  const rowKeys = new Set<string>();
  for (const row of plan.rows) {
    const rowKey = `${row.database}\u0000${row.table}\u0000${row.sourceRecordHash}`;
    if (rowKeys.has(rowKey)) throw new Error(`Duplicate Legacy Skill migration plan row: ${rowKey}`);
    rowKeys.add(rowKey);
    const target = documents.get(`${row.skillId}\u0000${row.version}`);
    if (
      target === undefined ||
      target.document.contentHash !== row.contentHash ||
      target.document.trust !== row.trust ||
      canonicalJson(target.source) !== canonicalJson(row.source)
    ) {
      throw new Error(`Legacy Skill migration row target does not match its document: ${rowKey}`);
    }
  }

  if (authority.builtInDocuments !== undefined) {
    const canonicalBuiltIns = orderedBuiltInDocuments(authority.builtInDocuments);
    if (canonicalJson(canonicalBuiltIns) !== canonicalJson(builtIns)) {
      throw new Error('Legacy Skill migration built-in documents do not match the canonical pack');
    }
  }
  if (authority.sourceBundle !== undefined) {
    if (authority.builtInDocuments === undefined) {
      throw new Error('Legacy Skill migration source validation requires canonical built-ins');
    }
    const expected = planLegacySkillMigration(authority.sourceBundle, authority.builtInDocuments);
    if (canonicalJson(expected) !== canonicalJson(plan)) {
      throw new Error('Legacy Skill migration plan does not match its canonical source bundle');
    }
  }
  return plan;
}

type NormalizedClassificationRow =
  | {
      readonly row: LegacyClassificationRow;
      readonly collection: 'presetOverrides';
      readonly record: PresetOverride;
    }
  | {
      readonly row: LegacyClassificationRow;
      readonly collection: 'customShotTemplates';
      readonly record: CustomShotTemplate;
    }
  | {
      readonly row: LegacyClassificationRow;
      readonly collection: 'processPromptOverrides';
      readonly record: ProcessPromptOverride;
    }
  | {
      readonly row: LegacyClassificationRow;
      readonly collection: 'promptTemplateOverrides';
      readonly record: PromptTemplateOverride;
    };

function normalizeClassificationRow(row: LegacyClassificationRow): NormalizedClassificationRow {
  if (row.subject.path !== '$') {
    throw new Error(`Legacy Skill row path must be root: ${row.subject.path}`);
  }
  if (row.database === 'main' && row.table === 'preset_overrides') {
    return { row, collection: 'presetOverrides', record: normalizePresetOverride(row.values) };
  }
  if (row.database === 'main' && row.table === 'custom_shot_templates') {
    return {
      row,
      collection: 'customShotTemplates',
      record: normalizeCustomShotTemplate(row.values),
    };
  }
  if (row.database === 'prompts' && row.table === 'process_prompts') {
    return {
      row,
      collection: 'processPromptOverrides',
      record: normalizeProcessPromptOverride(row.values),
    };
  }
  if (row.database === 'prompts' && row.table === 't_prompt_overrides') {
    return {
      row,
      collection: 'promptTemplateOverrides',
      record: normalizePromptTemplateOverride(row.values),
    };
  }
  throw new Error(`Unsupported Legacy Skill row: ${row.database}.${row.table}`);
}

function classificationDatabaseRows(
  rows: readonly NormalizedClassificationRow[],
): BundleDatabaseRows {
  const presetOverrides: PresetOverride[] = [];
  const customShotTemplates: CustomShotTemplate[] = [];
  const processPromptOverrides: ProcessPromptOverride[] = [];
  const promptTemplateOverrides: PromptTemplateOverride[] = [];
  for (const row of rows) {
    if (row.collection === 'presetOverrides') presetOverrides.push(row.record);
    else if (row.collection === 'customShotTemplates') customShotTemplates.push(row.record);
    else if (row.collection === 'processPromptOverrides') processPromptOverrides.push(row.record);
    else promptTemplateOverrides.push(row.record);
  }
  return parseBundleDatabaseRows(
    orderedBundleDatabaseRows({
      presetOverrides,
      customShotTemplates,
      processPromptOverrides,
      promptTemplateOverrides,
    }),
  );
}

function planRowKey(database: string, table: string, sourceRecordHash: string): string {
  return `${database}\u0000${table}\u0000${sourceRecordHash}`;
}

function blockingSkillRow(
  row: LegacyClassificationRow,
  blockerCode: string,
): LegacyClassificationEntryInput {
  return {
    subject: row.subject,
    disposition: 'blocking_error',
    reasonCode: blockerCode,
    targetRefs: [],
    exportRef: null,
    blockerCode,
  };
}

/** Binds a frozen plan to exactly the normalized Legacy rows it covers. */
export function createLegacySkillRowClassifier(planValue: unknown): LegacySkillRowClassifier {
  const plan = validateLegacySkillMigrationPlan(planValue);
  const planRows = new Map<string, LegacySkillMigrationPlanRow>();
  for (const row of plan.rows) {
    const key = planRowKey(row.database, row.table, row.sourceRecordHash);
    if (planRows.has(key)) throw new Error(`Duplicate Legacy Skill migration plan row: ${key}`);
    planRows.set(key, row);
  }

  return (rows) => {
    const states = rows.map((row) => {
      try {
        return { row, normalized: normalizeClassificationRow(row), invalid: false as const };
      } catch {
        return { row, normalized: null, invalid: true as const };
      }
    });
    const normalized = states.flatMap((state) =>
      state.normalized === null ? [] : [state.normalized],
    );
    const databaseFingerprint =
      normalized.length === states.length
        ? legacySkillDatabaseFingerprint(classificationDatabaseRows(normalized))
        : null;
    const fingerprintMatches = databaseFingerprint === plan.databaseFingerprint;
    const matchCounts = new Map<string, number>();
    for (const state of states) {
      if (state.normalized === null) continue;
      const key = planRowKey(
        state.row.database,
        state.row.table,
        sha256(canonicalJson(state.normalized.record)),
      );
      matchCounts.set(key, (matchCounts.get(key) ?? 0) + 1);
    }

    return states
      .map((state): LegacyClassificationEntryInput => {
        if (state.invalid || state.normalized === null) {
          return blockingSkillRow(state.row, 'invalid_legacy_skill_source_row');
        }
        if (!fingerprintMatches) {
          return blockingSkillRow(state.row, 'legacy_skill_source_plan_mismatch');
        }
        const key = planRowKey(
          state.row.database,
          state.row.table,
          sha256(canonicalJson(state.normalized.record)),
        );
        const target = planRows.get(key);
        if (target === undefined) {
          return blockingSkillRow(state.row, 'unresolved_legacy_skill_target');
        }
        if (matchCounts.get(key) !== 1) {
          return blockingSkillRow(state.row, 'duplicate_legacy_skill_source');
        }
        return {
          subject: state.row.subject,
          disposition: 'migrated_current_state',
          reasonCode: 'legacy_skill_catalog_entry',
          targetRefs: [{ authority: 'skill', id: target.skillId, projectId: null }],
          exportRef: null,
          blockerCode: null,
        };
      })
      .sort((left, right) =>
        compareText(
          legacyClassificationSourceKey(left.subject),
          legacyClassificationSourceKey(right.subject),
        ),
      );
  };
}

/** Builds the non-mutating report consumed by dry-run and apply callers. */
export function reportLegacySkillMigration(options: {
  readonly mode: LegacySkillMigrationReport['mode'];
  readonly plan: unknown;
  readonly registrations: readonly LegacySkillMigrationReportEntry['registration'][];
}): LegacySkillMigrationReport {
  const plan = validateLegacySkillMigrationPlan(options.plan);
  if (options.registrations.length !== plan.documents.length) {
    throw new Error('Legacy Skill migration report registration count does not match the plan');
  }
  const firstByInstruction = new Map<string, string>();
  const latestBySkill = new Map<string, SkillDocument>();
  for (const document of plan.documents) latestBySkill.set(document.skillId, document);
  const entries = plan.documents.map((document, index): LegacySkillMigrationReportEntry => {
    const envelope = LegacySkillContentV1Schema.parse(JSON.parse(document.content));
    const instructionHash = sha256(envelope.effectiveInstruction);
    const duplicateInstructionOf = firstByInstruction.get(instructionHash) ?? null;
    firstByInstruction.set(
      instructionHash,
      firstByInstruction.get(instructionHash) ?? document.skillId,
    );
    const quarantined = document.trust === 'unreviewed';
    return {
      source: envelope.source,
      skillId: document.skillId,
      version: document.version,
      contentHash: document.contentHash,
      duplicateInstructionOf,
      disposition: quarantined ? 'quarantined' : 'cataloged',
      eligibleToEnable: !quarantined && latestBySkill.get(document.skillId) === document,
      registration: options.registrations[index]!,
    };
  });
  const withoutHash = {
    schema: 'lucid-fin.legacy-skill-migration-report/v1' as const,
    mode: options.mode,
    builtInPackHash: plan.builtInPackHash,
    sourceFingerprint: plan.sourceFingerprint,
    counts: {
      builtIn: plan.builtInCount,
      dynamic: plan.documents.length - plan.builtInCount,
      total: plan.documents.length,
      duplicateInstructions: entries.filter(({ duplicateInstructionOf }) => duplicateInstructionOf)
        .length,
      quarantined: entries.filter(({ disposition }) => disposition === 'quarantined').length,
    },
    entries,
  };
  const hashInput = {
    schema: withoutHash.schema,
    builtInPackHash: withoutHash.builtInPackHash,
    sourceFingerprint: withoutHash.sourceFingerprint,
    counts: withoutHash.counts,
    entries: entries.map(({ registration: _registration, ...entry }) => entry),
  };
  return Object.freeze({ ...withoutHash, reportHash: sha256(canonicalJson(hashInput)) });
}
