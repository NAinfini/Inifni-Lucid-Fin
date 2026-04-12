import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app } from 'electron';
import type { IpcMain } from 'electron';
import type { Canvas, CanvasNode, VideoNodeData, AudioNodeData } from '@lucid-fin/contracts';
import type { CAS, SqliteIndex } from '@lucid-fin/storage';
import log from '../../logger.js';
import { getLipSyncAdapter, type LipSyncSettings } from './lipsync-registry.js';
import { getCurrentProjectId } from '../project-context.js';
import type { CanvasStore } from './canvas.handlers.js';

export interface LipSyncHandlerDeps {
  cas: CAS;
  canvasStore: CanvasStore;
  db: SqliteIndex;
}

function getLipSyncSettings(): LipSyncSettings | null {
  try {
    const settingsPath = path.join(app.getPath('userData'), 'settings.json');
    if (!fs.existsSync(settingsPath)) return null;
    const raw = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as Record<string, unknown>;
    const s = raw['lipsync'];
    if (!s || typeof s !== 'object') return null;
    const obj = s as Record<string, unknown>;
    const backend = obj['backend'];
    if (backend !== 'cloud' && backend !== 'local') return null;
    return {
      backend,
      cloudEndpoint: typeof obj['cloudEndpoint'] === 'string' ? obj['cloudEndpoint'] : undefined,
      localModelPath: typeof obj['localModelPath'] === 'string' ? obj['localModelPath'] : undefined,
    };
  } catch { /* malformed lipsync config JSON — return null to use defaults */
    return null;
  }
}

function findAudioAssetForVideoNode(canvas: Canvas, videoNode: CanvasNode): string | undefined {
  // Look for an audio node connected by an edge targeting the video node
  const incomingEdge = canvas.edges.find((e) => e.target === videoNode.id);
  if (!incomingEdge) return undefined;
  const sourceNode = canvas.nodes.find(
    (n) => n.id === incomingEdge.source && n.type === 'audio',
  );
  if (!sourceNode) return undefined;
  const audioData = sourceNode.data as AudioNodeData;
  return audioData.assetHash;
}

function resolveVideoPath(cas: CAS, assetHash: string): string | undefined {
  for (const ext of ['mp4', 'webm', 'mov']) {
    const candidate = cas.getAssetPath(assetHash, 'video', ext);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

function resolveAudioPath(cas: CAS, assetHash: string): string | undefined {
  for (const ext of ['wav', 'mp3', 'aac', 'm4a']) {
    const candidate = cas.getAssetPath(assetHash, 'audio', ext);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

/**
 * Run lip-sync post-processing for a completed video node.
 * Exported for use as a post-generation hook in canvas-generation.handlers.ts.
 */
export async function runLipSyncPostProcess(
  canvas: Canvas,
  node: CanvasNode,
  deps: LipSyncHandlerDeps,
): Promise<void> {
  const { cas, canvasStore, db } = deps;
  const videoData = node.data as VideoNodeData;

  const videoHash = videoData.assetHash;
  if (!videoHash) {
    log.warn('[lipsync] video node has no assetHash', { nodeId: node.id });
    return;
  }

  const audioHash = findAudioAssetForVideoNode(canvas, node);
  if (!audioHash) {
    log.warn('[lipsync] no audio asset found for video node', { nodeId: node.id });
    return;
  }

  const settings = getLipSyncSettings();
  if (!settings) {
    log.warn('[lipsync] lip-sync settings not configured', { nodeId: node.id });
    return;
  }

  const videoPath = resolveVideoPath(cas, videoHash);
  if (!videoPath) {
    log.warn('[lipsync] could not resolve video file', { nodeId: node.id, videoHash });
    return;
  }

  const audioPath = resolveAudioPath(cas, audioHash);
  if (!audioPath) {
    log.warn('[lipsync] could not resolve audio file', { nodeId: node.id, audioHash });
    return;
  }

  const tmpOutput = path.join(os.tmpdir(), `lucid-lipsync-${Date.now()}.mp4`);

  try {
    const adapter = getLipSyncAdapter(settings);
    log.info('[lipsync] starting lip-sync post-process', {
      nodeId: node.id,
      adapterId: adapter.id,
      videoHash,
      audioHash,
    });

    await adapter.process(videoPath, audioPath, tmpOutput);

    if (!fs.existsSync(tmpOutput)) {
      throw new Error('Lip-sync adapter produced no output file');
    }

    const { ref, meta } = await cas.importAsset(tmpOutput, 'video');
    const lipSyncHash = ref.hash;

    const projectId = getCurrentProjectId();
    db.insertAsset({
      ...meta,
      projectId: projectId ?? undefined,
      tags: [
        'canvas',
        `canvas:${canvas.id}`,
        `node:${node.id}`,
        'lipsync',
      ],
    });

    // Move current assetHash to variants, set lip-sync result as primary
    const oldHash = videoData.assetHash;
    if (oldHash && !videoData.variants.includes(oldHash)) {
      videoData.variants.push(oldHash);
    }
    videoData.assetHash = lipSyncHash;
    if (!videoData.variants.includes(lipSyncHash)) {
      videoData.variants.unshift(lipSyncHash);
    }
    videoData.selectedVariantIndex = 0;
    canvas.updatedAt = Date.now();
    canvasStore.save(canvas);

    log.info('[lipsync] lip-sync post-process complete', {
      nodeId: node.id,
      lipSyncHash,
    });
  } finally {
    if (fs.existsSync(tmpOutput)) {
      fs.rmSync(tmpOutput, { force: true });
    }
  }
}

export function registerLipSyncHandlers(
  ipcMain: IpcMain,
  deps: LipSyncHandlerDeps,
): void {
  ipcMain.handle(
    'lipsync:process',
    async (
      _event,
      args: { canvasId: string; nodeId: string },
    ) => {
      const { canvasId, nodeId } = args;
      const canvas = deps.canvasStore.get(canvasId);
      if (!canvas) {
        throw new Error(`Canvas not found: ${canvasId}`);
      }
      const node = canvas.nodes.find((n) => n.id === nodeId);
      if (!node || node.type !== 'video') {
        throw new Error(`Video node not found: ${nodeId}`);
      }
      await runLipSyncPostProcess(canvas, node, deps);
    },
  );

  ipcMain.handle('lipsync:checkAvailability', async () => {
    const settings = getLipSyncSettings();
    if (!settings) {
      return { available: false, backend: '' };
    }
    return { available: true, backend: settings.backend };
  });
}
