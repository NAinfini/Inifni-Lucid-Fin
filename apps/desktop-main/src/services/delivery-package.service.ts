import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type {
  CanvasId,
  DeliveryManifestContent,
  DeliveryManifestContext,
  DeliveryPackageTaskAttempt,
  PlanDocument,
  TaskList,
} from '@lucid-fin/contracts';
import { DeliveryManifestSchema } from '@lucid-fin/contracts-parse';
import type { CAS, SqliteIndex } from '@lucid-fin/storage';
import log from '../logger.js';

export interface DeliveryPackageStartInput {
  taskListId: string;
  canvasId: string;
  expectedManifestRevision: number;
  expectedManifestHash: string;
  destinationDirectory: string;
}

export interface DeliveryPackageAttemptView {
  attemptId: string;
  status: DeliveryPackageTaskAttempt['status'];
  progress: number;
  destinationPath: string;
  manifestRevision: number;
  manifestHash: string;
  attempt: number;
  error?: string;
}

interface DeliveryTaskExecutionEngine {
  get(taskListId: string): TaskList | undefined;
  getDeliveryContext(taskListId: string): DeliveryManifestContext | undefined;
  requireApprovedDeliveryManifest(taskListId: string, canvasId: string): PlanDocument;
}

export interface DeliveryPackageServiceOptions {
  db: SqliteIndex;
  cas: CAS;
  taskExecutionEngine: DeliveryTaskExecutionEngine;
  now?: () => number;
  idFactory?: () => string;
}

interface RunningPackage {
  abortController: AbortController;
  progress: number;
}

interface PackageFileRecord {
  path: string;
  sha256: string;
  bytes: number;
}

interface PackageFacts {
  packageHash: string;
  packageBytes: number;
  fileCount: number;
}

class PublishAmbiguityError extends Error {}

export class DeliveryPackageService {
  private readonly now: () => number;
  private readonly idFactory: () => string;
  private readonly running = new Map<string, RunningPackage>();

  constructor(private readonly options: DeliveryPackageServiceOptions) {
    this.now = options.now ?? (() => Date.now());
    this.idFactory = options.idFactory ?? randomUUID;
  }

  async startApproved(input: DeliveryPackageStartInput): Promise<DeliveryPackageAttemptView> {
    const { document, manifest } = this.requireExactManifest(input);
    const finalPath = await this.resolveFinalPath(input.destinationDirectory, document, manifest);
    const idempotencyKey = hashText(
      canonicalJson({
        taskListId: input.taskListId,
        manifestRevision: document.revision,
        manifestHash: document.contentHash,
        destinationPath: normalizeIdentityPath(finalPath),
      }),
    );
    const now = this.now();
    const taskList = this.options.taskExecutionEngine.get(input.taskListId);
    if (!taskList) throw new Error(`Task List "${input.taskListId}" not found`);
    const reserved = this.options.db.repos.taskLists.reserveDeliveryPackageAttempt({
      attempt: {
        kind: 'batch_export',
        id: this.idFactory(),
        taskListId: input.taskListId,
        ...(taskList.currentTaskId ? { taskId: taskList.currentTaskId } : {}),
        manifestRevision: document.revision,
        manifestHash: document.contentHash,
        idempotencyKey,
        status: 'queued',
        rowVersion: 0,
        destinationPath: finalPath,
        attempt: 1,
        createdAt: now,
        updatedAt: now,
      },
    });
    let attempt = reserved.attempt;
    if (!reserved.created) {
      if (attempt.idempotencyKey !== idempotencyKey || attempt.destinationPath !== finalPath) {
        throw new Error('Approved Delivery package already has a different destination');
      }
      if (attempt.status === 'completed' || isActive(attempt.status)) {
        return this.toView(attempt);
      }
      throw new Error(
        `Delivery package attempt is ${attempt.status}; use deliveryPackage:retry explicitly`,
      );
    }
    if (fs.existsSync(finalPath)) {
      attempt = this.options.db.repos.taskLists.transitionDeliveryPackageAttempt({
        id: attempt.id,
        expectedRowVersion: attempt.rowVersion,
        expectedStatuses: ['queued'],
        status: 'failed',
        error: `Delivery package destination already exists; overwrite is forbidden: ${finalPath}`,
        updatedAt: this.now(),
      });
      throw new Error(attempt.error);
    }
    this.launch(attempt, manifest);
    return this.toView(attempt);
  }

