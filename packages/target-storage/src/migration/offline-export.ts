import { createHash, randomUUID } from 'node:crypto';
import { link, open, unlink } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { canonicalJson } from '@lucid-fin/target-contracts';
import { hashCanonical } from '../internal/hashes.js';
import {
  legacyClassificationSourceKey,
  type LegacyClassificationEntry,
  type LegacyClassificationSubject,
} from './classification-report.js';
import { scanLegacyRowsForClassification } from './classification-subjects.js';
import {
  scanLegacyEmbeddedJsonMembersForClassification,
  type LegacyEmbeddedJsonMember,
  type LegacyEmbeddedJsonSource,
} from './embedded-json-classification.js';
import type { LegacyPhaseOneClassificationReport } from './phase-one-classification.js';
import type { LegacySourceDatabases, LegacySourceExpectedSchemas } from './source-preflight.js';

export type LegacyOfflineEncodedValue =
  | { readonly kind: 'null' }
  | { readonly kind: 'boolean'; readonly value: boolean }
  | { readonly kind: 'number'; readonly value: string }
  | { readonly kind: 'integer'; readonly value: string }
  | { readonly kind: 'text'; readonly value: string }
  | {
      readonly kind: 'blob';
      readonly byteLength: number;
      readonly sha256: string;
      readonly base64: string;
    }
  | { readonly kind: 'array'; readonly items: readonly LegacyOfflineEncodedValue[] }
  | {
      readonly kind: 'object';
      readonly entries: readonly {
        readonly key: string;
        readonly value: LegacyOfflineEncodedValue;
      }[];
    };

export interface LegacyOfflineExportEntry {
  readonly sourceKey: string;
  readonly subject: LegacyClassificationSubject;
  readonly reasonCode: string;
  readonly exportRef: string;
  readonly payloadRef: string;
}

export interface LegacyOfflineExportPayload {
  readonly payloadRef: string;
  readonly sourceKey: string;
  readonly value: LegacyOfflineEncodedValue;
  readonly valueHash: string;
}

export interface LegacyOfflineExportBundle {
  readonly schema: 'lucid-fin.legacy-offline-export/v1';
  readonly sourceFingerprint: string;
  readonly sourceContentFingerprint: string;
  readonly phaseOneFingerprint: string;
  readonly entryCount: number;
  readonly payloadCount: number;
  readonly entries: readonly LegacyOfflineExportEntry[];
  readonly payloads: readonly LegacyOfflineExportPayload[];
  readonly contentFingerprint: string;
  readonly fingerprint: string;
}

export interface LegacyOfflineExportWriteReport {
  readonly schema: 'lucid-fin.legacy-offline-export-write-report/v1';
  readonly bundleFingerprint: string;
  readonly entryCount: number;
  readonly payloadCount: number;
  readonly byteLength: string;
  readonly sha256: string;
  readonly fingerprint: string;
  readonly ok: true;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function encodeNumber(value: number): string {
  if (!Number.isFinite(value))
    throw new TypeError('Offline export cannot encode a non-finite number');
  return Object.is(value, -0) ? '-0' : String(value);
}

function encodeValue(value: unknown): LegacyOfflineEncodedValue {
  if (value === null) return { kind: 'null' };
  if (typeof value === 'boolean') return { kind: 'boolean', value };
  if (typeof value === 'number') return { kind: 'number', value: encodeNumber(value) };
  if (typeof value === 'bigint') return { kind: 'integer', value: value.toString() };
  if (typeof value === 'string') return { kind: 'text', value };
  if (value instanceof Uint8Array) {
    return {
      kind: 'blob',
      byteLength: value.byteLength,
      sha256: createHash('sha256').update(value).digest('hex'),
      base64: Buffer.from(value).toString('base64'),
    };
  }
  if (Array.isArray(value)) return { kind: 'array', items: value.map(encodeValue) };
  if (typeof value === 'object') {
    return {
      kind: 'object',
      entries: Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => compareText(left, right))
        .map(([key, item]) => ({ key, value: encodeValue(item) })),
    };
  }
  throw new TypeError(`Offline export cannot encode ${typeof value}`);
}

