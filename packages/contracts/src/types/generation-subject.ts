/**
 * `GenerationSubject` — Phase D-1.
 *
 * A generation request's identity: either "generate media for this canvas
 * node" or "generate a reference image for this entity". The two intents
 * share a 4-step pipeline (resolve → compile → execute → ingest) but have
 * different inputs, different telemetry buckets, and different success paths.
 *
 * Modeling them as an exhaustive discriminated union lets the strategy table
 * be statically checked: adding a new `GeneratableNodeKind` or a new
 * ref-image `entityKind` produces a compile error at every `selectStrategy`
 * site and at the strategies table itself.
 */

import type { GeneratableNodeKind } from './node-kinds.js';
import type {
  CanvasId,
  NodeId,
  CharacterId,
  LocationId,
  EquipmentId,
} from './brands.js';

export type GenerationSubject =
  | {
      readonly intent: 'canvas-node';
      readonly canvasId: CanvasId;
      readonly nodeId: NodeId;
      readonly kind: GeneratableNodeKind;
    }
  | {
      readonly intent: 'ref-image';
      readonly entityKind: 'character' | 'location' | 'equipment';
      readonly entityId: CharacterId | LocationId | EquipmentId;
    };

/**
 * Flat strategy key — the catalog indexing axis. Every legal
 * (intent, kind-or-entity) pair has a distinct string literal, so the
 * strategies record is statically complete.
 */
export type GenerationStrategyKey =
  | 'canvas-node.image'
  | 'canvas-node.video'
  | 'canvas-node.audio'
  | 'ref-image.character'
  | 'ref-image.location'
  | 'ref-image.equipment';

/**
 * Map a `GenerationSubject` to its strategy key. Exhaustive by construction —
 * if `GenerationSubject` gains a new variant, this function fails to compile
 * until the new branch is added.
 */
export function generationStrategyKey(subject: GenerationSubject): GenerationStrategyKey {
  if (subject.intent === 'canvas-node') {
    return `canvas-node.${subject.kind}` as const;
  }
  return `ref-image.${subject.entityKind}` as const;
}
