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
}

export function getLipSyncAdapter(settings: LipSyncSettings): LipSyncAdapter {
  if (settings.backend === 'local') {
    const modelPath = settings.localModelPath ?? '';
    return new LocalLipSyncAdapter(modelPath);
  }
  const endpoint = settings.cloudEndpoint ?? '';
  return new CloudLipSyncAdapter(endpoint);
}
