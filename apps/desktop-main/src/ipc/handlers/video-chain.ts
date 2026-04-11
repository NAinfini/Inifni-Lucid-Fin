import type { Canvas, CanvasNode, VideoNodeData } from '@lucid-fin/contracts';
import type { CAS } from '@lucid-fin/storage';
import { extractLastFrame } from '@lucid-fin/media-engine';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { IpcMain } from 'electron';
import log from '../../logger.js';
import type { CanvasStore } from './canvas.handlers.js';

export async function autoChainVideoFrame(
  canvas: Canvas,
  completedNode: CanvasNode,
  cas: CAS,
): Promise<void> {
  try {
    // 1. Get assetHash from completed video node
    const data = completedNode.data as VideoNodeData;
    const assetHash = data.assetHash;
    if (!assetHash) {
      log.warn('[video-chain] completed video node has no assetHash', {
        nodeId: completedNode.id,
      });
      return;
    }

    // 2. Resolve video file path from CAS (try mp4, webm, mov)
    let videoPath: string | undefined;
    for (const ext of ['mp4', 'webm', 'mov']) {
      const candidate = cas.getAssetPath(assetHash, 'video', ext);
      if (fs.existsSync(candidate)) {
        videoPath = candidate;
        break;
      }
    }
    if (!videoPath) {
      log.warn('[video-chain] could not resolve video file for auto-chain', {
        nodeId: completedNode.id,
        assetHash,
      });
      return;
    }

    // 3. Create temp output path for the last frame
    const tmpOutput = path.join(os.tmpdir(), `lucid-last-frame-${Date.now()}.png`);

    // 4. Call extractLastFrame
    await extractLastFrame(videoPath, tmpOutput);

    if (!fs.existsSync(tmpOutput)) {
      log.warn('[video-chain] extractLastFrame produced no output file', {
        nodeId: completedNode.id,
        tmpOutput,
      });
      return;
    }

    // 5. Import the frame image into CAS
    const { ref } = await cas.importAsset(tmpOutput, 'image');
    const frameHash = ref.hash;

    // 6. Find the next video node
    let nextNode: CanvasNode | undefined;

    // First: check outgoing edges from completedNode
    const outgoingEdge = canvas.edges.find((e) => e.source === completedNode.id);
    if (outgoingEdge) {
      const targetNode = canvas.nodes.find(
        (n) => n.id === outgoingEdge.target && n.type === 'video',
      );
      if (targetNode) {
        nextNode = targetNode;
      }
    }

    // Fallback: sort all video nodes by position.x, find the one immediately after completedNode
    if (!nextNode) {
      const videoNodes = canvas.nodes
        .filter((n) => n.type === 'video')
        .sort((a, b) => a.position.x - b.position.x);
      const currentIndex = videoNodes.findIndex((n) => n.id === completedNode.id);
      if (currentIndex !== -1 && currentIndex < videoNodes.length - 1) {
        nextNode = videoNodes[currentIndex + 1];
      }
    }

    // 7. If next video node exists AND it doesn't already have firstFrameAssetHash set
    if (nextNode) {
      const nextData = nextNode.data as VideoNodeData;
      if (!nextData.firstFrameAssetHash) {
        nextData.firstFrameAssetHash = frameHash;
        log.info('[video-chain] auto-chained last frame to next video node', {
          completedNodeId: completedNode.id,
          nextNodeId: nextNode.id,
          frameHash,
        });
      } else {
        log.info('[video-chain] next video node already has firstFrameAssetHash, skipping', {
          nextNodeId: nextNode.id,
        });
      }
    } else {
      log.info('[video-chain] no next video node found for auto-chain', {
        completedNodeId: completedNode.id,
      });
    }

    // 8. Clean up temp file
    fs.rmSync(tmpOutput, { force: true });
  } catch (err) {
    log.warn('[video-chain] autoChainVideoFrame failed (non-fatal)', {
      nodeId: completedNode.id,
      error: String(err),
    });
  }
}

export function registerVideoChainHandlers(
  ipcMain: IpcMain,
  canvasStore: CanvasStore,
  cas: CAS,
): void {
  ipcMain.handle('video:extractLastFrame', async (_event, args: { canvasId: string; nodeId: string }) => {
    const { canvasId, nodeId } = args;
    const canvas = canvasStore.get(canvasId);
    if (!canvas) {
      log.warn('[video-chain] video:extractLastFrame: canvas not found', { canvasId });
      return;
    }
    const node = canvas.nodes.find((n) => n.id === nodeId);
    if (!node) {
      log.warn('[video-chain] video:extractLastFrame: node not found', { canvasId, nodeId });
      return;
    }
    await autoChainVideoFrame(canvas, node, cas);
    canvasStore.save(canvas);
  });
}
