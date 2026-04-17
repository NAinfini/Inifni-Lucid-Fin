/**
 * `GenerationApplicationService` — Phase D-1 scaffold.
 *
 * The 4-step generation pipeline (resolve → compile → execute → ingest)
 * with an exhaustive strategy table indexed by
 * `(intent, kind | entityKind)`. See PRD Phase D §D-1 for the full design.
 *
 * **Current status (Phase D-v1):** the strategy implementations are empty
 * stubs that throw `LucidError('not-implemented')`. The real generation
 * logic still lives in `apps/desktop-main/src/ipc/handlers/generation-*.ts`
 * and `apps/desktop-main/src/generation-pipeline.ts`. Callers that already
 * use those helpers continue to work unchanged.
 *
 * What this file delivers today:
 *
 *   1. A compile-time guarantee that every `(intent, kind)` pair has a
 *      registered strategy — adding a new `GeneratableNodeKind` or
 *      ref-image `entityKind` to `GenerationSubject` breaks this file at
 *      `STRATEGIES` until a new entry is added.
 *   2. The `GenerationStrategy` interface callers can implement as they
 *      incrementally migrate logic out of the legacy helpers.
 *   3. A `selectStrategy(subject)` dispatcher that future handlers will
 *      call, so renaming strategies later is a single-file change.
 *
 * Not yet delivered (intentional — tracked as Phase D-v2 follow-up):
 *
 *   - Deletion of `generation-helpers.ts` / `generation-context.ts` /
 *     `generation-prompt-compiler.ts` / `generation-pipeline.ts`.
 *   - `canvas-generation.handlers.ts` thinning below 250 lines.
 *   - Real strategy bodies consuming the legacy helpers.
 */

import type {
  GenerationStrategyKey,
  GenerationSubject,
  ProviderId,
} from '@lucid-fin/contracts';
import { generationStrategyKey } from '@lucid-fin/contracts';

export interface PipelineRequest<S extends GenerationSubject = GenerationSubject> {
  readonly subject: S;
  readonly providerId?: ProviderId;
  readonly seed?: number;
  readonly variantCount?: number;
}

export type GenerationEvent =
  | { readonly kind: 'progress'; readonly percentage: number; readonly step: string }
  | { readonly kind: 'complete'; readonly assetHashes: readonly string[]; readonly cost: number }
  | { readonly kind: 'error'; readonly message: string };

export interface GenerationStrategy<S extends GenerationSubject = GenerationSubject> {
  readonly key: GenerationStrategyKey;
  run(
    req: PipelineRequest<S>,
    signal: AbortSignal,
  ): AsyncIterable<GenerationEvent>;
}

async function* notImplemented(key: GenerationStrategyKey): AsyncIterable<GenerationEvent> {
  yield {
    kind: 'error',
    message: `Strategy "${key}" is not wired to the GenerationApplicationService yet — the legacy generation helpers remain the execution path. See PRD Phase D §D-v2.`,
  };
}

/**
 * Exhaustive strategy table. The `satisfies` clause is the key guarantee:
 * any missing `GenerationStrategyKey` is a compile error.
 */
export const STRATEGIES = {
  'canvas-node.image': {
    key: 'canvas-node.image',
    run: (_req, _signal) => notImplemented('canvas-node.image'),
  },
  'canvas-node.video': {
    key: 'canvas-node.video',
    run: (_req, _signal) => notImplemented('canvas-node.video'),
  },
  'canvas-node.audio': {
    key: 'canvas-node.audio',
    run: (_req, _signal) => notImplemented('canvas-node.audio'),
  },
  'ref-image.character': {
    key: 'ref-image.character',
    run: (_req, _signal) => notImplemented('ref-image.character'),
  },
  'ref-image.location': {
    key: 'ref-image.location',
    run: (_req, _signal) => notImplemented('ref-image.location'),
  },
  'ref-image.equipment': {
    key: 'ref-image.equipment',
    run: (_req, _signal) => notImplemented('ref-image.equipment'),
  },
} as const satisfies Record<GenerationStrategyKey, GenerationStrategy>;

/**
 * Exhaustive dispatcher. `generationStrategyKey` in contracts is itself an
 * exhaustive mapper, so this lookup is total by construction — no runtime
 * fallback needed.
 */
export function selectStrategy(subject: GenerationSubject): GenerationStrategy {
  return STRATEGIES[generationStrategyKey(subject)];
}

export class GenerationApplicationService {
  async *run(
    req: PipelineRequest,
    signal: AbortSignal,
  ): AsyncIterable<GenerationEvent> {
    const strategy = selectStrategy(req.subject);
    yield* strategy.run(req, signal);
  }
}
