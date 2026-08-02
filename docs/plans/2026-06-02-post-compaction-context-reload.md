# Post-Compaction Context Reload Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** After context compaction, re-inject critical workspace context (entities, canvas state, style plate status) that was lost when old messages were summarized — analogous to how Claude Code's `SessionStart` hook re-fires on `"compact"` events to re-inject context from the filesystem.

**Architecture:** Add an optional `onPostCompact` callback to `ContextManager` that the orchestrator supplies at construction time. After any LLM compaction (Phase 2), the callback is invoked to produce a fresh context block. This block is appended to the compaction summary message so the model starts fresh with accurate workspace state. The callback is wired in the orchestrator factory, fed by the same `buildWorkspaceSnapshot` function that produces the initial Layer 2 context. No new event types — the existing `phase_note` with code `'compacted'` is emitted with a `reloaded: true` param.

**Tech Stack:** TypeScript, vitest, existing `ContextManager` / `AgentOrchestrator` / `orchestrator-factory` / `commander-context.service`

---

## Task 1: Add `onPostCompact` callback to ContextManager

**Files:**

- Modify: `packages/agent/src/agent/context-manager.ts` (ContextManagerOptions interface, constructor, compactWithLLM method)
- Test: `packages/agent/src/agent/context-manager.test.ts`

### Step 1: Write the failing test

```typescript
// In context-manager.test.ts — add a new describe block

describe('compactWithLLM post-compact reload', () => {
  it('appends onPostCompact output after LLM summary', async () => {
    const mockLlm = {
      complete: vi.fn().mockResolvedValue('[done] Created 2 nodes\n[entities] node-abc'),
      id: 'mock',
    } as unknown as LLMAdapter;
    const resolvePrompt = () => 'system prompt';
    const onPostCompact = vi.fn().mockReturnValue('## Workspace Reload\nCanvas: "test" (5 nodes)');

    const cm = new ContextManager(mockLlm, resolvePrompt, { onPostCompact });

    // Build messages array that exceeds the char budget
    const messages: LLMMessage[] = [
      { role: 'system', content: 'system prompt' },
      // 8 old exchanges to exceed budget
      ...Array.from({ length: 16 }, (_, i) => ({
        role: (i % 2 === 0 ? 'assistant' : 'user') as 'assistant' | 'user',
        content: 'x'.repeat(10000),
      })),
      // Recent messages
      { role: 'user', content: 'latest message' },
    ];

    await cm.compactWithLLM(messages, 20000);

    expect(onPostCompact).toHaveBeenCalledOnce();
    // The compacted message should contain both the LLM summary and the reload block
    const compactedMsg = messages.find((m) => m.content.includes('Context compacted'));
    expect(compactedMsg).toBeDefined();
    expect(compactedMsg!.content).toContain('Workspace Reload');
    expect(compactedMsg!.content).toContain('Canvas: "test" (5 nodes)');
  });

  it('skips reload gracefully when onPostCompact is not provided', async () => {
    const mockLlm = {
      complete: vi.fn().mockResolvedValue('[done] Created 2 nodes'),
      id: 'mock',
    } as unknown as LLMAdapter;
    const resolvePrompt = () => 'system prompt';
    const cm = new ContextManager(mockLlm, resolvePrompt);

    const messages: LLMMessage[] = [
      { role: 'system', content: 'system prompt' },
      ...Array.from({ length: 16 }, (_, i) => ({
        role: (i % 2 === 0 ? 'assistant' : 'user') as 'assistant' | 'user',
        content: 'x'.repeat(10000),
      })),
      { role: 'user', content: 'latest message' },
    ];

    await cm.compactWithLLM(messages, 20000);
    // Should not throw, compacted message should not contain reload header
    const compactedMsg = messages.find((m) => m.content.includes('Context compacted'));
    expect(compactedMsg).toBeDefined();
    expect(compactedMsg!.content).not.toContain('Workspace Reload');
  });

  it('skips reload when onPostCompact returns empty string', async () => {
    const mockLlm = {
      complete: vi.fn().mockResolvedValue('[done] Created 2 nodes'),
      id: 'mock',
    } as unknown as LLMAdapter;
    const resolvePrompt = () => 'system prompt';
    const onPostCompact = vi.fn().mockReturnValue('');
    const cm = new ContextManager(mockLlm, resolvePrompt, { onPostCompact });

    const messages: LLMMessage[] = [
      { role: 'system', content: 'system prompt' },
      ...Array.from({ length: 16 }, (_, i) => ({
        role: (i % 2 === 0 ? 'assistant' : 'user') as 'assistant' | 'user',
        content: 'x'.repeat(10000),
      })),
      { role: 'user', content: 'latest message' },
    ];

    await cm.compactWithLLM(messages, 20000);
    const compactedMsg = messages.find((m) => m.content.includes('Context compacted'));
    expect(compactedMsg).toBeDefined();
    expect(compactedMsg!.content).not.toContain('Workspace Reload');
  });
});
```

