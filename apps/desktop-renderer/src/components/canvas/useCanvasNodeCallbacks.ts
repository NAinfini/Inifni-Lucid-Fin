/**
 * useCanvasNodeCallbacks — all node-level action callbacks.
 *
 * Extracted from CanvasWorkspace to keep the god-component slim.
 * Returns the `NodeCallbacks` object consumed by `NodeCallbacksContext`.
 */

import { useCallback, useMemo, useRef } from 'react';
import { useSelector, useDispatch, shallowEqual } from 'react-redux';

import type { AppDispatch, RootState } from '../../store/index.js';
import { selectActiveCanvas } from '../../store/slices/canvas-selectors.js';
import {
  removeNodes,
  renameNode,
  copyNodes as copyNodesAction,
  setClipboard,
  selectVariant,
  toggleSeedLock,
  setNodeColorTag,
  setNodeUploadedAsset,
  toggleLock,
  toggleBackdropCollapse,
  setBackdropOpacity,
  pasteNodes as pasteNodesAction,
} from '../../store/slices/canvas.js';
import {
  duplicateNode,
  disconnectNode,
} from '../../store/slices/canvas.js';
import type { NodeCallbacks } from './node-callbacks-context.js';
import { buildClipboardPayload, parseClipboardPayload, localizePresetName } from './canvas-utils.js';
import { buildExternalAIPrompt } from '../../utils/prompt-export.js';
import { getAPI } from '../../utils/api.js';

export interface UseCanvasNodeCallbacksParams {
  /** Called when the user triggers generation on a node. */
  generate: (id: string) => Promise<void>;
  /** Setter for the "connecting from" mode (connect-to action). */
  setConnectingFromNodeId: (id: string | null) => void;
}

