import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Worker } from 'node:worker_threads';
import type { AssetRef, AssetMeta, AssetType } from '@lucid-fin/contracts';
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

  async importAsset(
    filePath: string,
    type: AssetType,
  ): Promise<{ ref: AssetRef; meta: AssetMeta }> {
    const ext = path.extname(filePath).slice(1).toLowerCase();
    const stat = fs.statSync(filePath);
    const hash = await this.computeHash(filePath, stat.size);
    const prefix = hash.slice(0, 2);
    const destDir = path.join(this.assetsRoot, type, prefix);
    const destPath = path.join(destDir, `${hash}.${ext}`);
    const metaPath = path.join(destDir, `${hash}.meta.json`);

    const ref: AssetRef = { hash, type, format: ext, path: destPath };

    // Deduplication check
    if (fs.existsSync(destPath)) {
      const existingMeta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as AssetMeta;
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

  getAssetPath(hash: string, type: AssetType, ext: string): string {
    const prefix = hash.slice(0, 2);
    return path.join(this.assetsRoot, type, prefix, `${hash}.${ext}`);
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
