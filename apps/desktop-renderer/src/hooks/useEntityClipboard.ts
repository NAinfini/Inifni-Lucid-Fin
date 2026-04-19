/**
 * Module-scoped clipboard for entity panels (characters, equipment, locations,
 * assets). Holds a snapshot of the selected items plus a "kind" tag so
 * pasting only works inside the panel that copied — cross-panel paste is
 * meaningless for these entity types.
 *
 * The clipboard also tracks whether the items were Cut (to consume after
 * paste) or Copied (to duplicate). The owning panel decides how to handle
 * each via the paste callback.
 */
import { useCallback, useEffect, useState } from 'react';

export type ClipboardMode = 'copy' | 'cut';

export interface ClipboardPayload<T> {
  kind: string;
  mode: ClipboardMode;
  items: T[];
}

type Listener = () => void;

const listeners = new Set<Listener>();
let current: ClipboardPayload<unknown> | null = null;

function notify(): void {
  for (const l of listeners) l();
}

function set<T>(payload: ClipboardPayload<T> | null): void {
  current = payload as ClipboardPayload<unknown> | null;
  notify();
}

export interface UseEntityClipboardResult<T> {
  hasClipboard: boolean;
  isCut: boolean;
  peek: () => ClipboardPayload<T> | null;
  copy: (items: T[]) => void;
  cut: (items: T[]) => void;
  paste: () => ClipboardPayload<T> | null;
  clear: () => void;
}

/**
 * @param kind  Panel identifier ("character", "equipment", etc.). The hook
 *              only reports `hasClipboard` when the current clipboard's
 *              kind matches — that enforces the same-panel-only rule.
 */
export function useEntityClipboard<T>(kind: string): UseEntityClipboardResult<T> {
  const [, force] = useState(0);

  useEffect(() => {
    const rerender: Listener = () => force((n) => n + 1);
    listeners.add(rerender);
    return () => { listeners.delete(rerender); };
  }, []);

  const match = current && current.kind === kind ? (current as ClipboardPayload<T>) : null;

  const copy = useCallback((items: T[]) => {
    if (items.length === 0) return;
    set<T>({ kind, mode: 'copy', items });
  }, [kind]);

  const cut = useCallback((items: T[]) => {
    if (items.length === 0) return;
    set<T>({ kind, mode: 'cut', items });
  }, [kind]);

  const paste = useCallback((): ClipboardPayload<T> | null => {
    if (!match) return null;
    // Cut payloads are consumed on paste (one-shot move); copy payloads
    // stay on the clipboard so multiple pastes create multiple duplicates.
    if (match.mode === 'cut') set(null);
    return match;
  }, [match]);

  const peek = useCallback(() => match, [match]);
  const clear = useCallback(() => { if (current?.kind === kind) set(null); }, [kind]);

  return {
    hasClipboard: Boolean(match),
    isCut: match?.mode === 'cut',
    peek,
    copy,
    cut,
    paste,
    clear,
  };
}

/** Test hook: wipe the shared clipboard between tests. */
export function resetEntityClipboardForTests(): void {
  current = null;
  listeners.clear();
}