export function useCanvasNodeCallbacks(
  params: UseCanvasNodeCallbacksParams,
): NodeCallbacks {
  const { generate, setConnectingFromNodeId } = params;
  const dispatch = useDispatch<AppDispatch>();
  const canvas = useSelector(selectActiveCanvas);
  const clipboard = useSelector(
    (s: RootState) => s.canvas.clipboard,
    shallowEqual,
  );
  const presetById = useSelector((s: RootState) => s.presets.byId);

  // Refs so callbacks don't re-create when canvas/presets change
  const canvasRef = useRef(canvas);
  canvasRef.current = canvas;
  const presetByIdRef = useRef(presetById);
  presetByIdRef.current = presetById;

  const handleTitleChange = useCallback(
    (id: string, title: string) => {
      dispatch(renameNode({ id, title }));
    },
    [dispatch],
  );

  const handleNodeDelete = useCallback(
    (id: string) => {
      dispatch(removeNodes([id]));
    },
    [dispatch],
  );

  const handleNodeDuplicate = useCallback(
    (id: string) => {
      const newId = `node-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      dispatch(duplicateNode({ sourceId: id, newId }));
    },
    [dispatch],
  );

  const handleNodeDisconnect = useCallback(
    (id: string) => {
      dispatch(disconnectNode(id));
    },
    [dispatch],
  );

  const handleNodeRename = useCallback((_id: string) => {
    // Rename is handled inline via double-click on title in node components.
    // This callback is a no-op placeholder for the context menu.
  }, []);

  const handleNodeGenerate = useCallback(
    (id: string) => {
      void generate(id);
    },
    [generate],
  );

  const handleNodeCut = useCallback(
    (id: string) => {
      const c = canvasRef.current;
      if (!c) return;
      const payload = buildClipboardPayload(c, [id]);
      if (!payload) return;
      dispatch(copyNodesAction([id]));
      dispatch(setClipboard(payload));
      if (navigator.clipboard?.writeText) {
        void navigator.clipboard.writeText(
          JSON.stringify({ type: 'lucid-canvas-selection', payload }),
        );
      }
      dispatch(removeNodes([id]));
    },
    [dispatch],
  );

  const handleNodeCopy = useCallback(
    (id: string) => {
      const c = canvasRef.current;
      if (!c) return;
      const payload = buildClipboardPayload(c, [id]);
      if (!payload) return;
      dispatch(copyNodesAction([id]));
      dispatch(setClipboard(payload));
      if (navigator.clipboard?.writeText) {
        void navigator.clipboard.writeText(
          JSON.stringify({ type: 'lucid-canvas-selection', payload }),
        );
      }
    },
    [dispatch],
  );

  const handleNodePaste = useCallback(
    async (_id: string) => {
      let payload = clipboard;
      try {
        if (navigator.clipboard?.readText) {
          const raw = await navigator.clipboard.readText();
          payload = parseClipboardPayload(raw) ?? payload;
        }
      } catch {
        /* clipboard permission denied — fall back to redux clipboard */
      }
      if (!payload) return;
      dispatch(setClipboard(payload));
      dispatch(pasteNodesAction({ offset: { x: 50, y: 50 } }));
    },
    [clipboard, dispatch],
  );

  const handleNodeLock = useCallback(
    (id: string) => {
      dispatch(toggleLock({ id }));
    },
    [dispatch],
  );

  const handleCopyPromptForAI = useCallback(
    (id: string) => {
      const c = canvasRef.current;
      if (!c) return;
      const currentPresetById = presetByIdRef.current;
      const summaries: Record<string, string> = {};
      for (const node of c.nodes ?? []) {
        const presetData = node.data as unknown as {
          presetTracks?: Record<string, unknown>;
        };
        if (presetData.presetTracks) {
          const names: string[] = [];
          for (const [, track] of Object.entries(presetData.presetTracks)) {
            const t = track as { entries?: Array<{ presetId?: string }> };
            if (t.entries?.[0]?.presetId) {
              const p = currentPresetById[t.entries[0].presetId];
              if (p?.name) names.push(localizePresetName(p.name));
            }
          }
          if (names.length > 0) summaries[node.id] = names.join(', ');
        }
      }
      const prompt = buildExternalAIPrompt(c, id, summaries);
      void navigator.clipboard.writeText(prompt);
    },
    [],
  );

  const handleNodeColorTag = useCallback(
    (id: string, color: string | undefined) => {
      dispatch(setNodeColorTag({ id, colorTag: color }));
    },
    [dispatch],
  );

  const handleConnectTo = useCallback(
    (id: string) => {
      setConnectingFromNodeId(id);
    },
    [setConnectingFromNodeId],
  );

  const handleSelectVariant = useCallback(
    (id: string, index: number) => {
      dispatch(selectVariant({ id, index }));
    },
    [dispatch],
  );

  const handleToggleSeedLock = useCallback(
    (id: string) => {
      dispatch(toggleSeedLock({ id }));
    },
    [dispatch],
  );

  const handleToggleCollapse = useCallback(
    (id: string) => {
      dispatch(toggleBackdropCollapse({ id }));
    },
    [dispatch],
  );

  const handleOpacityChange = useCallback(
    (id: string, opacity: number) => {
      dispatch(setBackdropOpacity({ id, opacity }));
    },
    [dispatch],
  );

  const handleNodeUpload = useCallback(
    async (id: string) => {
      const api = getAPI();
      if (!api) return;
      const node = canvasRef.current?.nodes.find((n) => n.id === id);
      if (!node) return;
      const ref = (await api.asset.pickFile(node.type)) as {
        hash: string;
      } | null;
      if (!ref) return;
      dispatch(setNodeUploadedAsset({ id, assetHash: ref.hash }));
    },
    [dispatch],
  );

  return useMemo<NodeCallbacks>(
    () => ({
      onTitleChange: handleTitleChange,
      onDelete: handleNodeDelete,
      onDuplicate: handleNodeDuplicate,
      onCut: handleNodeCut,
      onCopy: handleNodeCopy,
      onPaste: (id: string) => {
        void handleNodePaste(id);
      },
      onDisconnect: handleNodeDisconnect,
      onConnectTo: handleConnectTo,
      onRename: handleNodeRename,
      onGenerate: handleNodeGenerate,
      onLock: handleNodeLock,
      onColorTag: handleNodeColorTag,
      onCopyPromptForAI: handleCopyPromptForAI,
      onUpload: (id: string) => {
        void handleNodeUpload(id);
      },
      onSelectVariant: handleSelectVariant,
      onToggleSeedLock: handleToggleSeedLock,
      onToggleCollapse: handleToggleCollapse,
      onOpacityChange: handleOpacityChange,
    }),
    [
      handleTitleChange,
      handleNodeDelete,
      handleNodeDuplicate,
      handleNodeCut,
      handleNodeCopy,
      handleNodePaste,
      handleNodeDisconnect,
      handleConnectTo,
      handleNodeRename,
      handleNodeGenerate,
      handleNodeLock,
      handleNodeColorTag,
      handleCopyPromptForAI,
      handleNodeUpload,
      handleSelectVariant,
      handleToggleSeedLock,
      handleToggleCollapse,
      handleOpacityChange,
    ],
  );
}
