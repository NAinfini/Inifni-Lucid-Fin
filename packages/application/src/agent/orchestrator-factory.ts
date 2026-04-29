/**
 * Single entry point for building an `AgentOrchestrator`.
 *
 * Before Phase D, three call sites constructed the orchestrator directly:
 *  - `apps/desktop-main/src/ipc/handlers/commander.handlers.ts` (production)
 *  - `apps/desktop-main/src/electron.ts` (session recovery path)
 *  - `evals/commander-study/harness/run-single.ts` (study harness)
 *
 * Each wired a different subset of resolvers, which is why the 04-19
 * commander-study runs found `style-plate-lock` never activating in the
 * harness — the harness never wired `resolveCanvasSettings`. Phase D makes
 * the factory the ONLY supported construction path so drift of this shape
 * becomes impossible; an ESLint `no-restricted-syntax` rule (added
 * alongside the factory) fails the build on any `new AgentOrchestrator(...)`
 * outside this module.
 *
 * The factory also owns the "study-harness" affordance: when
 * `variant === 'study-harness'` the caller can supply `mockGenerationInstaller`
 * to patch the tool registry after `registerAllTools` runs. Production never
 * invokes that hook.
 */

import type { LLMAdapter, ProviderProfile } from '@lucid-fin/contracts';
import { AgentOrchestrator, type AgentOptions } from './agent-orchestrator.js';
import type { ProcessCategory } from './process-detection.js';
import type { AgentToolRegistry } from './tool-registry.js';
import { TodoRunStore } from './tools/todo-run-store.js';
import { randomUUID } from 'node:crypto';

/**
 * Minimal canvas-store surface the factory needs. Both production's
 * `CanvasStore` and the harness's in-memory seed implement this structurally.
 */
export interface CanvasLookup {
  get: (canvasId: string) =>
    | {
        nodes: ReadonlyArray<{ id: string; type: string }>;
        settings?: { stylePlate?: string | null } | null | undefined;
      }
    | null
    | undefined;
}

export type OrchestratorVariant = 'production' | 'study-harness';

export interface OrchestratorFactoryInput {
  /** Which call-site is constructing this orchestrator. Drives variant hooks. */
  variant: OrchestratorVariant;

  /** Required: the adapter used for LLM calls this run. */
  llmAdapter: LLMAdapter;
  /** Required: pre-populated tool registry (callers invoke registerAllTools first). */
  toolRegistry: AgentToolRegistry;
  /** Required: prompt-code resolver (`(code) => string`). */
  resolvePrompt: (code: string) => string;
  /**
   * Canvas lookup used to derive `resolveCanvasNodeType` and
   * `resolveCanvasSettings`. Omit for non-canvas AI flows (e.g. the
   * electron.ts standalone AI orchestrator used by `ai.*` handlers); the
   * factory then skips those resolvers and any canvas-state-driven
   * ProcessPromptSpec stays dormant, which is the correct no-op.
   */
  canvasStore?: CanvasLookup;

  /**
   * Optional: process-prompt text resolver. When omitted, declarative
   * ProcessPromptSpecs like `style-plate-lock` stay dormant — the spec's
   * `resolvePromptText` callback falls back to `null` and
   * `evaluateProcessPromptSpecs` filters the activation out. Harness callers
   * that want the spec to fire MUST pass this.
   */
  resolveProcessPrompt?: (processKey: string) => string | null | undefined;

  /** Optional knob bag. Merged over the factory's defaults. */
  options?: Pick<AgentOptions, 'maxSteps' | 'temperature' | 'maxTokens' | 'profile'>;

  /**
   * Harness-only hook. Called with the orchestrator instance after
   * construction; production ignores it even if provided (defensive).
   */
  postConstructHarnessHook?: (orchestrator: AgentOrchestrator) => void;
}

/**
 * Production = identical to harness except `postConstructHarnessHook` is
 * ignored. The harness path wires `mockGenerationInstaller` outside the
 * factory (against the tool registry) — the hook here is for anything that
 * needs a hold on the constructed `AgentOrchestrator`.
 */
export function createAgentOrchestratorForRun(input: OrchestratorFactoryInput): AgentOrchestrator {
  const profile = input.options?.profile ?? input.llmAdapter.profile;

  const resolveProcessPromptTyped: ((key: ProcessCategory) => string | null) | undefined =
    input.resolveProcessPrompt
      ? (key: ProcessCategory) => {
          // The process-prompt store indexes by free-form string, but the
          // orchestrator's AgentOptions slot types it as ProcessCategory for
          // historical reasons (the widened ProcessPromptKey union lives
          // inside the orchestrator). Cast is narrowed here.
          const raw = input.resolveProcessPrompt!(key as unknown as string);
          return typeof raw === 'string' ? raw : null;
        }
      : undefined;

  const canvasStore = input.canvasStore;
  const todoStore = new TodoRunStore({
    generateId: (kind) => `${kind}-${randomUUID().slice(0, 8)}`,
  });

  const agentOptions: AgentOptions = {
    ...(input.options ?? {}),
    profile: profile as ProviderProfile | undefined,
    resolveProcessPrompt: resolveProcessPromptTyped,
    todoStore,
    resolveCanvasNodeType: canvasStore
      ? (canvasId: string, nodeId: string) => {
          const canvas = canvasStore.get(canvasId);
          if (!canvas) return null;
          const node = canvas.nodes.find((n) => n.id === nodeId);
          if (!node) return null;
          if (node.type === 'image' || node.type === 'backdrop') return 'image';
          if (node.type === 'video') return 'video';
          if (node.type === 'audio') return 'audio';
          return null;
        }
      : undefined,
    resolveCanvasSettings: canvasStore
      ? (canvasId: string) => {
          const canvas = canvasStore.get(canvasId);
          if (!canvas) return null;
          return { stylePlate: canvas.settings?.stylePlate ?? null };
        }
      : undefined,
  };

  const orchestrator = new AgentOrchestrator(
    input.llmAdapter,
    input.toolRegistry,
    input.resolvePrompt,
    agentOptions,
  );

  if (input.variant === 'study-harness' && input.postConstructHarnessHook) {
    input.postConstructHarnessHook(orchestrator);
  }

  return orchestrator;
}
