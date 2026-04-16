# Commander Summary Card Layout Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Refine the completed Commander run summary card into a compact two-layer Codex-style layout with clearer status, metrics, and excerpt hierarchy.

**Architecture:** Keep the existing `runMeta` data model and change only the renderer presentation in `MessageList.tsx`. Add focused UI tests first so the card hierarchy is locked before styling changes.

**Tech Stack:** React 19, TypeScript, Tailwind CSS, Vitest, Testing Library.

---

### Task 1: Lock the compact summary hierarchy in tests

**Files:**
- Modify: `apps/desktop-renderer/src/components/canvas/commander/MessageList.test.tsx`

**Step 1: Write the failing test**

Add assertions for:
- separate status badge text
- separate duration/tool/error metrics
- collapsed excerpt remaining visible
- expanded body still rendering after toggle

**Step 2: Run test to verify it fails**

Run: `npm test -- MessageList.test.tsx`
Expected: FAIL because the current card hierarchy does not expose the refined layout hooks/content.

### Task 2: Implement the compact two-layer card

**Files:**
- Modify: `apps/desktop-renderer/src/components/canvas/commander/MessageList.tsx`

**Step 1: Write minimal implementation**

Update `RunSummaryCard` so it renders:
- top row with status badge on the left
- grouped metrics on the right
- separate excerpt row with smaller two-line summary text
- cleaner spacing and lighter border hierarchy

**Step 2: Run focused tests**

Run: `npm test -- MessageList.test.tsx`
Expected: PASS

### Task 3: Verify no regressions

**Files:**
- Test: `apps/desktop-renderer/src/components/canvas/commander/MessageList.test.tsx`
- Test: `apps/desktop-renderer/src/components/canvas/CommanderPanel.test.tsx`

**Step 1: Run focused UI tests**

Run: `npm test -- MessageList.test.tsx CommanderPanel.test.tsx`
Expected: PASS

**Step 2: Run renderer typecheck**

Run: `npx tsc --noEmit -p apps/desktop-renderer/tsconfig.json`
Expected: PASS
