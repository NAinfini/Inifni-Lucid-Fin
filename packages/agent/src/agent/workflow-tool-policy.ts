import type { WorkflowApprovalGateKey } from '@lucid-fin/contracts';
import { getToolCompactionCategory } from '@lucid-fin/shared-utils';

export type WorkflowToolPolicyPhase =
  | 'unbound'
  | 'production_plan_pending'
  | 'production_plan_revision'
  | 'style_exploration'
  | 'visual_constitution_pending'
  | 'preproduction'
  | 'media_generation'
  | 'assembly'
  | 'final_export_preparation'
  | 'final_export_pending'
  | 'final_export_approved'
  | 'blocked';

/**
 * Host-derived authorization projection for the workflow bound to the active
 * canvas. It is rebuilt from SQLite; renderer state and model-authored text
 * are never authoritative inputs.
 */
export interface WorkflowToolPolicy {
  workflowRunId?: string;
  phase: WorkflowToolPolicyPhase;
  gate?: WorkflowApprovalGateKey;
  rowVersion?: number;
  /** Host-derived current workflow task binding for durable AskUser decisions. */
  currentTaskRunId?: string;
  /** Host-resolved logical task/stage fields used for task-bound authorization. */
  currentTaskId?: string;
  currentTaskRole?: string;
  currentStageId?: string;
  /** Exact approved or pending subject revision that scopes decision idempotency. */
  subjectRevision?: number;
  reason?: string;
}

const MEDIA_GENERATION_TOOLS = new Set(['canvas.generation', 'entity.generateRefImage']);

const FINAL_EXPORT_TOOLS = new Set(['render.start', 'render.exportBundle']);

function isSafeCanvasGenerationAction(args: Record<string, unknown> | undefined): boolean {
  return args?.action === 'cancel' || args?.action === 'estimate';
}

function isMutation(toolName: string): boolean {
  return getToolCompactionCategory(toolName) === 'mutation';
}

function requestedToolNames(args: Record<string, unknown> | undefined): string[] {
  if (!args) return [];
  if (Array.isArray(args.names)) {
    return args.names.filter((name): name is string => typeof name === 'string');
  }
  return typeof args.name === 'string' ? [args.name] : [];
}

function mutatesMediaPrompt(args: Record<string, unknown> | undefined): boolean {
  if (!args) return false;
  const setHasPrompt = (value: unknown): boolean => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const set = value as Record<string, unknown>;
    return 'prompt' in set || 'negativePrompt' in set;
  };
  if (setHasPrompt(args.set)) return true;
  return (
    Array.isArray(args.nodes) &&
    args.nodes.some(
      (entry) =>
        !!entry &&
        typeof entry === 'object' &&
        !Array.isArray(entry) &&
        setHasPrompt((entry as Record<string, unknown>).set),
    )
  );
}

function mutatesCanvasStyle(args: Record<string, unknown> | undefined): boolean {
  if (!args) return false;
  const hasStyleField = (value: unknown): boolean => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const record = value as Record<string, unknown>;
    return 'visualStylePolicy' in record || 'stylePlate' in record || 'negativePrompt' in record;
  };
  return hasStyleField(args) || hasStyleField(args.settings);
}

function hasApprovedVisualConstitution(phase: WorkflowToolPolicyPhase): boolean {
  return (
    phase === 'preproduction' ||
    phase === 'media_generation' ||
    phase === 'assembly' ||
    phase === 'final_export_preparation' ||
    phase === 'final_export_pending' ||
    phase === 'final_export_approved'
  );
}

/**
 * Return a user-actionable denial reason, or null when the tool call is
 * permitted. This function is used twice: to hide schemas before the LLM
 * request and immediately before execution to reject forged/stale calls.
 */