  getStatus(attemptId: string): DeliveryPackageAttemptView | null {
    const attempt = this.options.db.repos.taskLists.getDeliveryPackageAttempt(attemptId);
    return attempt ? this.toView(attempt) : null;
  }

  cancel(attemptId: string): DeliveryPackageAttemptView | null {
    let attempt = this.options.db.repos.taskLists.getDeliveryPackageAttempt(attemptId);
    if (!attempt) return null;
    this.running.get(attemptId)?.abortController.abort();
    if (attempt.status === 'queued' || attempt.status === 'running') {
      attempt = this.options.db.repos.taskLists.transitionDeliveryPackageAttempt({
        id: attempt.id,
        expectedRowVersion: attempt.rowVersion,
        expectedStatuses: [attempt.status],
        status: 'cancelled',
        error: 'Cancelled by user',
        updatedAt: this.now(),
      });
    }
    return this.toView(attempt);
  }

  async retry(attemptId: string): Promise<DeliveryPackageAttemptView> {
    let attempt = this.requireAttempt(attemptId);
    if (!['failed', 'cancelled', 'recovery_required'].includes(attempt.status)) {
      throw new Error(`Delivery package attempt is not retryable from ${attempt.status}`);
    }
    if (attempt.status === 'recovery_required') {
      await this.recoverPublish(attempt);
      attempt = this.requireAttempt(attemptId);
      if (attempt.status === 'completed') return this.toView(attempt);
    }
    const { manifest } = this.requireAttemptManifest(attempt);
    if (fs.existsSync(attempt.destinationPath)) {
      throw new Error(
        `Delivery package destination exists and will not be overwritten: ${attempt.destinationPath}`,
      );
    }
    if (attempt.stagingPath) await this.removeStagingIfSafe(attempt);
    attempt = this.options.db.repos.taskLists.retryDeliveryPackageAttempt({
      id: attempt.id,
      expectedRowVersion: attempt.rowVersion,
      updatedAt: this.now(),
    });
    this.launch(attempt, manifest);
    return this.toView(attempt);
  }

  requireCompletedPackagePath(attemptId: string): string {
    const attempt = this.requireAttempt(attemptId);
    if (attempt.status !== 'completed') {
      throw new Error('Only a completed Delivery package can be opened');
    }
    if (!fs.existsSync(attempt.destinationPath)) {
      throw new Error('Completed Delivery package is missing from its destination');
    }
    return attempt.destinationPath;
  }

  async recoverInterruptedAttempts(): Promise<void> {
    for (const attempt of this.options.db.repos.taskLists.listRecoverableDeliveryPackageAttempts()) {
      try {
        if (attempt.status === 'queued' || attempt.status === 'running') {
          if (attempt.stagingPath) await this.removeStagingIfSafe(attempt);
          this.options.db.repos.taskLists.transitionDeliveryPackageAttempt({
            id: attempt.id,
            expectedRowVersion: attempt.rowVersion,
            expectedStatuses: [attempt.status],
            status: 'failed',
            error: `Application restarted while Delivery packaging was ${attempt.status}`,
            updatedAt: this.now(),
          });
        } else {
          await this.recoverPublish(attempt);
        }
      } catch (error) {
        const latest = this.options.db.repos.taskLists.getDeliveryPackageAttempt(attempt.id);
        if (latest && latest.status !== 'completed' && latest.status !== 'recovery_required') {
          this.markRecoveryRequired(latest, error);
        }
        log.error('Delivery package recovery failed', {
          category: 'delivery-package',
          attemptId: attempt.id,
          error: errorMessage(error),
        });
      }
    }
  }

