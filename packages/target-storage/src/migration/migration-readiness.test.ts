import { createHash } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { SCHEMA_SQL } from '../../../storage/src/schema-sql.js';
import { openTargetStore } from '../kernel/store.js';
import { rehearseEmptyLegacySource } from './empty-source-rehearsal.js';
import { I0_LEGACY_SOURCE_SCHEMAS } from './legacy-source-schema.js';
import { preflightLegacyInputs } from './legacy-preflight.js';
import { buildLegacyMigrationReadinessReport } from './migration-readiness.js';
import {
  buildLegacyOfflineExportBundle,
  writeLegacyOfflineExportBundle,
} from './offline-export.js';
import { classifyLegacyPhaseOne } from './phase-one-classification.js';

const temporaryDirectories: string[] = [];

interface LegacyFixture {
  readonly directory: string;
  readonly mainDatabasePath: string;
  readonly promptsDatabasePath: string;
  readonly assetsRoot: string;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function fixture(): Promise<LegacyFixture> {
  const directory = await mkdtemp(join(tmpdir(), 'lucid-fin-migration-readiness-'));
  temporaryDirectories.push(directory);
  const mainDatabasePath = join(directory, 'lucid-fin.db');
  const promptsDatabasePath = join(directory, 'prompts.db');
  const assetsRoot = join(directory, 'assets');
  await mkdir(assetsRoot);

  const main = new DatabaseSync(mainDatabasePath);
  try {
    main.exec(SCHEMA_SQL);
  } finally {
    main.close();
  }
  const prompts = new DatabaseSync(promptsDatabasePath);
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
  } finally {
    prompts.close();
  }
  return { directory, mainDatabasePath, promptsDatabasePath, assetsRoot };
}

function insertPromptAssembly(source: LegacyFixture): void {
  const database = new DatabaseSync(source.mainDatabasePath);
  try {
    database
      .prepare(
        `INSERT INTO prompt_assemblies (
           id, canvas_id, node_id, node_updated_at, media_type, mode, purpose,
           authority_json, sources_json, conditioning_manifest_json, provider_profile_json,
           host_constraints_json, input_json, input_hash, status, created_at, updated_at
         ) VALUES (?, ?, ?, 1, 'image', 'text-to-image', 'initial', ?, ?, ?, ?, ?, ?, ?,
                   'prepared', 1, 1)`,
      )
      .run(
        'assembly.readiness',
        'canvas.readiness',
        'node.readiness',
        '{"Private authority":true}',
        '{"Private sources":true}',
        '{"Private conditioning":true}',
        '{"Private provider":true}',
        '{"Private constraints":true}',
        '{"Private input":true}',
        '0'.repeat(64),
      );
  } finally {
    database.close();
  }
}

function insertOfflineColorStyle(source: LegacyFixture): void {
  const database = new DatabaseSync(source.mainDatabasePath);
  try {
    database
      .prepare(
        `INSERT INTO color_styles (
           id, name, source_type, palette, gradients, exposure, tags, created_at, updated_at
         ) VALUES ('style.readiness', 'Offline style', 'manual', '[]', '[]', '{}', '[]', 1, 1)`,
      )
      .run();
  } finally {
    database.close();
  }
}

async function classify(
  source: LegacyFixture,
  preflight: Awaited<ReturnType<typeof preflightLegacyInputs>>,
) {
  if (preflight.media.status !== 'checked') {
    throw new Error('Readiness fixture media preflight did not run');
  }
  const main = new DatabaseSync(source.mainDatabasePath, { readOnly: true });
  const prompts = new DatabaseSync(source.promptsDatabasePath, { readOnly: true });
  try {
    return classifyLegacyPhaseOne(
      { main, prompts },
      I0_LEGACY_SOURCE_SCHEMAS,
      preflight.media.report,
    );
  } finally {
    prompts.close();
    main.close();
  }
}

