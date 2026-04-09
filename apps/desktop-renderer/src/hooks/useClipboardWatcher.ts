import { useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import type { RootState } from '../store/index.js';
import { addNode } from '../store/slices/canvas.js';
import { addLog } from '../store/slices/logger.js';
import { getAPI } from '../utils/api.js';

/**
 * Watches the clipboard when the app is not focused.
 * When a large text block is detected (>100 chars, typically from ChatGPT/DeepSeek),
 * creates a text node on the active canvas with the content.
 */
export function useClipboardWatcher() {
  const dispatch = useDispatch();
  const activeCanvasId = useSelector((state: RootState) => state.canvas.activeCanvasId);

  useEffect(() => {
    const api = getAPI();
    if (!api?.clipboard?.onAIDetected) return;

    const unsub = api.clipboard.onAIDetected((data: { text: string }) => {
      if (!activeCanvasId) return;

      dispatch(
        addNode({
          id: crypto.randomUUID(),
          type: 'text',
          title: 'Imported from clipboard',
          data: { content: data.text },
          position: { x: 100 + Math.random() * 200, y: 100 + Math.random() * 200 },
        }),
      );
      dispatch(
        addLog({
          level: 'info',
          category: 'clipboard',
          message: `AI response imported from clipboard (${data.text.length} chars)`,
        }),
      );
    });

    return unsub;
  }, [activeCanvasId, dispatch]);
}