### Step 2: Run test to verify it fails

Run: `npx vitest run packages/agent/src/agent/context-manager.test.ts --reporter=verbose`
Expected: FAIL — `ContextManager` constructor does not accept `onPostCompact` option.

### Step 3: Implement the `onPostCompact` callback

In `packages/agent/src/agent/context-manager.ts`:

**3a.** Add `onPostCompact` to the options interface:

```typescript
// Modify ContextManagerOptions (around line 535)
export interface ContextManagerOptions {
  maxContextChars?: number;
  /** Called after LLM compaction completes. Return a string block to inject
   *  into the compacted message (e.g. fresh workspace snapshot). Empty/null
   *  strings are silently skipped. */
  onPostCompact?: () => string | null;
}
```

**3b.** Store the callback in the constructor — no changes needed, `this._opts` already stores the full options object.

**3c.** After the LLM summary is spliced in, invoke the callback and append:

```typescript
// In compactWithLLM, after the messages.splice call (around line 762-769):
const reloadBlock = this._opts?.onPostCompact?.();
const reloadSuffix =
  reloadBlock && reloadBlock.trim().length > 0
    ? `\n\n--- WORKSPACE CONTEXT RELOAD (fresh from current state) ---\n${reloadBlock}`
    : '';

messages.splice(1, keepFromIndex - 1, {
  role: 'user',
  content:
    `[Context compacted — ${oldMessages.length} messages summarized by AI]\n` +
    'The AI assistant previously worked on this task and produced the following summary. ' +
    'Use this to build on the work already done and avoid duplicating effort.\n\n' +
    summary +
    reloadSuffix,
});
```

### Step 4: Run tests to verify they pass

Run: `npx vitest run packages/agent/src/agent/context-manager.test.ts --reporter=verbose`
Expected: All tests PASS (11 existing + 3 new = 14 total)

### Step 5: Run typecheck

Run: `npx tsc --noEmit -p packages/agent/tsconfig.json`
Expected: Clean

### Step 6: Commit

```bash
git add packages/agent/src/agent/context-manager.ts packages/agent/src/agent/context-manager.test.ts
git commit -m "feat(agent): add onPostCompact callback to ContextManager for post-compaction context reload"
```

---

## Task 2: Wire `onPostCompact` in the orchestrator factory

**Files:**

- Modify: `packages/agent/src/agent/orchestrator-factory.ts` (factory input, construction)
- Modify: `packages/agent/src/agent/agent-orchestrator.ts` (pass through to ContextManager, emit phase_note)
- Test: `packages/agent/src/agent/agent-orchestrator.test.ts`

### Step 1: Write the failing test

```typescript
// In agent-orchestrator.test.ts — add a new describe block

describe('post-compaction context reload', () => {
  it('emits compacted phase_note with reloaded=true when onPostCompact is wired', async () => {
    // This test requires a multi-step execution that triggers compaction.
    // Use a mock adapter that returns tool calls for many steps to fill context,
    // then verify that after compaction the phase_note includes reloaded: true.
    // (The exact setup depends on your existing test helpers — follow the pattern
    // from the "compacts tool definitions before sending them to the LLM" test.)
    // Minimal assertion: verify the factory accepts onPostCompact in options
    // and passes it through to ContextManager.
    // This is a wiring/integration test, not a unit test of the callback itself.
  });
});
```

Note: the exact test fixture depends heavily on the existing mock adapter patterns in the orchestrator test file. The test should verify that `onPostCompact` supplied via the factory's `OrchestratorFactoryInput` reaches the `ContextManager` constructor. Since the ContextManager tests already verify the callback's behavior, this test focuses on wiring only.

### Step 2: Add `onPostCompact` to `OrchestratorFactoryInput`

In `packages/agent/src/agent/orchestrator-factory.ts`:

```typescript
// Add to OrchestratorFactoryInput interface (around line 63)
  /** Called after LLM-based context compaction. Returns fresh workspace context
   *  to inject into the compacted message. Wired by commander.handlers.ts. */
  onPostCompact?: () => string | null;
```

### Step 3: Pass through to ContextManager in factory function

In `packages/agent/src/agent/orchestrator-factory.ts`, find where `ContextManager` is constructed (or where the `resolvePrompt` + options are passed to the `AgentOrchestrator` constructor) and pass `onPostCompact` into the options:

```typescript
// In createAgentOrchestratorForRun (wherever ContextManager options are built):
const contextManagerOpts = {
  onPostCompact: input.onPostCompact,
};
```

