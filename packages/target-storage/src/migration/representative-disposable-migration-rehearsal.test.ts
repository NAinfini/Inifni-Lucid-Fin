import { createHash } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { canonicalJson, type SkillDocument } from '@lucid-fin/target-contracts';
import { openTargetStore as openTargetStoreForReplay } from '@lucid-fin/target-storage';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { SCHEMA_SQL } from '../../../storage/src/schema-sql.js';
import { loadCanvasByProject } from '../internal/canvas-records.js';
import { loadMessage } from '../internal/conversation-write.js';
import { getTargetStoreDatabase } from '../internal/database-access.js';
import { createFilesystemMediaCas } from '../internal/filesystem-media-cas.js';
import { hashCanonical } from '../internal/hashes.js';
import { loadProjectMediaRecord } from '../internal/media-records.js';
import { openTargetStore } from '../kernel/store.js';
import { buildLegacyMigrationPlan } from './legacy-migration-plan.js';
import { legacySourceToSkill } from './legacy-skill-catalog.js';
import {
  createLegacySkillRowClassifier,
  legacySkillDatabaseFingerprint,
  planLegacySkillMigration,
  type LegacySkillMigrationBundleV1,
  type LegacySkillMigrationPlan,
} from './legacy-skill-migration.js';
import {
  LEGACY_BROWSER_STATE_KEYS,
  captureLegacyBrowserState,
  createLegacyBrowserStateSnapshot,
  type LegacyBrowserStateSnapshot,
} from './legacy-browser-state.js';
import { rehearseDisposableLegacyMigration } from './legacy-migration-rehearsal.js';
import { I0_LEGACY_SOURCE_SCHEMAS } from './legacy-source-schema.js';
import { preflightLegacyInputs, type LegacyPreflightPaths } from './legacy-preflight.js';
import { buildLegacyMigrationReadinessReport } from './migration-readiness.js';
import { classifyLegacyPhaseOne } from './phase-one-classification.js';
import { assertTargetCompositionStartup } from '../../../../tests/i7/target-startup-composition-harness.js';
import { createJourneyDependencies, deterministicIds } from '../../test/i2h/fixture.js';
import { runTargetNativeSyntheticReplay } from '../../test/i7/target-native-synthetic-replay.fixture.js';

const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);
const MP4_BYTES = Buffer.from('00000020ftypisom00000000isomiso2avc1mp41', 'ascii');
const WAV_BYTES = Buffer.from('RIFF0000WAVEfmt 0000data0000', 'ascii');
const CREATED_AT = 1_700_000_000_000;
const UPDATED_AT = CREATED_AT + 10_000;
const ISO_CREATED_AT = new Date(CREATED_AT).toISOString();
const ISO_UPDATED_AT = new Date(UPDATED_AT).toISOString();
const SHA256_ZERO = '0'.repeat(64);
const USER_MESSAGE_TEXT = '  Create the imported sequence.  ';
const ASSISTANT_MESSAGE_TEXT = '\nImported assistant answer.\n';
const SKILL_PRESET_OVERRIDE = {
  id: 'preset.override',
  presetId: 'preset.base',
  category: 'camera',
  name: 'Private preset override',
  description: 'Private preset description',
  prompt: 'Private preset instruction',
  params: [],
  defaults: {},
  isUser: false,
  createdAt: CREATED_AT,
  updatedAt: UPDATED_AT,
} as const;
const SKILL_SHOT_TEMPLATE = {
  id: 'shot.custom',
  name: 'Private shot template',
  description: 'Private shot description',
  tracks: { camera: { entries: [] } },
  createdAt: CREATED_AT,
  updatedAt: UPDATED_AT,
} as const;
const SKILL_PROCESS_PROMPT = {
  id: 1,
  processKey: 'process.one',
  name: 'Process one',
  description: 'Process prompt description',
  defaultValue: 'Process default instruction',
  customValue: 'Private process instruction',
  createdAt: CREATED_AT,
  updatedAt: UPDATED_AT,
} as const;
const SKILL_PROMPT_TEMPLATE = {
  code: 'prompt.one',
  customValue: 'Private prompt template instruction',
} as const;
const temporaryDirectories: string[] = [];

type SqlValue = string | number | null | Uint8Array;

interface FixtureMedia {
  readonly hash: string;
  readonly type: 'image' | 'video' | 'audio';
  readonly format: 'png' | 'mp4' | 'wav';
  readonly bytes: Buffer;
  readonly path: string;
}

interface RepresentativeFixture extends LegacyPreflightPaths {
  readonly directory: string;
  readonly targetRootPath: string;
  readonly media: Readonly<Record<'image' | 'video' | 'audio', FixtureMedia>>;
}

interface PreparedMigration {
  readonly preflight: Awaited<ReturnType<typeof preflightLegacyInputs>>;
  readonly phaseOne: ReturnType<typeof classifyLegacyPhaseOne>;
  readonly readiness: ReturnType<typeof buildLegacyMigrationReadinessReport>;
  readonly plan: ReturnType<typeof buildLegacyMigrationPlan>;
  readonly skillBundle: LegacySkillMigrationBundleV1;
  readonly builtInSkills: readonly SkillDocument[];
  readonly skillPlan: LegacySkillMigrationPlan;
  readonly browserState: LegacyBrowserStateSnapshot;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function insert(database: DatabaseSync, statement: string, ...values: SqlValue[]): void {
  database.prepare(statement).run(...values);
}

function count(database: DatabaseSync, table: string): number {
  return Number(
    (database.prepare(`SELECT count(*) AS count FROM ${table}`).get() as { readonly count: number })
      .count,
  );
}

function importedHistorySnapshot(database: DatabaseSync) {
  return {
    counts: [
      'imported_history_batches',
      'imported_run_history',
      'imported_run_event_history',
      'imported_run_scope_history',
      'imported_run_attachment_history',
      'imported_task_list_history',
      'imported_task_item_history',
      'imported_history_records',
    ].map((table) => [table, count(database, table)] as const),
    runs: database
      .prepare(
        `SELECT id, legacy_run_id, project_id, root_run_id, parent_run_id, retry_of_run_id,
                status, last_sequence, source_payload_hash
           FROM imported_run_history
          ORDER BY id`,
      )
      .all(),
  };
}

function representativeBuiltInSkills(): readonly SkillDocument[] {
  return [
    legacySourceToSkill({
      kind: 'preset',
      logicalKey: 'preset.base',
      state: 'built_in',
      store: 'representative.preset',
      name: 'Base preset',
      description: 'Base preset description',
      effectiveInstruction: 'Base preset instruction',
      sourceRecord: { id: 'preset.base' },
      trust: 'trusted',
    }),
    legacySourceToSkill({
      kind: 'process_prompt',
      logicalKey: 'process.one',
      state: 'built_in',
      store: 'representative.process-prompt',
      name: 'Process one',
      description: 'Process prompt description',
      effectiveInstruction: 'Process default instruction',
      sourceRecord: {
        processKey: 'process.one',
        name: 'Process one',
        description: 'Process prompt description',
        defaultValue: 'Process default instruction',
      },
      trust: 'trusted',
    }),
    legacySourceToSkill({
      kind: 'prompt_template',
      logicalKey: 'prompt.one',
      state: 'built_in',
      store: 'representative.prompt-template',
      name: 'Prompt one',
      description: 'Prompt template description',
      effectiveInstruction: 'Prompt template default',
      sourceRecord: { code: 'prompt.one', type: 'system' },
      trust: 'trusted',
    }),
  ];
}

function representativeSkillAuthority(): {
  readonly skillBundle: LegacySkillMigrationBundleV1;
  readonly builtInSkills: readonly SkillDocument[];
  readonly skillPlan: LegacySkillMigrationPlan;
  readonly browserState: LegacyBrowserStateSnapshot;
} {
  const rows = {
    presetOverrides: [SKILL_PRESET_OVERRIDE],
    customShotTemplates: [SKILL_SHOT_TEMPLATE],
    processPromptOverrides: [SKILL_PROCESS_PROMPT],
    promptTemplateOverrides: [SKILL_PROMPT_TEMPLATE],
  };
  const rawJson = canonicalJson({ builtInCustoms: {}, builtInNames: {}, customSkills: [] });
  const skillBundle: LegacySkillMigrationBundleV1 = {
    schema: 'lucid-fin.legacy-skill-migration-bundle/v1',
    cutoverAt: ISO_CREATED_AT,
    databaseFingerprint: legacySkillDatabaseFingerprint(rows),
    rendererExport: {
      storageKey: 'lucid-skills-v2',
      rawJson,
      rawHash: sha256(rawJson),
    },
    ...rows,
  };
  const builtInSkills = representativeBuiltInSkills();
  const skillPlan = planLegacySkillMigration(skillBundle, builtInSkills);
  const browserSessions = canonicalJson([
    {
      id: 'session.a',
      messages: [{ id: 'message.user.a' }, { id: 'message.assistant.a' }],
    },
    { id: 'session.b', messages: [] },
  ]);
  const browserValues = Object.fromEntries(
    LEGACY_BROWSER_STATE_KEYS.map((key) => {
      const value =
        key === 'lucid-skills-v2'
          ? rawJson
          : key === 'lucid-commander-sessions-v1'
            ? browserSessions
            : null;
      return [key, value];
    }),
  ) as Readonly<Record<(typeof LEGACY_BROWSER_STATE_KEYS)[number], string | null>>;
  const browserState = createLegacyBrowserStateSnapshot(
    captureLegacyBrowserState(
      {
        captureRunId: 'representative-rehearsal-run-1',
        captureSessionId: 'representative-rehearsal-session-1',
        chromiumProfile: { platform: 'win32', path: 'C:/Lucid/Profile 1' },
        origin: 'opaque:file',
        challenge: 'A'.repeat(43),
        capturedAt: ISO_CREATED_AT,
      },
      (key) => browserValues[key],
    ),
  );
  return { skillBundle, builtInSkills, skillPlan, browserState };
}

function representativeSkillPlan(): LegacySkillMigrationPlan {
  return representativeSkillAuthority().skillPlan;
}

function assertAllLegacyTables(main: DatabaseSync, prompts: DatabaseSync): void {
  const tableNames = (database: DatabaseSync) =>
    new Set(
      (
        database
          .prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'view')")
          .all() as readonly { readonly name: string }[]
      ).map(({ name }) => name),
    );
  const mainTables = tableNames(main);
  const promptTables = tableNames(prompts);
  const expected = [
    ...I0_LEGACY_SOURCE_SCHEMAS.main.tables.map(({ name }) => `main:${name}`),
    ...I0_LEGACY_SOURCE_SCHEMAS.prompts.tables.map(({ name }) => `prompts:${name}`),
  ];
  expect(expected).toHaveLength(39);
  expect(
    expected.filter((key) => {
      const [database, table] = key.split(':') as ['main' | 'prompts', string];
      return !(database === 'main' ? mainTables : promptTables).has(table);
    }),
  ).toEqual([]);
}

