import { parentPort } from 'node:worker_threads';
import fs from 'node:fs';
import crypto from 'node:crypto';

parentPort?.on('message', (filePath: string) => {
  const hasher = crypto.createHash('sha256');
  const stream = fs.createReadStream(filePath);
  stream.on('data', (chunk) => hasher.update(chunk));
  stream.on('end', () => parentPort?.postMessage(hasher.digest('hex')));
  stream.on('error', (err) => parentPort?.postMessage({ error: err.message }));
});
