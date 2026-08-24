import { hashCanonical } from '../internal/hashes.js';
import {
  classifyLegacyEmbeddedJsonMembers,
  type LegacyEmbeddedJsonClassificationOptions,
  type LegacyEmbeddedJsonClassificationReport,
} from './embedded-json-classification.js';
import type { LegacyMediaPreflightReport } from './media-preflight.js';
import {
  classifyLegacyRootRows,
  type LegacyRootRowClassificationOptions,
  type LegacyRootRowClassificationReport,
} from './root-row-classification.js';
import type { LegacySourceDatabases, LegacySourceExpectedSchemas } from './source-preflight.js';
import type { LegacyProjectOwnershipGraphReport } from './project-ownership-graph.js';

export interface LegacyPhaseOneClassificationOptions {
  readonly root?: LegacyRootRowClassificationOptions;
  readonly embeddedJson?: LegacyEmbeddedJsonClassificationOptions;
}

export interface LegacyPhaseOneClassificationReport {
  readonly schema: 'lucid-fin.legacy-phase-one-classification/v1';
  readonly sourceFingerprint: string;
  readonly sourceContentFingerprint: string;
  readonly ownership: LegacyProjectOwnershipGraphReport;
  readonly rootRows: LegacyRootRowClassificationReport;
  readonly embeddedJson: LegacyEmbeddedJsonClassificationReport;
  readonly fingerprint: string;
  readonly ok: boolean;
}

/** The Phase-1 gate passes only when both root rows and embedded members pass. */
export function classifyLegacyPhaseOne(
  databases: LegacySourceDatabases,
  expected: LegacySourceExpectedSchemas,
  media: LegacyMediaPreflightReport,
  options: LegacyPhaseOneClassificationOptions = {},
): LegacyPhaseOneClassificationReport {
  const rootRows = classifyLegacyRootRows(databases, expected, media, options.root);
  const embeddedJson = classifyLegacyEmbeddedJsonMembers(databases, expected, {
    ...options.embeddedJson,
    ownership: rootRows.ownership,
    rootClassification: rootRows.classification,
  });
  if (rootRows.inventory.fingerprint !== embeddedJson.inventory.sourceFingerprint) {
    throw new Error('Legacy Phase-1 classifiers did not inspect the same source snapshot');
  }
  const withoutFingerprint = {
    schema: 'lucid-fin.legacy-phase-one-classification/v1' as const,
    sourceFingerprint: rootRows.inventory.fingerprint,
    sourceContentFingerprint: rootRows.inventory.sourceContentFingerprint,
    ownership: rootRows.ownership,
    rootRows,
    embeddedJson,
  };
  return {
    ...withoutFingerprint,
    fingerprint: hashCanonical({
      schema: withoutFingerprint.schema,
      sourceFingerprint: withoutFingerprint.sourceFingerprint,
      sourceContentFingerprint: withoutFingerprint.sourceContentFingerprint,
      ownershipFingerprint: rootRows.ownership.fingerprint,
      rootFingerprint: rootRows.fingerprint,
      embeddedJsonFingerprint: embeddedJson.fingerprint,
    }),
    ok: rootRows.ok && embeddedJson.ok,
  };
}