async function writeLegacyMedia(
  assetsRoot: string,
  type: FixtureMedia['type'],
  format: FixtureMedia['format'],
  bytes: Buffer,
): Promise<FixtureMedia> {
  const hash = sha256(bytes);
  const path = join(assetsRoot, type, hash.slice(0, 2), `${hash}.${format}`);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
  return { hash, type, format, bytes, path };
}

function createPromptDatabase(path: string): void {
  const prompts = new DatabaseSync(path);
  try {
    prompts.exec(`
      CREATE TABLE process_prompts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        process_key TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        default_value TEXT NOT NULL,
        custom_value TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE t_prompt_overrides (
        code TEXT PRIMARY KEY,
        customValue TEXT NOT NULL
      );
    `);
    insert(
      prompts,
      `INSERT INTO process_prompts (
         id, process_key, name, description, default_value, custom_value, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      SKILL_PROCESS_PROMPT.id,
      SKILL_PROCESS_PROMPT.processKey,
      SKILL_PROCESS_PROMPT.name,
      SKILL_PROCESS_PROMPT.description,
      SKILL_PROCESS_PROMPT.defaultValue,
      SKILL_PROCESS_PROMPT.customValue,
      SKILL_PROCESS_PROMPT.createdAt,
      SKILL_PROCESS_PROMPT.updatedAt,
    );
    insert(
      prompts,
      'INSERT INTO t_prompt_overrides (code, customValue) VALUES (?, ?)',
      SKILL_PROMPT_TEMPLATE.code,
      SKILL_PROMPT_TEMPLATE.customValue,
    );
  } finally {
    prompts.close();
  }
}

function writeRepresentativeRows(
  database: DatabaseSync,
  media: Readonly<Record<'image' | 'video' | 'audio', FixtureMedia>>,
): void {
  insert(
    database,
    'INSERT INTO project_settings (key, value, updated_at) VALUES (?, ?, ?)',
    'appSettings',
    canonicalJson({ analyticsEnabled: false, providerPreference: 'offline' }),
    UPDATED_AT,
  );
  insert(
    database,
    'INSERT INTO project_settings (key, value, updated_at) VALUES (?, ?, ?)',
    'styleGuide',
    canonicalJson({ global: { tone: 'representative' }, sceneOverrides: {} }),
    UPDATED_AT,
  );
  insert(
    database,
    `INSERT INTO preset_overrides (
       id, preset_id, category, name, description, prompt, params, defaults, is_user,
       created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    SKILL_PRESET_OVERRIDE.id,
    SKILL_PRESET_OVERRIDE.presetId,
    SKILL_PRESET_OVERRIDE.category,
    SKILL_PRESET_OVERRIDE.name,
    SKILL_PRESET_OVERRIDE.description,
    SKILL_PRESET_OVERRIDE.prompt,
    canonicalJson(SKILL_PRESET_OVERRIDE.params),
    canonicalJson(SKILL_PRESET_OVERRIDE.defaults),
    SKILL_PRESET_OVERRIDE.isUser ? 1 : 0,
    SKILL_PRESET_OVERRIDE.createdAt,
    SKILL_PRESET_OVERRIDE.updatedAt,
  );
  insert(
    database,
    `INSERT INTO custom_shot_templates (
       id, name, description, tracks_json, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?)`,
    SKILL_SHOT_TEMPLATE.id,
    SKILL_SHOT_TEMPLATE.name,
    SKILL_SHOT_TEMPLATE.description,
    canonicalJson(SKILL_SHOT_TEMPLATE.tracks),
    SKILL_SHOT_TEMPLATE.createdAt,
    SKILL_SHOT_TEMPLATE.updatedAt,
  );
  const planContent = { version: 1, subject: 'representative-migration' };
  const planContentJson = canonicalJson(planContent);
  const planContentHash = hashCanonical(planContent);
  const snapshotData = canonicalJson({
    canvases: [],
    characters: [],
    equipment: [],
    locations: [],
    scripts: [],
    preset_overrides: [],
  });
  const deliverySequence = canonicalJson({
    revision: 1,
    updatedAt: UPDATED_AT,
    items: [
      {
        shotId: 'shot.a',
        selectedVideoHash: media.video.hash,
        trimInMs: 0,
        trimOutMs: 1_000,
        embeddedAudioEnabled: true,
      },
    ],
  });
  const entityImageReferences = canonicalJson([{ assetHash: media.image.hash, variants: [] }]);
  const nodeAData = canonicalJson({
    assetHash: media.image.hash,
    characterRefs: [{ characterId: 'character.shared', loadoutId: '' }],
    equipmentRefs: [{ equipmentId: 'equipment.shared' }],
    locationRefs: [{ locationId: 'location.shared' }],
    generationHistory: [
      {
        assetHash: media.image.hash,
        characterRefs: [{ entityId: 'character.history', imageHashes: [media.image.hash] }],
        equipmentRefs: [{ entityId: 'equipment.history', imageHashes: [media.image.hash] }],
        locationRefs: [{ entityId: 'location.history', imageHashes: [media.image.hash] }],
      },
    ],
  });
  const nodeBData = canonicalJson({
    assetHash: media.image.hash,
    characterRefs: [{ characterId: 'character.shared', loadoutId: '' }],
    equipmentRefs: [{ equipmentId: 'equipment.shared' }],
    locationRefs: [{ locationId: 'location.shared' }],
  });
  const attemptSpec = canonicalJson({
    specVersion: 3,
    mediaType: 'image',
    request: { type: 'image', sourceImageHash: media.image.hash },
    referenceEvidence: [{ assetHash: media.image.hash }],
  });
  const sessionAMessages = canonicalJson([
    {
      id: 'message.user.a',
      role: 'user',
      content: USER_MESSAGE_TEXT,
      timestamp: CREATED_AT + 1_000,
    },
    {
      id: 'message.assistant.a',
      role: 'assistant',
      content: ASSISTANT_MESSAGE_TEXT,
      timestamp: CREATED_AT + 4_000,
      runMeta: {
        runId: 'run.root',
        status: 'completed',
        startedAt: CREATED_AT + 2_000,
        completedAt: CREATED_AT + 5_000,
      },
    },
  ]);
  const assistantEventPayload = canonicalJson({
    kind: 'assistant_text',
    content: ASSISTANT_MESSAGE_TEXT,
    isDelta: false,
  });

  insert(
    database,
    `INSERT INTO asset_contents (
       hash, type, format, prompt, provider, created_at, file_size, width, height, duration,
       has_audio, generation_metadata
     ) VALUES (?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, NULL)`,
    media.image.hash,
    'image',
    'png',
    CREATED_AT,
    media.image.bytes.byteLength,
    1,
    1,
    null,
    0,
  );
  insert(
    database,
    `INSERT INTO asset_contents (
       hash, type, format, prompt, provider, created_at, file_size, width, height, duration,
       has_audio, generation_metadata
     ) VALUES (?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, NULL)`,
    media.video.hash,
    'video',
    'mp4',
    CREATED_AT,
    media.video.bytes.byteLength,
    1920,
    1080,
    1,
    1,
  );
  insert(
    database,
    `INSERT INTO asset_contents (
       hash, type, format, prompt, provider, created_at, file_size, width, height, duration,
       has_audio, generation_metadata
     ) VALUES (?, ?, ?, NULL, NULL, ?, ?, NULL, NULL, ?, 0, NULL)`,
    media.audio.hash,
    'audio',
    'wav',
    CREATED_AT,
    media.audio.bytes.byteLength,
    1,
  );
  insert(
    database,
    `INSERT INTO asset_folders (id, parent_id, name, sort_order, created_at, updated_at)
     VALUES ('asset.folder.root', NULL, 'Imported assets', 0, ?, ?),
            ('asset.folder.child', 'asset.folder.root', 'Reference media', 1, ?, ?)`,
    CREATED_AT,
    UPDATED_AT,
    CREATED_AT,
    UPDATED_AT,
  );
  for (const [id, item, name] of [
    ['asset.image', media.image, 'Reference image'],
    ['asset.video', media.video, 'Delivery video'],
    ['asset.audio', media.audio, 'Reference audio'],
  ] as const) {
    insert(
      database,
      `INSERT INTO asset_entries (id, asset_hash, display_name, tags, folder_id, created_at)
       VALUES (?, ?, ?, '["imported"]', 'asset.folder.child', ?)`,
      id,
      item.hash,
      name,
      CREATED_AT,
    );
  }

  insert(
    database,
    `INSERT INTO canvases (
       id, name, viewport, notes, aspect_ratio, delivery_sequence_json,
       delivery_sequence_revision, created_at, updated_at
     ) VALUES (?, ?, ?, ?, '16:9', ?, 1, ?, ?),
              (?, ?, ?, '[]', '16:9', NULL, 0, ?, ?)`,
    'canvas.a',
    'Canvas A',
    canonicalJson({ x: 120, y: -40, zoom: 1.25 }),
    canonicalJson([
      {
        id: 'note.a',
        content: 'Imported canvas note.',
        createdAt: CREATED_AT,
        updatedAt: UPDATED_AT,
      },
    ]),
    deliverySequence,
    CREATED_AT,
    UPDATED_AT,
    'canvas.b',
    'Canvas B',
    canonicalJson({ x: 0, y: 0, zoom: 1 }),
    CREATED_AT,
    UPDATED_AT,
  );
  insert(
    database,
    `INSERT INTO delivery_asset_refs (canvas_id, asset_hash) VALUES ('canvas.a', ?)`,
    media.video.hash,
  );
  for (const [id, canvasId, type, data, x, y] of [
    ['node.a.image', 'canvas.a', 'image', nodeAData, 0, 0],
    ['node.a.video', 'canvas.a', 'video', canonicalJson({ assetHash: media.video.hash }), 300, 0],
    ['node.b.image', 'canvas.b', 'image', nodeBData, 0, 0],
    ['node.b.audio', 'canvas.b', 'audio', canonicalJson({ assetHash: media.audio.hash }), 300, 0],
  ] as const) {
    insert(
      database,
      `INSERT INTO canvas_nodes (
         id, canvas_id, type, position_x, position_y, width, height, data_json, z_index,
         created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, 320, 180, ?, 0, ?, ?)`,
      id,
      canvasId,
      type,
      x,
      y,
      data,
      ISO_CREATED_AT,
      ISO_UPDATED_AT,
    );
  }
  insert(
    database,
    `INSERT INTO canvas_edges (
       id, canvas_id, source, target, source_handle, target_handle, label, status, auto_label,
       z_index, created_at, updated_at
     ) VALUES ('edge.a', 'canvas.a', 'node.a.image', 'node.a.video', NULL, NULL, 'delivery',
               'idle', 0, 0, ?, ?)`,
    ISO_CREATED_AT,
    ISO_UPDATED_AT,
  );

  insert(
    database,
    `INSERT INTO character_folders (id, parent_id, name, sort_order, created_at, updated_at)
     VALUES ('character.folder.root', NULL, 'Characters', 0, ?, ?),
            ('character.folder.shared', 'character.folder.root', 'Leads', 1, ?, ?)`,
    CREATED_AT,
    UPDATED_AT,
    CREATED_AT,
    UPDATED_AT,
  );
  insert(
    database,
    `INSERT INTO equipment_folders (id, parent_id, name, sort_order, created_at, updated_at)
     VALUES ('equipment.folder.shared', NULL, 'Equipment', 0, ?, ?)`,
    CREATED_AT,
    UPDATED_AT,
  );
  insert(
    database,
    `INSERT INTO location_folders (id, parent_id, name, sort_order, created_at, updated_at)
     VALUES ('location.folder.shared', NULL, 'Locations', 0, ?, ?)`,
    CREATED_AT,
    UPDATED_AT,
  );
  insert(
    database,
    `INSERT INTO characters (
       id, name, role, description, appearance, personality, ref_image, costumes, tags, age,
       gender, voice, face, hair, skin_tone, body, distinct_traits, vocal_traits,
       reference_images, loadouts, default_loadout_id, folder_id, deleted_at, created_at, updated_at
     ) VALUES (
       'character.shared', 'Shared Character', 'lead', 'A shared character.', 'calm', 'curious',
       ?, '[]', '["hero"]', 30, 'unspecified', NULL, NULL, NULL, NULL, NULL, '[]', '[]', ?,
       '[]', '', 'character.folder.shared', NULL, ?, ?
     )`,
    media.image.hash,
    entityImageReferences,
    CREATED_AT,
    UPDATED_AT,
  );
  insert(
    database,
    `INSERT INTO equipment (
       id, name, type, subtype, description, function_desc, material, color, condition,
       visual_details, tags, reference_images, folder_id, deleted_at, created_at, updated_at
     ) VALUES (
       'equipment.shared', 'Shared Camera', 'camera', NULL, 'A shared camera.', NULL, NULL, NULL,
       NULL, NULL, '["prop"]', ?, 'equipment.folder.shared', NULL, ?, ?
     )`,
    entityImageReferences,
    CREATED_AT,
    UPDATED_AT,
  );
  insert(
    database,
    `INSERT INTO locations (
       id, name, type, sub_location, description, time_of_day, mood, weather, lighting,
       architecture_style, dominant_colors, key_features, atmosphere_keywords, tags,
       reference_images, folder_id, deleted_at, created_at, updated_at
     ) VALUES (
       'location.shared', 'Shared Stage', 'interior', NULL, 'A shared stage.', NULL, NULL, NULL,
       NULL, NULL, '[]', '["stage"]', '["quiet"]', '["location"]', ?,
       'location.folder.shared', NULL, ?, ?
     )`,
    entityImageReferences,
    CREATED_AT,
    UPDATED_AT,
  );
  insert(
    database,
    `INSERT INTO characters (
       id, name, role, description, appearance, personality, ref_image, costumes, tags, age,
       gender, voice, face, hair, skin_tone, body, distinct_traits, vocal_traits,
       reference_images, loadouts, default_loadout_id, folder_id, deleted_at, created_at, updated_at
     ) VALUES (
       'character.history', 'Historical Character', 'support', 'A historical character reference.',
       'calm', 'observant', NULL, '[]', '[]', 29, 'unspecified', NULL, NULL, NULL, NULL, NULL,
       '[]', '[]', '[]', '[]', '', NULL, NULL, ?, ?
     )`,
    CREATED_AT,
    UPDATED_AT,
  );
  insert(
    database,
    `INSERT INTO equipment (
       id, name, type, subtype, description, function_desc, material, color, condition,
       visual_details, tags, reference_images, folder_id, deleted_at, created_at, updated_at
     ) VALUES (
       'equipment.history', 'Historical Lens', 'camera', NULL, 'A historical equipment reference.',
       NULL, NULL, NULL, NULL, NULL, '[]', '[]', NULL, NULL, ?, ?
     )`,
    CREATED_AT,
    UPDATED_AT,
  );
  insert(
    database,
    `INSERT INTO locations (
       id, name, type, sub_location, description, time_of_day, mood, weather, lighting,
       architecture_style, dominant_colors, key_features, atmosphere_keywords, tags,
       reference_images, folder_id, deleted_at, created_at, updated_at
     ) VALUES (
       'location.history', 'Historical Stage', 'interior', NULL, 'A historical location reference.',
       NULL, NULL, NULL, NULL, NULL, '[]', '[]', '[]', '[]', '[]', NULL, NULL, ?, ?
     )`,
    CREATED_AT,
    UPDATED_AT,
  );
  insert(
    database,
    `INSERT INTO scripts (id, content, format, parsed_scenes, created_at, updated_at)
     VALUES ('script.shared', 'INT. IMPORTED STAGE - DAY', 'fountain', '[]', ?, ?)`,
    CREATED_AT,
    UPDATED_AT,
  );
  insert(
    database,
    `INSERT INTO color_styles (
       id, name, source_type, source_asset, palette, gradients, exposure, tags, created_at, updated_at
     ) VALUES ('style.offline', 'Offline style', 'manual', ?, '[]', '[]', '{}', '[]', ?, ?)`,
    media.image.hash,
    CREATED_AT,
    UPDATED_AT,
  );

  insert(
    database,
    `INSERT INTO commander_sessions (
       id, default_canvas_id, title, messages, context_graph_json, created_at, updated_at
     ) VALUES ('session.a', 'canvas.a', 'Imported conversation A', ?, NULL, ?, ?),
              ('session.b', 'canvas.b', 'Imported conversation B', '[]', NULL, ?, ?)`,
    sessionAMessages,
    CREATED_AT,
    UPDATED_AT,
    CREATED_AT,
    UPDATED_AT,
  );
  for (const [id, parentRunId, retryOfRunId, defaultCanvasId] of [
    ['run.root', null, null, 'canvas.a'],
    ['run.child', 'run.root', null, 'canvas.a'],
    ['run.retry', 'run.root', 'run.root', 'canvas.a'],
  ] as const) {
    insert(
      database,
      `INSERT INTO commander_runs (
         id, session_id, default_canvas_id, work_type, parent_run_id, retry_of_run_id,
         display_name, objective, intent, status, accepted_at, started_at, completed_at, last_seq,
         error_text
       ) VALUES (?, 'session.a', ?, 'agent', ?, ?, ?, 'Complete imported work.', 'work', 'completed',
                 ?, ?, ?, ?, NULL)`,
      id,
      defaultCanvasId,
      parentRunId,
      retryOfRunId,
      id,
      CREATED_AT,
      CREATED_AT + 2_000,
      CREATED_AT + 5_000,
      id === 'run.root' ? 2 : 1,
    );
  }
  const addRunEvents = (runId: string, includeAssistantText: boolean) => {
    insert(
      database,
      `INSERT INTO commander_events (session_id, run_id, seq, kind, step, emitted_at, private_payload, payload)
       VALUES ('session.a', ?, 0, 'run_start', 0, ?, NULL, '{"kind":"run_start"}')`,
      runId,
      CREATED_AT,
    );
    if (includeAssistantText) {
      insert(
        database,
        `INSERT INTO commander_events (session_id, run_id, seq, kind, step, emitted_at, private_payload, payload)
         VALUES ('session.a', ?, 1, 'assistant_text', 1, ?, NULL, ?)`,
        runId,
        CREATED_AT + 3_000,
        assistantEventPayload,
      );
    }
    insert(
      database,
      `INSERT INTO commander_events (session_id, run_id, seq, kind, step, emitted_at, private_payload, payload)
       VALUES ('session.a', ?, ?, 'run_end', 2, ?, NULL, '{"kind":"run_end","status":"completed"}')`,
      runId,
      includeAssistantText ? 2 : 1,
      CREATED_AT + 5_000,
    );
  };
  addRunEvents('run.root', true);
  addRunEvents('run.child', false);
  addRunEvents('run.retry', false);
  for (const [runId, canvasId] of [
    ['run.root', 'canvas.a'],
    ['run.child', 'canvas.a'],
    ['run.retry', 'canvas.a'],
  ] as const) {
    insert(
      database,
      `INSERT INTO commander_run_canvases (run_id, canvas_id, ordinal, released_at)
       VALUES (?, ?, 0, ?)`,
      runId,
      canvasId,
      CREATED_AT + 5_000,
    );
  }
  insert(
    database,
    `INSERT INTO commander_run_attachments (
       run_id, ordinal, content_hash, role, original_name, mime_type
     ) VALUES ('run.root', 0, ?, 'reference', 'reference.png', 'image/png')`,
    media.image.hash,
  );
  insert(
    database,
    `INSERT INTO snapshots (id, session_id, label, trigger, schema_version, data, created_at)
     VALUES ('snapshot.offline', 'session.a', 'offline evidence', 'auto', 1, ?, ?)`,
    snapshotData,
    UPDATED_AT,
  );

  for (const [id, entityId, sessionId] of [['task.list.a', 'canvas.a', 'session.a']] as const) {
    const isCanvas = entityId.startsWith('canvas.');
    insert(
      database,
      `INSERT INTO task_lists (
         id, task_list_type, entity_type, entity_id, trigger_source, status, summary, progress,
         completed_phases, total_phases, completed_tasks, total_tasks, input_json, output_json,
         metadata_json, created_at, started_at, completed_at, updated_at, row_version,
         engine_version, definition_version, lease_token
       ) VALUES (?, 'imported_work', ?, ?, 'manual', 'completed', 'Completed imported work.', 1,
                 1, 1, ?, ?, '{}', '{}', ?, ?, ?, ?, ?, 0, 'legacy', 1, 0)`,
      id,
      isCanvas ? 'canvas' : 'script',
      entityId,
      isCanvas ? 2 : 0,
      isCanvas ? 2 : 0,
      canonicalJson({
        commanderSessionId: sessionId,
        ...(id === 'task.list.a' ? { commanderRunId: 'run.root' } : {}),
      }),
      CREATED_AT,
      CREATED_AT + 1_000,
      UPDATED_AT,
      UPDATED_AT,
    );
  }
  for (const [id, key, status, phaseOrder] of [
    ['task.a.one', 'first', 'completed', 0],
    ['task.a.two', 'second', 'skipped', 1],
  ] as const) {
    insert(
      database,
      `INSERT INTO tasks (
         id, task_list_id, phase_key, phase_name, phase_order, task_key, name, kind, status,
         provider, dependency_ids_json, attempts, max_retries, input_json, output_json,
         provider_task_id, asset_id, error_text, progress, current_step, started_at, completed_at,
         updated_at
       ) VALUES (?, 'task.list.a', 'phase.one', 'Phase one', ?, ?, ?, 'generation', ?, NULL,
                 '[]', 1, 0, '{}', '{}', NULL, NULL, NULL, 1, NULL, ?, ?, ?)`,
      id,
      phaseOrder,
      key,
      `Task ${key}`,
      status,
      CREATED_AT + 1_000,
      UPDATED_AT,
      UPDATED_AT,
    );
  }
  insert(
    database,
    `INSERT INTO task_dependencies (task_id, depends_on_task_id) VALUES ('task.a.two', 'task.a.one')`,
  );
  for (const [seq, id, payload] of [
    [1, 'task.event.one', '{"kind":"task_started"}'],
    [2, 'task.event.two', '{"kind":"task_completed"}'],
  ] as const) {
    insert(
      database,
      `INSERT INTO task_events (
         task_list_id, seq, event_id, actor, correlation_id, causation_id, payload_json, event_timestamp
       ) VALUES ('task.list.a', ?, ?, 'system', NULL, NULL, ?, ?)`,
      seq,
      id,
      payload,
      CREATED_AT + seq * 1_000,
    );
  }
  insert(
    database,
    `INSERT INTO task_attempts (
       id, task_list_id, task_id, kind, manifest_revision, manifest_hash, idempotency_key, status,
       row_version, staging_path, destination_path, package_hash, package_bytes, file_count, attempt,
       canvas_id, node_id, scope, parent_attempt_id, submission_purpose, spec_hash,
       generation_spec_json, repair_delta_json, media_type, provider_id, model, prompt, prompt_hash,
       negative_prompt, seed, estimated_cost_usd, reported_actual_cost_usd, provider_job_id,
       provider_receipt, asset_hash, input_json, output_json, metadata_json, error_text, created_at,
       submitted_at, submission_started_at, cancel_requested_at, asset_ready_at, evaluated_at,
       completed_at, updated_at
     ) VALUES (
       'attempt.a', 'task.list.a', 'task.a.one', 'production_media', NULL, NULL, 'attempt.a.key',
       'completed', 0, NULL, NULL, NULL, NULL, 1, 1, 'canvas.a', 'node.a.image', 'canvas', NULL,
       'initial', ?, ?, NULL, 'image', 'provider.imported', 'model.imported', 'prompt', ?, NULL,
       NULL, 0, NULL, 'job.a', 'receipt.a', ?, '{}', '{}', '{}', NULL, ?, ?, ?, NULL, ?, ?, ?, ?
     )`,
    SHA256_ZERO,
    attemptSpec,
    SHA256_ZERO,
    media.image.hash,
    CREATED_AT,
    CREATED_AT + 2_000,
    CREATED_AT + 2_000,
    CREATED_AT + 4_000,
    CREATED_AT + 4_000,
    UPDATED_AT,
    UPDATED_AT,
  );
  insert(
    database,
    `INSERT INTO task_artifacts (
       id, task_list_id, task_id, attempt_id, artifact_type, entity_type, entity_id, asset_hash, path,
       metadata_json, created_at
     ) VALUES ('artifact.a', 'task.list.a', 'task.a.one', 'attempt.a', 'media_output', 'canvas',
               'canvas.a', ?, NULL, '{}', ?)`,
    media.image.hash,
    UPDATED_AT,
  );
  insert(
    database,
    `INSERT INTO task_decisions (
       id, task_list_id, task_id, canvas_id, question_id, decision_key, subject_revision, question,
       options_json, allow_free_text, status, answer, selected_option_id, row_version, created_at,
       updated_at, answered_at
     ) VALUES ('decision.a', 'task.list.a', 'task.a.one', 'canvas.a', 'question.a', 'decision.a', 1,
               'Continue?', '[]', 0, 'answered', 'yes', NULL, 0, ?, ?, ?)`,
    CREATED_AT,
    UPDATED_AT,
    UPDATED_AT,
  );
  insert(
    database,
    `INSERT INTO task_evaluations (
       id, attempt_id, task_list_id, task_id, kind, canvas_id, node_id, artifact_id, asset_hash,
       media_type, profile, source_prompt_hash, rubric_version, evaluator_provider_id, evaluator_model,
       scores_json, total, verdict, strengths_json, risks_json, evidence_json, repair_delta_json,
       metadata_json, frame_evidence_json, created_at
     ) VALUES (
       'evaluation.a', 'attempt.a', 'task.list.a', 'task.a.one', 'production_media', 'canvas.a',
       'node.a.image', 'artifact.a', ?, 'image', 'canvas_media.v1', ?, 'rubric.v1',
       'provider.imported', 'model.imported', '{}', 100, 'pass', '[]', '[]', '{}', NULL, '{}', '[]', ?
     )`,
    media.image.hash,
    SHA256_ZERO,
    UPDATED_AT,
  );
  insert(
    database,
    `INSERT INTO plan_documents (
       id, task_list_id, logical_key, document_type, revision, schema_version, content_json,
       content_hash, status, created_at, updated_at
     ) VALUES ('plan.a', 'task.list.a', 'production-plan', 'production_plan', 1, 1, ?, ?, 'active', ?, ?)`,
    planContentJson,
    planContentHash,
    CREATED_AT,
    UPDATED_AT,
  );
  insert(
    database,
    `INSERT INTO plan_approvals (
       id, task_list_id, gate_key, subject_logical_key, subject_revision, subject_hash, manifest_hash,
       resume_token_hash, status, created_at, updated_at, decided_at
     ) VALUES ('approval.a', 'task.list.a', 'production_plan', 'production-plan', 1, ?, ?, ?,
               'approved', ?, ?, ?)`,
    planContentHash,
    SHA256_ZERO,
    SHA256_ZERO,
    CREATED_AT,
    UPDATED_AT,
    UPDATED_AT,
  );
  insert(
    database,
    `INSERT INTO prompt_assemblies (
       id, canvas_id, node_id, node_updated_at, media_type, mode, purpose, authority_json, sources_json,
       conditioning_manifest_json, provider_profile_json, host_constraints_json, input_json, input_hash,
       output_json, status, row_version, llm_provider_id, llm_model, task_list_id, task_id,
       parent_assembly_id, source_attempt_id, source_asset_hash, source_evaluation_id, error_text,
       created_at, assembled_at, submitted_at, terminal_at, updated_at
     ) VALUES (
       'assembly.a', 'canvas.a', 'node.a.image', ?, 'image', 'text-to-image', 'initial', '{}', '{}',
       '{}', '{}', '{}', '{}', ?, '{}', 'assembled', 0, NULL, NULL, 'task.list.a', 'task.a.one',
       NULL, NULL, ?, NULL, NULL, ?, ?, NULL, NULL, ?
     )`,
    UPDATED_AT,
    SHA256_ZERO,
    media.image.hash,
    CREATED_AT,
    CREATED_AT + 1_000,
    UPDATED_AT,
  );
}

async function fixture(): Promise<RepresentativeFixture> {
  const directory = await mkdtemp(join(tmpdir(), 'lucid-fin-i7-representative-migration-'));
  temporaryDirectories.push(directory);
  const mainDatabasePath = join(directory, 'legacy.sqlite');
  const promptsDatabasePath = join(directory, 'prompts.sqlite');
  const assetsRoot = join(directory, 'legacy-assets');
  const targetRootPath = join(directory, 'disposable-target');
  await mkdir(assetsRoot);
  const media = {
    image: await writeLegacyMedia(assetsRoot, 'image', 'png', PNG_BYTES),
    video: await writeLegacyMedia(assetsRoot, 'video', 'mp4', MP4_BYTES),
    audio: await writeLegacyMedia(assetsRoot, 'audio', 'wav', WAV_BYTES),
  };
  const main = new DatabaseSync(mainDatabasePath);
  try {
    main.exec(SCHEMA_SQL);
    writeRepresentativeRows(main, media);
  } finally {
    main.close();
  }
  createPromptDatabase(promptsDatabasePath);
  const mainRead = new DatabaseSync(mainDatabasePath, { readOnly: true });
  const promptsRead = new DatabaseSync(promptsDatabasePath, { readOnly: true });
  try {
    assertAllLegacyTables(mainRead, promptsRead);
  } finally {
    promptsRead.close();
    mainRead.close();
  }
  return { directory, mainDatabasePath, promptsDatabasePath, assetsRoot, targetRootPath, media };
}

async function prepareMigration(source: RepresentativeFixture): Promise<PreparedMigration> {
  const preflight = await preflightLegacyInputs(source);
  if (preflight.media.status !== 'checked')
    throw new Error('Representative media preflight was skipped');
  const { skillBundle, builtInSkills, skillPlan, browserState } = representativeSkillAuthority();
  const main = new DatabaseSync(source.mainDatabasePath, { readOnly: true });
  const prompts = new DatabaseSync(source.promptsDatabasePath, { readOnly: true });
  try {
    const phaseOne = classifyLegacyPhaseOne(
      { main, prompts },
      I0_LEGACY_SOURCE_SCHEMAS,
      preflight.media.report,
      { root: { classifyLegacySkillRows: createLegacySkillRowClassifier(skillPlan) } },
    );
    const readiness = buildLegacyMigrationReadinessReport({ preflight, phaseOne });
    return {
      preflight,
      phaseOne,
      readiness,
      plan: buildLegacyMigrationPlan({ readiness, phaseOne }),
      skillBundle,
      builtInSkills,
      skillPlan,
      browserState,
    };
  } finally {
    prompts.close();
    main.close();
  }
}

async function probeAudioVisual(sourcePath: string): Promise<Readonly<Record<string, unknown>>> {
  if (sourcePath.endsWith('.mp4')) {
    return {
      format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', duration: '1.0' },
      streams: [
        { codec_type: 'video', width: 1920, height: 1080, avg_frame_rate: '24/1' },
        { codec_type: 'audio', sample_rate: '48000', channels: 2 },
      ],
    };
  }
  if (sourcePath.endsWith('.wav')) {
    return {
      format: { format_name: 'wav', duration: '1.0' },
      streams: [{ codec_type: 'audio', sample_rate: '48000', channels: 2 }],
    };
  }
  throw new Error(`Unexpected audio/video probe path: ${sourcePath}`);
}

describe('representative disposable Legacy migration rehearsal', () => {
  it('migrates an all-table source with canvases, immutable history, cloned production, and byte-verified media', async () => {
    const source = await fixture();
    const sourceMainBefore = await readFile(source.mainDatabasePath);
    const sourcePromptsBefore = await readFile(source.promptsDatabasePath);
    const sourceMediaBefore = await Promise.all(
      Object.values(source.media).map(({ path }) => readFile(path)),
    );
    const prepared = await prepareMigration(source);

    expect(prepared.preflight.ok).toBe(true);
    expect(prepared.phaseOne.ok).toBe(true);
    expect(prepared.readiness).toMatchObject({
      status: 'ready_for_disposable_dry_run',
      ok: true,
    });
    expect(prepared.phaseOne.rootRows.runHistory?.counts).toEqual({
      runs: 3,
      events: 7,
      scopes: 3,
      attachments: 1,
    });
    expect(prepared.phaseOne.rootRows.taskHistory?.counts).toMatchObject({
      taskLists: 1,
      tasks: 2,
      dependencies: 1,
      events: 2,
      attempts: 1,
      artifacts: 1,
      plans: 1,
      approvals: 1,
      promptAssemblies: 1,
    });
    expect(prepared.readiness.counts.cloneRefCount).toBeGreaterThan(0);
    expect(prepared.skillPlan).toMatchObject({ builtInCount: 3 });
    expect(prepared.skillPlan.rows).toHaveLength(4);
    expect(prepared.skillPlan.documents).toHaveLength(7);
    expect(
      prepared.phaseOne.rootRows.classification.entries
        .filter(({ subject }) => subject.table === 'project_settings')
        .map(({ disposition }) => disposition),
    ).toEqual(['offline_legacy_export', 'offline_legacy_export']);

    const report = await rehearseDisposableLegacyMigration({
      paths: source,
      targetRootPath: source.targetRootPath,
      readiness: prepared.readiness,
      plan: prepared.plan,
      skillBundle: prepared.skillBundle,
      builtInSkills: prepared.builtInSkills,
      skillPlan: prepared.skillPlan,
      browserState: prepared.browserState,
      probeAudioVisual,
    });

    expect(report).toMatchObject({
      schema: 'lucid-fin.disposable-legacy-migration-rehearsal/v1',
      mediaObjectCount: 3,
      atomicRenameVerified: true,
      targetRootName: basename(source.targetRootPath),
      ok: true,
    });
    expect(report.firstReconciliationFingerprint).toBe(report.reopenedReconciliationFingerprint);
    expect(report.reopenedReconciliationFingerprint).toBe(report.finalReconciliationFingerprint);
    expect(report.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(report.skillPlanHash).toBe(prepared.skillPlan.planHash);
    expect(JSON.stringify(report)).not.toContain('providerPreference');
    expect(JSON.stringify(report)).not.toContain('representative');
    await expect(
      access(
        join(
          dirname(source.targetRootPath),
          `.${basename(source.targetRootPath)}.${prepared.plan.batchId}.staging`,
        ),
      ),
    ).rejects.toMatchObject({ code: 'ENOENT' });

    const store = await openTargetStore(join(source.targetRootPath, 'target.sqlite'));
    try {
      const database = getTargetStoreDatabase(store);
      expect(count(database, 'projects')).toBe(2);
      expect(count(database, 'project_settings')).toBe(2);
      expect(count(database, 'skills')).toBe(7);
      expect(count(database, 'skill_effective_versions')).toBe(4);
      expect(count(database, 'skill_quarantines')).toBe(4);
      expect(count(database, 'skill_enablements')).toBe(0);
      expect(
        database
          .prepare(
            `SELECT count(*) AS count
               FROM skill_effective_versions AS effective
               JOIN skill_quarantines AS quarantine
                 ON quarantine.skill_id = effective.skill_id
                AND quarantine.skill_version = effective.skill_version`,
          )
          .get(),
      ).toEqual({ count: 4 });
      expect(
        database
          .prepare('SELECT trust, count(*) AS count FROM skills GROUP BY trust ORDER BY trust')
          .all(),
      ).toEqual([
        { trust: 'trusted', count: 3 },
        { trust: 'unreviewed', count: 4 },
      ]);
      expect(count(database, 'media_blobs')).toBe(3);
      expect(count(database, 'global_media_folders')).toBe(2);
      expect(count(database, 'global_media_assets')).toBe(3);
      expect(count(database, 'project_media_refs')).toBe(4);
      expect(count(database, 'canvas_documents')).toBe(2);
      expect(count(database, 'chats')).toBe(2);
      expect(count(database, 'messages')).toBe(2);
      expect(count(database, 'production_objects')).toBe(9);
      expect(count(database, 'production_collections')).toBe(8);
      expect(count(database, 'production_collection_members')).toBe(6);
      const collectionGroups = database
        .prepare(
          `SELECT source_collection_id, id, project_id, parent_collection_id,
                  clone_of_collection_id
             FROM production_collections
            ORDER BY source_collection_id, id`,
        )
        .all() as readonly {
        readonly source_collection_id: string;
        readonly id: string;
        readonly project_id: string;
        readonly parent_collection_id: string | null;
        readonly clone_of_collection_id: string | null;
      }[];
      for (const sourceCollectionId of new Set(
        collectionGroups.map(({ source_collection_id }) => source_collection_id),
      )) {
        const clones = collectionGroups.filter(
          ({ source_collection_id }) => source_collection_id === sourceCollectionId,
        );
        expect(clones).toHaveLength(2);
        const canonical = clones.filter(({ clone_of_collection_id }) => {
          return clone_of_collection_id === null;
        });
        expect(canonical).toHaveLength(1);
        expect(
          clones
            .filter(({ id }) => id !== canonical[0]!.id)
            .map(({ clone_of_collection_id }) => clone_of_collection_id),
        ).toEqual([canonical[0]!.id]);
      }
      expect(
        database
          .prepare(
            `SELECT count(*) AS count
               FROM production_collections AS child
               JOIN production_collections AS parent ON parent.id = child.parent_collection_id
              WHERE child.project_id <> parent.project_id`,
          )
          .get(),
      ).toEqual({ count: 0 });
      expect(
        database
          .prepare(
            `SELECT count(*) AS count
               FROM production_collection_members AS member
               JOIN production_collections AS collection ON collection.id = member.collection_id
               JOIN production_objects AS object ON object.id = member.production_object_id
              WHERE collection.project_id <> object.project_id`,
          )
          .get(),
      ).toEqual({ count: 0 });
      expect(
        database
          .prepare(
            `SELECT object_type, count(*) AS count
               FROM production_objects
              GROUP BY object_type
              ORDER BY object_type`,
          )
          .all(),
      ).toEqual([
        { object_type: 'character', count: 3 },
        { object_type: 'equipment', count: 3 },
        { object_type: 'location', count: 3 },
      ]);
      expect(count(database, 'imported_history_batches')).toBe(1);
      expect(count(database, 'imported_run_history')).toBe(3);
      expect(count(database, 'imported_run_event_history')).toBe(7);
      expect(count(database, 'imported_run_scope_history')).toBe(3);
      expect(count(database, 'imported_run_attachment_history')).toBe(1);
      expect(count(database, 'imported_task_list_history')).toBe(1);
      expect(count(database, 'imported_task_item_history')).toBe(2);
      expect(count(database, 'imported_history_records')).toBe(13);
      expect(
        database
          .prepare(
            `SELECT legacy_run_id, root_run_id, parent_run_id, retry_of_run_id, status
               FROM imported_run_history
              ORDER BY legacy_run_id`,
          )
          .all(),
      ).toEqual([
        {
          legacy_run_id: 'run.child',
          root_run_id: 'run.root',
          parent_run_id: 'run.root',
          retry_of_run_id: null,
          status: 'completed',
        },
        {
          legacy_run_id: 'run.retry',
          root_run_id: 'run.root',
          parent_run_id: 'run.root',
          retry_of_run_id: 'run.root',
          status: 'completed',
        },
        {
          legacy_run_id: 'run.root',
          root_run_id: 'run.root',
          parent_run_id: null,
          retry_of_run_id: null,
          status: 'completed',
        },
      ]);
      expect(
        database
          .prepare(
            `SELECT legacy_task_id, status
               FROM imported_task_item_history
              ORDER BY legacy_task_id`,
          )
          .all(),
      ).toEqual([
        { legacy_task_id: 'task.a.one', status: 'completed' },
        { legacy_task_id: 'task.a.two', status: 'skipped' },
      ]);
      expect(
        database
          .prepare(
            `SELECT role, originating_imported_run_id
               FROM messages
              ORDER BY sequence`,
          )
          .all(),
      ).toEqual([
        { role: 'user', originating_imported_run_id: null },
        { role: 'assistant', originating_imported_run_id: 'run.root' },
      ]);
      expect(loadMessage(database, 'message.user.a').blocks).toEqual([
        { type: 'text', text: USER_MESSAGE_TEXT },
      ]);
      expect(loadMessage(database, 'message.assistant.a').blocks).toEqual([
        { type: 'text', text: ASSISTANT_MESSAGE_TEXT },
      ]);
      const imageProjectMediaRefs = database
        .prepare(
          `SELECT ref.id, ref.project_id
             FROM project_media_refs AS ref
             JOIN global_media_assets AS asset ON asset.id = ref.global_asset_id
            WHERE asset.blob_hash = ?
            ORDER BY ref.project_id`,
        )
        .all(source.media.image.hash) as readonly {
        readonly id: string;
        readonly project_id: string;
      }[];
      expect(imageProjectMediaRefs.map(({ project_id }) => project_id)).toEqual([
        'canvas.a',
        'canvas.b',
      ]);
      for (const { id, project_id } of imageProjectMediaRefs) {
        const mediaRef = loadProjectMediaRecord(database, id);
        expect(mediaRef.productionLinks).toHaveLength(project_id === 'canvas.a' ? 6 : 3);
        expect(mediaRef.productionLinks.every(({ relation }) => relation === 'references')).toBe(
          true,
        );
        for (const { productionObjectId } of mediaRef.productionLinks) {
          expect(
            database
              .prepare('SELECT project_id FROM production_objects WHERE id = ?')
              .get(productionObjectId),
          ).toEqual({ project_id });
        }
        if (project_id === 'canvas.a') {
          expect(mediaRef.productionLinks).toEqual(
            expect.arrayContaining([
              { productionObjectId: 'character.history', relation: 'references' },
              { productionObjectId: 'equipment.history', relation: 'references' },
              { productionObjectId: 'location.history', relation: 'references' },
            ]),
          );
        }
      }
      const rootEvents = database
        .prepare(
          `SELECT sequence, previous_event_hash, event_hash
             FROM imported_run_event_history
            WHERE run_id = 'run.root'
            ORDER BY sequence`,
        )
        .all() as readonly {
        readonly sequence: number;
        readonly previous_event_hash: string | null;
        readonly event_hash: string;
      }[];
      expect(rootEvents).toHaveLength(3);
      expect(rootEvents[0]).toMatchObject({ sequence: 0, previous_event_hash: null });
      expect(rootEvents[1]?.previous_event_hash).toBe(rootEvents[0]?.event_hash);
      expect(rootEvents[2]?.previous_event_hash).toBe(rootEvents[1]?.event_hash);
      const canvas = loadCanvasByProject(database, 'canvas.a');
      expect(canvas.viewport).toEqual({
        center: { x: 0, y: 0 },
        zoom: 1,
      });
      const secondCanvas = loadCanvasByProject(database, 'canvas.b');
      expect([canvas, secondCanvas].flatMap(({ placements }) => placements)).toHaveLength(4);
      for (const placement of [canvas, secondCanvas].flatMap(({ placements }) => placements)) {
        expect(placement.target.targetType).toBe('project_media_ref');
        expect(
          Number(
            (
              database
                .prepare('SELECT count(*) AS count FROM project_media_refs WHERE id = ?')
                .get(placement.target.targetId) as { readonly count: number }
            ).count,
          ),
        ).toBe(1);
      }
      expect(canvas.edges).toHaveLength(1);
      expect(canvas.annotations).toEqual(
        expect.arrayContaining([expect.objectContaining({ text: 'Imported canvas note.' })]),
      );
      expect(
        database
          .prepare(
            `SELECT count(*) AS count
               FROM imported_history_records
              WHERE schema_id = 'legacy.unmigrated_payload.v1'`,
          )
          .get(),
      ).toEqual({ count: 2 });
      expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    } finally {
      store.close();
    }
    const offlineExport = JSON.parse(
      await readFile(join(source.targetRootPath, 'legacy-offline-export.json'), 'utf8'),
    ) as {
      readonly entries: readonly {
        readonly subject: { readonly table: string; readonly path: string };
        readonly payloadRef: string;
      }[];
      readonly payloads: readonly { readonly payloadRef: string }[];
    };
    const settingEntries = offlineExport.entries.filter(
      ({ subject }) => subject.table === 'project_settings',
    );
    expect(settingEntries.filter(({ subject }) => subject.path === '$')).toHaveLength(2);
    expect(
      settingEntries.every(({ payloadRef }) =>
        offlineExport.payloads.some((payload) => payload.payloadRef === payloadRef),
      ),
    ).toBe(true);
    for (const item of Object.values(source.media)) {
      await createFilesystemMediaCas(join(source.targetRootPath, 'media')).verify({
        hash: item.hash,
        byteLength: item.bytes.byteLength,
      });
    }
    expect(await readFile(source.mainDatabasePath)).toEqual(sourceMainBefore);
    expect(await readFile(source.promptsDatabasePath)).toEqual(sourcePromptsBefore);
    expect(
      await Promise.all(Object.values(source.media).map(({ path }) => readFile(path))),
    ).toEqual(sourceMediaBefore);

    const repeatedParent = join(source.directory, 'r');
    await mkdir(repeatedParent);
    const repeatedTargetRootPath = join(repeatedParent, basename(source.targetRootPath));
    const repeatedReport = await rehearseDisposableLegacyMigration({
      paths: source,
      targetRootPath: repeatedTargetRootPath,
      readiness: prepared.readiness,
      plan: prepared.plan,
      skillBundle: prepared.skillBundle,
      builtInSkills: prepared.builtInSkills,
      skillPlan: prepared.skillPlan,
      browserState: prepared.browserState,
      probeAudioVisual,
    });
    expect(repeatedReport).toEqual(report);
    const repeatedStore = await openTargetStore(join(repeatedTargetRootPath, 'target.sqlite'));
    repeatedStore.close();
    for (const item of Object.values(source.media)) {
      await createFilesystemMediaCas(join(repeatedTargetRootPath, 'media')).verify({
        hash: item.hash,
        byteLength: item.bytes.byteLength,
      });
    }
    expect(await readFile(source.mainDatabasePath)).toEqual(sourceMainBefore);
    expect(await readFile(source.promptsDatabasePath)).toEqual(sourcePromptsBefore);
    expect(
      await Promise.all(Object.values(source.media).map(({ path }) => readFile(path))),
    ).toEqual(sourceMediaBefore);
  }, 30_000);

  it('runs the same full desktop startup composition harness as a fresh install', async () => {
    const source = await fixture();
    const prepared = await prepareMigration(source);
    const report = await rehearseDisposableLegacyMigration({
      paths: source,
      targetRootPath: source.targetRootPath,
      readiness: prepared.readiness,
      plan: prepared.plan,
      skillBundle: prepared.skillBundle,
      builtInSkills: prepared.builtInSkills,
      skillPlan: prepared.skillPlan,
      browserState: prepared.browserState,
      probeAudioVisual,
    });

    expect(report.ok).toBe(true);
    await assertTargetCompositionStartup({
      databasePath: join(source.targetRootPath, 'target.sqlite'),
      expectedDatabaseCreated: false,
      expectedProjectIds: ['canvas.a', 'canvas.b'],
    });
  }, 30_000);

  it('runs the same target-native replay on the migrated target without scheduling imported history', async () => {
    const source = await fixture();
    const prepared = await prepareMigration(source);
    const report = await rehearseDisposableLegacyMigration({
      paths: source,
      targetRootPath: source.targetRootPath,
      readiness: prepared.readiness,
      plan: prepared.plan,
      skillBundle: prepared.skillBundle,
      builtInSkills: prepared.builtInSkills,
      skillPlan: prepared.skillPlan,
      browserState: prepared.browserState,
      probeAudioVisual,
    });
    const databasePath = join(source.targetRootPath, 'target.sqlite');
    const beforeStore = await openTargetStore(databasePath);
    let importedBefore: ReturnType<typeof importedHistorySnapshot>;
    try {
      importedBefore = importedHistorySnapshot(getTargetStoreDatabase(beforeStore));
    } finally {
      beforeStore.close();
    }

    expect(report.ok).toBe(true);
    expect(importedBefore.counts).toContainEqual(['imported_run_history', 3]);
    const replay = await runTargetNativeSyntheticReplay({
      databasePath,
      store: await openTargetStoreForReplay(databasePath),
      dependencies: createJourneyDependencies(),
      createId: deterministicIds(),
    });

    const afterStore = await openTargetStore(databasePath);
    try {
      const database = getTargetStoreDatabase(afterStore);
      expect(importedHistorySnapshot(database)).toEqual(importedBefore);
      expect(
        database
          .prepare('SELECT id FROM projects ORDER BY id')
          .all()
          .map(({ id }) => id),
      ).toEqual(['canvas.a', 'canvas.b', replay.nativeProjectId].sort());
      expect(
        database
          .prepare(
            `SELECT
               (SELECT count(*)
                  FROM runs AS live
                  JOIN imported_run_history AS imported ON imported.id = live.id) AS imported_run_count,
               (SELECT count(*)
                  FROM task_lists AS live
                  JOIN imported_task_list_history AS imported ON imported.id = live.id) AS imported_task_list_count,
               (SELECT count(*)
                  FROM task_items AS live
                  JOIN imported_task_item_history AS imported ON imported.id = live.id) AS imported_task_item_count`,
          )
          .get(),
      ).toEqual({
        imported_run_count: 0,
        imported_task_list_count: 0,
        imported_task_item_count: 0,
      });
      expect(
        database
          .prepare('SELECT id FROM runs WHERE id IN (?, ?, ?) ORDER BY id')
          .all(replay.rootRunId, replay.childRunId, replay.retryRunId)
          .map(({ id }) => id),
      ).toEqual([replay.rootRunId, replay.childRunId, replay.retryRunId].sort());
      expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    } finally {
      afterStore.close();
    }
  }, 30_000);

  it('blocks a nonempty Legacy dependencies relation before it can form a migration plan', async () => {
    const source = await fixture();
    const mainWrite = new DatabaseSync(source.mainDatabasePath);
    try {
      insert(
        mainWrite,
        `INSERT INTO dependencies (source_type, source_id, target_type, target_id)
         VALUES ('character', 'character.shared', 'equipment', 'equipment.shared')`,
      );
    } finally {
      mainWrite.close();
    }
    const preflight = await preflightLegacyInputs(source);
    const skillPlan = representativeSkillPlan();
    const mainRead = new DatabaseSync(source.mainDatabasePath, { readOnly: true });
    const prompts = new DatabaseSync(source.promptsDatabasePath, { readOnly: true });
    try {
      if (preflight.media.status !== 'checked') throw new Error('Media preflight was skipped');
      const phaseOne = classifyLegacyPhaseOne(
        { main: mainRead, prompts },
        I0_LEGACY_SOURCE_SCHEMAS,
        preflight.media.report,
        { root: { classifyLegacySkillRows: createLegacySkillRowClassifier(skillPlan) } },
      );
      const readiness = buildLegacyMigrationReadinessReport({ preflight, phaseOne });
      expect(readiness.ok).toBe(false);
      expect(
        phaseOne.rootRows.classification.blockers.map(({ blockerCode }) => blockerCode),
      ).toContain('ambiguous_legacy_dependency_relation');
    } finally {
      prompts.close();
      mainRead.close();
    }
  });

  it('blocks an unknown Legacy Project setting before target creation', async () => {
    const source = await fixture();
    const mainWrite = new DatabaseSync(source.mainDatabasePath);
    try {
      insert(
        mainWrite,
        'INSERT INTO project_settings (key, value, updated_at) VALUES (?, ?, ?)',
        'unknown.private.setting',
        canonicalJson({ privateValue: true }),
        UPDATED_AT,
      );
    } finally {
      mainWrite.close();
    }
    const preflight = await preflightLegacyInputs(source);
    const skillPlan = representativeSkillPlan();
    const mainRead = new DatabaseSync(source.mainDatabasePath, { readOnly: true });
    const prompts = new DatabaseSync(source.promptsDatabasePath, { readOnly: true });
    try {
      if (preflight.media.status !== 'checked') throw new Error('Media preflight was skipped');
      const phaseOne = classifyLegacyPhaseOne(
        { main: mainRead, prompts },
        I0_LEGACY_SOURCE_SCHEMAS,
        preflight.media.report,
        { root: { classifyLegacySkillRows: createLegacySkillRowClassifier(skillPlan) } },
      );
      const readiness = buildLegacyMigrationReadinessReport({ preflight, phaseOne });
      expect(readiness.ok).toBe(false);
      expect(
        phaseOne.rootRows.classification.blockers.map(({ blockerCode }) => blockerCode),
      ).toContain('unknown_legacy_project_setting_key');
      expect(() => buildLegacyMigrationPlan({ readiness, phaseOne })).toThrow();
      await expect(access(source.targetRootPath)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      prompts.close();
      mainRead.close();
    }
  });

  it('blocks a backdrop that carries a forbidden media reference before target creation', async () => {
    const source = await fixture();
    const mainWrite = new DatabaseSync(source.mainDatabasePath);
    try {
      insert(
        mainWrite,
        `INSERT INTO canvas_nodes (
           id, canvas_id, type, position_x, position_y, width, height, data_json, z_index,
           created_at, updated_at
         ) VALUES ('node.backdrop.blocked', 'canvas.a', 'backdrop', 0, 0, 640, 480, ?, 0, ?, ?)`,
        canonicalJson({ assetHash: source.media.image.hash }),
        ISO_CREATED_AT,
        ISO_UPDATED_AT,
      );
    } finally {
      mainWrite.close();
    }
    const preflight = await preflightLegacyInputs(source);
    expect(preflight.ok).toBe(false);
    expect(preflight.canvasNodeMedia.status).toBe('checked');
    if (preflight.canvasNodeMedia.status !== 'checked')
      throw new Error('Canvas node preflight was skipped');
    expect(preflight.canvasNodeMedia.report.blockers).toContainEqual(
      expect.objectContaining({
        kind: 'canvas_node_media_path_not_allowed',
        nodeKind: 'backdrop',
        path: '$.assetHash',
      }),
    );
    await expect(access(source.targetRootPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
