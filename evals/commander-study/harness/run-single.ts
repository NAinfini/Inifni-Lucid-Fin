/**
 * Drive a single fake-user session through AgentOrchestrator.execute.
 *
 * Flow:
 *   1. `test-env.createTestEnv` → fresh sqlite + canvas.
 *   2. `guide-loader.loadBuiltinPromptGuides` → same 35 skills renderer ships.
 *   3. `registerAllTools` → full production tool graph (works because of the
 *      electron-shim).
 *   4. `installMockGeneration` → overrides canvas.generate + ref-image tools
 *      with canned success results so no provider cost is incurred for media.
 *   5. `buildCodexAdapter(spec)` → LLM adapter with keychain-backed key.
 *   6. `new AgentOrchestrator(adapter, registry, ...)` + `execute(opener)`.
 *   7. emit handler:
 *        - logs every stream event to the session log (raw ndjson)
 *        - when `tool_question` fires: pop persona.followUps.shift() and
 *          call `orchestrator.answerQuestion(toolCallId, answer)`
 *        - watches step + cumulative prompt tokens for budget enforcement
 *   8. returns a SessionResult summarising what happened.
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import {
  AgentToolRegistry,
  createAgentOrchestratorForRun,
  type AgentContext,
  type StampedStreamEvent,
} from '@lucid-fin/application';
import { DEFAULT_PROVIDER_PROFILE, type LLMAdapter } from '@lucid-fin/contracts';

import { createTestEnv, type TestEnvWithCanvas } from './test-env.js';
import { loadBuiltinPromptGuides } from './guide-loader.js';
import { installMockGeneration, type MockStats } from './mock-generation.js';
import { type Persona } from './personas.js';
import type { CodexProviderSpec } from './provider-config.js';
import { buildCodexAdapter } from './llm-factory.js';

// The desktop-main handler lives behind the electron shim; imported here
// AFTER the shim has been registered at the run-all entrypoint.
import {
  registerAllTools,
  mergePromptGuidesWithBuiltIns,
} from '../../../apps/desktop-main/src/ipc/handlers/commander-tool-deps.js';
import { buildContext } from '../../../apps/desktop-main/src/ipc/handlers/commander.handlers.js';

export interface SessionResult {
  personaIndex: number;
  personaSlug: string;
  archetype: string;
  providerName: string;
  outcome: 'completed' | 'aborted' | 'budget-exceeded' | 'error';
  error?: string;
  steps: number;
  toolCalls: Array<{ step: number; name: string; ok: boolean; errorMessage?: string }>;
  toolCallCounts: Record<string, number>;
  mockCallCounts: Record<string, number>;
  askUserCount: number;
  askUserAnswersConsumed: number;
  askUserFallbacksUsed: number;
  promptTokensEstimated: number;
  finalNodeCount: number;
  finalEdgeCount: number;
  stylePlateLocked: boolean;
  promptGuidesLoadedViaGuideGet: string[];
  /**
   * Phase D: now authoritative. Populated from the
   * `evidence_appended` stream event filtered on
   * `evidence.kind === 'process_prompt_activated'`. The pre-Phase-D
   * grep-based heuristic (`process_prompt_injected` / `process_prompts_primed`
   * events) was a dead listener — the orchestrator never emitted those.
   */
  processPromptsInjected: string[];
  /** Phase D: per-spec preflight outcomes — `{ specKey, decision, step }`. */
  preflightDecisions: Array<{
    specKey: string;
    decision: 'activated' | 'skipped';
    step: number;
  }>;
  /** Phase D: full typed evidence ledger for post-hoc study analysis. */
  evidenceLedger: Array<{ kind: string; at: number; [k: string]: unknown }>;
  /** Phase D: last `exit_decision` emitted before the run terminated, or null. */
  exitDecision: {
    outcome: string;
    contractId?: string;
    reason?: string;
    blocker?: unknown;
    [k: string]: unknown;
  } | null;
  /**
   * Phase E: product-satisfaction signal. `true` when `exitDecision.outcome`
   * is `'satisfied'` or `'informational_answered'`. Drives the 70% headline
   * in `report.ts`.
   */
  contractSatisfied: boolean;
  /** Phase E: shorthand for `exitDecision?.outcome`, null-safe. */
  exitOutcome: string | null;
  /**
   * Phase E: shorthand for `exitDecision?.blocker?.kind` when outcome is
   * `'unsatisfied'`. Null otherwise. Used by the report to histogram
   * blocker reasons per archetype.
   */
  blocker: string | null;
  logFile: string;
  ms: number;
}

