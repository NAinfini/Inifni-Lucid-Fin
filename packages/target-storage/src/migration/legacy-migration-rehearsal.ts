import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
} from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path';
import { canonicalJson, parseCanonical, type SkillDocument } from '@lucid-fin/target-contracts';
import type { DatabaseSync } from 'node:sqlite';
import { getTargetStoreDatabase } from '../internal/database-access.js';
import { createFilesystemMediaCas } from '../internal/filesystem-media-cas.js';
import { hashCanonical } from '../internal/hashes.js';
import { openConfiguredDatabase } from '../kernel/database.js';
import { createTargetStore, openTargetStore, type TargetStore } from '../kernel/store.js';
import { withImmediateTransaction } from '../kernel/transaction.js';
import {
  createLegacySkillRowClassifier,
  LegacySkillMigrationBundleV1Schema,
  validateLegacySkillMigrationPlan,
  type LegacySkillMigrationBundleV1,
  type LegacySkillMigrationPlan,
} from './legacy-skill-migration.js';
import {
  parseLegacyBrowserStateSnapshot,
  type LegacyBrowserStateSnapshot,
} from './legacy-browser-state.js';
import {
  buildLegacyBrowserStateMigrationEvidence,
  createLegacySqliteChatMirrorSummary,
  type LegacyBrowserStateMigrationEvidence,
} from './legacy-browser-state-migration.js';
import {
  inspectLegacyMediaTechnicalBytes,
  type LegacyAudioVisualProbe,
  type LegacyMediaTechnicalInspection,
} from './media-technical-inspector.js';
import { buildLegacyMigrationMaterialization } from './legacy-migration-materialization.js';
import { buildLegacyMigrationPlan, type LegacyMigrationPlan } from './legacy-migration-plan.js';
import {
  legacyMigrationReconciliationExpectationHash,
  reconcileLegacyMigration,
  writeLegacyMigrationMaterializationInTransaction,
  type LegacyMigrationReconciliationReport,
} from './legacy-migration-writer.js';
import {
  preflightLegacyInputs,
  type LegacyPreflightPaths,
  type LegacyPreflightReport,
} from './legacy-preflight.js';
import {
  buildLegacyMigrationReadinessReport,
  type LegacyMigrationReadinessReport,
} from './migration-readiness.js';
import {
  buildLegacyOfflineExportBundle,
  writeLegacyOfflineExportBundle,
} from './offline-export.js';
import { classifyLegacyPhaseOne } from './phase-one-classification.js';
import { I0_LEGACY_SOURCE_SCHEMAS } from './legacy-source-schema.js';

const TARGET_DATABASE_NAME = 'target.sqlite';
const TARGET_MEDIA_DIRECTORY = 'media';
const TARGET_OFFLINE_EXPORT_NAME = 'legacy-offline-export.json';
const TARGET_BROWSER_STATE_NAME = 'legacy-browser-state.json';
const TARGET_RECONCILIATION_NAME = 'migration-reconciliation.json';

export type LegacyMigrationFaultPoint =
  | 'after_staging_created'
  | 'after_media_copy'
  | 'inside_transaction'
  | 'after_transaction'
  | 'after_reopen'
  | 'before_atomic_rename';

export interface DisposableLegacyMigrationRehearsalInput {
  readonly paths: LegacyPreflightPaths;
  readonly targetRootPath: string;
  readonly readiness: LegacyMigrationReadinessReport;
  readonly plan: LegacyMigrationPlan;
  readonly skillBundle: LegacySkillMigrationBundleV1;
  readonly builtInSkills: readonly SkillDocument[];
  readonly skillPlan: LegacySkillMigrationPlan;
  readonly browserState: LegacyBrowserStateSnapshot;
  readonly probeAudioVisual?: LegacyAudioVisualProbe;
  readonly faultAt?: LegacyMigrationFaultPoint;
}