  private launch(attempt: DeliveryPackageTaskAttempt, manifest: DeliveryManifestContent): void {
    if (this.running.has(attempt.id)) return;
    const abortController = new AbortController();
    this.running.set(attempt.id, { abortController, progress: 0 });
    void this.execute(attempt, manifest, abortController).finally(() => {
      this.running.delete(attempt.id);
    });
  }

  private async execute(
    attempt: DeliveryPackageTaskAttempt,
    manifest: DeliveryManifestContent,
    abortController: AbortController,
  ): Promise<void> {
    const stagingPath = makeStagingPath(attempt);
    let current = attempt;
    let publishStarted = false;
    try {
      assertUniquePackageNames(manifest);
      if (fs.existsSync(attempt.destinationPath)) {
        throw new Error(
          `Delivery package destination already exists; overwrite is forbidden: ${attempt.destinationPath}`,
        );
      }
      if (fs.existsSync(stagingPath)) {
        throw new Error(`Delivery package staging directory already exists: ${stagingPath}`);
      }
      const sources = await this.resolveSources(manifest, abortController.signal);
      current = this.options.db.repos.taskLists.transitionDeliveryPackageAttempt({
        id: current.id,
        expectedRowVersion: current.rowVersion,
        expectedStatuses: ['queued'],
        status: 'running',
        stagingPath,
        updatedAt: this.now(),
      });
      await fsp.mkdir(stagingPath);
      await fsyncDirectoryIfSupported(path.dirname(stagingPath));
      const records: PackageFileRecord[] = [];
      for (const [index, item] of manifest.items.entries()) {
        throwIfAborted(abortController.signal);
        const record = await copyFileVerified(
          sources[index],
          path.join(stagingPath, item.packageFileName),
          item.packageFileName,
          abortController.signal,
        );
        if (record.sha256 !== item.selectedVideoHash || record.bytes !== item.sourceBytes) {
          throw new Error(`Delivery source changed while copying: ${item.selectedVideoHash}`);
        }
        records.push(record);
        const running = this.running.get(attempt.id);
        if (running) running.progress = 10 + Math.floor(((index + 1) / manifest.items.length) * 70);
      }
      const manifestJson = buildManifestJson(current, manifest);
      const manifestCsv = buildManifestCsv(manifest);
      records.push(await writeFileFsynced(stagingPath, 'manifest.json', manifestJson));
      records.push(await writeFileFsynced(stagingPath, 'manifest.csv', manifestCsv));
      await fsyncDirectoryIfSupported(stagingPath);
      const facts = packageFacts(records);
      current = this.options.db.repos.taskLists.transitionDeliveryPackageAttempt({
        id: current.id,
        expectedRowVersion: current.rowVersion,
        expectedStatuses: ['running'],
        status: 'ready_to_publish',
        packageHash: facts.packageHash,
        packageBytes: facts.packageBytes,
        fileCount: facts.fileCount,
        updatedAt: this.now(),
      });
      const running = this.running.get(attempt.id);
      if (running) running.progress = 90;
      throwIfAborted(abortController.signal);
      publishStarted = true;
      await this.publishReady(current, manifest, stagingPath);
    } catch (error) {
      const latest = this.options.db.repos.taskLists.getDeliveryPackageAttempt(attempt.id);
      if (latest && latest.status !== 'completed' && latest.status !== 'cancelled') {
        try {
          if (publishStarted || latest.status === 'ready_to_publish') {
            this.markRecoveryRequired(latest, error);
          } else if (latest.status === 'queued' || latest.status === 'running') {
            this.options.db.repos.taskLists.transitionDeliveryPackageAttempt({
              id: latest.id,
              expectedRowVersion: latest.rowVersion,
              expectedStatuses: [latest.status],
              status: 'failed',
              error: errorMessage(error),
              updatedAt: this.now(),
            });
          }
        } catch (transitionError) {
          log.error('Delivery package failure persistence failed', {
            category: 'delivery-package',
            attemptId: attempt.id,
            error: errorMessage(transitionError),
          });
        }
      }
      const persisted = this.options.db.repos.taskLists.getDeliveryPackageAttempt(attempt.id);
      if (persisted?.status === 'failed' || persisted?.status === 'cancelled') {
        try {
          await this.removeStagingIfSafe({ ...persisted, stagingPath });
        } catch (cleanupError) {
          log.warn('Delivery package staging cleanup failed', {
            category: 'delivery-package',
            attemptId: attempt.id,
            error: errorMessage(cleanupError),
          });
        }
      }
      log.error('Delivery package attempt failed', {
        category: 'delivery-package',
        attemptId: attempt.id,
        error: errorMessage(error),
      });
    }
  }

