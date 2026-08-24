import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, mkdir, readFile, rm } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import {
  GlobalMediaAssetSchema,
  GlobalMediaFolderSchema,
  GlobalMediaTagsSchema,
  parseCanonical,
  type GlobalMediaAsset,
  type GlobalMediaFolder,
  type MediaBlob,
} from '@lucid-fin/target-contracts';
import { getTargetStoreDatabase } from '../internal/database-access.js';
import { createFilesystemMediaCas } from '../internal/filesystem-media-cas.js';
import { hashCanonical, hashContentObject } from '../internal/hashes.js';
import {
  insertGlobalMediaAsset,
  insertGlobalMediaFolder,
  insertOrValidateMediaBlob,
  listGlobalMediaFolders,
  loadGlobalMediaAsset,
  loadMediaBlob,
} from '../internal/media-records.js';
import { openConfiguredDatabase } from '../kernel/database.js';
import type { MediaCas } from '../kernel/media-cas.js';
import { createTargetStore, openTargetStore, type TargetStore } from '../kernel/store.js';
import { withImmediateTransaction } from '../kernel/transaction.js';
import {
  legacyClassificationSourceKey,
  type LegacyClassificationEntry,
} from './classification-report.js';
import {
  scanLegacyRowsForClassification,
  type LegacyClassificationRow,
} from './classification-subjects.js';
import { I0_LEGACY_SOURCE_SCHEMAS } from './legacy-source-schema.js';
import { preflightLegacyInputs, type LegacyPreflightPaths } from './legacy-preflight.js';
import {
  buildLegacyMigrationReadinessReport,
  type LegacyMigrationReadinessReport,
} from './migration-readiness.js';
import {
  buildLegacyOfflineExportBundle,
  writeLegacyOfflineExportBundle,
  type LegacyOfflineExportBundle,
} from './offline-export.js';
import {
  classifyLegacyPhaseOne,
  type LegacyPhaseOneClassificationReport,
} from './phase-one-classification.js';
import { inspectLegacyStaticImageBytes } from './static-image-byte-evidence.js';

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const MAXIMUM_TIMESTAMP_MILLISECONDS = 8_640_000_000_000_000n;
const MAXIMUM_SAFE_INTEGER = BigInt(Number.MAX_SAFE_INTEGER);
const MINIMUM_SAFE_INTEGER = BigInt(Number.MIN_SAFE_INTEGER);
const TARGET_DATABASE_NAME = 'catalog.sqlite';
const TARGET_MEDIA_DIRECTORY = 'media';
const TARGET_OFFLINE_EXPORT_NAME = 'legacy-offline-export.json';

export interface RepresentativeLegacyCatalogMapping {
  readonly sourceKey: string;
  readonly target: Readonly<{
    authority: 'media_blob' | 'global_media_folder' | 'global_media_asset';
    id: string;
  }>;
}

export interface RepresentativeLegacyImageCatalogRehearsalInput {
  readonly paths: LegacyPreflightPaths;
  readonly readiness: LegacyMigrationReadinessReport;
  readonly targetRootPath: string;
}

export interface RepresentativeLegacyImageCatalogRehearsalReport {
  readonly schema: 'lucid-fin.legacy-representative-image-catalog-rehearsal/v1';
  readonly source: Readonly<{
    readinessFingerprint: string;
    contentFingerprint: string;
    preflightFingerprint: string;
    phaseOneFingerprint: string;
  }>;
  readonly mappings: readonly RepresentativeLegacyCatalogMapping[];
  readonly coverage: Readonly<{
    classifiedSubjects: number;
    mappedSubjects: number;
    offlineSubjects: number;
    fingerprint: string;
    complete: true;
  }>;
  readonly target: Readonly<{
    schemaFingerprint: string;
    reopenedSchemaFingerprint: string;
    counts: Readonly<{
      mediaBlobs: number;
      globalMediaFolders: number;
      globalMediaAssets: number;
    }>;
    offlineExport: Readonly<{
      bundleFingerprint: string;
      entryCount: number;
      payloadCount: number;
      byteLength: string;
      sha256: string;
      reopenedSha256: string;
    }>;
    casFingerprint: string;
    mappingFingerprint: string;
    contentFingerprint: string;
    reopenedContentFingerprint: string;
    reopenVerified: true;
  }>;
  readonly fingerprint: string;
  readonly ok: true;
}