export interface DisposableLegacyMigrationRehearsalReport {
  readonly schema: 'lucid-fin.disposable-legacy-migration-rehearsal/v1';
  readonly source: Readonly<{
    readinessFingerprint: string;
    preflightFingerprint: string;
    phaseOneFingerprint: string;
    contentFingerprint: string;
    finalPreflightFingerprint: string;
  }>;
  readonly planFingerprint: string;
  readonly skillPlanHash: string;
  readonly materializationFingerprint: string;
  readonly reconciliationExpectationHash: string;
  readonly firstReconciliationFingerprint: string;
  readonly reopenedReconciliationFingerprint: string;
  readonly finalReconciliationFingerprint: string;
  readonly targetDatabase: Readonly<{
    schemaFingerprint: string;
    sha256: string;
    byteLength: string;
  }>;
  readonly offlineEvidence: Readonly<{
    bundleFingerprint: string;
    sha256: string;
    byteLength: string;
  }>;
  readonly browserState: Readonly<{
    snapshotFingerprint: string;
    evidenceFingerprint: string;
    sessionComparisonFingerprint: string;
    sha256: string;
    byteLength: string;
  }>;
  readonly reconciliationEvidence: Readonly<{
    sha256: string;
    byteLength: string;
  }>;
  readonly mediaObjectCount: number;
  readonly atomicRenameVerified: true;
  readonly targetRootName: string;
  readonly fingerprint: string;
  readonly ok: true;
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw cause;
  }
}

function isWithin(parent: string, candidate: string): boolean {
  const value = relative(parent, candidate);
  return value === '' || (!value.startsWith(`..${sep}`) && value !== '..' && !isAbsolute(value));
}

interface DirectoryIdentity {
  readonly device: bigint;
  readonly inode: bigint;
}

interface OwnedDirectory {
  readonly path: string;
  readonly identity: DirectoryIdentity;
  readonly label: string;
}

interface RehearsalFilesystemPaths {
  readonly sources: LegacyPreflightPaths;
  readonly targetRootPath: string;
  readonly stagingRootPath: string;
  readonly parentPath: string;
  readonly parentIdentity: DirectoryIdentity;
}

function isMissing(cause: unknown): boolean {
  return (cause as NodeJS.ErrnoException).code === 'ENOENT';
}

async function canonicalizeExistingPath(path: string): Promise<string> {
  const absolute = resolve(path);
  try {
    return await realpath(absolute);
  } catch (cause) {
    if (isMissing(cause)) return absolute;
    throw cause;
  }
}

async function canonicalizeLegacySourcePaths(
  paths: LegacyPreflightPaths,
): Promise<LegacyPreflightPaths> {
  return {
    mainDatabasePath: await canonicalizeExistingPath(paths.mainDatabasePath),
    promptsDatabasePath: await canonicalizeExistingPath(paths.promptsDatabasePath),
    assetsRoot: await canonicalizeExistingPath(paths.assetsRoot),
  };
}

function assertPathSeparation(
  paths: LegacyPreflightPaths,
  targetRootPaths: readonly string[],
): void {
  const sources = [paths.mainDatabasePath, paths.promptsDatabasePath, paths.assetsRoot];
  if (
    targetRootPaths.some((target) =>
      sources.some((source) => isWithin(source, target) || isWithin(target, source)),
    )
  ) {
    throw new TypeError('Disposable Target root must be separate from every Legacy source');
  }
}

async function inspectExistingPath(path: string, label: string) {
  const listed = await lstat(path, { bigint: true });
  if (listed.isSymbolicLink()) {
    throw new TypeError(`${label} must not traverse a symbolic link, junction, or reparse point`);
  }
  const followed = await stat(path, { bigint: true });
  if (listed.dev !== followed.dev || listed.ino !== followed.ino) {
    throw new TypeError(`${label} must not traverse a symbolic link, junction, or reparse point`);
  }
  return listed;
}

async function assertNoReparseAncestors(path: string, label: string): Promise<void> {
  const absolute = resolve(path);
  const root = parse(absolute).root;
  let current = root;
  await inspectExistingPath(current, label);
  for (const segment of relative(root, absolute).split(sep).filter(Boolean)) {
    current = join(current, segment);
    let entry: Awaited<ReturnType<typeof inspectExistingPath>>;
    try {
      entry = await inspectExistingPath(current, label);
    } catch (cause) {
      if (isMissing(cause)) return;
      throw cause;
    }
    if (current !== absolute && !entry.isDirectory()) {
      throw new TypeError(`${label} has a non-directory ancestor`);
    }
  }
}

async function directoryIdentity(path: string, label: string): Promise<DirectoryIdentity> {
  const entry = await inspectExistingPath(path, label);
  if (!entry.isDirectory()) throw new TypeError(`${label} must be a directory`);
  return { device: entry.dev, inode: entry.ino };
}

async function assertSameDirectoryIdentity(
  path: string,
  expected: DirectoryIdentity,
  label: string,
  timing: string,
): Promise<void> {
  await assertNoReparseAncestors(path, label);
  const actual = await directoryIdentity(path, label);
  if (actual.device !== expected.device || actual.inode !== expected.inode) {
    throw new TypeError(`${label} changed ${timing}`);
  }
}