### Step 4: Emit `phase_note` with `'compacted'` code after compaction

In `packages/agent/src/agent/agent-orchestrator.ts`, at the compaction trigger site (lines 1157-1163), emit a `phase_note` after compaction succeeds:

```typescript
if (utilizationRatio > 0.95) {
  const didCompact = await this.contextManager.compactWithLLM(messages, inLoopCharBudget);
  if (didCompact) {
    wrappedEmit({
      kind: 'phase_note',
      note: 'compacted',
      params: { phase: 'llm', reloaded: !!this._opts?.onPostCompact },
    });
  }
} else if (utilizationRatio > 0.9) {
  const didCompact = this.contextManager.compactPhase1(messages);
  if (didCompact) {
    wrappedEmit({
      kind: 'phase_note',
      note: 'compacted',
      params: { phase: 'phase1', reloaded: false },
    });
  }
}
```

Note: `compactWithLLM` already returns `boolean`. `compactPhase1` already returns `boolean`. Just capture the return values.

### Step 5: Run all agent tests

Run: `npx vitest run packages/agent/src/agent/agent-orchestrator.test.ts --reporter=verbose`
Expected: All 44+ tests PASS

### Step 6: Run typecheck

Run: `npx tsc --noEmit -p packages/agent/tsconfig.json`
Expected: Clean

### Step 7: Commit

```bash
git add packages/agent/src/agent/orchestrator-factory.ts packages/agent/src/agent/agent-orchestrator.ts packages/agent/src/agent/agent-orchestrator.test.ts
git commit -m "feat(agent): wire onPostCompact through orchestrator factory, emit compacted phase_note"
```

---

## Task 3: Supply the callback from commander handlers

**Files:**

- Modify: `apps/desktop-main/src/ipc/handlers/commander.handlers.ts` (where `createAgentOrchestratorForRun` is called)
- Existing: `apps/desktop-main/src/ipc/handlers/commander-context.service.ts` (`buildWorkspaceSnapshot`)

### Step 1: Locate the factory call site

In `apps/desktop-main/src/ipc/handlers/commander.handlers.ts`, find where `createAgentOrchestratorForRun` is called (around line 88-120). The call already has access to `canvas`, `db`, and `selectedNodeIds` from the handler scope.

### Step 2: Add onPostCompact to the factory input

```typescript
const orchestrator = createAgentOrchestratorForRun({
  variant: 'production',
  llmAdapter: adapter,
  toolRegistry: registry,
  resolvePrompt,
  canvasStore,
  onPostCompact: () => {
    try {
      // Re-read current canvas state — may have changed during the run
      const currentCanvas = canvasStore?.get(canvasId);
      if (!currentCanvas) return null;
      // Build fresh snapshot from live database state
      return buildWorkspaceSnapshot(currentCanvas as Canvas, selectedNodeIds, db);
    } catch {
      return null;
    }
  },
  options: {/* existing options */},
});
```

The key insight: `buildWorkspaceSnapshot` reads from the _live_ database (entity counts, ref-image status, canvas node counts). After compaction, entities may have been created/modified during the run — the reload captures the _current_ state, not the stale initial state.

### Step 3: Verify the import

Ensure `buildWorkspaceSnapshot` is already imported in `commander.handlers.ts`. It's defined in `commander-context.service.ts` and likely already imported. If not:

```typescript
import { buildContext, buildWorkspaceSnapshot } from './commander-context.service.js';
```

### Step 4: Run typecheck

Run: `npx tsc --noEmit -p apps/desktop-main/tsconfig.json`
Expected: Clean

### Step 5: Run lint

Run: `npx eslint apps/desktop-main/src/ipc/handlers/commander.handlers.ts --max-warnings=0`
Expected: Clean

### Step 6: Commit

```bash
git add apps/desktop-main/src/ipc/handlers/commander.handlers.ts
git commit -m "feat(commander): supply onPostCompact with live workspace snapshot at factory call site"
```

---

## Task 4: Also reload in `compactNow` (explicit compaction via tool.compact / UI)

**Files:**

- Modify: `packages/agent/src/agent/context-manager.ts` (`compactNow` method)
- Test: `packages/agent/src/agent/context-manager.test.ts`

### Step 1: Write the failing test

```typescript
describe('compactNow post-compact reload', () => {
  it('appends reload block after explicit compactNow', async () => {
    const mockLlm = {
      complete: vi.fn().mockResolvedValue('[done] Work summary'),
      id: 'mock',
    } as unknown as LLMAdapter;
    const onPostCompact = vi.fn().mockReturnValue('## Reload\nFresh state');
    const cm = new ContextManager(mockLlm, () => 'sys', { onPostCompact });

    const messages: LLMMessage[] = [
      { role: 'system', content: 'system prompt' },
      ...Array.from({ length: 20 }, (_, i) => ({
        role: (i % 2 === 0 ? 'assistant' : 'user') as 'assistant' | 'user',
        content: 'x'.repeat(5000),
      })),
    ];

    await cm.compactNow(messages);
    expect(onPostCompact).toHaveBeenCalled();
    const reloadMsg = messages.find((m) => m.content.includes('Fresh state'));
    expect(reloadMsg).toBeDefined();
  });
});
```