  private async resolveSources(
    manifest: DeliveryManifestContent,
    signal: AbortSignal,
  ): Promise<string[]> {
    const sources: string[] = [];
    for (const item of manifest.items) {
      throwIfAborted(signal);
      const asset = this.options.db.repos.assets.findByHash(item.selectedVideoHash);
      if (!asset || asset.type !== 'video' || asset.format !== item.sourceFormat) {
        throw new Error(`Approved Delivery video asset is missing: ${item.selectedVideoHash}`);
      }
      const sourcePath = this.options.cas.getAssetPath(
        item.selectedVideoHash,
        'video',
        item.sourceFormat,
      );
      let stat: fs.Stats;
      try {
        stat = await fsp.stat(sourcePath);
      } catch {
        throw new Error(`Approved Delivery source is missing from CAS: ${item.selectedVideoHash}`);
      }
      if (!stat.isFile() || stat.size !== item.sourceBytes) {
        throw new Error(`Approved Delivery source size mismatch: ${item.selectedVideoHash}`);
      }
      sources.push(sourcePath);
    }
    return sources;
  }

  private async publishReady(
    attempt: DeliveryPackageTaskAttempt,
    manifest: DeliveryManifestContent,
    stagingPath: string,
  ): Promise<void> {
    if (attempt.status !== 'ready_to_publish') {
      throw new Error('Delivery package attempt is not ready to publish');
    }
    await this.verifyPackageDirectory(stagingPath, attempt, manifest);
    this.requireAttemptManifest(attempt);
    try {
      await fsyncDirectoryIfSupported(path.dirname(stagingPath));
      await fsp.rename(stagingPath, attempt.destinationPath);
      await fsyncDirectoryIfSupported(path.dirname(attempt.destinationPath));
    } catch (error) {
      throw new PublishAmbiguityError(`Atomic Delivery package publish failed: ${errorMessage(error)}`);
    }
    const exact = this.requireAttemptManifest(attempt);
    await this.complete(attempt, exact.manifest);
  }

  private async recoverPublish(attempt: DeliveryPackageTaskAttempt): Promise<void> {
    const { manifest } = this.requireAttemptManifest(attempt);
    const finalExists = fs.existsSync(attempt.destinationPath);
    const stagingExists = Boolean(attempt.stagingPath && fs.existsSync(attempt.stagingPath));
    let current = attempt;
    if (finalExists) {
      await this.verifyPackageDirectory(attempt.destinationPath, attempt, manifest);
      if (stagingExists) await this.removeStagingIfSafe(attempt);
    } else if (stagingExists && attempt.stagingPath) {
      if (!this.isSafeStagingPath(attempt, attempt.stagingPath)) {
        throw new Error('Delivery package staging path is outside its exact destination sibling');
      }
      await this.verifyPackageDirectory(attempt.stagingPath, attempt, manifest);
      if (current.status === 'recovery_required') {
        current = this.options.db.repos.taskLists.transitionDeliveryPackageAttempt({
          id: current.id,
          expectedRowVersion: current.rowVersion,
          expectedStatuses: ['recovery_required'],
          status: 'ready_to_publish',
          updatedAt: this.now(),
        });
      }
      try {
        await fsyncDirectoryIfSupported(path.dirname(attempt.stagingPath));
        await fsp.rename(attempt.stagingPath, attempt.destinationPath);
        await fsyncDirectoryIfSupported(path.dirname(attempt.destinationPath));
      } catch (error) {
        throw new PublishAmbiguityError(
          `Atomic Delivery package recovery publish failed: ${errorMessage(error)}`,
        );
      }
    } else {
      throw new Error('Delivery package recovery found neither the exact staging nor final package');
    }
    if (current.status === 'recovery_required') {
      current = this.options.db.repos.taskLists.transitionDeliveryPackageAttempt({
        id: current.id,
        expectedRowVersion: current.rowVersion,
        expectedStatuses: ['recovery_required'],
        status: 'ready_to_publish',
        updatedAt: this.now(),
      });
    }
    await this.complete(current, manifest);
  }

