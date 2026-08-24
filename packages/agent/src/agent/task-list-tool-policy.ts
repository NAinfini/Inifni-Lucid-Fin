import type { PlanApprovalGateKey } from '@lucid-fin/contracts';
import { getToolCompactionCategory } from '@lucid-fin/shared-utils';

export type TaskListToolPolicyPhase =
  | 'unbound'
  | 'production_plan_pending'
  | 'production_plan_revision'
  | 'style_exploration'
  | 'visual_constitution_pending'
  | 'preproduction'
  | 'media_generation'
  | 'assembly'
  | 'delivery_preparation'
  | 'delivery_pending'
  | 'delivery_approved'
  | 'blocked';

/**
 * Host-derived authorization projection for the task list bound to the active
 * canvas. It is rebuilt from SQLite; renderer state and model-authored text
 * are never authoritative inputs.
 */
export interface TaskListToolPolicy {
  taskListId?: string;
  phase: TaskListToolPolicyPhase;
  gate?: PlanApprovalGateKey;
  rowVersion?: number;
  /** Host-derived current task-list task binding for durable AskUser decisions. */
  currentTaskId?: string;
  /** Host-resolved logical task/phase fields used for task-bound authorization. */
  currentTaskKey?: string;
  currentTaskRole?: string;
  currentPhaseKey?: string;
  /** Exact approved or pending subject revision that scopes decision idempotency. */
  subjectRevision?: number;
  reason?: string;
}

const MEDIA_GENERATION_TOOLS = new Set(['canvas.generation']);

