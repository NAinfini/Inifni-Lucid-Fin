# Commander extensibility (public API)

> Phase F, 2026-04-20.
> Status: stable. Anything not in this file is internal and may change without notice.

Commander's agent loop terminates based on two declarative primitives:

1. **`CompletionContract`** — what evidence a run must accumulate to be considered "satisfied".
2. **`ProcessPromptSpec`** — an activation rule that injects a system prompt (a.k.a. "process prompt") when certain conditions hold.

Both are registered at package-load time and consumed by the exit-decision engine at run end. No orchestrator changes are needed to add a new workflow or a new standalone process prompt.

---

## 1. `CompletionContract`

### Shape

```ts
import type { CompletionContract } from '@lucid-fin/application';

const myContract: CompletionContract = {
  id: 'my-workflow',              // stable, globally unique
  requiredCommits: [
    {
      kind: 'mutation_commit',
      toolName: 'canvas.batchCreate',
      argPredicate: (args) => {
        const nodes = (args as { nodes?: unknown[] }).nodes;
        return Array.isArray(nodes) && nodes.length > 0;
      },
    },
  ],
  acceptableSubstitutes: [         // optional; treated as alternates for satisfaction
    {
      kind: 'mutation_commit',
      toolName: 'canvas.updateNodes',
      argPredicate: () => true,
    },
  ],
  infoIntentExemption: false,      // true → informational intent is auto-satisfied
  blockingQuestionsAllowed: 1,     // max askUser calls before `ask_user_loop` fires
};
```

| Field | Meaning |
|---|---|
| `id` | Must equal the `RunIntent.workflow` string the classifier produces. Duplicate ids are rejected at `register()` time. |
| `requiredCommits` | Array of `CommitRequirement`s. Every entry must match at least one ledger event of kind `mutation_commit` with `toolName` === requirement's `toolName` and `argPredicate(args) === true`. |
| `acceptableSubstitutes` | Optional alternates. Satisfying any one entry counts for a requirement whose `toolName` is also in this list. Used for guide prose like "prefer X, but Y is acceptable". |
| `infoIntentExemption` | `true` for contracts whose work is pure reading / answering (e.g. `info-answer`). |
| `blockingQuestionsAllowed` | Caps `commander.askUser` count. Exceeding it produces an `ask_user_loop` blocker. |

### Registration

```ts
import { contractRegistry } from '@lucid-fin/application';
import { myContract } from './my-contract.js';

contractRegistry.register(myContract);
```

Rules:
- **Idempotent on identity.** Registering the same contract object twice is a no-op. Safe under double-imports and HMR.
- **Duplicate id, different object → throws.** Hard error at registration time.
- **`contractRegistry.unregister(id)`** removes a contract. Safe on unknown ids. Intended for tests; don't call from production code.

### Guide prose sync (CI)

`scripts/lint-contract-drift.ts` cross-checks each contract's `requiredCommits[*].toolName` (and `acceptableSubstitutes[*].toolName`) against the prose in `docs/ai-skills/workflows/<id>.md`'s **"## Terminal commitment"** section. A tool name present in the contract but missing from the guide prose fails `npm run lint`. If your plugin ships a guide, mirror the tool names in that section.

---

## 2. `ProcessPromptSpec`

### Shape

```ts
import type { ProcessPromptSpec } from '@lucid-fin/application';

export const myPromptSpec: ProcessPromptSpec = {
  key: 'my-standalone-prompt',
  lifecycle: 'sticky',        // 'sticky' | 'one-shot' | 'decaying'
  activationPredicate: (ctx) => {
    // `ctx` contains canvasSettings, requestedToolNames, currentStep, etc.
    return ctx.requestedToolNames.has('canvas.setSettings');
  },
  content: (ctx) => {
    // Return the system message body to inject, or null to skip.
    return 'Remember to preserve the user-specified style plate when calling canvas.setSettings.';
  },
};
```

### Lifecycle

| Lifecycle | Behavior |
|---|---|
| `sticky` | Injected once, stays for the rest of the run. Default for phase-critical prompts. |
| `one-shot` | Injected once, removed on the next iteration. |
| `decaying` | Stripped after a fixed number of steps without reactivation. |

### Evaluation

`evaluateProcessPromptSpecs(specs, ctx, alreadyActivated)` is a pure function that returns the list of specs whose predicate fires THIS step AND that have not yet been activated. The orchestrator calls this every loop iteration; specs are stateless.

Swallowed failures: if a predicate or content builder throws, the spec is silently skipped for that iteration. This is intentional — plugins must not crash the agent loop.

### Registration

There is no separate registry for specs. The orchestrator seeds its spec list at construction time via `createAgentOrchestratorForRun({ ... })`. To add a built-in spec, include it alongside `createStylePlateLockSpec` in the factory. Runtime registration of specs is not currently supported — open an issue if you need it.

---

## 3. Stable extension points

The `@lucid-fin/application` barrel exports the following (Phase F-frozen):

- **Functions**: `contractRegistry`, `decide`, `classifyIntent`, `evaluateProcessPromptSpecs`, `createStylePlateLockSpec`.
- **Types**: `RunIntent`, `CompletionContract`, `CompletionEvidence`, `ExitDecision`, `BlockerReason`, `ReadonlyCompletionEvidenceList`, `CommitRequirement`, `SuccessSignal`, `ExitOutcomeKind`, `ProcessPromptSpec`, `ProcessPromptLifecycle`, `ActivationContext`, `ProcessPromptEvaluationResult`.

Anything else in `packages/application/src/agent/exit-contract/**` is `@internal` and may change in any release. `public-surface.test.ts` enforces this at CI time.

---

## 4. Minimal plugin example

```ts
// my-plugin.ts
import {
  contractRegistry,
  type CompletionContract,
} from '@lucid-fin/application';

const summarizeSeriesContract: CompletionContract = {
  id: 'summarize-series',
  requiredCommits: [
    {
      kind: 'mutation_commit',
      toolName: 'series.writeSummary',
      argPredicate: (args) => typeof (args as { summary?: unknown }).summary === 'string',
    },
  ],
  infoIntentExemption: false,
  blockingQuestionsAllowed: 0,
};

contractRegistry.register(summarizeSeriesContract);
```

Import `my-plugin.js` once from your main bundle. The `contractRegistry.select()` call at run start will pick it up automatically whenever the classifier emits `{ kind: 'execution', workflow: 'summarize-series' }`.

---

## 5. Testing a plugin

See `packages/application/src/agent/exit-contract/plugin-extensibility.test.ts` for a minimal end-to-end template: register a contract, run `classify → select → decide`, assert the outcome. Use `contractRegistry.unregister(id)` in `afterEach` to avoid cross-test leakage.
