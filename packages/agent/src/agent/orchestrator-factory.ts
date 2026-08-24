/**
 * Single entry point for building an `AgentOrchestrator`.
 *
 * Before Phase D, three call sites constructed the orchestrator directly:
 *  - `apps/desktop-main/src/ipc/handlers/commander.handlers.ts` (production)
 *  - `apps/desktop-main/src/electron.ts` (session recovery path)
 *  - `evals/commander-study/harness/run-single.ts` (study harness)
 *
 * Phase D makes the factory the ONLY supported construction path; an ESLint
 * `no-restricted-syntax` rule (added alongside the factory) fails the build
 * on any `new AgentOrchestrator(...)` outside this module.
 *
 * The factory also owns the "study-harness" affordance: when
 * `variant === 'study-harness'` the caller can supply `mockGenerationInstaller`
 * to patch the tool registry after `registerAllTools` runs. Production never
 * invokes that hook.
 */

import type { LLMAdapter, ProviderProfile } from '@lucid-fin/contracts';
import { AgentOrchestrator, type AgentOptions } from './agent-orchestrator.js';
import type { ToolRegistry } from './tool-registry.js';
import { RunChecklistStore } from './tools/run-checklist-store.js';
import { bindRunChecklistToolDefinition } from './tools/run-checklist-tools.js';
import { randomUUID } from 'node:crypto';

export type OrchestratorVariant = 'production' | 'study-harness';

export interface OrchestratorFactoryInput {
  /** Which call-site is constructing this orchestrator. Drives variant hooks. */
  variant: OrchestratorVariant;

  /** Required: the adapter used for LLM calls this run. */
  llmAdapter: LLMAdapter;
  /** Required: pre-populated tool registry (callers invoke registerAllTools first). */
  toolRegistry: ToolRegistry;
  /** Required: prompt-code resolver (`(code) => string`). */
  resolvePrompt: (code: string) => string;
  /** Optional knob bag. Merged over the factory's defaults. */
  options?: Pick<
    AgentOptions,
    | 'resourceBudget'
    | 'resourceCarryIn'
    | 'resourceNow'
    | 'temperature'
    | 'maxOutputTokens'
    | 'contextWindowTokens'
    | 'profile'
    | 'onBeforeCompact'
    | 'onPostCompact'
    | 'resolvePersistentContext'
    | 'onTaskDecision'
    | 'onContextRecoveryReport'
    | 'toolProgramLifecycleFactory'
    | 'subagentToolHostFactory'
  >;

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

  const runChecklistStore = new RunChecklistStore({
    generateId: (kind) => `${kind}-${randomUUID().slice(0, 8)}`,
  });
  const runChecklistDefinition = input.toolRegistry.get('runChecklist.manage');
  if (runChecklistDefinition) {
    input.toolRegistry.register(
      bindRunChecklistToolDefinition(runChecklistDefinition, runChecklistStore),
    );
  }

  const agentOptions: AgentOptions = {
    ...(input.options ?? {}),
    profile: profile as ProviderProfile | undefined,
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
