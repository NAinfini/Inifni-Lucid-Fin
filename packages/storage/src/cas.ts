import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Worker } from 'node:worker_threads';
import type { AssetRef, AssetMeta, AssetType } from '@lucid-fin/contracts';
import { ensureExpectedMediaType, inspectBufferMedia, inspectFileMedia } from './media-inspector.js';
import { ensureDir, atomicWrite } from './utils.js';

const WORKER_THRESHOLD = 10 * 1024 * 1024; // 10MB

export class CAS {
  private projectAssetsRoot: string | null = null;

  constructor(
    private readonly globalAssetsRoot: string,
    private readonly workerPath?: string,
  ) {}

  /** Set per-project assets root (called on project:open/create) */
  setProjectRoot(projectPath: string): void {
    this.projectAssetsRoot = path.join(projectPath, 'assets');
  }

  private get assetsRoot(): string {
    return this.projectAssetsRoot ?? this.globalAssetsRoot;
  }

  getAssetsRoot(): string {
    return this.assetsRoot;
  }

  async importAsset(
    filePath: string,
    type: AssetType,
  ): Promise<{ ref: AssetRef; meta: AssetMeta }> {
    const stat = fs.statSync(filePath);
    const inspection = ensureExpectedMediaType(inspectFileMedia(filePath), type, filePath);
    const ext = inspection.format;
    const hash = await this.computeHash(filePath, stat.size);
    const prefix = hash.slice(0, 2);
    const destDir = path.join(this.assetsRoot, type, prefix);
    const destPath = path.join(destDir, `${hash}.${ext}`);
    const metaPath = path.join(destDir, `${hash}.meta.json`);

    const ref: AssetRef = { hash, type, format: ext, path: destPath };

    // Deduplication check
    if (fs.existsSync(destPath)) {
      const existingMeta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as AssetMeta;
      // Backfill fileSize for meta files written before size tracking was added
      if (!existingMeta.fileSize || existingMeta.fileSize <= 0) {
        existingMeta.fileSize = stat.size;
        atomicWrite(metaPath, existingMeta);
      }
      return { ref, meta: existingMeta };
    }

    ensureDir(destDir);
    fs.copyFileSync(filePath, destPath);

    const meta: AssetMeta = {
      hash,
      type,
      format: ext,
      originalName: path.basename(filePath),
      fileSize: stat.size,
      tags: [],
      createdAt: Date.now(),
    };
    atomicWrite(metaPath, meta);

    return { ref, meta };
  }

  /** Import from an in-memory buffer (for sandboxed renderers where File.path is unavailable). */
  async importBuffer(
    buffer: Buffer,
    fileName: string,
    type: AssetType,
  ): Promise<{ ref: AssetRef; meta: AssetMeta }> {
    const inspection = ensureExpectedMediaType(inspectBufferMedia(buffer), type, fileName);
    const ext = inspection.format;
    const hash = crypto.createHash('sha256').update(buffer).digest('hex');
    const prefix = hash.slice(0, 2);
    const destDir = path.join(this.assetsRoot, type, prefix);
    const destPath = path.join(destDir, `${hash}.${ext}`);
    const metaPath = path.join(destDir, `${hash}.meta.json`);

    const ref: AssetRef = { hash, type, format: ext, path: destPath };

    if (fs.existsSync(destPath)) {
      const existingMeta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as AssetMeta;
      if (!existingMeta.fileSize || existingMeta.fileSize <= 0) {
        existingMeta.fileSize = buffer.length;
        atomicWrite(metaPath, existingMeta);
      }
      return { ref, meta: existingMeta };
    }

    ensureDir(destDir);
    fs.writeFileSync(destPath, buffer);

    const meta: AssetMeta = {
      hash,
      type,
      format: ext,
      originalName: fileName,
      fileSize: buffer.length,
      tags: [],
      createdAt: Date.now(),
    };
    atomicWrite(metaPath, meta);

    return { ref, meta };
  }

  getAssetPath(hash: string, type: AssetType, ext: string): string {
    if (!/^[a-f0-9]+$/i.test(hash)) throw new Error(`Invalid asset hash: ${hash}`);
    if (!/^[a-zA-Z0-9]+$/.test(ext)) throw new Error(`Invalid file extension: ${ext}`);
    const prefix = hash.slice(0, 2);
    return path.join(this.assetsRoot, type, prefix, `${hash}.${ext}`);
  }

  deleteAsset(hash: string): void {
    const prefix = hash.slice(0, 2);

    for (const type of ['image', 'video', 'audio'] as const) {
      const dir = path.join(this.assetsRoot, type, prefix);
      if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
        continue;
      }

      for (const entry of fs.readdirSync(dir)) {
        if (entry === `${hash}.meta.json` || entry.startsWith(`${hash}.`)) {
          fs.rmSync(path.join(dir, entry), { force: true });
        }
      }
    }
  }

  assetExists(hash: string, type: AssetType, ext: string): boolean {
    return fs.existsSync(this.getAssetPath(hash, type, ext));
  }

  private computeHash(filePath: string, fileSize: number): Promise<string> {
    // Use Worker Thread for large files (>10MB) to avoid blocking Main Process
    if (fileSize > WORKER_THRESHOLD) {
      return this.computeHashWorker(filePath);
    }
    return this.computeHashInline(filePath);
  }

  private computeHashInline(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hasher = crypto.createHash('sha256');
      const stream = fs.createReadStream(filePath);
      stream.on('data', (chunk) => hasher.update(chunk));
      stream.on('end', () => resolve(hasher.digest('hex')));
      stream.on('error', reject);
    });
  }

  private computeHashWorker(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!this.workerPath) {
        // Fall back to inline hashing if no worker path configured
        this.computeHashInline(filePath).then(resolve, reject);
        return;
      }
      const worker = new Worker(this.workerPath);
      worker.postMessage(filePath);
      worker.on('message', (result: string | { error: string }) => {
        worker.terminate();
        if (typeof result === 'string') {
          resolve(result);
        } else {
          reject(new Error(result.error));
        }
      });
      worker.on('error', (err) => {
        worker.terminate();
        reject(err);
      });
    });
  }
}
