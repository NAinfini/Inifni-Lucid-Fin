import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { IpcMain, WebContents } from 'electron';
import { dialog } from 'electron';
import type { Canvas, CanvasNode, CanvasEdge } from '@lucid-fin/contracts';
import type { CAS } from '@lucid-fin/storage';
import { detectScenes, extractFrameAtTime } from '@lucid-fin/media-engine';
import type { CanvasStore } from './canvas.handlers.js';
import log from '../../logger.js';

interface VideoCloneProgress {
  step: 'detect' | 'extract' | 'describe' | 'build';
  current: number;
  total: number;
  message: string;
}

function sendProgress(sender: WebContents, progress: VideoCloneProgress): void {
  sender.send('video:clone:progress', progress);
}

export function registerVideoCloneHandlers(
  ipcMain: IpcMain,
  deps: {
    cas: CAS;
    canvasStore: CanvasStore;
    describeImageAsset?: (assetHash: string, style?: string) => Promise<{ prompt: string }>;
  },
): void {
  ipcMain.handle(
    'video:clone',
    async (
      event,
      args: { filePath: string; projectId: string; threshold?: number },
    ) => {
      if (!args?.filePath || typeof args.filePath !== 'string') {
        throw new Error('filePath is required');
      }
      if (!args?.projectId || typeof args.projectId !== 'string') {
        throw new Error('projectId is required');
      }

      const { filePath, projectId, threshold } = args;
      const sender = event.sender;
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lucid-video-clone-'));

      try {
        // Step 1: Detect scenes
        sendProgress(sender, {
          step: 'detect',
          current: 0,
          total: 1,
          message: 'Detecting scenes...',
        });

        log.info('Video clone: detecting scenes', { category: 'video-clone', filePath, threshold });
        const scenes = await detectScenes(filePath, threshold ?? 0.4);
        log.info('Video clone: scenes detected', { category: 'video-clone', count: scenes.length });

        if (scenes.length === 0) {
          return { canvasId: '', nodeCount: 0 };
        }

        // Step 2: Extract keyframes
        const keyframeHashes: string[] = [];
        for (let i = 0; i < scenes.length; i++) {
          const scene = scenes[i];
          sendProgress(sender, {
            step: 'extract',
            current: i,
            total: scenes.length,
            message: `Extracting keyframes (${i + 1}/${scenes.length})...`,
          });

          const framePath = path.join(tmpDir, `frame-${i}.png`);
          try {
            await extractFrameAtTime(filePath, scene.time, framePath);
            const { ref } = await deps.cas.importAsset(framePath, 'image');
            keyframeHashes.push(ref.hash);
          } catch (err) {
            log.warn('Video clone: failed to extract frame', {
              category: 'video-clone',
              index: i,
              time: scene.time,
              error: String(err),
            });
            keyframeHashes.push('');
          }
        }

        // Step 3: Describe keyframes (optional)
        const descriptions: string[] = new Array(scenes.length).fill('');
        if (deps.describeImageAsset) {
          for (let i = 0; i < keyframeHashes.length; i++) {
            const hash = keyframeHashes[i];
            if (!hash) continue;
            sendProgress(sender, {
              step: 'describe',
              current: i,
              total: scenes.length,
              message: `Describing keyframes (${i + 1}/${scenes.length})...`,
            });
            try {
              const result = await deps.describeImageAsset(hash, 'prompt');
              descriptions[i] = result.prompt;
            } catch (err) {
              log.warn('Video clone: failed to describe frame', {
                category: 'video-clone',
                index: i,
                error: String(err),
              });
            }
          }
        }

        // Step 4: Build canvas
        sendProgress(sender, {
          step: 'build',
          current: 0,
          total: 1,
          message: 'Building canvas...',
        });

        const now = Date.now();
        const canvasId = randomUUID();
        const nodes: CanvasNode[] = [];
        const edges: CanvasEdge[] = [];

        for (let i = 0; i < scenes.length; i++) {
          const nodeId = randomUUID();
          const hash = keyframeHashes[i];
          const prevHash = i > 0 ? keyframeHashes[i - 1] : undefined;

          nodes.push({
            id: nodeId,
            type: 'video',
            position: { x: i * 300, y: 0 },
            title: `Scene ${i + 1}`,
            status: 'idle',
            bypassed: false,
            locked: false,
            data: {
              status: 'empty',
              prompt: descriptions[i],
              sourceImageHash: hash || undefined,
              firstFrameAssetHash: prevHash || undefined,
              variants: [],
              selectedVariantIndex: 0,
            },
            createdAt: now,
            updatedAt: now,
          } as CanvasNode);

          if (i > 0) {
            const prevNodeId = nodes[i - 1].id;
            edges.push({
              id: randomUUID(),
              source: prevNodeId,
              target: nodeId,
              data: { status: 'idle' },
            } as CanvasEdge);
          }
        }

        const canvas: Canvas = {
          id: canvasId,
          projectId,
          name: `Video Clone ${new Date().toLocaleDateString()}`,
          nodes,
          edges,
          viewport: { x: 0, y: 0, zoom: 1 },
          notes: [],
          createdAt: now,
          updatedAt: now,
        };

        deps.canvasStore.save(canvas);
        log.info('Video clone: canvas created', { category: 'video-clone', canvasId, nodeCount: nodes.length });

        return { canvasId, nodeCount: nodes.length };
      } finally {
        // Clean up temp directory
        try {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        } catch (err) {
          log.warn('Video clone: failed to clean up temp dir', {
            category: 'video-clone',
            tmpDir,
            error: String(err),
          });
        }
      }
    },
  );

  ipcMain.handle('video:pickFile', async () => {
    const result = await dialog.showOpenDialog({
      filters: [{ name: 'Video', extensions: ['mp4', 'webm', 'mov', 'avi', 'mkv'] }],
      properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });
}
