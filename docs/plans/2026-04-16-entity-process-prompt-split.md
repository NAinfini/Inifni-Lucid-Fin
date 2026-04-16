# Entity Process Prompt Split Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Split the mixed entity-management process prompt into independent character, location, and equipment process prompts that inject separately into Commander.

**Architecture:** Replace the single shared process key with three dedicated keys in storage defaults, process detection, injected category allowlists, and settings UI trigger metadata. Keep the existing process-prompt store and IPC surface unchanged so only the process-key taxonomy changes.

**Tech Stack:** TypeScript, Vitest, Electron renderer, application agent orchestration, SQLite-backed process prompt store

---

### Task 1: Lock expected behavior with tests

**Files:**
- Modify: `packages/storage/src/process-prompt-store.test.ts`
- Modify: `packages/application/src/agent/process-detection.test.ts`
- Modify: `apps/desktop-renderer/src/components/settings/SettingsSections.test.tsx`
- Modify: `apps/desktop-renderer/src/pages/Settings.test.tsx`

**Steps:**
1. Write failing tests expecting `character-management`, `location-management`, and `equipment-management`.
2. Run the targeted test files and confirm failure is caused by the old `entity-management` key.

### Task 2: Replace the shared storage default

**Files:**
- Modify: `packages/storage/src/process-prompt-store.ts`

**Steps:**
1. Remove the `entity-management` default entry.
2. Add three independent default entries with domain-specific names, descriptions, and prompt content.
3. Keep the store API unchanged and preserve default seeding behavior.

### Task 3: Update injected process detection

**Files:**
- Modify: `packages/application/src/agent/process-detection.ts`
- Modify: `packages/application/src/agent/agent-orchestrator.ts`

**Steps:**
1. Extend the process category union and display names with the three new keys.
2. Map character/location/equipment create-update tools to their dedicated key.
3. Update the orchestrator’s allowed initial process categories list.

### Task 4: Update settings UI metadata and localization

**Files:**
- Modify: `apps/desktop-renderer/src/components/settings/processPromptTriggers.ts`
- Modify: `apps/desktop-renderer/src/i18n.messages.en-US.ts`
- Modify: `apps/desktop-renderer/src/i18n.messages.zh-CN.ts`

**Steps:**
1. Replace the shared trigger group with three dedicated trigger groups.
2. Add localized names and descriptions for the three new keys.
3. Verify the existing settings section renders the three separate cards without component changes.

### Task 5: Verify and review

**Files:**
- No new files

**Steps:**
1. Run targeted Vitest suites for storage, process detection, and settings UI.
2. Run a renderer type-check.
3. Review the diff to confirm only the intended process taxonomy changed.
