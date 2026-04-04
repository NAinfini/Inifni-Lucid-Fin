# Settings Model Shortlist Refresh Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the default Settings-page provider lists with the approved five-provider shortlist for LLM, image, video, and audio.

**Architecture:** Keep the change localized to the renderer settings defaults and settings-page provider metadata. Validate the shortlist with a reducer-level test so future config drift is caught without coupling the test to page rendering details.

**Tech Stack:** React, Redux Toolkit, Vitest, TypeScript

---

### Task 1: Lock the shortlist with a failing reducer test

**Files:**
- Create: `apps/desktop-renderer/src/store/slices/settings.test.ts`
- Modify: `apps/desktop-renderer/src/store/slices/settings.ts`

**Step 1: Write the failing test**

- Assert the initial reducer state exposes exactly 5 providers in each group.
- Assert the provider IDs and model strings match the approved shortlist.
- Assert the active provider defaults still point at the first flagship choice in each group.

**Step 2: Run test to verify it fails**

Run: `npm test -- --run apps/desktop-renderer/src/store/slices/settings.test.ts`

Expected: FAIL because the current defaults still contain stale providers/models and more than five entries.

### Task 2: Update settings defaults and provider URLs

**Files:**
- Modify: `apps/desktop-renderer/src/store/slices/settings.ts`
- Modify: `apps/desktop-renderer/src/pages/Settings.tsx`

**Step 1: Replace default providers**

- Trim each group to the approved 5-provider shortlist.
- Update provider names and model strings to the approved current defaults.
- Preserve existing slice actions and custom-provider support.

**Step 2: Update provider key URLs**

- Remove dead mappings for providers no longer shown in the shortlist.
- Add mappings for any newly surfaced providers in the shortlist, especially `runway-gen4` and `pika-v2`.

### Task 3: Verify and review

**Files:**
- Test: `apps/desktop-renderer/src/store/slices/settings.test.ts`

**Step 1: Run the targeted test**

Run: `npm test -- --run apps/desktop-renderer/src/store/slices/settings.test.ts`

Expected: PASS

**Step 2: Review for correctness**

- Confirm no other settings-page code assumes the removed providers still exist.
- Confirm active provider defaults still reference valid IDs.
- Confirm the URL map covers the full shortlist.