interface PlannedBlob {
  readonly record: MediaBlob;
  readonly sourcePath: string;
  readonly filename: string;
}

interface RepresentativeCatalogPlan {
  readonly blobs: readonly PlannedBlob[];
  readonly folders: readonly GlobalMediaFolder[];
  readonly foldersInInsertOrder: readonly GlobalMediaFolder[];
  readonly assets: readonly GlobalMediaAsset[];
  readonly mappings: readonly RepresentativeLegacyCatalogMapping[];
  readonly offlineExport: LegacyOfflineExportBundle;
  readonly coverage: RepresentativeLegacyImageCatalogRehearsalReport['coverage'];
}

interface CatalogSnapshot {
  readonly blobs: readonly MediaBlob[];
  readonly folders: readonly GlobalMediaFolder[];
  readonly assets: readonly GlobalMediaAsset[];
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function assertReadiness(readiness: LegacyMigrationReadinessReport): void {
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
}

async function assertTargetRootAbsent(targetRootPath: string): Promise<void> {
  try {
    await lstat(targetRootPath);
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw cause;
  }
  throw new TypeError('Disposable target root already exists');
}

function isInside(parentPath: string, candidatePath: string): boolean {
  const path = relative(parentPath, candidatePath);
  return path === '' || (!path.startsWith('..') && !path.includes(':'));
}

function assertPathSeparation(paths: LegacyPreflightPaths, targetRootPath: string): void {
  const assetsRoot = resolve(paths.assetsRoot);
  if (isInside(assetsRoot, targetRootPath)) {
    throw new TypeError('Disposable target root must be outside the Legacy media root');
  }
}

function integer(value: unknown, label: string): bigint {
  if (typeof value !== 'bigint') throw new TypeError(`Legacy ${label} must be a SQLite integer`);
  return value;
}

function positiveSafeInteger(value: unknown, label: string): number {
  const raw = integer(value, label);
  if (raw <= 0n || raw > MAXIMUM_SAFE_INTEGER) {
    throw new TypeError(`Legacy ${label} must be a positive safe integer`);
  }
  return Number(raw);
}

function safeInteger(value: unknown, label: string): number {
  const raw = integer(value, label);
  if (raw < MINIMUM_SAFE_INTEGER || raw > MAXIMUM_SAFE_INTEGER) {
    throw new TypeError(`Legacy ${label} must be a safe integer`);
  }
  return Number(raw);
}

function isoTimestamp(value: unknown, label: string): string {
  const raw = integer(value, label);
  if (raw < 0n || raw > MAXIMUM_TIMESTAMP_MILLISECONDS) {
    throw new TypeError(`Legacy ${label} is outside the supported timestamp range`);
  }
  return new Date(Number(raw)).toISOString();
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new TypeError(`Legacy ${label} must be text`);
  return value;
}

function expectedRootAuthority(
  table: string,
): RepresentativeLegacyCatalogMapping['target']['authority'] | null {
  if (table === 'asset_contents') return 'media_blob';
  if (table === 'asset_folders') return 'global_media_folder';
  if (table === 'asset_entries') return 'global_media_asset';
  return null;
}

function assertRepresentativeScope(
  phaseOne: LegacyPhaseOneClassificationReport,
): readonly RepresentativeLegacyCatalogMapping[] {
  const mappings: RepresentativeLegacyCatalogMapping[] = [];
  const byAuthority = {
    media_blob: 0,
    global_media_folder: 0,
    global_media_asset: 0,
  };
  for (const entry of phaseOne.rootRows.classification.entries) {
    if (
      entry.subject.database === 'main' &&
      entry.subject.table === 'asset_entries_fts' &&
      entry.subject.path === '$' &&
      entry.disposition === 'offline_legacy_export' &&
      entry.reasonCode === 'legacy_derived_projection_rebuild' &&
      entry.targetRefs.length === 0 &&
      entry.exportRef !== null &&
      entry.blockerCode === null
    ) {
      continue;
    }
    const authority = expectedRootAuthority(entry.subject.table);
    const target = entry.targetRefs[0];
    if (
      authority === null ||
      entry.subject.database !== 'main' ||
      entry.subject.path !== '$' ||
      entry.disposition !== 'migrated_current_state' ||
      entry.targetRefs.length !== 1 ||
      target?.authority !== authority ||
      target.projectId !== null ||
      target.cloneOf !== null
    ) {
      throw new TypeError('Legacy source exceeds the representative catalog scope');
    }
    byAuthority[authority] += 1;
    mappings.push({ sourceKey: entry.sourceKey, target: { authority, id: target.id } });
  }
  if (
    byAuthority.media_blob === 0 ||
    byAuthority.global_media_folder === 0 ||
    byAuthority.global_media_asset === 0
  ) {
    throw new TypeError('Representative catalog scope requires Blob, Folder, and Asset rows');
  }
  for (const entry of phaseOne.embeddedJson.classification.entries) {
    const target = entry.targetRefs[0];
    if (
      entry.subject.database !== 'main' ||
      entry.subject.table !== 'asset_entries' ||
      (entry.subject.path !== '$.tags' && !entry.subject.path.startsWith('$.tags#')) ||
      entry.disposition !== 'migrated_current_state' ||
      entry.reasonCode !== 'legacy_global_media_asset_tags' ||
      entry.targetRefs.length !== 1 ||
      target?.authority !== 'global_media_asset' ||
      target.projectId !== null ||
      target.cloneOf !== null
    ) {
      throw new TypeError('Legacy source exceeds the representative catalog scope');
    }
    mappings.push({
      sourceKey: entry.sourceKey,
      target: { authority: 'global_media_asset', id: target.id },
    });
  }
  return mappings.sort((left, right) => compareText(left.sourceKey, right.sourceKey));
}

function rootEntryBySourceKey(
  phaseOne: LegacyPhaseOneClassificationReport,
): ReadonlyMap<string, LegacyClassificationEntry> {
  return new Map(
    phaseOne.rootRows.classification.entries.map((entry) => [entry.sourceKey, entry] as const),
  );
}

function assertRowTarget(
  row: LegacyClassificationRow,
  entryBySourceKey: ReadonlyMap<string, LegacyClassificationEntry>,
  authority: RepresentativeLegacyCatalogMapping['target']['authority'],
  id: string,
): void {
  const entry = entryBySourceKey.get(legacyClassificationSourceKey(row.subject));
  const target = entry?.targetRefs[0];
  if (
    entry?.disposition !== 'migrated_current_state' ||
    entry.targetRefs.length !== 1 ||
    target?.authority !== authority ||
    target.id !== id ||
    target.projectId !== null ||
    target.cloneOf !== null
  ) {
    throw new TypeError('Legacy row does not match its approved target mapping');
  }
}

function foldersInInsertOrder(folders: readonly GlobalMediaFolder[]): readonly GlobalMediaFolder[] {
  const pending = new Map(folders.map((folder) => [folder.id, folder] as const));
  const inserted = new Set<string>();
  const ordered: GlobalMediaFolder[] = [];
  while (pending.size > 0) {
    let progressed = false;
    for (const [id, folder] of [...pending.entries()].sort(([left], [right]) =>
      compareText(left, right),
    )) {
      if (folder.parentId !== null && !inserted.has(folder.parentId)) continue;
      ordered.push(folder);
      inserted.add(id);
      pending.delete(id);
      progressed = true;
    }
    if (!progressed) throw new TypeError('Legacy Global Media Folder hierarchy is not insertable');
  }
  return ordered;
}

function dispositionCoverage(
  phaseOne: LegacyPhaseOneClassificationReport,
  mappings: readonly RepresentativeLegacyCatalogMapping[],
  offlineExport: LegacyOfflineExportBundle,
): RepresentativeLegacyImageCatalogRehearsalReport['coverage'] {
  const classifiedSourceKeys = [
    ...phaseOne.rootRows.classification.entries,
    ...phaseOne.embeddedJson.classification.entries,
  ]
    .map(({ sourceKey }) => sourceKey)
    .sort(compareText);
  const outputSourceKeys = [
    ...mappings.map(({ sourceKey }) => sourceKey),
    ...offlineExport.entries.map(({ sourceKey }) => sourceKey),
  ].sort(compareText);
  if (
    new Set(outputSourceKeys).size !== outputSourceKeys.length ||
    outputSourceKeys.length !== classifiedSourceKeys.length ||
    outputSourceKeys.some((sourceKey, index) => sourceKey !== classifiedSourceKeys[index])
  ) {
    throw new TypeError('Representative catalog outputs do not cover every classified subject');
  }
  const withoutFingerprint = {
    classifiedSubjects: classifiedSourceKeys.length,
    mappedSubjects: mappings.length,
    offlineSubjects: offlineExport.entryCount,
    complete: true as const,
  };
  return { ...withoutFingerprint, fingerprint: hashCanonical(withoutFingerprint) };
}

async function buildRepresentativePlan(
  databases: Readonly<{ main: DatabaseSync; prompts: DatabaseSync }>,
  phaseOne: LegacyPhaseOneClassificationReport,
  assetsRoot: string,
): Promise<RepresentativeCatalogPlan> {
  const mappings = assertRepresentativeScope(phaseOne);
  const rows: LegacyClassificationRow[] = [];
  const inventory = scanLegacyRowsForClassification(databases, I0_LEGACY_SOURCE_SCHEMAS, (row) =>
    rows.push(row),
  );
  if (
    inventory.fingerprint !== phaseOne.rootRows.inventory.fingerprint ||
    inventory.sourceContentFingerprint !== phaseOne.sourceContentFingerprint
  ) {
    throw new TypeError('Legacy source snapshot changed after classification');
  }
  const entryBySourceKey = rootEntryBySourceKey(phaseOne);

  const blobs: PlannedBlob[] = [];
  for (const row of rows.filter(
    ({ database, table }) => database === 'main' && table === 'asset_contents',
  )) {
    const hash = text(row.values.hash, 'MediaBlob hash');
    if (!SHA256_PATTERN.test(hash)) throw new TypeError('Legacy MediaBlob hash is not canonical');
    assertRowTarget(row, entryBySourceKey, 'media_blob', hash);
    const declaredType = text(row.values.type, 'MediaBlob type');
    const declaredFormat = text(row.values.format, 'MediaBlob format');
    if (declaredType !== 'image') {
      throw new TypeError('Representative catalog accepts only the static image media family');
    }
    if (
      row.values.prompt !== null ||
      row.values.provider !== null ||
      row.values.generation_metadata !== null ||
      row.values.duration !== null ||
      (row.values.has_audio !== null && row.values.has_audio !== 0n)
    ) {
      throw new TypeError('Representative catalog cannot map non-empty unmapped media fields');
    }
    const declaredByteLength = positiveSafeInteger(row.values.file_size, 'MediaBlob file_size');
    const declaredWidth = positiveSafeInteger(row.values.width, 'MediaBlob width');
    const declaredHeight = positiveSafeInteger(row.values.height, 'MediaBlob height');
    const sourcePath = join(
      resolve(assetsRoot),
      declaredType,
      hash.slice(0, 2),
      `${hash}.${declaredFormat}`,
    );
    const inspected = await inspectLegacyStaticImageBytes(sourcePath);
    if (inspected.type !== declaredType || inspected.format !== declaredFormat) {
      throw new TypeError(
        'Legacy static image byte identity does not match its catalog type and format',
      );
    }
    if (inspected.byteLength !== declaredByteLength) {
      throw new TypeError('Legacy static image byte length does not match its catalog metadata');
    }
    if (inspected.width !== declaredWidth || inspected.height !== declaredHeight) {
      throw new TypeError('Legacy static image dimensions do not match its catalog metadata');
    }
    blobs.push({
      sourcePath,
      filename: `${hash}.${inspected.format}`,
      record: {
        authority: 'media_blob',
        hash,
        byteLength: inspected.byteLength,
        mimeType: inspected.mimeType,
        technicalFacts: { kind: 'image', width: inspected.width, height: inspected.height },
        createdAt: isoTimestamp(row.values.created_at, 'MediaBlob created_at'),
      },
    });
  }
  blobs.sort((left, right) => compareText(left.record.hash, right.record.hash));

  const folders = rows
    .filter(({ database, table }) => database === 'main' && table === 'asset_folders')
    .map((row): GlobalMediaFolder => {
      const id = text(row.values.id, 'GlobalMediaFolder id');
      assertRowTarget(row, entryBySourceKey, 'global_media_folder', id);
      const parentId = row.values.parent_id;
      if (parentId !== null && typeof parentId !== 'string') {
        throw new TypeError('Legacy GlobalMediaFolder parent_id must be text or null');
      }
      const folderWithoutHash = {
        authority: 'global_media_folder' as const,
        id,
        revision: 0,
        contentHash: '',
        parentId,
        name: text(row.values.name, 'GlobalMediaFolder name'),
        sortOrder: safeInteger(row.values.sort_order, 'GlobalMediaFolder sort_order'),
        createdAt: isoTimestamp(row.values.created_at, 'GlobalMediaFolder created_at'),
        updatedAt: isoTimestamp(row.values.updated_at, 'GlobalMediaFolder updated_at'),
      };
      return parseCanonical(GlobalMediaFolderSchema, {
        ...folderWithoutHash,
        contentHash: hashContentObject(folderWithoutHash),
      });
    })
    .sort((left, right) => compareText(left.id, right.id));

  const blobByHash = new Map(blobs.map((blob) => [blob.record.hash, blob] as const));
  const assets = rows
    .filter(({ database, table }) => database === 'main' && table === 'asset_entries')
    .map((row): GlobalMediaAsset => {
      const id = text(row.values.id, 'GlobalMediaAsset id');
      assertRowTarget(row, entryBySourceKey, 'global_media_asset', id);
      const blobHash = text(row.values.asset_hash, 'GlobalMediaAsset asset_hash');
      const blob = blobByHash.get(blobHash);
      if (!blob) throw new TypeError('Legacy GlobalMediaAsset references an unplanned MediaBlob');
      const folderId = row.values.folder_id;
      if (folderId !== null && typeof folderId !== 'string') {
        throw new TypeError('Legacy GlobalMediaAsset folder_id must be text or null');
      }
      let tagsDocument: unknown;
      try {
        tagsDocument = JSON.parse(text(row.values.tags, 'GlobalMediaAsset tags')) as unknown;
      } catch {
        throw new TypeError('Legacy GlobalMediaAsset tags are not valid JSON');
      }
      const tags = parseCanonical(GlobalMediaTagsSchema, tagsDocument);
      const createdAt = isoTimestamp(row.values.created_at, 'GlobalMediaAsset created_at');
      const filename = blob.filename;
      const assetWithoutHash = {
        authority: 'global_media_asset' as const,
        id,
        revision: 0,
        contentHash: '',
        blobHash,
        kind: blob.record.technicalFacts.kind,
        filename,
        displayName: text(row.values.display_name, 'GlobalMediaAsset display_name'),
        source: { kind: 'imported' as const, originalFileName: filename, importId: id },
        folderId,
        tags,
        createdAt,
        updatedAt: createdAt,
      };
      return parseCanonical(GlobalMediaAssetSchema, {
        ...assetWithoutHash,
        contentHash: hashContentObject(assetWithoutHash),
      });
    })
    .sort((left, right) => compareText(left.id, right.id));

  const offlineExport = buildLegacyOfflineExportBundle(
    databases,
    I0_LEGACY_SOURCE_SCHEMAS,
    phaseOne,
  );
  return {
    blobs,
    folders,
    foldersInInsertOrder: foldersInInsertOrder(folders),
    assets,
    mappings,
    offlineExport,
    coverage: dispositionCoverage(phaseOne, mappings, offlineExport),
  };
}

function catalogSnapshot(database: DatabaseSync): CatalogSnapshot {
  const blobHashes = (
    database.prepare('SELECT hash FROM media_blobs ORDER BY hash').all() as unknown as readonly {
      readonly hash: string;
    }[]
  ).map(({ hash }) => hash);
  const assetIds = (
    database
      .prepare('SELECT id FROM global_media_assets ORDER BY id')
      .all() as unknown as readonly {
      readonly id: string;
    }[]
  ).map(({ id }) => id);
  return {
    blobs: blobHashes.map((hash) => loadMediaBlob(database, hash)),
    folders: [...listGlobalMediaFolders(database)].sort((left, right) =>
      compareText(left.id, right.id),
    ),
    assets: assetIds.map((id) => loadGlobalMediaAsset(database, id)),
  };
}

function expectedSnapshot(plan: RepresentativeCatalogPlan): CatalogSnapshot {
  return {
    blobs: plan.blobs.map(({ record }) => record),
    folders: [...plan.folders].sort((left, right) => compareText(left.id, right.id)),
    assets: plan.assets,
  };
}

async function reconcileCatalog(
  database: DatabaseSync,
  mediaCas: MediaCas,
  plan: RepresentativeCatalogPlan,
): Promise<{ readonly snapshot: CatalogSnapshot; readonly fingerprint: string }> {
  const snapshot = catalogSnapshot(database);
  const expected = expectedSnapshot(plan);
  const fingerprint = hashCanonical(snapshot);
  if (fingerprint !== hashCanonical(expected)) {
    throw new Error(
      'Disposable target catalog does not reconcile with the approved source mapping',
    );
  }
  for (const { record } of plan.blobs) {
    await mediaCas.verify({ hash: record.hash, byteLength: record.byteLength });
  }
  return { snapshot, fingerprint };
}

async function fileFingerprint(path: string): Promise<{
  readonly byteLength: string;
  readonly sha256: string;
}> {
  const bytes = await readFile(path);
  return {
    byteLength: String(bytes.byteLength),
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

function assertSameSourceSnapshot(
  expected: LegacyMigrationReadinessReport,
  actual: LegacyMigrationReadinessReport,
): void {
  if (actual.fingerprint !== expected.fingerprint) {
    throw new TypeError('Legacy source snapshot changed after readiness approval');
  }
}

/**
 * Executes the first non-empty one-way transform only inside a caller-selected,
 * previously absent disposable root. It never mutates a Legacy database or CAS.
 */
export async function rehearseRepresentativeLegacyImageCatalog(
  input: RepresentativeLegacyImageCatalogRehearsalInput,
): Promise<RepresentativeLegacyImageCatalogRehearsalReport> {
  assertReadiness(input.readiness);
  const targetRootPath = resolve(input.targetRootPath);
  assertPathSeparation(input.paths, targetRootPath);
  await assertTargetRootAbsent(targetRootPath);

  const preflight = await preflightLegacyInputs(input.paths);
  if (
    preflight.fingerprint !== input.readiness.source.preflightFingerprint ||
    preflight.source.contentFingerprint !== input.readiness.source.contentFingerprint
  ) {
    throw new TypeError('Legacy source snapshot changed after readiness approval');
  }
  if (!preflight.ok || preflight.media.status !== 'checked') {
    throw new TypeError('Legacy source preflight is blocked');
  }

  let main: DatabaseSync | undefined;
  let prompts: DatabaseSync | undefined;
  let plan: RepresentativeCatalogPlan;
  let phaseOne: LegacyPhaseOneClassificationReport;
  try {
    main = openConfiguredDatabase(resolve(input.paths.mainDatabasePath), true);
    prompts = openConfiguredDatabase(resolve(input.paths.promptsDatabasePath), true);
    phaseOne = classifyLegacyPhaseOne(
      { main, prompts },
      I0_LEGACY_SOURCE_SCHEMAS,
      preflight.media.report,
    );
    const currentReadiness = buildLegacyMigrationReadinessReport({ preflight, phaseOne });
    assertSameSourceSnapshot(input.readiness, currentReadiness);
    plan = await buildRepresentativePlan({ main, prompts }, phaseOne, input.paths.assetsRoot);
  } finally {
    prompts?.close();
    main?.close();
  }

  let store: TargetStore | undefined;
  let createdRoot = false;
  let complete = false;
  try {
    await mkdir(targetRootPath);
    createdRoot = true;
    const targetDatabasePath = join(targetRootPath, TARGET_DATABASE_NAME);
    const offlineExportPath = join(targetRootPath, TARGET_OFFLINE_EXPORT_NAME);
    const mediaCas = createFilesystemMediaCas(join(targetRootPath, TARGET_MEDIA_DIRECTORY));
    store = await createTargetStore(targetDatabasePath);

    for (const { record, sourcePath } of plan.blobs) {
      await mediaCas.putVerified(
        { hash: record.hash, byteLength: record.byteLength },
        createReadStream(sourcePath),
      );
    }

    const database = getTargetStoreDatabase(store);
    withImmediateTransaction(database, () => {
      for (const { record } of plan.blobs) {
        insertOrValidateMediaBlob(
          database,
          {
            hash: record.hash,
            byteLength: record.byteLength,
            mimeType: record.mimeType,
            technicalFacts: record.technicalFacts,
          },
          record.createdAt,
        );
      }
      for (const folder of plan.foldersInInsertOrder) insertGlobalMediaFolder(database, folder);
      for (const asset of plan.assets) insertGlobalMediaAsset(database, asset);
    });
    const offlineExportWrite = await writeLegacyOfflineExportBundle(
      plan.offlineExport,
      offlineExportPath,
    );

    const schemaFingerprint = store.schemaFingerprint.sha256;
    const first = await reconcileCatalog(database, mediaCas, plan);
    store.close();
    store = await openTargetStore(targetDatabasePath);
    const reopenedSchemaFingerprint = store.schemaFingerprint.sha256;
    const reopened = await reconcileCatalog(getTargetStoreDatabase(store), mediaCas, plan);
    if (schemaFingerprint !== reopenedSchemaFingerprint) {
      throw new Error('Disposable target schema fingerprint changed after reopen');
    }
    if (first.fingerprint !== reopened.fingerprint) {
      throw new Error('Disposable target catalog fingerprint changed after reopen');
    }
    const reopenedOfflineExport = await fileFingerprint(offlineExportPath);
    if (
      reopenedOfflineExport.byteLength !== offlineExportWrite.byteLength ||
      reopenedOfflineExport.sha256 !== offlineExportWrite.sha256
    ) {
      throw new Error('Disposable offline export fingerprint changed after target reopen');
    }

    const finalPreflight = await preflightLegacyInputs(input.paths);
    if (finalPreflight.fingerprint !== preflight.fingerprint) {
      throw new TypeError('Legacy source snapshot changed during disposable rehearsal');
    }

    const counts = {
      mediaBlobs: first.snapshot.blobs.length,
      globalMediaFolders: first.snapshot.folders.length,
      globalMediaAssets: first.snapshot.assets.length,
    };
    const casFingerprint = hashCanonical(
      plan.blobs.map(({ record }) => ({ hash: record.hash, byteLength: record.byteLength })),
    );
    const mappingFingerprint = hashCanonical(plan.mappings);
    const withoutFingerprint = {
      schema: 'lucid-fin.legacy-representative-image-catalog-rehearsal/v1' as const,
      source: {
        readinessFingerprint: input.readiness.fingerprint,
        contentFingerprint: input.readiness.source.contentFingerprint,
        preflightFingerprint: preflight.fingerprint,
        phaseOneFingerprint: phaseOne.fingerprint,
      },
      mappings: plan.mappings,
      coverage: plan.coverage,
      target: {
        schemaFingerprint,
        reopenedSchemaFingerprint,
        counts,
        offlineExport: {
          bundleFingerprint: offlineExportWrite.bundleFingerprint,
          entryCount: offlineExportWrite.entryCount,
          payloadCount: offlineExportWrite.payloadCount,
          byteLength: offlineExportWrite.byteLength,
          sha256: offlineExportWrite.sha256,
          reopenedSha256: reopenedOfflineExport.sha256,
        },
        casFingerprint,
        mappingFingerprint,
        contentFingerprint: first.fingerprint,
        reopenedContentFingerprint: reopened.fingerprint,
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
    if (createdRoot && !complete) {
      await rm(targetRootPath, { recursive: true, force: true });
    }
  }
}
