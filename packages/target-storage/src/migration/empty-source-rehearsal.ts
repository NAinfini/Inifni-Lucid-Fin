import { unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { hashCanonical } from '../internal/hashes.js';
import { createTargetStore, openTargetStore, type TargetStore } from '../kernel/store.js';
import { getTargetStoreDatabase } from '../internal/database-access.js';
import type { LegacyMigrationReadinessReport } from './migration-readiness.js';

export interface EmptyLegacyTargetTableCount {
  readonly table: string;
  readonly rowCount: string;
}

export interface EmptyLegacySourceRehearsalInput {
  readonly readiness: LegacyMigrationReadinessReport;
  readonly targetDatabasePath: string;
}

export interface EmptyLegacySourceRehearsalReport {
  readonly schema: 'lucid-fin.legacy-empty-source-rehearsal/v1';
  readonly source: Readonly<{
    readinessFingerprint: string;
    contentFingerprint: string;
  }>;
  readonly target: Readonly<{
    schemaFingerprint: string;
    reopenedSchemaFingerprint: string;
    tableCounts: readonly EmptyLegacyTargetTableCount[];
    contentFingerprint: string;
    reopenedContentFingerprint: string;
    reopenVerified: true;
  }>;
  readonly fingerprint: string;
  readonly ok: true;
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function targetTableCounts(store: TargetStore): readonly EmptyLegacyTargetTableCount[] {
  const database = getTargetStoreDatabase(store);
  const tables = (
    database.prepare('PRAGMA table_list').all() as unknown as readonly {
      readonly name: string;
      readonly schema: string;
      readonly type: string;
    }[]
  )
    .filter(
      ({ name, schema, type }) =>
        schema === 'main' &&
        !name.startsWith('sqlite_') &&
        (type === 'table' || type === 'virtual'),
    )
    .map(({ name }) => name)
    .sort();
  return tables.map((table) => {
    const statement = database.prepare(
      `SELECT COUNT(*) AS row_count FROM ${quoteIdentifier(table)}`,
    );
    statement.setReadBigInts(true);
    const row = statement.get() as unknown as { readonly row_count: bigint };
    return { table, rowCount: row.row_count.toString() };
  });
}

function assertEmptySourceReadiness(readiness: LegacyMigrationReadinessReport): void {
  const { fingerprint, ok, ...fingerprintInput } = readiness;
  if (hashCanonical(fingerprintInput) !== fingerprint) {
    throw new TypeError('Legacy migration readiness report fingerprint does not match');
  }
  if (
    !ok ||
    readiness.status !== 'ready_for_disposable_dry_run' ||
    readiness.blockers.length !== 0
  ) {
    throw new TypeError('Legacy migration readiness gate is blocked');
  }
  const { counts } = readiness;
  if (
    counts.rootSubjectCount !== 0 ||
    counts.embeddedSubjectCount !== 0 ||
    counts.classifiedSubjectCount !== 0 ||
    counts.targetRefCount !== 0 ||
    counts.cloneRefCount !== 0 ||
    Object.values(counts.byDisposition).some((count) => count !== 0)
  ) {
    throw new TypeError('Empty Legacy source rehearsal requires a zero-subject source');
  }
}

/** Creates only the canonical target store for the explicit empty-install fixture. */
export async function rehearseEmptyLegacySource(
  input: EmptyLegacySourceRehearsalInput,
): Promise<EmptyLegacySourceRehearsalReport> {
  assertEmptySourceReadiness(input.readiness);
  const targetDatabasePath = resolve(input.targetDatabasePath);
  let store: TargetStore | undefined;
  let created = false;
  let complete = false;
  try {
    store = await createTargetStore(targetDatabasePath);
    created = true;
    const schemaFingerprint = store.schemaFingerprint.sha256;
    const tableCounts = targetTableCounts(store);
    const contentFingerprint = hashCanonical(tableCounts);
    store.close();
    store = await openTargetStore(targetDatabasePath);
    const reopenedSchemaFingerprint = store.schemaFingerprint.sha256;
    const reopenedTableCounts = targetTableCounts(store);
    const reopenedContentFingerprint = hashCanonical(reopenedTableCounts);
    if (reopenedSchemaFingerprint !== schemaFingerprint) {
      throw new Error('Disposable target schema fingerprint changed after reopen');
    }
    if (reopenedContentFingerprint !== contentFingerprint) {
      throw new Error('Disposable target content fingerprint changed after reopen');
    }
    const withoutFingerprint = {
      schema: 'lucid-fin.legacy-empty-source-rehearsal/v1' as const,
      source: {
        readinessFingerprint: input.readiness.fingerprint,
        contentFingerprint: input.readiness.source.contentFingerprint,
      },
      target: {
        schemaFingerprint,
        reopenedSchemaFingerprint,
        tableCounts,
        contentFingerprint,
        reopenedContentFingerprint,
        reopenVerified: true as const,
      },
    };
    complete = true;
    return {
      ...withoutFingerprint,
      fingerprint: hashCanonical(withoutFingerprint),
      ok: true,
    };
  } finally {
    store?.close();
    if (created && !complete) {
      await unlink(targetDatabasePath).catch((cause: NodeJS.ErrnoException) => {
        if (cause.code !== 'ENOENT') throw cause;
      });
    }
  }
}
