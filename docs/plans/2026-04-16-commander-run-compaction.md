# Commander Run Compaction Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make Commander show rich live feedback while a run is in progress, then automatically compact each completed assistant run into a collapsible summary card.

**Architecture:** Extend renderer-side `CommanderMessage` with run-level UI metadata instead of creating a parallel session structure. Generate summary data inside the commander Redux slice when a stream finishes or errors, and let `MessageList` render assistant messages as either live-expanded runs or compact summary cards with expandable details.

**Tech Stack:** React 19, Redux Toolkit, TypeScript strict mode, Vitest, Testing Library, Tailwind CSS.

---

### Task 1: Define run-level metadata on commander messages

**Files:**
- Modify: `apps/desktop-renderer/src/store/slices/commander.ts`
- Test: `apps/desktop-renderer/src/store/slices/commander.test.ts`

**Step 1: Write the failing test**

Add reducer tests that expect `finishStreaming` and `streamError` to save assistant messages with:
- `runMeta.status`
- `runMeta.collapsed`
- `runMeta.startedAt`
- `runMeta.completedAt`
- `runMeta.summary`

**Step 2: Run test to verify it fails**

Run: `npm test -- commander.test.ts`
Expected: FAIL because assistant messages do not yet include run metadata.

**Step 3: Write minimal implementation**

In `commander.ts`:
- Add run-summary types next to `CommanderMessage`
- Track stream start time in state
- Build summary stats from `currentSegments`, `currentToolCalls`, and `currentStreamContent`
- Store run metadata on finished/error assistant messages

**Step 4: Run test to verify it passes**

Run: `npm test -- commander.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/desktop-renderer/src/store/slices/commander.ts apps/desktop-renderer/src/store/slices/commander.test.ts
git commit -m "feat: add commander run metadata"
```

### Task 2: Render compact summary cards for completed assistant runs

**Files:**
- Modify: `apps/desktop-renderer/src/components/canvas/commander/MessageList.tsx`
- Modify: `apps/desktop-renderer/src/components/canvas/CommanderPanel.test.tsx`
- Test: `apps/desktop-renderer/src/components/canvas/CommanderPanel.test.tsx`

**Step 1: Write the failing test**

Add component tests that expect:
- streaming assistant output stays expanded
- completed assistant runs show a compact summary row
- clicking the summary expands detailed markdown/tool calls again

**Step 2: Run test to verify it fails**

Run: `npm test -- CommanderPanel.test.tsx`
Expected: FAIL because no summary card or expand/collapse UI exists yet.

**Step 3: Write minimal implementation**

In `MessageList.tsx`:
- Render user messages unchanged
- Render completed assistant messages with `runMeta.collapsed === true` as a summary header plus hidden detail body
- Keep live message rendering unchanged and always expanded
- Preserve tool cards and markdown in expanded state

**Step 4: Run test to verify it passes**

Run: `npm test -- CommanderPanel.test.tsx`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/desktop-renderer/src/components/canvas/commander/MessageList.tsx apps/desktop-renderer/src/components/canvas/CommanderPanel.test.tsx
git commit -m "feat: render compact commander run summaries"
```

### Task 3: Finalize summary copy, toggles, and edge cases

**Files:**
- Modify: `apps/desktop-renderer/src/store/slices/commander.ts`
- Modify: `apps/desktop-renderer/src/components/canvas/commander/MessageList.tsx`
- Modify: `apps/desktop-renderer/src/components/canvas/CommanderPanel.tsx`
- Modify: `apps/desktop-renderer/src/i18n.messages.en-US.ts`
- Modify: `apps/desktop-renderer/src/i18n.messages.zh-CN.ts`

**Step 1: Write the failing test**

Extend tests for:
- failed runs showing failure summary state
- runs with no tool calls still summarizing correctly
- summary row showing duration and tool counts

**Step 2: Run test to verify it fails**

Run: `npm test -- commander.test.ts CommanderPanel.test.tsx`
Expected: FAIL because summary labels/status badges are incomplete.

**Step 3: Write minimal implementation**

- Add localized labels for summary UI
- Add explicit toggle button text/aria labels
- Ensure question-history cards and existing message actions still render correctly when expanded

**Step 4: Run test to verify it passes**

Run: `npm test -- commander.test.ts CommanderPanel.test.tsx`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/desktop-renderer/src/store/slices/commander.ts apps/desktop-renderer/src/components/canvas/commander/MessageList.tsx apps/desktop-renderer/src/components/canvas/CommanderPanel.tsx apps/desktop-renderer/src/i18n.messages.en-US.ts apps/desktop-renderer/src/i18n.messages.zh-CN.ts
git commit -m "feat: polish commander run summary UI"
```

### Task 4: Verify and review

**Files:**
- Test: `apps/desktop-renderer/src/store/slices/commander.test.ts`
- Test: `apps/desktop-renderer/src/components/canvas/CommanderPanel.test.tsx`

**Step 1: Run focused test suite**

Run: `npm test -- commander.test.ts CommanderPanel.test.tsx`
Expected: PASS

**Step 2: Run renderer typecheck**

Run: `npx tsc --noEmit -p apps/desktop-renderer/tsconfig.json`
Expected: PASS

**Step 3: Review diff**

Run: `git diff -- apps/desktop-renderer/src/store/slices/commander.ts apps/desktop-renderer/src/components/canvas/commander/MessageList.tsx apps/desktop-renderer/src/components/canvas/CommanderPanel.tsx apps/desktop-renderer/src/i18n.messages.en-US.ts apps/desktop-renderer/src/i18n.messages.zh-CN.ts`
Expected: Only commander run-summary changes.

**Step 4: Commit**

```bash
git add docs/plans/2026-04-16-commander-run-compaction.md
git commit -m "docs: add commander run compaction plan"
```
