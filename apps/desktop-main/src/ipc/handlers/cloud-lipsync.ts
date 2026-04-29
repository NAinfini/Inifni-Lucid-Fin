import fsp from 'node:fs/promises';
import type { LipSyncAdapter, LipSyncOptions } from './lipsync-registry.js';

export class CloudLipSyncAdapter implements LipSyncAdapter {
  id = 'cloud-lipsync';
  name = 'Cloud Lip Sync';

  constructor(private endpoint: string) {}

  async process(
    videoPath: string,
    audioPath: string,
    outputPath: string,
    _options?: LipSyncOptions,
  ): Promise<void> {
    const videoBuffer = await fsp.readFile(videoPath);
    const audioBuffer = await fsp.readFile(audioPath);

    const url = new URL(this.endpoint);
    if (url.protocol !== 'https:') throw new Error('Cloud lipsync endpoint must use HTTPS');
    if (
      ['localhost', '127.0.0.1', '0.0.0.0', '::1'].includes(url.hostname) ||
      /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(url.hostname)
    ) {
      throw new Error('Cloud lipsync endpoint must not be a private/local address');
    }

    const formData = new FormData();
    formData.append('video', new Blob([videoBuffer]), 'video.mp4');
    formData.append('audio', new Blob([audioBuffer]), 'audio.wav');

    const response = await fetch(this.endpoint, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`Cloud lip-sync request failed: ${response.status} ${response.statusText}`);
    }

    const resultBuffer = await response.arrayBuffer();
    await fsp.writeFile(outputPath, Buffer.from(resultBuffer));
  }
}
