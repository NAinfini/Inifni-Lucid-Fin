import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { LipSyncAdapter, LipSyncAdapterConfig, LipSyncOptions } from './lipsync-registry.js';

function resolvePython(configured?: string): string {
  if (configured && configured.length > 0) return configured;
  if (process.env.PYTHON_PATH) return process.env.PYTHON_PATH;
  return process.platform === 'win32' ? 'python' : 'python3';
}

export class LocalLipSyncAdapter implements LipSyncAdapter {
  id = 'local-lipsync';
  name = 'Local Wav2Lip';

  private readonly pythonPath: string;
  private readonly inferenceScript: string;
  private readonly checkpointPath: string;
  private readonly projectDir: string;

  constructor(config: LipSyncAdapterConfig) {
    this.pythonPath = resolvePython(config.pythonPath);
    this.projectDir = resolve(config.projectDir);
    this.inferenceScript = join(this.projectDir, 'inference.py');
    this.checkpointPath = resolve(config.checkpointPath);
  }

  async process(
    videoPath: string,
    audioPath: string,
    outputPath: string,
    _options?: LipSyncOptions,
  ): Promise<void> {
    if (!existsSync(this.inferenceScript)) {
      throw new Error(
        `inference.py not found at: ${this.inferenceScript}. ` +
        `Ensure the Wav2Lip project directory is correctly configured.`,
      );
    }
    if (!existsSync(this.checkpointPath)) {
      throw new Error(
        `Model checkpoint not found at: ${this.checkpointPath}. ` +
        `Download the Wav2Lip checkpoint and configure the path in Settings.`,
      );
    }
    if (!existsSync(videoPath)) {
      throw new Error(`Video file not found: ${videoPath}`);
    }
    if (!existsSync(audioPath)) {
      throw new Error(`Audio file not found: ${audioPath}`);
    }

    return new Promise<void>((resolvePromise, reject) => {
      const child = spawn(this.pythonPath, [
        this.inferenceScript,
        '--video', resolve(videoPath),
        '--audio', resolve(audioPath),
        '--output', resolve(outputPath),
        '--checkpoint_path', this.checkpointPath,
      ], {
        cwd: this.projectDir,
        env: { ...process.env },
      });

      const stderrChunks: Buffer[] = [];

      child.stderr.on('data', (chunk: Buffer) => {
        stderrChunks.push(chunk);
      });

      child.on('close', (code) => {
        if (code === 0) {
          resolvePromise();
        } else {
          const stderr = Buffer.concat(stderrChunks).toString('utf-8').trim();
          reject(
            new Error(
              `Local lip-sync process exited with code ${String(code)}` +
              `${stderr ? `:\n${stderr}` : ''}` +
              `\n\nPython: ${this.pythonPath}\nScript: ${this.inferenceScript}` +
              `\nCheckpoint: ${this.checkpointPath}`,
            ),
          );
        }
      });

      child.on('error', (err) => {
        reject(new Error(
          `Failed to start local lip-sync process: ${err.message}\n` +
          `Python path: ${this.pythonPath}\n` +
          `Ensure Python is installed and accessible.`,
        ));
      });
    });
  }
}
