import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { CloudLipSyncAdapter } from './cloud-lipsync.js';
import { LocalLipSyncAdapter } from './local-lipsync.js';

export interface LipSyncOptions {
  faceDetection?: boolean;
  enhanceFace?: boolean;
}

export interface LipSyncAdapter {
  id: string;
  name: string;
  process(videoPath: string, audioPath: string, outputPath: string, options?: LipSyncOptions): Promise<void>;
}

export interface LipSyncSettings {
  backend: 'cloud' | 'local';
  cloudEndpoint?: string;
  localModelPath?: string;
  localProjectDir?: string;
  localPythonPath?: string;
}

export interface LipSyncAdapterConfig {
  pythonPath: string;
  projectDir: string;
  checkpointPath: string;
}

export function validateLipSyncConfig(config: LipSyncAdapterConfig): string[] {
  const errors: string[] = [];
  if (!config.projectDir || config.projectDir.trim().length === 0) {
    errors.push('Wav2Lip project directory is not configured.');
  } else {
    const inferenceScript = join(config.projectDir, 'inference.py');
    if (!existsSync(inferenceScript)) {
      errors.push(`inference.py not found in: ${config.projectDir}`);
    }
  }
  if (!config.checkpointPath || config.checkpointPath.trim().length === 0) {
    errors.push('Model checkpoint path is not configured.');
  } else if (!existsSync(config.checkpointPath)) {
    errors.push(`Model checkpoint not found: ${config.checkpointPath}`);
  }
  return errors;
}

export function getLipSyncAdapter(settings: LipSyncSettings): LipSyncAdapter {
  if (settings.backend === 'local') {
    const config: LipSyncAdapterConfig = {
      pythonPath: settings.localPythonPath ?? '',
      projectDir: settings.localProjectDir ?? '',
      checkpointPath: settings.localModelPath ?? '',
    };
    const errors = validateLipSyncConfig(config);
    if (errors.length > 0) {
      throw new Error(
        `Local lip-sync configuration invalid:\n${errors.join('\n')}\n\nConfigure these in Settings > Lip Sync.`,
      );
    }
    return new LocalLipSyncAdapter(config);
  }
  const endpoint = settings.cloudEndpoint ?? '';
  return new CloudLipSyncAdapter(endpoint);
}