describe('Legacy migration prewrite readiness', () => {
  it('allows only a fully clear, same-snapshot source into disposable dry run', async () => {
    const source = await fixture();
    const preflight = await preflightLegacyInputs(source);
    const phaseOne = await classify(source, preflight);

    const first = buildLegacyMigrationReadinessReport({ preflight, phaseOne });
    const second = buildLegacyMigrationReadinessReport({ preflight, phaseOne });

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      schema: 'lucid-fin.legacy-migration-readiness/v1',
      status: 'ready_for_disposable_dry_run',
      blockers: [],
      counts: {
        rootSubjectCount: 0,
        embeddedSubjectCount: 0,
        classifiedSubjectCount: 0,
      },
      ok: true,
    });
    expect(first.source.contentFingerprint).toBe(phaseOne.sourceContentFingerprint);
    expect(first.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it('blocks classified migration findings before any target write without leaking values', async () => {
    const source = await fixture();
    insertPromptAssembly(source);
    const preflight = await preflightLegacyInputs(source);
    const phaseOne = await classify(source, preflight);

    const report = buildLegacyMigrationReadinessReport({ preflight, phaseOne });

    expect(preflight.ok).toBe(true);
    expect(report.status).toBe('blocked_before_target_write');
    expect(report.blockers.map(({ kind }) => kind)).toEqual([
      'root_classification_blocked',
      'embedded_json_classification_blocked',
    ]);
    expect(report.ok).toBe(false);
    expect(JSON.stringify(report)).not.toContain('Private');
  });

  it('blocks when preflight and classification inspected different source snapshots', async () => {
    const source = await fixture();
    const preflight = await preflightLegacyInputs(source);
    insertPromptAssembly(source);
    const phaseOne = await classify(source, preflight);

    const report = buildLegacyMigrationReadinessReport({ preflight, phaseOne });

    expect(report.status).toBe('blocked_before_target_write');
    expect(report.blockers.map(({ kind }) => kind)).toContain('source_snapshot_mismatch');
    expect(report.ok).toBe(false);
  });
});

describe('empty Legacy source rehearsal', () => {
  it('creates and reopens one canonical disposable target without mutating source evidence', async () => {
    const source = await fixture();
    const preflight = await preflightLegacyInputs(source);
    const phaseOne = await classify(source, preflight);
    const readiness = buildLegacyMigrationReadinessReport({ preflight, phaseOne });
    const targetDatabasePath = join(source.directory, 'target.sqlite');

    const report = await rehearseEmptyLegacySource({ readiness, targetDatabasePath });

    expect(report).toMatchObject({
      schema: 'lucid-fin.legacy-empty-source-rehearsal/v1',
      source: {
        readinessFingerprint: readiness.fingerprint,
        contentFingerprint: readiness.source.contentFingerprint,
      },
      target: { reopenVerified: true },
      ok: true,
    });
    expect(report.target.schemaFingerprint).toBe(report.target.reopenedSchemaFingerprint);
    expect(report.target.contentFingerprint).toBe(report.target.reopenedContentFingerprint);
    expect(report.target.tableCounts).toContainEqual({ table: 'projects', rowCount: '0' });
    expect(report.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    const reopened = await openTargetStore(targetDatabasePath);
    expect(reopened.schemaFingerprint.sha256).toBe(report.target.schemaFingerprint);
    reopened.close();
  });

  it('leaves no target file when the readiness gate is blocked', async () => {
    const source = await fixture();
    insertPromptAssembly(source);
    const preflight = await preflightLegacyInputs(source);
    const phaseOne = await classify(source, preflight);
    const readiness = buildLegacyMigrationReadinessReport({ preflight, phaseOne });
    const targetDatabasePath = join(source.directory, 'blocked-target.sqlite');

    await expect(rehearseEmptyLegacySource({ readiness, targetDatabasePath })).rejects.toThrow(
      'readiness gate',
    );
    await expect(access(targetDatabasePath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('refuses a clear but non-empty source instead of pretending to transform it', async () => {
    const source = await fixture();
    insertOfflineColorStyle(source);
    const preflight = await preflightLegacyInputs(source);
    const phaseOne = await classify(source, preflight);
    const readiness = buildLegacyMigrationReadinessReport({ preflight, phaseOne });
    const targetDatabasePath = join(source.directory, 'non-empty-target.sqlite');

    expect(readiness.ok).toBe(true);
    expect(readiness.counts.rootSubjectCount).toBe(1);
    await expect(rehearseEmptyLegacySource({ readiness, targetDatabasePath })).rejects.toThrow(
      'zero-subject source',
    );
    await expect(access(targetDatabasePath)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

describe('Legacy offline export bundle', () => {
  it('captures every offline disposition once while deduplicating nested payloads', async () => {
    const source = await fixture();
    insertOfflineColorStyle(source);
    const preflight = await preflightLegacyInputs(source);
    const phaseOne = await classify(source, preflight);
    const main = new DatabaseSync(source.mainDatabasePath, { readOnly: true });
    const prompts = new DatabaseSync(source.promptsDatabasePath, { readOnly: true });
    try {
      const first = buildLegacyOfflineExportBundle(
        { main, prompts },
        I0_LEGACY_SOURCE_SCHEMAS,
        phaseOne,
      );
      const second = buildLegacyOfflineExportBundle(
        { main, prompts },
        I0_LEGACY_SOURCE_SCHEMAS,
        phaseOne,
      );

      const offlineEntries = [
        ...phaseOne.rootRows.classification.entries,
        ...phaseOne.embeddedJson.classification.entries,
      ].filter(({ disposition }) => disposition === 'offline_legacy_export');
      expect(first).toEqual(second);
      expect(first).toMatchObject({
        schema: 'lucid-fin.legacy-offline-export/v1',
        entryCount: offlineEntries.length,
      });
      expect(first.entries.map(({ sourceKey }) => sourceKey)).toEqual(
        offlineEntries.map(({ sourceKey }) => sourceKey).sort(),
      );
      expect(first.payloads).toHaveLength(1);
      expect(new Set(first.entries.map(({ payloadRef }) => payloadRef))).toEqual(
        new Set(first.payloads.map(({ payloadRef }) => payloadRef)),
      );
      expect(first.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    } finally {
      prompts.close();
      main.close();
    }
  });

  it('rejects a source changed after Phase-1 classification', async () => {
    const source = await fixture();
    insertOfflineColorStyle(source);
    const preflight = await preflightLegacyInputs(source);
    const phaseOne = await classify(source, preflight);
    const writable = new DatabaseSync(source.mainDatabasePath);
    writable.prepare("UPDATE color_styles SET name = 'Changed after classification'").run();
    writable.close();
    const main = new DatabaseSync(source.mainDatabasePath, { readOnly: true });
    const prompts = new DatabaseSync(source.promptsDatabasePath, { readOnly: true });
    try {
      expect(() =>
        buildLegacyOfflineExportBundle({ main, prompts }, I0_LEGACY_SOURCE_SCHEMAS, phaseOne),
      ).toThrow('different source snapshot');
    } finally {
      prompts.close();
      main.close();
    }
  });

  it('writes one canonical path-private artifact without overwriting an existing file', async () => {
    const source = await fixture();
    insertOfflineColorStyle(source);
    const preflight = await preflightLegacyInputs(source);
    const phaseOne = await classify(source, preflight);
    const main = new DatabaseSync(source.mainDatabasePath, { readOnly: true });
    const prompts = new DatabaseSync(source.promptsDatabasePath, { readOnly: true });
    try {
      const bundle = buildLegacyOfflineExportBundle(
        { main, prompts },
        I0_LEGACY_SOURCE_SCHEMAS,
        phaseOne,
      );
      const exportPath = join(source.directory, 'legacy-offline-export.json');

      const report = await writeLegacyOfflineExportBundle(bundle, exportPath);
      const bytes = await readFile(exportPath);

      expect(report).toMatchObject({
        schema: 'lucid-fin.legacy-offline-export-write-report/v1',
        bundleFingerprint: bundle.fingerprint,
        entryCount: bundle.entryCount,
        payloadCount: bundle.payloadCount,
        byteLength: String(bytes.byteLength),
        sha256: createHash('sha256').update(bytes).digest('hex'),
        ok: true,
      });
      expect(JSON.parse(bytes.toString('utf8'))).toMatchObject({
        schema: bundle.schema,
        fingerprint: bundle.fingerprint,
      });
      expect(JSON.stringify(report)).not.toContain('Offline style');
      await expect(writeLegacyOfflineExportBundle(bundle, exportPath)).rejects.toMatchObject({
        code: 'EEXIST',
      });
      expect(await readFile(exportPath)).toEqual(bytes);
    } finally {
      prompts.close();
      main.close();
    }
  });
});