  private async verifyPackageDirectory(
    directory: string,
    attempt: DeliveryPackageTaskAttempt,
    manifest: DeliveryManifestContent,
  ): Promise<void> {
    const expectedNames = [...manifest.items.map((item) => item.packageFileName), 'manifest.json', 'manifest.csv'].sort();
    const actualNames = (await fsp.readdir(directory)).sort();
    if (canonicalJson(actualNames) !== canonicalJson(expectedNames)) {
      throw new Error('Delivery package file set does not match the exact approved manifest');
    }
    const records: PackageFileRecord[] = [];
    for (const item of manifest.items) {
      const record = await hashFile(path.join(directory, item.packageFileName), item.packageFileName);
      if (record.sha256 !== item.selectedVideoHash || record.bytes !== item.sourceBytes) {
        throw new Error(`Delivery package content mismatch: ${item.packageFileName}`);
      }
      records.push(record);
    }
    const jsonRecord = await hashExactTextFile(
      directory,
      'manifest.json',
      buildManifestJson(attempt, manifest),
    );
    const csvRecord = await hashExactTextFile(
      directory,
      'manifest.csv',
      buildManifestCsv(manifest),
    );
    records.push(jsonRecord, csvRecord);
    const facts = packageFacts(records);
    if (
      attempt.packageHash !== facts.packageHash ||
      attempt.packageBytes !== facts.packageBytes ||
      attempt.fileCount !== facts.fileCount
    ) {
      throw new Error('Delivery package deterministic record hash does not match durable state');
    }
  }

  private async complete(
    attempt: DeliveryPackageTaskAttempt,
    manifest: DeliveryManifestContent,
  ): Promise<void> {
    const exact = this.requireAttemptManifest(attempt);
    if (exact.document.contentHash !== attempt.manifestHash) {
      throw new Error('Delivery package approval changed before completion');
    }
    const taskList = this.options.taskExecutionEngine.get(attempt.taskListId);
    if (!taskList) throw new Error(`Task List "${attempt.taskListId}" not found`);
    if (
      !attempt.packageHash ||
      attempt.packageBytes === undefined ||
      attempt.fileCount === undefined
    ) {
      throw new Error('Delivery package attempt is missing deterministic package facts');
    }
    const completedAt = this.now();
    this.options.db.repos.taskLists.completeDeliveryPackageAttempt({
      id: attempt.id,
      expectedExecutionRowVersion: attempt.rowVersion,
      expectedTaskListRowVersion: taskList.rowVersion ?? 0,
      packageHash: attempt.packageHash,
      packageBytes: attempt.packageBytes,
      fileCount: attempt.fileCount,
      completedAt,
      taskListOutput: {
        deliveryPackage: {
          attemptId: attempt.id,
          manifestRevision: attempt.manifestRevision,
          manifestHash: attempt.manifestHash,
          packageHash: attempt.packageHash,
          packageBytes: attempt.packageBytes,
          fileCount: attempt.fileCount,
          destinationPath: attempt.destinationPath,
        },
      },
      event: {
        taskListId: attempt.taskListId,
        eventId: this.idFactory(),
        actor: 'system',
        correlationId: attempt.id,
        payload: {
          type: 'task_list.delivery_package.completed',
          attemptId: attempt.id,
          manifestRevision: attempt.manifestRevision,
          manifestHash: attempt.manifestHash,
          packageHash: attempt.packageHash,
          packageBytes: attempt.packageBytes,
          fileCount: attempt.fileCount,
          itemCount: manifest.items.length,
        },
        timestamp: completedAt,
      },
    });
  }