async function assertNoReparseDescendants(path: string, label: string): Promise<void> {
  const entries = await readdir(path, { withFileTypes: true });
  for (const entry of entries) {
    const childPath = join(path, entry.name);
    const child = await inspectExistingPath(childPath, `${label} child`);
    if (child.isDirectory()) await assertNoReparseDescendants(childPath, label);
  }
}

async function createOwnedChildDirectory(
  parent: OwnedDirectory,
  name: string,
  label: string,
): Promise<OwnedDirectory> {
  await assertSameDirectoryIdentity(
    parent.path,
    parent.identity,
    parent.label,
    'before child creation',
  );
  const path = join(parent.path, name);
  try {
    await mkdir(path);
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new TypeError(`${label} must be a newly created directory`, { cause });
    }
    throw cause;
  }
  const owned = { path, identity: await directoryIdentity(path, label), label };
  await assertSameDirectoryIdentity(
    parent.path,
    parent.identity,
    parent.label,
    'after child creation',
  );
  await assertSameDirectoryIdentity(
    owned.path,
    owned.identity,
    owned.label,
    'after child creation',
  );
  return owned;
}

async function assertOwnedDirectories(
  directories: readonly OwnedDirectory[],
  timing: string,
): Promise<void> {
  for (const directory of directories) {
    await assertSameDirectoryIdentity(directory.path, directory.identity, directory.label, timing);
  }
}

function portablePath(path: string): string {
  return path.split(sep).join('/');
}

async function assertRegularFile(path: string, label: string): Promise<void> {
  const entry = await inspectExistingPath(path, label);
  if (!entry.isFile()) throw new TypeError(`${label} must be a regular file`);
}

async function assertExactStagingOutput(
  stagingRootPath: string,
  mediaBlobs: readonly { readonly hash: string }[],
): Promise<void> {
  await assertNoReparseDescendants(stagingRootPath, 'Disposable staging root');
  const expected = new Set<string>([
    TARGET_DATABASE_NAME,
    TARGET_OFFLINE_EXPORT_NAME,
    TARGET_BROWSER_STATE_NAME,
    TARGET_RECONCILIATION_NAME,
  ]);
  if (mediaBlobs.length > 0) {
    expected.add(TARGET_MEDIA_DIRECTORY);
    expected.add(`${TARGET_MEDIA_DIRECTORY}/.incoming`);
    expected.add(`${TARGET_MEDIA_DIRECTORY}/sha256`);
    for (const blob of mediaBlobs) {
      const prefix = blob.hash.slice(0, 2);
      expected.add(`${TARGET_MEDIA_DIRECTORY}/sha256/${prefix}`);
      expected.add(`${TARGET_MEDIA_DIRECTORY}/sha256/${prefix}/${blob.hash}`);
    }
  }
  const entries = (await readdir(stagingRootPath, { recursive: true })).map(portablePath).sort();
  const expectedEntries = [...expected].sort();
  if (
    entries.length !== expectedEntries.length ||
    entries.some((entry, index) => entry !== expectedEntries[index])
  ) {
    throw new TypeError(
      'Disposable staging root output tree does not match the migration manifest',
    );
  }
  await assertRegularFile(
    join(stagingRootPath, TARGET_DATABASE_NAME),
    'Disposable staging database',
  );
  await assertRegularFile(
    join(stagingRootPath, TARGET_OFFLINE_EXPORT_NAME),
    'Disposable staging offline export',
  );
  await assertRegularFile(
    join(stagingRootPath, TARGET_BROWSER_STATE_NAME),
    'Disposable staging browser-state evidence',
  );
  await assertRegularFile(
    join(stagingRootPath, TARGET_RECONCILIATION_NAME),
    'Disposable staging reconciliation evidence',
  );
  if (mediaBlobs.length > 0) {
    for (const blob of mediaBlobs) {
      await assertRegularFile(
        join(stagingRootPath, TARGET_MEDIA_DIRECTORY, 'sha256', blob.hash.slice(0, 2), blob.hash),
        'Disposable staging media object',
      );
    }
  }
}