function embeddedSources(
  phaseOne: LegacyPhaseOneClassificationReport,
): readonly LegacyEmbeddedJsonSource[] {
  const grouped = new Map<
    string,
    { database: 'main' | 'prompts'; table: string; columns: string[] }
  >();
  for (const source of phaseOne.embeddedJson.inventory.bySource) {
    const key = `${source.database}\u0000${source.table}`;
    const existing = grouped.get(key);
    if (existing) existing.columns.push(source.column);
    else {
      grouped.set(key, {
        database: source.database,
        table: source.table,
        columns: [source.column],
      });
    }
  }
  return [...grouped.values()]
    .map((source) => ({ ...source, columns: source.columns.sort(compareText) }))
    .sort(
      (left, right) =>
        compareText(left.database, right.database) || compareText(left.table, right.table),
    );
}

function memberPathKey(member: LegacyEmbeddedJsonMember, length: number): string {
  return hashCanonical({
    database: member.database,
    table: member.table,
    rowKey: member.rowSubject.rowKey,
    column: member.column,
    memberPath: member.memberPath.slice(0, length),
  });
}

function offlineEntries(
  phaseOne: LegacyPhaseOneClassificationReport,
): readonly LegacyClassificationEntry[] {
  return [
    ...phaseOne.rootRows.classification.entries,
    ...phaseOne.embeddedJson.classification.entries,
  ]
    .filter(({ disposition }) => disposition === 'offline_legacy_export')
    .sort((left, right) => compareText(left.sourceKey, right.sourceKey));
}

/**
 * Builds the versioned private offline artifact in memory. Reports should use
 * only its hashes and counts; the payload values are intentionally not redacted.
 */
export function buildLegacyOfflineExportBundle(
  databases: LegacySourceDatabases,
  expected: LegacySourceExpectedSchemas,
  phaseOne: LegacyPhaseOneClassificationReport,
): LegacyOfflineExportBundle {
  if (!phaseOne.ok) {
    throw new TypeError('Legacy offline export requires a clear Phase-1 classification');
  }
  const classifications = offlineEntries(phaseOne);
  const classificationBySourceKey = new Map(
    classifications.map((entry) => [entry.sourceKey, entry] as const),
  );
  if (classificationBySourceKey.size !== classifications.length) {
    throw new Error('Legacy offline export contains duplicate classification entries');
  }

  const payloads = new Map<string, LegacyOfflineExportPayload>();
  const payloadRefs = new Map<string, string>();
  const rootOfflineSourceKeys = new Set<string>();
  const addPayload = (sourceKey: string, value: unknown): void => {
    if (payloads.has(sourceKey)) throw new Error('Legacy offline export payload is duplicated');
    const encoded = encodeValue(value);
    payloads.set(sourceKey, {
      payloadRef: sourceKey,
      sourceKey,
      value: encoded,
      valueHash: hashCanonical(encoded),
    });
    payloadRefs.set(sourceKey, sourceKey);
  };

  const rootInventory = scanLegacyRowsForClassification(databases, expected, (row) => {
    const sourceKey = legacyClassificationSourceKey(row.subject);
    if (!classificationBySourceKey.has(sourceKey)) return;
    addPayload(sourceKey, row.values);
    rootOfflineSourceKeys.add(sourceKey);
  });
  if (rootInventory.fingerprint !== phaseOne.rootRows.inventory.fingerprint) {
    throw new Error('Legacy offline export inspected a different source snapshot');
  }

  const offlinePayloadByMemberPath = new Map<string, string>();
  const embeddedInventory = scanLegacyEmbeddedJsonMembersForClassification(
    databases,
    expected,
    (member) => {
      const sourceKey = legacyClassificationSourceKey(member.subject);
      if (!classificationBySourceKey.has(sourceKey)) return;
      const rowSourceKey = legacyClassificationSourceKey(member.rowSubject);
      if (rootOfflineSourceKeys.has(rowSourceKey)) {
        payloadRefs.set(sourceKey, rowSourceKey);
        return;
      }
      for (let length = member.memberPath.length - 1; length >= 0; length -= 1) {
        const ancestorPayloadRef = offlinePayloadByMemberPath.get(memberPathKey(member, length));
        if (ancestorPayloadRef) {
          payloadRefs.set(sourceKey, ancestorPayloadRef);
          return;
        }
      }
      addPayload(sourceKey, member.value);
      offlinePayloadByMemberPath.set(memberPathKey(member, member.memberPath.length), sourceKey);
    },
    embeddedSources(phaseOne),
  );
  if (embeddedInventory.fingerprint !== phaseOne.embeddedJson.inventory.fingerprint) {
    throw new Error('Legacy offline export inspected a different source snapshot');
  }

  const entries = classifications.map((classification): LegacyOfflineExportEntry => {
    const payloadRef = payloadRefs.get(classification.sourceKey);
    if (!payloadRef) {
      throw new Error(`Legacy offline export did not capture ${classification.sourceKey}`);
    }
    if (classification.exportRef === null) {
      throw new Error('Legacy offline classification has no export reference');
    }
    return {
      sourceKey: classification.sourceKey,
      subject: classification.subject,
      reasonCode: classification.reasonCode,
      exportRef: classification.exportRef,
      payloadRef,
    };
  });
  const orderedPayloads = [...payloads.values()].sort((left, right) =>
    compareText(left.payloadRef, right.payloadRef),
  );
  const contentFingerprint = hashCanonical({ entries, payloads: orderedPayloads });
  const withoutFingerprint = {
    schema: 'lucid-fin.legacy-offline-export/v1' as const,
    sourceFingerprint: phaseOne.sourceFingerprint,
    sourceContentFingerprint: phaseOne.sourceContentFingerprint,
    phaseOneFingerprint: phaseOne.fingerprint,
    entryCount: entries.length,
    payloadCount: orderedPayloads.length,
    entries,
    payloads: orderedPayloads,
    contentFingerprint,
  };
  return { ...withoutFingerprint, fingerprint: hashCanonical(withoutFingerprint) };
}