### Step 2: Run test to verify it fails

Run: `npx vitest run packages/agent/src/agent/context-manager.test.ts --reporter=verbose`
Expected: FAIL — `compactNow` doesn't call `onPostCompact` yet.

### Step 3: Implement

`compactNow` delegates to `compactWithLLM` which already calls `onPostCompact`. However, if the LLM phase is skipped (Phase 1 was sufficient), we should still reload. Add after the Phase 2 block in `compactNow`:

```typescript
// In compactNow, after the Phase 2 block (around line 806-807):
// If Phase 2 was skipped (Phase 1 freed enough), still inject a
// post-compact reload since old query results were deleted.
if (afterPhase1 <= targetBudget && this._opts?.onPostCompact) {
  const reloadBlock = this._opts.onPostCompact();
  if (reloadBlock && reloadBlock.trim().length > 0) {
    messages.push({
      role: 'user',
      content: `--- WORKSPACE CONTEXT RELOAD (fresh from current state) ---\n${reloadBlock}`,
    });
  }
}
```

### Step 4: Run tests to verify they pass

Run: `npx vitest run packages/agent/src/agent/context-manager.test.ts --reporter=verbose`
Expected: All tests PASS

### Step 5: Commit

```bash
git add packages/agent/src/agent/context-manager.ts packages/agent/src/agent/context-manager.test.ts
git commit -m "feat(agent): invoke onPostCompact in explicit compactNow path"
```

---

## Task 5: Final integration verification

**Files:** None created/modified — verification only.

### Step 1: Run full agent package tests

Run: `npx vitest run packages/agent/ --reporter=verbose`
Expected: All tests PASS

### Step 2: Run prompt-compiler tests (no regressions)

Run: `npx vitest run packages/application/src/prompt-compiler.test.ts --reporter=verbose`
Expected: All 27 tests PASS

### Step 3: Run generation prompt-compiler tests

Run: `npx vitest run apps/desktop-main/src/ipc/handlers/generation-prompt-compiler.test.ts --reporter=verbose`
Expected: All 60 tests PASS

### Step 4: Full typecheck

Run: `npx tsc --noEmit -p packages/agent/tsconfig.json && npx tsc --noEmit -p packages/application/tsconfig.json && npx tsc --noEmit -p apps/desktop-main/tsconfig.json`
Expected: All clean

### Step 5: Lint all changed files

Run: `npx eslint packages/agent/src/agent/context-manager.ts packages/agent/src/agent/agent-orchestrator.ts packages/agent/src/agent/orchestrator-factory.ts apps/desktop-main/src/ipc/handlers/commander.handlers.ts --max-warnings=0`
Expected: Clean

### Step 6: Final commit (if any fixups needed)

```bash
git add -A
git commit -m "chore: integration verification for post-compaction context reload"
```

---

## Summary: What This Achieves

| Before                                                              | After                                                                                |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| After compaction, the model has only an LLM summary of old work     | After compaction, the model gets the LLM summary **plus a fresh workspace snapshot** |
| Entity counts, ref-image status, style plate — all from memory only | Entity counts, ref-image status, style plate — re-read from live database            |
| Canvas state after 20 tool calls? Whatever the LLM remembers        | Canvas state after 20 tool calls? Accurate node/edge counts from current canvas      |
| `tool.compact` (explicit) has no reload path                        | `tool.compact` also triggers reload                                                  |
| No event emitted on compaction                                      | `phase_note` with `'compacted'` code and `reloaded` flag                             |

### Design decisions

1. **Callback, not event bus** — A simple `() => string | null` callback is the minimum viable hook. No new event types, no new interfaces beyond the existing `ContextManagerOptions`. If we need richer hooks later (multiple handlers, async, priority), we upgrade to an event emitter — but YAGNI for now.

2. **Injected into the compacted message, not as a separate message** — Keeping it in the same user message as the LLM summary means the model sees it as context, not as a new user instruction. A separate `role: 'user'` message would be interpreted as a new turn.

3. **`buildWorkspaceSnapshot` reuse** — The same function that produces the initial Layer 2 context is called again at compaction time. No new code to maintain; if the snapshot format changes, both initial and reload paths update together.

4. **Graceful degradation** — If the callback throws, returns null, or returns empty string, compaction proceeds normally with no reload. The model loses no more context than before this feature.