async function prepareRehearsalFilesystemPaths(
  input: DisposableLegacyMigrationRehearsalInput,
): Promise<RehearsalFilesystemPaths> {
  const sources = await canonicalizeLegacySourcePaths(input.paths);
  const targetRootPath = resolve(input.targetRootPath);
  const parentPath = dirname(targetRootPath);
  const targetRootName = basename(targetRootPath);
  const stagingRootPath = resolve(parentPath, `.${targetRootName}.${input.plan.batchId}.staging`);
  if (dirname(stagingRootPath) !== parentPath) {
    throw new TypeError('Disposable staging root must be an exact sibling of the Target root');
  }
  await assertNoReparseAncestors(targetRootPath, 'Disposable Target root');
  await assertNoReparseAncestors(stagingRootPath, 'Disposable staging root');
  const parentIdentity = await directoryIdentity(parentPath, 'Disposable Target parent');
  const canonicalParentPath = await realpath(parentPath);
  assertPathSeparation(sources, [
    join(canonicalParentPath, targetRootName),
    join(canonicalParentPath, basename(stagingRootPath)),
  ]);
  if ((await exists(targetRootPath)) || (await exists(stagingRootPath))) {
    throw new TypeError('Disposable Target and its exact staging root must both be absent');
  }
  return { sources, targetRootPath, stagingRootPath, parentPath, parentIdentity };
}

async function assertReadyToPublish(
  paths: RehearsalFilesystemPaths,
  stagingIdentity: DirectoryIdentity,
): Promise<void> {
  await assertSameDirectoryIdentity(
    paths.parentPath,
    paths.parentIdentity,
    'Disposable Target parent',
    'before publish',
  );
  await assertSameDirectoryIdentity(
    paths.stagingRootPath,
    stagingIdentity,
    'Disposable staging root',
    'before publish',
  );
  await assertNoReparseAncestors(paths.targetRootPath, 'Disposable Target root');
  if (await exists(paths.targetRootPath)) {
    throw new TypeError('Disposable Target root must be absent before publish');
  }
  const canonicalParentPath = await realpath(paths.parentPath);
  assertPathSeparation(paths.sources, [
    join(canonicalParentPath, basename(paths.targetRootPath)),
    join(canonicalParentPath, basename(paths.stagingRootPath)),
  ]);
}

function fault(input: DisposableLegacyMigrationRehearsalInput, point: LegacyMigrationFaultPoint) {
  if (input.faultAt === point) throw new Error(`Injected Legacy migration fault: ${point}`);
}

function assertSamePreflight(
  expected: LegacyPreflightReport,
  actual: LegacyPreflightReport,
  label: string,
): void {
  if (actual.fingerprint !== expected.fingerprint) {
    throw new TypeError(`Legacy source snapshot changed ${label}`);
  }
}

async function inspectMedia(
  database: DatabaseSync,
  assetsRootInput: string,
  probeAudioVisual: LegacyAudioVisualProbe | undefined,
): Promise<{
  readonly inspections: Readonly<Record<string, LegacyMediaTechnicalInspection>>;
  readonly sourcePaths: ReadonlyMap<string, string>;
}> {
  const assetsRoot = await canonicalizeExistingPath(assetsRootInput);
  const statement = database.prepare('SELECT hash, type, format FROM asset_contents ORDER BY hash');
  const sourcePaths = new Map<string, string>();
  const inspections: Record<string, LegacyMediaTechnicalInspection> = {};
  for (const row of statement.all() as unknown as readonly {
    readonly hash: unknown;
    readonly type: unknown;
    readonly format: unknown;
  }[]) {
    if (
      typeof row.hash !== 'string' ||
      !/^[a-f0-9]{64}$/.test(row.hash) ||
      (row.type !== 'image' && row.type !== 'video' && row.type !== 'audio') ||
      typeof row.format !== 'string' ||
      !/^[a-z0-9]{1,16}$/.test(row.format)
    ) {
      throw new TypeError('Legacy media identity cannot form a safe source path');
    }
    const sourcePath = await canonicalizeExistingPath(
      join(assetsRoot, row.type, row.hash.slice(0, 2), `${row.hash}.${row.format}`),
    );
    if (!isWithin(assetsRoot, sourcePath)) throw new TypeError('Legacy media path escaped its CAS');
    inspections[row.hash] = await inspectLegacyMediaTechnicalBytes({
      sourcePath,
      declaredType: row.type,
      declaredFormat: row.format,
      probeAudioVisual,
    });
    sourcePaths.set(row.hash, sourcePath);
  }
  return { inspections, sourcePaths };
}

