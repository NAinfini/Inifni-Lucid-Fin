import { useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import type { RootState } from '../store/index.js';
import { addNode } from '../store/slices/canvas.js';
import { addLog } from '../store/slices/logger.js';
import { enqueueToast } from '../store/slices/toast.js';
import { getAPI } from '../utils/api.js';
import { t } from '../i18n.js';

/**
 * Watches the clipboard when the app is not focused.
 * When a large text block is detected (>100 chars, typically from ChatGPT/DeepSeek),
 * shows a toast notification with an "Add to canvas" action button.
 * The text node is only created if the user clicks the button.
 */
export function useClipboardWatcher() {
  const dispatch = useDispatch();
  const activeCanvasId = useSelector((state: RootState) => state.canvas.activeCanvasId);

  useEffect(() => {
    const api = getAPI();
    if (!api?.clipboard?.onAIDetected) return;

    const unsub = api.clipboard.onAIDetected((data: { text: string }) => {
      if (!activeCanvasId) return;

      const preview =
        data.text.length > 80 ? data.text.slice(0, 80) + '...' : data.text;

      dispatch(
        enqueueToast({
          title: t('toast.clipboard.detected'),
          message: preview,
          variant: 'info',
          durationMs: 5000,
          actionLabel: t('toast.clipboard.addToCanvas'),
          onAction: () => {
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
          },
        }),
      );
    });

    return unsub;
  }, [activeCanvasId, dispatch]);
}