export interface RunSingleOptions {
  persona: Persona;
  spec: CodexProviderSpec;
  outDir: string;
  maxSteps?: number;
  maxPromptTokens?: number;
  genericFallback?: string;
}

const DEFAULT_MAX_STEPS = 200;
const DEFAULT_MAX_PROMPT_TOKENS = 400_000;
const DEFAULT_FALLBACK = 'You choose.';

export async function runSingle(options: RunSingleOptions): Promise<SessionResult> {
  const {
    persona,
    spec,
    outDir,
    maxSteps = DEFAULT_MAX_STEPS,
    maxPromptTokens = DEFAULT_MAX_PROMPT_TOKENS,
    genericFallback = DEFAULT_FALLBACK,
  } = options;

  fs.mkdirSync(outDir, { recursive: true });
  const logFile = path.join(
    outDir,
    `${String(persona.index).padStart(2, '0')}-${persona.slug}.ndjson`,
  );
  const logStream = fs.createWriteStream(logFile, { flags: 'w' });
  const logEvent = (rec: Record<string, unknown>) => {
    logStream.write(JSON.stringify({ t: Date.now(), ...rec }) + '\n');
  };

  const envStarted = Date.now();
  const { env, canvasId }: TestEnvWithCanvas = await createTestEnv();
  logEvent({ kind: 'env_ready', dir: env.dir, canvasId });

  // LLM adapter (real, via keychain).
  const llmAdapter: LLMAdapter = await buildCodexAdapter(spec);

  // Prompt guides (bundled from disk — same as renderer).
  const rawGuides = loadBuiltinPromptGuides();
  const promptGuides = mergePromptGuidesWithBuiltIns(rawGuides);

  // Build full tool registry using the production wiring. We pass a null
  // `getWindow` — any code path that hard-requires a window (real
  // triggerGeneration / cancelGeneration) would throw, but the harness
  // overrides canvas.generate with a mock right after, so we never reach
  // those paths.
  const registry = new AgentToolRegistry();
  const sessionId = randomUUID();
  registerAllTools(
    registry,
    {
      adapterRegistry: env.adapterRegistry,
      llmRegistry: env.llmRegistry,
      canvasStore: env.canvasStore,
      presetLibrary: [],
      jobQueue: env.jobQueue,
      workflowEngine: env.workflowEngine,
      db: env.db,
      cas: env.cas,
      keychain: env.keychain,
      promptStore: env.promptStore,
    },
    () => null,
    promptGuides,
    undefined,
    sessionId,
    undefined,
    undefined,
    // resolveProcessPrompt — delegate to the harness env's store so the
    // same process prompts the production app sees get injected.
    (processKey: string) => env.processPromptStore.getEffectiveValue(processKey),
  );

  // Mock generation tools AFTER registerAllTools so Map.set() overrides win.
  const mockStats: MockStats = installMockGeneration(registry);

  // Build context the same way commander.handlers does.
  const canvas = env.canvasStore.get(canvasId);
  if (!canvas) throw new Error('seed canvas missing — harness bug');
  const processPromptKeys = env.processPromptStore.list().map((r) => ({
    processKey: r.processKey,
    name: r.name,
  }));
  const context: AgentContext = buildContext(
    canvas,
    [],
    [],
    env.db,
    promptGuides,
    processPromptKeys,
  );

  // Orchestrator — factory is the only supported construction path (Phase D).
  // Wiring `canvasStore` here is what the pre-Phase-D harness was missing,
  // which is why the 04-19 study runs showed `style-plate-lock` never
  // activating in the harness: without a canvas resolver the predicate has
  // no settings snapshot to inspect.
  const profile = llmAdapter.profile ?? DEFAULT_PROVIDER_PROFILE;
  const orchestrator = createAgentOrchestratorForRun({
    variant: 'study-harness',
    llmAdapter,
    toolRegistry: registry,
    resolvePrompt: (code: string) => env.promptStore.resolve(code),
    canvasStore: env.canvasStore,
    resolveProcessPrompt: (processKey) => env.processPromptStore.getEffectiveValue(processKey),
    options: {
      maxSteps,
      profile,
    },
  });

  // Tracking state.
  const followUpQueue = [...persona.followUps];
  let askUserCount = 0;
  let askUserConsumed = 0;
  let askUserFallbacks = 0;
  const toolCalls: SessionResult['toolCalls'] = [];
  const toolCallCounts: Record<string, number> = {};
  /** OpenAI-compatible providers rename `a.b` tool names to `a_b` in events;
   *  normalize back so our counts key on the canonical (dotted) name. */
  const normalizeToolName = (name: string | undefined): string | undefined => {
    if (!name) return name;
    // The real tool registry always uses dots. If the name has no dot but has
    // an underscore in a recognizable place, swap the first underscore.
    if (name.includes('.')) return name;
    const i = name.indexOf('_');
    return i > 0 ? `${name.slice(0, i)}.${name.slice(i + 1)}` : name;
  };
  /** toolCallId → canonical (dotted) toolName, captured at tool_call_started. */
  const toolNameById = new Map<string, string>();
  let step = 0;
  let promptTokens = 0;
  let aborted = false;
  const guideGetIds: string[] = [];
  const processPromptsInjected: string[] = [];
  const preflightDecisions: SessionResult['preflightDecisions'] = [];
  const evidenceLedger: SessionResult['evidenceLedger'] = [];
  let exitDecision: SessionResult['exitDecision'] = null;

  const emit = (event: StampedStreamEvent) => {
    logEvent({ kind: 'stream', event });
    const anyEvent = event as unknown as Record<string, unknown>;
    const kind = anyEvent.kind;

    if (typeof anyEvent.step === 'number') step = Math.max(step, anyEvent.step as number);

    if (kind === 'context_usage') {
      const tokens = anyEvent.estimatedTokensUsed as number | undefined;
      if (typeof tokens === 'number') promptTokens = Math.max(promptTokens, tokens);
      if (promptTokens > maxPromptTokens) {
        // Orchestrator has no public abort(); we signal via isAborted callback.
        aborted = true;
      }
    }

    if (kind === 'tool_call_started') {
      const toolCallId = anyEvent.toolCallId as string | undefined;
      const rawName = (anyEvent.toolName ?? anyEvent.name) as string | undefined;
      const canonical = normalizeToolName(rawName);
      if (toolCallId && canonical) toolNameById.set(toolCallId, canonical);
      if (canonical) toolCallCounts[canonical] = (toolCallCounts[canonical] ?? 0) + 1;
    }

    if (kind === 'tool_call_args_complete') {
      const toolCallId = anyEvent.toolCallId as string | undefined;
      const canonical = toolCallId ? toolNameById.get(toolCallId) : undefined;
      if (canonical === 'guide.get') {
        const args = (anyEvent.arguments ?? anyEvent.args) as Record<string, unknown> | undefined;
        const ids = args?.ids;
        if (Array.isArray(ids))
          for (const id of ids) if (typeof id === 'string') guideGetIds.push(id);
      }
    }

    if (kind === 'tool_result') {
      const toolCallId = anyEvent.toolCallId as string | undefined;
      const canonical = toolCallId
        ? (toolNameById.get(toolCallId) ??
          normalizeToolName(anyEvent.toolName as string | undefined))
        : normalizeToolName(anyEvent.toolName as string | undefined);
      const result = anyEvent.result as { success?: boolean; error?: string } | undefined;
      if (canonical) {
        toolCalls.push({
          step,
          name: canonical,
          ok: Boolean(result?.success),
          errorMessage: result?.error,
        });
      }
    }

    // Phase D: drop the 04-19 dead listeners
    // (`process_prompt_injected`, `process_prompts_primed`). The
    // orchestrator never emitted those; they produced silent empty
    // arrays. The authoritative signal is `evidence_appended` with
    // `evidence.kind === 'process_prompt_activated'`, handled below.

    if (kind === 'evidence_appended') {
      const ev = anyEvent.evidence as { kind?: string; [k: string]: unknown } | undefined;
      if (ev && typeof ev === 'object') {
        evidenceLedger.push({ ...(ev as { kind: string; at: number }) });
        if (ev.kind === 'process_prompt_activated') {
          const key = (ev as { key?: unknown }).key;
          if (typeof key === 'string') processPromptsInjected.push(key);
        }
      }
    }

    if (kind === 'preflight_decision') {
      const specKey = anyEvent.specKey as string | undefined;
      const decision = anyEvent.decision as 'activated' | 'skipped' | undefined;
      if (specKey && decision) {
        preflightDecisions.push({ specKey, decision, step });
      }
    }

    if (kind === 'exit_decision') {
      const decisionRaw = anyEvent.decision as SessionResult['exitDecision'] | undefined;
      if (decisionRaw && typeof decisionRaw === 'object') {
        exitDecision = decisionRaw;
      }
    }

    if (kind === 'tool_question') {
      askUserCount++;
      const toolCallId = anyEvent.toolCallId as string;
      const reply = followUpQueue.shift() ?? genericFallback;
      if (followUpQueue.length === 0 || reply === genericFallback) askUserFallbacks++;
      else askUserConsumed++;
      // tool_question is emitted BEFORE the executor wires the
      // pendingQuestionResolver map entry (same microtask). Defer the answer
      // to a microtask so the resolver is in place when we call into it.
      queueMicrotask(() => {
        orchestrator.answerQuestion(toolCallId, reply);
        logEvent({ kind: 'harness_answered', toolCallId, reply });
      });
    }

    if (kind === 'tool_confirm') {
      const toolCallId = anyEvent.toolCallId as string;
      queueMicrotask(() => {
        orchestrator.confirmTool(toolCallId, true);
      });
    }
  };

  const started = Date.now();
  let outcome: SessionResult['outcome'] = 'completed';
  let error: string | undefined;
  try {
    await orchestrator.execute(persona.opener, context, emit, {
      history: [],
      isAborted: () => aborted,
      permissionMode: 'auto',
    });
  } catch (err) {
    if (aborted && promptTokens > maxPromptTokens) {
      outcome = 'budget-exceeded';
    } else {
      outcome = 'error';
      error = err instanceof Error ? err.message : String(err);
    }
  }
  if (aborted && outcome === 'completed') {
    outcome = 'budget-exceeded';
  }

  // Final canvas snapshot.
  const finalCanvas = env.canvasStore.get(canvasId);
  const finalNodeCount = finalCanvas?.nodes.length ?? 0;
  const finalEdgeCount = finalCanvas?.edges.length ?? 0;
  const stylePlateLocked =
    typeof finalCanvas?.settings?.stylePlate === 'string' &&
    finalCanvas.settings.stylePlate.trim().length > 0;

  await env.close();
  logStream.end();

  const exitOutcome = typeof exitDecision?.outcome === 'string' ? exitDecision.outcome : null;
  const contractSatisfied = exitOutcome === 'satisfied' || exitOutcome === 'informational_answered';
  const blockerRaw = exitDecision?.blocker;
  const blocker =
    blockerRaw && typeof blockerRaw === 'object' && 'kind' in blockerRaw
      ? String((blockerRaw as { kind?: unknown }).kind ?? '')
      : null;

  return {
    personaIndex: persona.index,
    personaSlug: persona.slug,
    archetype: persona.archetype,
    providerName: spec.name,
    outcome,
    error,
    steps: step,
    toolCalls,
    toolCallCounts,
    mockCallCounts: mockStats.calls,
    askUserCount,
    askUserAnswersConsumed: askUserConsumed,
    askUserFallbacksUsed: askUserFallbacks,
    promptTokensEstimated: promptTokens,
    finalNodeCount,
    finalEdgeCount,
    stylePlateLocked,
    promptGuidesLoadedViaGuideGet: guideGetIds,
    processPromptsInjected,
    preflightDecisions,
    evidenceLedger,
    exitDecision,
    contractSatisfied,
    exitOutcome,
    blocker,
    logFile,
    ms: Date.now() - started,
  };
}
