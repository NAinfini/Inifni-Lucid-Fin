/**
 * Node-kind taxonomy: closed-literal unions for the five node kinds and
 * their subsets. Existing code uses `CanvasNodeType`; the aliases here
 * are the canonical names going forward.
 *
 * New code should use `NodeKind` / `GeneratableNodeKind` / `VisualNodeKind`
 * / `MediaNodeKind` directly. `CanvasNodeType` is kept as a backward-compat
 * alias (same union) so existing imports don't break until Phase B+ migrates
 * them batch by batch.
 */

/** All five canvas node types. */
export const NODE_KINDS = ['image', 'video', 'audio', 'text', 'backdrop'] as const;
export type NodeKind = (typeof NODE_KINDS)[number];

/** Subset that can be sent through the generation pipeline. */
export const GENERATABLE_NODE_KINDS = ['image', 'video', 'audio'] as const;
export type GeneratableNodeKind = (typeof GENERATABLE_NODE_KINDS)[number];

/** Subset that produces a visual (non-audio) output. */
export const VISUAL_NODE_KINDS = ['image', 'video'] as const;
export type VisualNodeKind = (typeof VISUAL_NODE_KINDS)[number];

/** All media kinds (generatable — everything except text/backdrop). */
export type MediaNodeKind = GeneratableNodeKind;

/** Generation intent — separates canvas-node generation from ref-image. */
export const GENERATION_INTENTS = ['canvas-node', 'ref-image'] as const;
export type GenerationIntent = (typeof GENERATION_INTENTS)[number];