async function canonicalFileFingerprint(path: string) {
  const bytes = await readFile(path);
  return {
    byteLength: String(bytes.byteLength),
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

async function assertCanonicalFileFingerprint(
  path: string,
  expected: Awaited<ReturnType<typeof canonicalFileFingerprint>>,
  label: string,
): Promise<void> {
  const actual = await canonicalFileFingerprint(path);
  if (actual.sha256 !== expected.sha256 || actual.byteLength !== expected.byteLength) {
    throw new Error(`${label} changed after final reconciliation`);
  }
}

async function writeCanonicalEvidence(path: string, value: unknown): Promise<void> {
  const handle = await open(path, 'wx', 0o600);
  try {
    await handle.writeFile(Buffer.from(`${canonicalJson(value)}\n`, 'utf8'));
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function assertReconciliationsEqual(
  first: LegacyMigrationReconciliationReport,
  reopened: LegacyMigrationReconciliationReport,
): void {
  if (first.fingerprint !== reopened.fingerprint) {
    throw new Error('Disposable Target reconciliation changed after reopen');
  }
}

/**
 * Performs the complete one-way migration only inside a new disposable sibling
 * staging root, then atomically publishes that root after reopen verification.
 */
export async function rehearseDisposableLegacyMigration(
  input: DisposableLegacyMigrationRehearsalInput,
): Promise<DisposableLegacyMigrationRehearsalReport> {
  const filesystemPaths = await prepareRehearsalFilesystemPaths(input);
  const {
    sources: sourcePaths,
    targetRootPath,
    stagingRootPath,
    parentPath,
    parentIdentity,
  } = filesystemPaths;
  const targetRootName = basename(targetRootPath);
  const skillBundle = parseCanonical(LegacySkillMigrationBundleV1Schema, input.skillBundle);
  const browserState = parseLegacyBrowserStateSnapshot(input.browserState);
  const skillPlan = validateLegacySkillMigrationPlan(input.skillPlan, {
    builtInDocuments: input.builtInSkills,
    sourceBundle: skillBundle,
  });
  const firstPreflight = await preflightLegacyInputs(sourcePaths);
  if (!firstPreflight.ok || firstPreflight.media.status !== 'checked') {
    throw new TypeError('Legacy source preflight is blocked');
  }
  if (firstPreflight.fingerprint !== input.readiness.source.preflightFingerprint) {
    throw new TypeError('Legacy source differs from the approved readiness report');
  }

  let main: DatabaseSync | undefined;
  let prompts: DatabaseSync | undefined;
  let phaseOne: ReturnType<typeof classifyLegacyPhaseOne>;
  let materialization: ReturnType<typeof buildLegacyMigrationMaterialization>;
  let offlineExport: ReturnType<typeof buildLegacyOfflineExportBundle>;
  let browserStateEvidence: LegacyBrowserStateMigrationEvidence;
  let mediaSources: ReadonlyMap<string, string>;
  let expectationHash: string;
  try {
    main = openConfiguredDatabase(sourcePaths.mainDatabasePath, true);
    prompts = openConfiguredDatabase(sourcePaths.promptsDatabasePath, true);
    phaseOne = classifyLegacyPhaseOne(
      { main, prompts },
      I0_LEGACY_SOURCE_SCHEMAS,
      firstPreflight.media.report,
      { root: { classifyLegacySkillRows: createLegacySkillRowClassifier(skillPlan) } },
    );
    const currentReadiness = buildLegacyMigrationReadinessReport({
      preflight: firstPreflight,
      phaseOne,
    });
    if (currentReadiness.fingerprint !== input.readiness.fingerprint) {
      throw new TypeError('Legacy readiness report changed before disposable migration');
    }
    const currentPlan = buildLegacyMigrationPlan({ readiness: currentReadiness, phaseOne });
    if (canonicalJson(currentPlan) !== canonicalJson(input.plan)) {
      throw new TypeError('Legacy migration plan changed before disposable migration');
    }
    offlineExport = buildLegacyOfflineExportBundle(
      { main, prompts },
      I0_LEGACY_SOURCE_SCHEMAS,
      phaseOne,
    );
    browserStateEvidence = buildLegacyBrowserStateMigrationEvidence({
      snapshot: browserState,
      rendererExport: skillBundle.rendererExport,
      sqliteMirror: createLegacySqliteChatMirrorSummary(main),
    });
    if (!browserStateEvidence.ok) {
      throw new TypeError('Legacy browser Chat mirror differs from canonical SQLite sessions');
    }
    expectationHash = legacyMigrationReconciliationExpectationHash({
      plan: input.plan,
      skillPlan,
      offlineEvidenceManifestHash: offlineExport.fingerprint,
      browserStateFingerprint: browserState.fingerprint,
    });
    const inspected = await inspectMedia(main, sourcePaths.assetsRoot, input.probeAudioVisual);
    mediaSources = inspected.sourcePaths;
    materialization = buildLegacyMigrationMaterialization({
      databases: { main, prompts },
      phaseOne,
      plan: input.plan,
      skillPlan,
      mediaInspections: inspected.inspections,
      offlineEvidenceManifestHash: offlineExport.fingerprint,
      reconciliationHash: expectationHash,
    });
  } finally {
    prompts?.close();
    main?.close();
  }

  const prewritePreflight = await preflightLegacyInputs(sourcePaths);
  assertSamePreflight(firstPreflight, prewritePreflight, 'before Target write');
  let store: TargetStore | undefined;
  let stagingOwned = false;
  let stagingIdentity: DirectoryIdentity | undefined;
  let ownedStagingDirectories: readonly OwnedDirectory[] = [];
  let renamed = false;
  let outcome:
    | {
        readonly kind: 'succeeded';
        readonly report: DisposableLegacyMigrationRehearsalReport;
      }
    | { readonly kind: 'failed'; readonly cause: unknown };
  try {
    await mkdir(stagingRootPath);
    stagingOwned = true;
    await assertSameDirectoryIdentity(
      parentPath,
      parentIdentity,
      'Disposable Target parent',
      'after staging creation',
    );
    stagingIdentity = await directoryIdentity(stagingRootPath, 'Disposable staging root');
    const stagingDirectory = {
      path: stagingRootPath,
      identity: stagingIdentity,
      label: 'Disposable staging root',
    };
    ownedStagingDirectories = [stagingDirectory];
    fault(input, 'after_staging_created');
    await assertOwnedDirectories(ownedStagingDirectories, 'after staging fault point');
    let mediaCas: ReturnType<typeof createFilesystemMediaCas> | undefined;
    if (materialization.mediaBlobs.length > 0) {
      const mediaDirectory = await createOwnedChildDirectory(
        stagingDirectory,
        TARGET_MEDIA_DIRECTORY,
        'Disposable staging media directory',
      );
      const incomingDirectory = await createOwnedChildDirectory(
        mediaDirectory,
        '.incoming',
        'Disposable staging media incoming directory',
      );
      const sha256Directory = await createOwnedChildDirectory(
        mediaDirectory,
        'sha256',
        'Disposable staging media SHA-256 directory',
      );
      ownedStagingDirectories = [
        ...ownedStagingDirectories,
        mediaDirectory,
        incomingDirectory,
        sha256Directory,
      ];
      mediaCas = createFilesystemMediaCas(mediaDirectory.path);
      const hashDirectories = new Map<string, OwnedDirectory>();
      for (const blob of materialization.mediaBlobs) {
        const sourcePath = mediaSources.get(blob.hash);
        if (sourcePath === undefined)
          throw new Error(`Legacy media source disappeared: ${blob.hash}`);
        const prefix = blob.hash.slice(0, 2);
        let hashDirectory = hashDirectories.get(prefix);
        if (hashDirectory === undefined) {
          hashDirectory = await createOwnedChildDirectory(
            sha256Directory,
            prefix,
            'Disposable staging media hash directory',
          );
          hashDirectories.set(prefix, hashDirectory);
          ownedStagingDirectories = [...ownedStagingDirectories, hashDirectory];
        }
        await assertOwnedDirectories(ownedStagingDirectories, 'before media write');
        await mediaCas.putVerified(
          { hash: blob.hash, byteLength: blob.byteLength },
          createReadStream(sourcePath),
        );
        await assertOwnedDirectories(ownedStagingDirectories, 'after media write');
      }
    }
    fault(input, 'after_media_copy');
    await assertOwnedDirectories(ownedStagingDirectories, 'after media-copy fault point');
    const offlineEvidence = await writeLegacyOfflineExportBundle(
      offlineExport,
      join(stagingRootPath, TARGET_OFFLINE_EXPORT_NAME),
    );
    await assertOwnedDirectories(ownedStagingDirectories, 'after offline-evidence write');
    await writeCanonicalEvidence(join(stagingRootPath, TARGET_BROWSER_STATE_NAME), browserState);
    const browserStateFile = await canonicalFileFingerprint(
      join(stagingRootPath, TARGET_BROWSER_STATE_NAME),
    );
    await assertOwnedDirectories(ownedStagingDirectories, 'after browser-state evidence write');
    const targetDatabasePath = join(stagingRootPath, TARGET_DATABASE_NAME);
    await assertOwnedDirectories(ownedStagingDirectories, 'before Target database creation');
    store = await createTargetStore(targetDatabasePath);
    await assertOwnedDirectories(ownedStagingDirectories, 'after Target database creation');
    const database = getTargetStoreDatabase(store);
    withImmediateTransaction(database, () => {
      writeLegacyMigrationMaterializationInTransaction(database, materialization);
      fault(input, 'inside_transaction');
    });
    fault(input, 'after_transaction');
    await assertOwnedDirectories(ownedStagingDirectories, 'after transaction fault point');
    for (const blob of materialization.mediaBlobs) {
      if (mediaCas === undefined) throw new Error('Disposable media CAS is unavailable');
      await assertOwnedDirectories(ownedStagingDirectories, 'before media verification');
      await mediaCas.verify({ hash: blob.hash, byteLength: blob.byteLength });
      await assertOwnedDirectories(ownedStagingDirectories, 'after media verification');
    }
    const firstReconciliation = await reconcileLegacyMigration(
      database,
      materialization,
      input.plan,
      expectationHash,
    );
    const schemaFingerprint = store.schemaFingerprint.sha256;
    store.close();
    store = await openTargetStore(targetDatabasePath);
    if (store.schemaFingerprint.sha256 !== schemaFingerprint) {
      throw new Error('Disposable Target schema changed after reopen');
    }
    await assertOwnedDirectories(ownedStagingDirectories, 'after Target database reopen');
    const reopenedReconciliation = await reconcileLegacyMigration(
      getTargetStoreDatabase(store),
      materialization,
      input.plan,
      expectationHash,
    );
    assertReconciliationsEqual(firstReconciliation, reopenedReconciliation);
    fault(input, 'after_reopen');
    await assertOwnedDirectories(ownedStagingDirectories, 'after reopen fault point');
    const reopenedOfflineEvidence = await canonicalFileFingerprint(
      join(stagingRootPath, TARGET_OFFLINE_EXPORT_NAME),
    );
    if (
      reopenedOfflineEvidence.sha256 !== offlineEvidence.sha256 ||
      reopenedOfflineEvidence.byteLength !== offlineEvidence.byteLength
    ) {
      throw new Error('Disposable offline evidence changed after reopen');
    }
    await assertCanonicalFileFingerprint(
      join(stagingRootPath, TARGET_BROWSER_STATE_NAME),
      browserStateFile,
      'Disposable browser-state evidence',
    );
    const finalPreflight = await preflightLegacyInputs(sourcePaths);
    assertSamePreflight(firstPreflight, finalPreflight, 'during disposable migration');
    const finalReconciliation = await reconcileLegacyMigration(
      getTargetStoreDatabase(store),
      materialization,
      input.plan,
      expectationHash,
    );
    assertReconciliationsEqual(reopenedReconciliation, finalReconciliation);
    await writeCanonicalEvidence(
      join(stagingRootPath, TARGET_RECONCILIATION_NAME),
      finalReconciliation,
    );
    await assertOwnedDirectories(ownedStagingDirectories, 'after reconciliation-evidence write');
    store.close();
    store = undefined;
    store = await openTargetStore(targetDatabasePath);
    if (store.schemaFingerprint.sha256 !== schemaFingerprint) {
      throw new Error('Disposable Target schema changed after final validation');
    }
    store.close();
    store = undefined;
    const targetDatabase = {
      schemaFingerprint,
      ...(await canonicalFileFingerprint(targetDatabasePath)),
    };
    const reconciliationEvidence = await canonicalFileFingerprint(
      join(stagingRootPath, TARGET_RECONCILIATION_NAME),
    );
    const withoutFingerprint = {
      schema: 'lucid-fin.disposable-legacy-migration-rehearsal/v1' as const,
      source: {
        readinessFingerprint: input.readiness.fingerprint,
        preflightFingerprint: firstPreflight.fingerprint,
        phaseOneFingerprint: phaseOne.fingerprint,
        contentFingerprint: phaseOne.sourceContentFingerprint,
        finalPreflightFingerprint: finalPreflight.fingerprint,
      },
      planFingerprint: input.plan.fingerprint,
      skillPlanHash: skillPlan.planHash,
      materializationFingerprint: materialization.fingerprint,
      reconciliationExpectationHash: expectationHash,
      firstReconciliationFingerprint: firstReconciliation.fingerprint,
      reopenedReconciliationFingerprint: reopenedReconciliation.fingerprint,
      finalReconciliationFingerprint: finalReconciliation.fingerprint,
      targetDatabase,
      offlineEvidence: {
        bundleFingerprint: offlineEvidence.bundleFingerprint,
        sha256: offlineEvidence.sha256,
        byteLength: offlineEvidence.byteLength,
      },
      browserState: {
        snapshotFingerprint: browserState.fingerprint,
        evidenceFingerprint: browserStateEvidence.fingerprint,
        sessionComparisonFingerprint: browserStateEvidence.sessionComparison.fingerprint,
        sha256: browserStateFile.sha256,
        byteLength: browserStateFile.byteLength,
      },
      reconciliationEvidence,
      mediaObjectCount: materialization.mediaBlobs.length,
      atomicRenameVerified: true as const,
      targetRootName,
    };
    fault(input, 'before_atomic_rename');
    if (stagingIdentity === undefined)
      throw new Error('Disposable staging root identity is unavailable');
    await assertReadyToPublish(filesystemPaths, stagingIdentity);
    for (const blob of materialization.mediaBlobs) {
      if (mediaCas === undefined) throw new Error('Disposable media CAS is unavailable');
      await assertOwnedDirectories(ownedStagingDirectories, 'before final media verification');
      await mediaCas.verify({ hash: blob.hash, byteLength: blob.byteLength });
      await assertOwnedDirectories(ownedStagingDirectories, 'after final media verification');
    }
    await assertExactStagingOutput(stagingRootPath, materialization.mediaBlobs);
    await assertCanonicalFileFingerprint(
      targetDatabasePath,
      targetDatabase,
      'Disposable Target database',
    );
    await assertCanonicalFileFingerprint(
      join(stagingRootPath, TARGET_OFFLINE_EXPORT_NAME),
      reopenedOfflineEvidence,
      'Disposable offline evidence',
    );
    await assertCanonicalFileFingerprint(
      join(stagingRootPath, TARGET_BROWSER_STATE_NAME),
      browserStateFile,
      'Disposable browser-state evidence',
    );
    await assertCanonicalFileFingerprint(
      join(stagingRootPath, TARGET_RECONCILIATION_NAME),
      reconciliationEvidence,
      'Disposable reconciliation evidence',
    );
    await rename(stagingRootPath, targetRootPath);
    await assertSameDirectoryIdentity(
      targetRootPath,
      stagingIdentity,
      'Disposable Target root',
      'after publish',
    );
    renamed = true;
    const report: DisposableLegacyMigrationRehearsalReport = {
      ...withoutFingerprint,
      fingerprint: hashCanonical(withoutFingerprint),
      ok: true,
    };
    outcome = { kind: 'succeeded', report };
  } catch (cause) {
    outcome = { kind: 'failed', cause };
  }

  const cleanupFailures: unknown[] = [];
  try {
    store?.close();
  } catch (closeCause) {
    cleanupFailures.push(closeCause);
  }
  if (stagingOwned && !renamed && stagingIdentity !== undefined) {
    try {
      await assertSameDirectoryIdentity(
        parentPath,
        parentIdentity,
        'Disposable Target parent',
        'before cleanup',
      );
      await assertSameDirectoryIdentity(
        stagingRootPath,
        stagingIdentity,
        'Disposable staging root',
        'before cleanup',
      );
      await assertOwnedDirectories(ownedStagingDirectories, 'before cleanup');
      await assertNoReparseDescendants(stagingRootPath, 'Disposable staging root');
      await rm(stagingRootPath, { recursive: true, force: false });
    } catch (cleanupCause) {
      cleanupFailures.push(cleanupCause);
    }
  }

  if (outcome.kind === 'failed') {
    if (cleanupFailures.length > 0) {
      const primaryMessage =
        outcome.cause instanceof Error ? outcome.cause.message : 'unknown migration failure';
      throw new AggregateError(
        [outcome.cause, ...cleanupFailures],
        `Disposable Legacy migration failed and could not fully clean staging root ${stagingRootPath}: ${primaryMessage}`,
      );
    }
    throw outcome.cause;
  }
  if (cleanupFailures.length === 1) throw cleanupFailures[0];
  if (cleanupFailures.length > 0) {
    throw new AggregateError(
      cleanupFailures,
      `Disposable Legacy migration failed and could not fully clean staging root ${stagingRootPath}: unknown migration failure`,
    );
  }
  return outcome.report;
}
