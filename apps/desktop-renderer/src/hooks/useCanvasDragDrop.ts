/**
 * Hook encapsulating canvas drag-drop handling.
 *
 * Handles drops from:
 * - Asset store (application/x-lucid-asset, application/x-lucid-node-asset)
 * - Entity reference images (application/x-lucid-ref-image)
 * - OS file explorer (Files)
 */
import { useCallback, type RefObject } from 'react';
import { useDispatch } from 'react-redux';
import type { ReactFlowInstance } from '@xyflow/react';
import {
  createEmptyPresetTrackSet,
  type AudioNodeData,
  type CanvasNodeType,
  type ImageNodeData,
  type VideoNodeData,
} from '@lucid-fin/contracts';
import { addNode } from '../store/slices/canvas.js';
import { getAPI } from '../utils/api.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DragAssetPayload {
  hash: string;
  name: string;
  type: 'image' | 'video' | 'audio';
}

// ---------------------------------------------------------------------------
// Node factory from asset
// ---------------------------------------------------------------------------

export function createNodePayloadFromAsset(asset: DragAssetPayload): {
  type: CanvasNodeType;
  title: string;
  data: ImageNodeData | VideoNodeData | AudioNodeData;
} {
  switch (asset.type) {
    case 'image':
      return {
        type: 'image',
        title: asset.name,
        data: {
          assetHash: asset.hash,
          status: 'done',
          variants: [asset.hash],
          selectedVariantIndex: 0,
          variantCount: 1,
          seedLocked: false,
          presetTracks: createEmptyPresetTrackSet(),
        },
      };
    case 'video':
      return {
        type: 'video',
        title: asset.name,
        data: {
          assetHash: asset.hash,
          status: 'done',
          variants: [asset.hash],
          selectedVariantIndex: 0,
          variantCount: 1,
          seedLocked: false,
          presetTracks: createEmptyPresetTrackSet(),
        },
      };
    case 'audio':
      return {
        type: 'audio',
        title: asset.name,
        data: {
          assetHash: asset.hash,
          audioType: 'voice',
          status: 'done',
          variants: [asset.hash],
          selectedVariantIndex: 0,
          variantCount: 1,
          seedLocked: false,
        },
      };
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useCanvasDragDrop(
  rfInstanceRef: RefObject<ReactFlowInstance | null>,
) {
  const dispatch = useDispatch();

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();

      const rfInstance = rfInstanceRef.current;
      if (!rfInstance) return;

      // Handle ref-image drops from entity panels
      const refImageRaw = event.dataTransfer.getData('application/x-lucid-ref-image');
      if (refImageRaw) {
        try {
          const payload = JSON.parse(refImageRaw) as { assetHash: string; entityType: string; entityId: string; slot: string };
          if (payload.assetHash) {
            const nodePayload = createNodePayloadFromAsset({ hash: payload.assetHash, name: `${payload.entityType} ref`, type: 'image' });
            dispatch(
              addNode({
                id: crypto.randomUUID(),
                type: nodePayload.type,
                title: nodePayload.title,
                data: nodePayload.data,
                position: rfInstance.screenToFlowPosition({ x: event.clientX, y: event.clientY }),
              }),
            );
          }
        } catch { /* malformed payload */ }
        return;
      }

      // Handle asset drops from Asset Store or Canvas nodes (BEFORE OS files,
      // because dragging an image card also produces a native File entry)
      const raw = event.dataTransfer.getData('application/x-lucid-asset') || event.dataTransfer.getData('application/x-lucid-node-asset');
      if (raw) {
        try {
          const asset = JSON.parse(raw) as DragAssetPayload;
          const payload = createNodePayloadFromAsset(asset);
          dispatch(
            addNode({
              id: crypto.randomUUID(),
              type: payload.type,
              title: payload.title,
              data: payload.data,
              position: rfInstance.screenToFlowPosition({ x: event.clientX, y: event.clientY }),
            }),
          );
        } catch { /* malformed payload */ }
        return;
      }

      // Handle file drops from OS
      const files = event.dataTransfer.files;
      if (files.length > 0) {
        const basePos = rfInstance.screenToFlowPosition({ x: event.clientX, y: event.clientY });
        let offsetY = 0;
        let handledAny = false;
        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          if (!file) continue;
          const ext = file.name.split('.').pop()?.toLowerCase();
          // Text files → Text Node
          if (ext === 'txt' || ext === 'md') {
            const title = file.name.replace(/\.[^.]+$/, '');
            const pos = { x: basePos.x, y: basePos.y + offsetY };
            void file.text().then((content) => {
              dispatch(
                addNode({
                  id: crypto.randomUUID(),
                  type: 'text' as CanvasNodeType,
                  title,
                  data: { content },
                  position: pos,
                }),
              );
            }).catch(() => { /* text read failure is non-critical */ });
            offsetY += 180;
            handledAny = true;
          } else if (file.type.startsWith('image/')) {
            const title = file.name.replace(/\.[^.]+$/, '');
            const pos = { x: basePos.x, y: basePos.y + offsetY };
            const api = getAPI();
            if (api) {
              const filePath = (file as { path?: string }).path ?? '';
              const importPromise = filePath
                ? api.asset.import(filePath, 'image')
                : api.asset.importBuffer
                  ? file.arrayBuffer().then((buf) => api.asset.importBuffer!(buf, file.name, 'image'))
                  : Promise.resolve(null);
              void importPromise.then((ref: unknown) => {
                const r = ref as { hash: string } | null;
                if (!r?.hash) return;
                const payload = createNodePayloadFromAsset({ hash: r.hash, name: title, type: 'image' });
                dispatch(
                  addNode({
                    id: crypto.randomUUID(),
                    type: payload.type,
                    title: payload.title,
                    data: payload.data,
                    position: pos,
                  }),
                );
              }).catch(() => { /* image import failure is non-critical */ });
            }
            offsetY += 220;
            handledAny = true;
          } else if (file.type.startsWith('video/')) {
            const title = file.name.replace(/\.[^.]+$/, '');
            const pos = { x: basePos.x, y: basePos.y + offsetY };
            const api = getAPI();
            if (api) {
              const filePath = (file as { path?: string }).path ?? '';
              const importPromise = filePath
                ? api.asset.import(filePath, 'video')
                : api.asset.importBuffer
                  ? file.arrayBuffer().then((buf) => api.asset.importBuffer!(buf, file.name, 'video'))
                  : Promise.resolve(null);
              void importPromise.then((ref: unknown) => {
                const r = ref as { hash: string } | null;
                if (!r?.hash) return;
                const payload = createNodePayloadFromAsset({ hash: r.hash, name: title, type: 'video' });
                dispatch(
                  addNode({
                    id: crypto.randomUUID(),
                    type: payload.type,
                    title: payload.title,
                    data: payload.data,
                    position: pos,
                  }),
                );
              }).catch(() => { /* video import failure is non-critical */ });
            }
            offsetY += 220;
            handledAny = true;
          }
        }
        if (handledAny) return;
      }
    },
    [dispatch, rfInstanceRef],
  );

  const handleDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    const types = event.dataTransfer.types;
    if (
      types.includes('application/x-lucid-asset') ||
      types.includes('application/x-lucid-node-asset') ||
      types.includes('application/x-lucid-ref-image') ||
      types.includes('Files')
    ) {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    }
  }, []);

  return { handleDrop, handleDragOver };
}
