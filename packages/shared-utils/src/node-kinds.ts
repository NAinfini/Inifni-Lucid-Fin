/**
 * Node-kind matching and guard functions.
 *
 * These consume the `NodeKind` / `GeneratableNodeKind` / `VisualNodeKind`
 * types from `@lucid-fin/contracts` and provide exhaustive dispatch + runtime
 * type narrowing for any value carrying a `.type: CanvasNodeType` field.
 *
 * Usage:
 *   import { matchNode, isGeneratableMedia, isVisualMedia } from '@lucid-fin/shared-utils';
 *
 *   const label = matchNode(node.type, {
 *     image:    () => 'Image',
 *     video:    () => 'Video',
 *     audio:    () => 'Audio',
 *     text:     () => 'Text',
 *     backdrop: () => 'Backdrop',
 *   });
 */
import type {
  NodeKind,
  GeneratableNodeKind,
  VisualNodeKind,
} from '@lucid-fin/contracts';
import {
  GENERATABLE_NODE_KINDS,
  VISUAL_NODE_KINDS,
} from '@lucid-fin/contracts';
import { assertNever } from './assert-never.js';

type NodeHandlers<R> = {
  [K in NodeKind]: (kind: K) => R;
};

/**
 * Exhaustive match on a `NodeKind` (or the legacy `CanvasNodeType` — same
 * union). Every variant must be handled; adding a new kind to `NodeKind`
 * causes a compile error at every call site until a handler is added.
 */
export function matchNode<R>(kind: NodeKind, handlers: NodeHandlers<R>): R {
  switch (kind) {
    case 'image':    return handlers.image(kind);
    case 'video':    return handlers.video(kind);
    case 'audio':    return handlers.audio(kind);
    case 'text':     return handlers.text(kind);
    case 'backdrop': return handlers.backdrop(kind);
    default:         return assertNever(kind, 'matchNode');
  }
}

// ── Runtime guards ─────────────────────────────────────────────

const generatableSet = new Set<string>(GENERATABLE_NODE_KINDS);
const visualSet = new Set<string>(VISUAL_NODE_KINDS);

/** True for image / video / audio — kinds that can enter the generation pipeline. */
export function isGeneratableMedia(kind: string): kind is GeneratableNodeKind {
  return generatableSet.has(kind);
}

/** True for image / video — visual output kinds. */
export function isVisualMedia(kind: string): kind is VisualNodeKind {
  return visualSet.has(kind);
}

/** Alias — same as `isGeneratableMedia` but reads better in contexts about media nodes. */
export const isMediaNode = isGeneratableMedia;
