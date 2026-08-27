import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { hashCanonical } from '../internal/hashes.js';
import {
  LEGACY_MIGRATION_DISPOSITIONS,
  type LegacyMigrationDisposition,
} from './classification-report.js';
import {
  assertLegacyMigrationPlan,
  buildLegacyMigrationPlan,
  validateLegacyMigrationPlan,
} from './legacy-migration-plan.js';
import type { LegacyMediaPreflightReport } from './media-preflight.js';
import type { LegacyMigrationReadinessReport } from './migration-readiness.js';
import {
  classifyLegacyPhaseOne,
  type LegacyPhaseOneClassificationReport,
} from './phase-one-classification.js';
import type { LegacySourceExpectedSchemas } from './source-preflight.js';

const databases: DatabaseSync[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function mediaReport(): LegacyMediaPreflightReport {
  return {
    database: { assetCount: 0, declaredBytes: '0', nullOrZeroSizeCount: 0 },
    cas: { mediaFileCount: 0, mediaBytes: '0', sidecarFileCount: 0, sidecarBytes: '0' },
    verifiedAssetCount: 0,
    verifiedAssetHashes: [],
    fingerprint: digest('migration-plan-media'),
    blockers: [],
    ok: true,
  };
}

function phaseOneFixture(): LegacyPhaseOneClassificationReport {
  const main = new DatabaseSync(':memory:');
  const prompts = new DatabaseSync(':memory:');
  databases.push(main, prompts);
  main.exec(`
    CREATE TABLE canvases (id TEXT);
    CREATE TABLE task_lists (entity_id TEXT, entity_type TEXT, id TEXT, metadata_json TEXT);
    CREATE TABLE tasks (dependency_ids_json TEXT, id TEXT, task_list_id TEXT);
    INSERT INTO canvases VALUES ('project.1');
    INSERT INTO task_lists VALUES ('project.1', 'canvas', 'task-list.1', '{}');
    INSERT INTO tasks VALUES ('["Private prerequisite"]', 'task.1', 'task-list.1');
  `);
  const expected: LegacySourceExpectedSchemas = {
    main: {
      tables: [
        { name: 'canvases', kind: 'table', columns: ['id'] },
        {
          name: 'task_lists',
          kind: 'table',
          columns: ['entity_id', 'entity_type', 'id', 'metadata_json'],
        },
        {
          name: 'tasks',
          kind: 'table',
          columns: ['dependency_ids_json', 'id', 'task_list_id'],
        },
      ],
    },
    prompts: { tables: [] },
  };
  return classifyLegacyPhaseOne({ main, prompts }, expected, mediaReport(), {
    embeddedJson: {
      sources: [{ database: 'main', table: 'tasks', columns: ['dependency_ids_json'] }],
    },
  });
}

function readinessFor(
  phaseOne: LegacyPhaseOneClassificationReport,
): LegacyMigrationReadinessReport {
  const rootCounts = phaseOne.rootRows.classification.counts;
  const embeddedCounts = phaseOne.embeddedJson.classification.counts;
  const byDisposition = Object.fromEntries(
    LEGACY_MIGRATION_DISPOSITIONS.map((disposition) => [
      disposition,
      rootCounts.byDisposition[disposition] + embeddedCounts.byDisposition[disposition],
    ]),
  ) as Record<LegacyMigrationDisposition, number>;
  const withoutFingerprint = {
    schema: 'lucid-fin.legacy-migration-readiness/v1' as const,
    status: 'ready_for_disposable_dry_run' as const,
    source: {
      schemaFingerprint: digest('migration-plan-schema'),
      contentFingerprint: phaseOne.sourceContentFingerprint,
      preflightFingerprint: digest('migration-plan-preflight'),
      classificationFingerprint: phaseOne.sourceFingerprint,
      phaseOneFingerprint: phaseOne.fingerprint,
    },
    counts: {
      rootSubjectCount: rootCounts.subjectCount,
      embeddedSubjectCount: embeddedCounts.subjectCount,
      classifiedSubjectCount: rootCounts.classifiedCount + embeddedCounts.classifiedCount,
      targetRefCount: rootCounts.targetRefCount + embeddedCounts.targetRefCount,
      cloneRefCount: rootCounts.cloneRefCount + embeddedCounts.cloneRefCount,
      byDisposition,
    },
    blockers: [],
  };
  return { ...withoutFingerprint, fingerprint: hashCanonical(withoutFingerprint), ok: true };
}

function rehashReadiness(
  readiness: LegacyMigrationReadinessReport,
): LegacyMigrationReadinessReport {
  const { fingerprint: _fingerprint, ok: _ok, ...withoutFingerprint } = readiness;
  return { ...readiness, fingerprint: hashCanonical(withoutFingerprint) };
}

describe('Legacy deterministic migration plan', () => {
  it('builds one redacted content-addressed plan with exact root and embedded target-ref proof', () => {
    const phaseOne = phaseOneFixture();
    const readiness = readinessFor(phaseOne);

    const first = buildLegacyMigrationPlan({ readiness, phaseOne });
    const second = buildLegacyMigrationPlan({ readiness, phaseOne });

    expect(phaseOne.ok).toBe(true);
    expect(first).toEqual(second);
    expect(first).toMatchObject({
      schema: 'lucid-fin.legacy-migration-plan/v1',
      planId: `legacy.migration-plan.${first.fingerprint}`,
      source: {
        readinessFingerprint: readiness.fingerprint,
        phaseOneFingerprint: phaseOne.fingerprint,
      },
    });
    expect(first.operations.map(({ sourceKey }) => sourceKey)).toEqual(
      [...first.operations.map(({ sourceKey }) => sourceKey)].sort(),
    );
    expect(first.operations).toHaveLength(
      phaseOne.rootRows.classification.entries.length +
        phaseOne.embeddedJson.classification.entries.length,
    );
    const classified = [
      ...phaseOne.rootRows.classification.entries.map((entry) => ({
        scope: 'root_rows' as const,
        entry,
      })),
      ...phaseOne.embeddedJson.classification.entries.map((entry) => ({
        scope: 'embedded_json_members' as const,
        entry,
      })),
    ].sort(
      (left, right) =>
        left.entry.sourceKey.localeCompare(right.entry.sourceKey) ||
        left.scope.localeCompare(right.scope),
    );
    expect(first.operations).toEqual(
      classified.map(({ scope, entry }, ordinal) => ({
        ordinal,
        scope,
        disposition: entry.disposition,
        reasonCode: entry.reasonCode,
        sourceKey: entry.sourceKey,
        subject: entry.subject,
        targetRefs: entry.targetRefs,
        exportRef: entry.exportRef,
      })),
    );
    expect(first.targetRefs).toEqual(
      first.operations.map(({ scope, sourceKey, targetRefs }) => ({
        scope,
        sourceKey,
        targetRefs,
      })),
    );
    expect(first.operations.some(({ targetRefs }) => targetRefs.length > 0)).toBe(true);
    expect(JSON.stringify(first)).not.toContain('Private prerequisite');
    expect(JSON.stringify(first)).not.toMatch(/(?:^|["'])(?:[A-Za-z]:[\\/]|[\\/]{2}|\/)/);
    expect(validateLegacyMigrationPlan(first)).toEqual({ ok: true, errors: [] });
    expect(() => assertLegacyMigrationPlan(first)).not.toThrow();

    const tampered = {
      ...first,
      operations: first.operations.map((operation, index) =>
        index === 0 ? { ...operation, targetRefs: [] } : operation,
      ),
    };
    expect(validateLegacyMigrationPlan(tampered).errors).toContain('target_ref_proof_mismatch');
    expect(() => assertLegacyMigrationPlan(tampered)).toThrow('target reference proof');

    const ambiguousPath = {
      ...first,
      operations: first.operations.map((operation, index) =>
        index === 0
          ? { ...operation, subject: { ...operation.subject, path: '$.unsafe\u0000member' } }
          : operation,
      ),
    };
    expect(validateLegacyMigrationPlan(ambiguousPath).errors).toContain('invalid_operation');
  });

  it('refuses a blocked or differently bound readiness report before planning', () => {
    const phaseOne = phaseOneFixture();
    const readiness = readinessFor(phaseOne);
    const blocked = rehashReadiness({
      ...readiness,
      status: 'blocked_before_target_write',
      blockers: [{ kind: 'source_snapshot_mismatch' }],
      ok: false,
    });
    const mismatched = rehashReadiness({
      ...readiness,
      source: { ...readiness.source, contentFingerprint: digest('different-content') },
    });

    expect(() => buildLegacyMigrationPlan({ readiness: blocked, phaseOne })).toThrow(
      'readiness gate',
    );
    expect(() => buildLegacyMigrationPlan({ readiness: mismatched, phaseOne })).toThrow(
      'fingerprint bindings',
    );
  });
});