function assertOfflineExportBundle(bundle: LegacyOfflineExportBundle): void {
  const { fingerprint, ...fingerprintInput } = bundle;
  if (hashCanonical(fingerprintInput) !== fingerprint) {
    throw new TypeError('Legacy offline export bundle fingerprint does not match');
  }
  if (
    bundle.entryCount !== bundle.entries.length ||
    bundle.payloadCount !== bundle.payloads.length
  ) {
    throw new TypeError('Legacy offline export bundle counts do not match');
  }
  if (
    bundle.contentFingerprint !==
    hashCanonical({ entries: bundle.entries, payloads: bundle.payloads })
  ) {
    throw new TypeError('Legacy offline export content fingerprint does not match');
  }
  const payloadRefs = new Set(bundle.payloads.map(({ payloadRef }) => payloadRef));
  if (
    payloadRefs.size !== bundle.payloads.length ||
    bundle.payloads.some(({ sourceKey, payloadRef, value, valueHash }) => {
      return sourceKey !== payloadRef || valueHash !== hashCanonical(value);
    }) ||
    bundle.entries.some(({ payloadRef }) => !payloadRefs.has(payloadRef))
  ) {
    throw new TypeError('Legacy offline export payload bindings do not match');
  }
}

/** Writes a complete bundle once without returning its path or private payloads. */
export async function writeLegacyOfflineExportBundle(
  bundle: LegacyOfflineExportBundle,
  exportPath: string,
): Promise<LegacyOfflineExportWriteReport> {
  assertOfflineExportBundle(bundle);
  const destination = resolve(exportPath);
  const temporaryPath = join(dirname(destination), `.${basename(destination)}.${randomUUID()}.tmp`);
  const bytes = Buffer.from(`${canonicalJson(bundle)}\n`, 'utf8');
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(temporaryPath, 'wx', 0o600);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await link(temporaryPath, destination);
    const withoutFingerprint = {
      schema: 'lucid-fin.legacy-offline-export-write-report/v1' as const,
      bundleFingerprint: bundle.fingerprint,
      entryCount: bundle.entryCount,
      payloadCount: bundle.payloadCount,
      byteLength: String(bytes.byteLength),
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
    return {
      ...withoutFingerprint,
      fingerprint: hashCanonical(withoutFingerprint),
      ok: true,
    };
  } finally {
    await handle?.close();
    await unlink(temporaryPath).catch((cause: NodeJS.ErrnoException) => {
      if (cause.code !== 'ENOENT') throw cause;
    });
  }
}
