import {
  assertRunContextManifest,
  canonicalJson,
  type CapabilityCatalogSnapshotV1,
  type ContextManifest,
  type Run,
} from '@lucid-fin/target-contracts';
import type { DatabaseSync } from 'node:sqlite';
import { TargetStorageError } from '../kernel/errors.js';
import {
  decodeCapabilityCatalogSnapshot,
  decodeContextManifest,
  encodeCapabilityCatalogSnapshot,
  encodeContextManifest,
} from './canonical-codecs.js';
import { hashCanonical } from './hashes.js';
import { assertFrozenSkillRows } from './root-capability-catalog.js';

interface ManifestRow {
  manifest_hash: string;
  manifest_v1_json: string;
}

interface CatalogRow {
  catalog_hash: string;
  catalog_v1_json: string;
}

export function loadRunSnapshots(
  database: DatabaseSync,
  run: Run,
): { manifest: ContextManifest; catalog: CapabilityCatalogSnapshotV1 } {
  const manifestRow = database
    .prepare(
      `SELECT manifest_hash, manifest_v1_json
       FROM context_manifests
       WHERE run_id = ?`,
    )
    .get(run.id) as unknown as ManifestRow | undefined;
  const catalogRow = database
    .prepare(
      `SELECT catalog_hash, catalog_v1_json
       FROM capability_catalog_snapshots
       WHERE run_id = ?`,
    )
    .get(run.id) as unknown as CatalogRow | undefined;
  if (manifestRow === undefined || catalogRow === undefined) {
    throw new TargetStorageError('CORRUPT_DATA', `Run ${run.id} snapshot rows are incomplete`);
  }
  const manifest = decodeContextManifest(manifestRow.manifest_v1_json);
  const catalog = decodeCapabilityCatalogSnapshot(catalogRow.catalog_v1_json);
  if (
    encodeContextManifest(manifest) !== manifestRow.manifest_v1_json ||
    encodeCapabilityCatalogSnapshot(catalog) !== catalogRow.catalog_v1_json ||
    manifestRow.manifest_hash !== run.contextManifestHash ||
    hashCanonical(manifest) !== run.contextManifestHash ||
    catalogRow.catalog_hash !== run.capabilityCatalogHash ||
    catalog.catalogHash !== run.capabilityCatalogHash ||
    canonicalJson(manifest.model) !== canonicalJson(run.model)
  ) {
    throw new TargetStorageError('CORRUPT_DATA', `Run ${run.id} snapshot hashes do not match`);
  }
  try {
    assertRunContextManifest(run, manifest, catalog);
    assertFrozenSkillRows(database, run.projectId, catalog);
  } catch (cause) {
    throw new TargetStorageError('CORRUPT_DATA', `Run ${run.id} snapshot is inconsistent`, {
      cause,
    });
  }
  return { manifest, catalog };
}