  private requireExactManifest(input: DeliveryPackageStartInput): {
    document: PlanDocument;
    manifest: DeliveryManifestContent;
  } {
    const document = this.options.taskExecutionEngine.requireApprovedDeliveryManifest(
      input.taskListId,
      input.canvasId,
    );
    if (
      document.revision !== input.expectedManifestRevision ||
      document.contentHash !== input.expectedManifestHash
    ) {
      throw new Error('Delivery manifest revision/hash changed before packaging');
    }
    const manifest = parseManifest(document);
    if (manifest.taskListId !== input.taskListId || manifest.canvasId !== input.canvasId) {
      throw new Error('Approved Delivery manifest identity does not match the request');
    }
    return { document, manifest };
  }

  private requireAttemptManifest(attempt: DeliveryPackageTaskAttempt): {
    document: PlanDocument;
    manifest: DeliveryManifestContent;
  } {
    const context = this.options.taskExecutionEngine.getDeliveryContext(attempt.taskListId);
    if (!context) throw new Error('Approved Delivery context is missing');
    const contextManifest = parseManifest(context.manifest);
    const document = this.options.taskExecutionEngine.requireApprovedDeliveryManifest(
      attempt.taskListId,
      contextManifest.canvasId,
    );
    if (
      document.revision !== attempt.manifestRevision ||
      document.contentHash !== attempt.manifestHash
    ) {
      throw new Error('Delivery package no longer matches the exact approved manifest');
    }
    return { document, manifest: parseManifest(document) };
  }

  private async resolveFinalPath(
    destinationDirectory: string,
    document: PlanDocument,
    manifest: DeliveryManifestContent,
  ): Promise<string> {
    const directory = path.resolve(destinationDirectory);
    const stat = await fsp.stat(directory).catch(() => undefined);
    if (!stat?.isDirectory()) throw new Error(`Delivery destination directory not found: ${directory}`);
    const canvas = this.options.db.repos.canvases.get(manifest.canvasId as CanvasId);
    const preferred = sanitizeBaseName(canvas?.name ?? '');
    const fallback = sanitizeBaseName(manifest.namingPolicy.packageBaseName);
    const base = preferred || fallback || 'canvas';
    return path.join(directory, `${base}-delivery-${document.contentHash.slice(0, 12)}`);
  }

  private requireAttempt(attemptId: string): DeliveryPackageTaskAttempt {
    const attempt = this.options.db.repos.taskLists.getDeliveryPackageAttempt(attemptId);
    if (!attempt) throw new Error(`Delivery package attempt "${attemptId}" not found`);
    return attempt;
  }

  private markRecoveryRequired(attempt: DeliveryPackageTaskAttempt, error: unknown): void {
    if (attempt.status === 'recovery_required' || attempt.status === 'completed') return;
    this.options.db.repos.taskLists.transitionDeliveryPackageAttempt({
      id: attempt.id,
      expectedRowVersion: attempt.rowVersion,
      expectedStatuses: [attempt.status],
      status: 'recovery_required',
      error: errorMessage(error),
      updatedAt: this.now(),
    });
  }

  private async removeStagingIfSafe(attempt: DeliveryPackageTaskAttempt): Promise<void> {
    const stagingPath = attempt.stagingPath;
    if (!stagingPath || !fs.existsSync(stagingPath)) return;
    if (!this.isSafeStagingPath(attempt, stagingPath)) {
      throw new Error(`Refusing to remove unrecognized Delivery staging path: ${stagingPath}`);
    }
    await fsp.rm(stagingPath, { recursive: true, force: true });
  }

  private isSafeStagingPath(attempt: DeliveryPackageTaskAttempt, stagingPath: string): boolean {
    const resolvedStaging = path.resolve(stagingPath);
    const resolvedDestination = path.resolve(attempt.destinationPath);
    return (
      path.dirname(resolvedStaging) === path.dirname(resolvedDestination) &&
      path.basename(resolvedStaging) ===
        `${path.basename(resolvedDestination)}.staging-${attempt.id}-attempt-${attempt.attempt}`
    );
  }

