/**
 * Prompt guide type.
 *
 * The main-process `WORKFLOW_GUIDES` constant was removed in Phase A of the
 * skill-unification effort. All built-in and user-authored prompt guides now
 * live in the renderer's `skillDefinitions` slice and flow to main through
 * the `commander:chat` `promptGuides` payload. Main no longer carries its
 * own copy — see `mergePromptGuidesWithBuiltIns` in
 * `apps/desktop-main/src/ipc/handlers/commander-tool-deps.ts`, which is
 * now a pure dedupe passthrough.
 */
export interface PromptGuide {
  id: string;
  name: string;
  content: string;
}
