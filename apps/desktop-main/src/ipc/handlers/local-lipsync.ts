import { spawn } from 'node:child_process';
import type { LipSyncAdapter, LipSyncOptions } from './lipsync-registry.js';

export class LocalLipSyncAdapter implements LipSyncAdapter {
  id = 'local-lipsync';
  name = 'Local Wav2Lip';

  constructor(private modelPath: string) {}

  async process(
    videoPath: string,
    audioPath: string,
    outputPath: string,
    _options?: LipSyncOptions,
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const child = spawn('python', [
        'inference.py',
        '--video', videoPath,
        '--audio', audioPath,
        '--output', outputPath,
        '--checkpoint_path', this.modelPath,
      ]);

      const stderrChunks: Buffer[] = [];

      child.stderr.on('data', (chunk: Buffer) => {
        stderrChunks.push(chunk);
      });

      child.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          const stderr = Buffer.concat(stderrChunks).toString('utf-8').trim();
          reject(
            new Error(
              `Local lip-sync process exited with code ${String(code)}${stderr ? `: ${stderr}` : ''}`,
            ),
          );
        }
      });

      child.on('error', (err) => {
        reject(new Error(`Failed to start local lip-sync process: ${err.message}`));
      });
    });
  }
}