  private toView(attempt: DeliveryPackageTaskAttempt): DeliveryPackageAttemptView {
    const progress = this.running.get(attempt.id)?.progress ?? statusProgress(attempt.status);
    return {
      attemptId: attempt.id,
      status: attempt.status,
      progress,
      destinationPath: attempt.destinationPath,
      manifestRevision: attempt.manifestRevision,
      manifestHash: attempt.manifestHash,
      attempt: attempt.attempt,
      ...(attempt.error ? { error: attempt.error } : {}),
    };
  }
}

function parseManifest(document: PlanDocument): DeliveryManifestContent {
  return DeliveryManifestSchema.parse(document.content) as DeliveryManifestContent;
}

function makeStagingPath(attempt: DeliveryPackageTaskAttempt): string {
  return `${attempt.destinationPath}.staging-${attempt.id}-attempt-${attempt.attempt}`;
}

function assertUniquePackageNames(manifest: DeliveryManifestContent): void {
  const names = new Set<string>(['manifest.json', 'manifest.csv']);
  for (const item of manifest.items) {
    if (
      path.basename(item.packageFileName) !== item.packageFileName ||
      /[<>:"/\\|?*\u0000-\u001f]/.test(item.packageFileName) ||
      /[. ]$/.test(item.packageFileName)
    ) {
      throw new Error(`Approved Delivery package file name is unsafe: ${item.packageFileName}`);
    }
    const key = item.packageFileName.normalize('NFC').toLowerCase();
    if (names.has(key)) throw new Error(`Delivery package file name collision: ${item.packageFileName}`);
    names.add(key);
  }
}

async function copyFileVerified(
  sourcePath: string,
  destinationPath: string,
  relativePath: string,
  signal: AbortSignal,
): Promise<PackageFileRecord> {
  const source = await fsp.open(sourcePath, 'r');
  const destination = await fsp.open(destinationPath, 'wx');
  const hash = createHash('sha256');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  let bytes = 0;
  try {
    while (true) {
      throwIfAborted(signal);
      const { bytesRead } = await source.read(buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      hash.update(buffer.subarray(0, bytesRead));
      let offset = 0;
      while (offset < bytesRead) {
        const result = await destination.write(buffer, offset, bytesRead - offset);
        offset += result.bytesWritten;
      }
      bytes += bytesRead;
    }
    await destination.sync();
  } finally {
    await Promise.allSettled([source.close(), destination.close()]);
  }
  return { path: relativePath, sha256: hash.digest('hex'), bytes };
}

async function writeFileFsynced(
  directory: string,
  fileName: string,
  content: string,
): Promise<PackageFileRecord> {
  const buffer = Buffer.from(content, 'utf8');
  const handle = await fsp.open(path.join(directory, fileName), 'wx');
  try {
    await handle.writeFile(buffer);
    await handle.sync();
  } finally {
    await handle.close();
  }
  return { path: fileName, sha256: hashBuffer(buffer), bytes: buffer.length };
}

async function hashFile(filePath: string, relativePath: string): Promise<PackageFileRecord> {
  const handle = await fsp.open(filePath, 'r');
  const hash = createHash('sha256');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  let bytes = 0;
  try {
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      hash.update(buffer.subarray(0, bytesRead));
      bytes += bytesRead;
    }
  } finally {
    await handle.close();
  }
  return { path: relativePath, sha256: hash.digest('hex'), bytes };
}

async function hashExactTextFile(
  directory: string,
  fileName: string,
  expected: string,
): Promise<PackageFileRecord> {
  const actual = await fsp.readFile(path.join(directory, fileName));
  const expectedBuffer = Buffer.from(expected, 'utf8');
  if (!actual.equals(expectedBuffer)) throw new Error(`${fileName} is not the canonical manifest`);
  return { path: fileName, sha256: hashBuffer(actual), bytes: actual.length };
}

function buildManifestJson(
  attempt: Pick<DeliveryPackageTaskAttempt, 'manifestRevision' | 'manifestHash'>,
  manifest: DeliveryManifestContent,
): string {
  return canonicalJson({
    taskListId: manifest.taskListId,
    canvasId: manifest.canvasId,
    manifestRevision: attempt.manifestRevision,
    manifestHash: attempt.manifestHash,
    productionPlan: manifest.productionPlan,
    visualConstitution: manifest.visualConstitution,
    deliverySequence: manifest.deliverySequence,
    namingPolicy: manifest.namingPolicy,
    items: manifest.items.map((item, index) => ({ order: index + 1, ...item })),
  });
}

const CSV_COLUMNS = [
  'order',
  'packageFileName',
  'selectedVideoHash',
  'sourceFileName',
  'sourceFormat',
  'sourceBytes',
  'sourceDurationMs',
  'sourceWidth',
  'sourceHeight',
  'hasEmbeddedAudio',
  'trimInMs',
  'trimOutMs',
  'embeddedAudioEnabled',
  'assetCreatedAt',
  'nodeId',
  'taskId',
  'attemptId',
  'evaluationId',
  'promptAssemblyId',
  'providerId',
  'model',
] as const;

function buildManifestCsv(manifest: DeliveryManifestContent): string {
  const rows = manifest.items.map((item, index) => [
    index + 1,
    item.packageFileName,
    item.selectedVideoHash,
    item.sourceFileName,
    item.sourceFormat,
    item.sourceBytes,
    item.sourceDurationMs,
    item.sourceWidth ?? '',
    item.sourceHeight ?? '',
    item.hasEmbeddedAudio,
    item.trimInMs,
    item.trimOutMs,
    item.embeddedAudioEnabled,
    item.provenance.assetCreatedAt,
    item.provenance.nodeId ?? '',
    item.provenance.taskId ?? '',
    item.provenance.attemptId ?? '',
    item.provenance.evaluationId ?? '',
    item.provenance.promptAssemblyId ?? '',
    item.provenance.providerId ?? '',
    item.provenance.model ?? '',
  ]);
  return [CSV_COLUMNS, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

function csvCell(value: unknown): string {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function packageFacts(records: PackageFileRecord[]): PackageFacts {
  const stableRecords = [...records].sort((left, right) => left.path.localeCompare(right.path));
  return {
    packageHash: hashText(canonicalJson({ files: stableRecords })),
    packageBytes: stableRecords.reduce((total, record) => total + record.bytes, 0),
    fileCount: stableRecords.length,
  };
}

function canonicalJson(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(',')}}`;
}

function hashText(value: string): string {
  return hashBuffer(Buffer.from(value, 'utf8'));
}

async function fsyncDirectoryIfSupported(directory: string): Promise<void> {
  // Node cannot open directory handles for fsync on Windows. Every package file is
  // still fsynced there before the same-volume atomic rename; POSIX additionally
  // syncs directory metadata before and after publication.
  if (process.platform === 'win32') return;
  const handle = await fsp.open(directory, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function hashBuffer(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function sanitizeBaseName(value: string): string {
  return value
    .normalize('NFKC')
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[. -]+|[. -]+$/g, '')
    .slice(0, 80);
}

function normalizeIdentityPath(value: string): string {
  const normalized = path.normalize(path.resolve(value));
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function statusProgress(status: DeliveryPackageTaskAttempt['status']): number {
  switch (status) {
    case 'queued':
      return 0;
    case 'running':
      return 10;
    case 'ready_to_publish':
    case 'recovery_required':
      return 90;
    case 'completed':
      return 100;
    case 'failed':
    case 'cancelled':
      return 0;
  }
}

function isActive(status: DeliveryPackageTaskAttempt['status']): boolean {
  return status === 'queued' || status === 'running' || status === 'ready_to_publish';
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  const error = new Error('Delivery package cancelled');
  error.name = 'AbortError';
  throw error;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createDeliveryPackageService(
  options: DeliveryPackageServiceOptions,
): DeliveryPackageService {
  return new DeliveryPackageService(options);
}