function isSafeCanvasGenerationAction(args: Record<string, unknown> | undefined): boolean {
  return args?.action === 'status' || args?.action === 'cancel' || args?.action === 'estimate';
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

function hasApprovedVisualConstitution(phase: TaskListToolPolicyPhase): boolean {
  return (
    phase === 'preproduction' ||
    phase === 'media_generation' ||
    phase === 'assembly' ||
    phase === 'delivery_preparation' ||
    phase === 'delivery_pending' ||
    phase === 'delivery_approved'
  );
}

/**
 * Return a user-actionable denial reason, or null when the tool call is
 * permitted. The executor applies this policy immediately before execution
 * so a stable provider tool catalog cannot bypass current durable state.
 */
export function getTaskListToolDenial(
  policy: TaskListToolPolicy | undefined,
  toolName: string,
  args?: Record<string, unknown>,
): string | null {
  // Audio Task Lists are independent durable runs bound to the same Canvas. Their own
  // service validates Task List and Prompt Assembly identity.
  if (toolName === 'task.audio') return null;

  if (toolName === 'task.visual' && (!policy || policy.phase === 'unbound')) {
    return 'Style auditions require a persistent video task list whose exact Production Plan has been approved.';
  }
  if (toolName === 'task.media' && (!policy || policy.phase === 'unbound')) {
    return 'Production media requires a persistent video task list with exact approved Production Plan and Visual Constitution revisions.';
  }
  if (toolName === 'task.mediaFeedback' && (!policy || policy.phase === 'unbound')) {
    return 'Incremental production-media feedback requires an active persistent video task list and an exact prior attempt.';
  }
  if (toolName === 'task.delivery' && (!policy || policy.phase === 'unbound')) {
    return 'Delivery preparation requires a persistent video task list with exact approved Production Plan and Visual Constitution revisions.';
  }
  if (!policy || policy.phase === 'unbound') return null;

  // Direct status/estimate/cancel calls remain safe, but an argument-less policy
  // check must not expose the combined prepare/submit schema inside a bound
  // task list. Paid task-list media has dedicated phase tools.
  if (toolName === 'canvas.generation' && args && isSafeCanvasGenerationAction(args)) {
    return null;
  }

  if (
    toolName === 'canvas.setSettings' &&
    mutatesCanvasStyle(args) &&
    hasApprovedVisualConstitution(policy.phase)
  ) {
    return 'The approved Visual Constitution is the only style authority for this persistent task list. Request a Visual Constitution revision instead of editing the Canvas draft.';
  }

  if (policy.phase === 'delivery_approved' && MEDIA_GENERATION_TOOLS.has(toolName)) {
    return 'The approved persistent task list is frozen. Create a task-list revision instead of starting untracked Canvas media generation.';
  }

  if (toolName === 'taskList.manage') {
    if (args?.action === 'createProductionPlan') {
      return `Persistent video task list ${policy.taskListId ?? ''} is already active for this canvas. Resume or inspect that task list instead of creating a second Production Plan.`;
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
    if (
      args?.action === 'decidePendingGate' &&
      policy.phase !== 'production_plan_pending' &&
      policy.phase !== 'visual_constitution_pending' &&
      policy.phase !== 'delivery_pending'
    ) {
      return 'A structured pending-gate decision is available only while an exact human approval revision is pending.';
    }
  }

  if (toolName === 'task.visual' && policy.phase !== 'style_exploration') {
    return policy.phase === 'production_plan_pending'
      ? 'Production Plan approval is required before style auditions.'
      : policy.phase === 'visual_constitution_pending'
        ? 'The exact Visual Constitution revision is awaiting user approval; style auditions are frozen.'
        : 'Style auditions are available only during the bounded style-exploration phase.';
  }

  if (
    toolName === 'task.media' &&
    policy.phase !== 'media_generation' &&
    !(policy.phase === 'preproduction' && policy.currentTaskRole === 'references')
  ) {
    return 'Task-bound media is available only for the current reference-assets or production-shot task after the exact Visual Constitution is approved.';
  }

  if (
    toolName === 'task.mediaFeedback' &&
    policy.phase !== 'preproduction' &&
    policy.phase !== 'media_generation' &&
    policy.phase !== 'assembly'
  ) {
    return 'Incremental media feedback is available only before Delivery preparation, using the exact latest attempt and prompt hash.';
  }

  if (
    toolName === 'canvas.updateNodes' &&
    mutatesMediaPrompt(args) &&
    hasApprovedVisualConstitution(policy.phase)
  ) {
    return 'Do not overwrite a persistent-task-list media prompt. Use task.mediaFeedback so the host applies an immutable additive delta to the exact prior provider prompt.';
  }

  if (toolName === 'task.delivery' && policy.phase !== 'delivery_preparation') {
    return policy.phase === 'delivery_pending'
      ? 'The exact Delivery manifest is frozen while awaiting user approval.'
      : policy.phase === 'delivery_approved'
        ? 'The exact Delivery manifest is already approved; packaging is available only from the host UI.'
        : 'Delivery can be prepared only after media generation, grading, and Ordered Delivery are complete.';
  }

  if (toolName === 'tool.get') {
    const blockedRequest = requestedToolNames(args).find(
      (requested) => getTaskListToolDenial(policy, requested) !== null,
    );
    return blockedRequest
      ? `Tool '${blockedRequest}' is unavailable at task-list phase '${policy.phase}'. Complete the required human approval gate first.`
      : null;
  }

  if (toolName === 'taskList.manage') return null;

  switch (policy.phase) {
    case 'production_plan_pending':
      return isMutation(toolName)
        ? 'Production Plan approval is pending. Mutating, generation, and Delivery tools are locked; taskList.manage decidePendingGate is the only structured approval-decision path.'
        : null;

    case 'production_plan_revision':
      return isMutation(toolName)
        ? 'The rejected Production Plan must be revised through taskList.manage before other mutations continue.'
        : null;

    case 'style_exploration':
    case 'visual_constitution_pending':
      if (MEDIA_GENERATION_TOOLS.has(toolName)) {
        return 'Visual Constitution approval is required before general character, shot, image, or video generation. Use the dedicated bounded style-audition task instead.';
      }
      return null;

    case 'media_generation':
      if (toolName === 'canvas.generation') {
        return 'Persistent task list media, including character/location reference sheets, must use a canvas image node plus task.media so Generation Specs, provider attempts, grading evidence, and Repair Deltas are durable.';
      }
      return null;

    case 'preproduction':
      if (MEDIA_GENERATION_TOOLS.has(toolName)) {
        return 'Reference assets must use a canvas image node plus task.media so attempts and grading evidence remain durable.';
      }
      return null;

    case 'assembly':
      if (toolName === 'task.media' || MEDIA_GENERATION_TOOLS.has(toolName)) {
        return 'All planned shots are complete; assembly may arrange accepted assets but cannot create untracked media.';
      }
      return null;

    case 'delivery_preparation':
      if (toolName === 'task.media' || MEDIA_GENERATION_TOOLS.has(toolName)) {
        return 'Media is frozen while preparing the exact Delivery manifest.';
      }
      return null;

    case 'delivery_pending':
      return isMutation(toolName)
        ? 'The exact Delivery revision is awaiting user approval. The candidate is frozen; only read and inspection tools are available.'
        : null;

    case 'delivery_approved':
      return isMutation(toolName)
        ? 'The exact Delivery manifest is approved and frozen. Start or manage packaging only from the host UI.'
        : null;

    case 'blocked':
      return isMutation(toolName)
        ? (policy.reason ??
            'Persistent task-list state could not be verified. Mutating tools are fail-closed until SQLite state is readable and consistent.')
        : null;
  }
}