export function getWorkflowToolDenial(
  policy: WorkflowToolPolicy | undefined,
  toolName: string,
  args?: Record<string, unknown>,
): string | null {
  if (toolName === 'workflow.visual' && (!policy || policy.phase === 'unbound')) {
    return 'Style auditions require a persistent video workflow whose exact Production Plan has been approved.';
  }
  if (toolName === 'workflow.media' && (!policy || policy.phase === 'unbound')) {
    return 'Production media requires a persistent video workflow with exact approved Production Plan and Visual Constitution revisions.';
  }
  if (toolName === 'workflow.mediaFeedback' && (!policy || policy.phase === 'unbound')) {
    return 'Incremental production-media feedback requires an active persistent video workflow and an exact prior attempt.';
  }
  if (toolName === 'workflow.finalExport' && (!policy || policy.phase === 'unbound')) {
    return 'Final Export preparation requires a persistent video workflow with exact approved Production Plan and Visual Constitution revisions.';
  }
  if (!policy || policy.phase === 'unbound') return null;

  // Direct estimate/cancel calls remain safe, but an argument-less policy
  // check must not expose the combined start/refine schema inside a bound
  // workflow. Paid workflow media has dedicated phase tools.
  if (toolName === 'canvas.generation' && args && isSafeCanvasGenerationAction(args)) {
    return null;
  }

  if (
    toolName === 'canvas.setSettings' &&
    mutatesCanvasStyle(args) &&
    hasApprovedVisualConstitution(policy.phase)
  ) {
    return 'The approved Visual Constitution is the only style authority for this persistent workflow. Request a Visual Constitution revision instead of editing the Canvas draft.';
  }

  if (policy.phase === 'final_export_approved' && MEDIA_GENERATION_TOOLS.has(toolName)) {
    return 'The approved persistent workflow is frozen. Create a workflow revision instead of starting untracked Canvas media generation.';
  }

  if (toolName === 'workflow.manage') {
    if (args?.action === 'createProductionPlan') {
      return `Persistent video workflow ${policy.workflowRunId ?? ''} is already active for this canvas. Resume or inspect that run instead of creating a second Production Plan.`;
    }
    if (args?.action === 'reviseProductionPlan' && policy.phase !== 'production_plan_revision') {
      return 'A revised Production Plan can be submitted only after the user requests changes at that same gate.';
    }
    if (
      args?.action === 'completeCurrentTask' &&
      policy.phase !== 'preproduction' &&
      policy.phase !== 'assembly'
    ) {
      return 'Only the current pre-production or assembly creative task can be self-reported complete; media and gate producers require host-verified completion.';
    }
  }

  if (toolName === 'workflow.visual' && policy.phase !== 'style_exploration') {
    return policy.phase === 'production_plan_pending'
      ? 'Production Plan approval is required before style auditions.'
      : policy.phase === 'visual_constitution_pending'
        ? 'The exact Visual Constitution revision is awaiting user approval; style auditions are frozen.'
        : 'Style auditions are available only during the bounded style-exploration phase.';
  }

  if (
    toolName === 'workflow.media' &&
    policy.phase !== 'media_generation' &&
    !(policy.phase === 'preproduction' && policy.currentTaskRole === 'references')
  ) {
    return 'Task-bound media is available only for the current reference-assets or production-shot task after the exact Visual Constitution is approved.';
  }

  if (
    toolName === 'workflow.mediaFeedback' &&
    policy.phase !== 'preproduction' &&
    policy.phase !== 'media_generation' &&
    policy.phase !== 'assembly'
  ) {
    return 'Incremental media feedback is available only before assembly has started, using the exact latest attempt and prompt hash.';
  }

  if (
    toolName === 'canvas.updateNodes' &&
    mutatesMediaPrompt(args) &&
    hasApprovedVisualConstitution(policy.phase)
  ) {
    return 'Do not overwrite a persistent-workflow media prompt. Use workflow.mediaFeedback so the host applies an immutable additive delta to the exact prior provider prompt.';
  }

  if (toolName === 'workflow.finalExport' && policy.phase !== 'final_export_preparation') {
    return policy.phase === 'final_export_pending'
      ? 'The exact Final Export manifest is frozen while awaiting user approval.'
      : policy.phase === 'final_export_approved'
        ? 'The exact Final Export manifest is already approved; use render.start with its revision and hash.'
        : 'Final Export can be prepared only after media generation, grading, and assembly are complete.';
  }

  if (toolName === 'tool.get') {
    const blockedRequest = requestedToolNames(args).find(
      (requested) => getWorkflowToolDenial(policy, requested) !== null,
    );
    return blockedRequest
      ? `Tool '${blockedRequest}' is unavailable at workflow phase '${policy.phase}'. Complete the required human approval gate first.`
      : null;
  }

  if (toolName === 'workflow.manage' || toolName === 'render.cancel') return null;

  switch (policy.phase) {
    case 'production_plan_pending':
      return isMutation(toolName)
        ? 'Production Plan approval is pending. Mutating, generation, and export tools are locked until the user approves the exact plan revision in the approval UI.'
        : null;

    case 'production_plan_revision':
      return isMutation(toolName)
        ? 'The rejected Production Plan must be revised through workflow.manage before other mutations continue.'
        : null;

    case 'style_exploration':
    case 'visual_constitution_pending':
      if (MEDIA_GENERATION_TOOLS.has(toolName)) {
        return 'Visual Constitution approval is required before general character, shot, image, or video generation. Use the dedicated bounded style-audition workflow instead.';
      }
      return FINAL_EXPORT_TOOLS.has(toolName)
        ? 'Final export is unavailable before the Visual Constitution and media workflow are complete.'
        : null;

    case 'media_generation':
      if (toolName === 'canvas.generation' || toolName === 'entity.generateRefImage') {
        return 'Persistent workflow media, including character/location reference sheets, must use a canvas image node plus workflow.media so Generation Specs, provider attempts, grading evidence, and Repair Deltas are durable.';
      }
      return FINAL_EXPORT_TOOLS.has(toolName)
        ? 'The final export gate has not been approved. Finish generation and grading, then request approval for the exact export manifest.'
        : null;

    case 'preproduction':
      if (MEDIA_GENERATION_TOOLS.has(toolName)) {
        return 'Reference assets must use a canvas image node plus workflow.media so attempts and grading evidence remain durable.';
      }
      return FINAL_EXPORT_TOOLS.has(toolName)
        ? 'Final export is unavailable until pre-production, media generation, evaluation, and assembly complete.'
        : null;

    case 'assembly':
      if (toolName === 'workflow.media' || MEDIA_GENERATION_TOOLS.has(toolName)) {
        return 'All planned shots are complete; assembly may arrange accepted assets but cannot create untracked media.';
      }
      return FINAL_EXPORT_TOOLS.has(toolName)
        ? 'Complete the durable assembly task before preparing Final Export.'
        : null;

    case 'final_export_preparation':
      if (toolName === 'workflow.media' || MEDIA_GENERATION_TOOLS.has(toolName)) {
        return 'Media is frozen while preparing the exact Final Export manifest.';
      }
      return FINAL_EXPORT_TOOLS.has(toolName)
        ? 'Prepare and approve the exact Final Export manifest before rendering.'
        : null;

    case 'final_export_pending':
      return isMutation(toolName)
        ? 'The exact final export revision is awaiting user approval. The candidate is frozen; only read and inspection tools are available.'
        : null;

    case 'final_export_approved':
      return null;

    case 'blocked':
      return isMutation(toolName)
        ? (policy.reason ??
            'Persistent workflow state could not be verified. Mutating tools are fail-closed until SQLite state is readable and consistent.')
        : null;
  }
}
