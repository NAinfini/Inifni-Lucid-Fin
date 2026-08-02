import type { WorkflowApprovalGateKey } from '@lucid-fin/contracts';
import { getToolCompactionCategory } from '@lucid-fin/shared-utils';

export type WorkflowToolPolicyPhase =
  | 'unbound'
  | 'production_plan_pending'
  | 'style_exploration'
  | 'visual_constitution_pending'
  | 'media_generation'
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
  reason?: string;
}

const MEDIA_GENERATION_TOOLS = new Set(['canvas.generation', 'entity.generateRefImage']);

const FINAL_EXPORT_TOOLS = new Set(['render.start', 'render.exportBundle']);

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
  if (toolName === 'workflow.finalExport' && (!policy || policy.phase === 'unbound')) {
    return 'Final Export preparation requires a persistent video workflow with exact approved Production Plan and Visual Constitution revisions.';
  }
  if (!policy || policy.phase === 'unbound') return null;

  if (toolName === 'workflow.manage' && args?.action === 'createProductionPlan') {
    return `Persistent video workflow ${policy.workflowRunId ?? ''} is already active for this canvas. Resume or inspect that run instead of creating a second Production Plan.`;
  }

  if (toolName === 'workflow.visual' && policy.phase !== 'style_exploration') {
    return policy.phase === 'production_plan_pending'
      ? 'Production Plan approval is required before style auditions.'
      : policy.phase === 'visual_constitution_pending'
        ? 'The exact Visual Constitution revision is awaiting user approval; style auditions are frozen.'
        : 'Style auditions are available only during the bounded style-exploration phase.';
  }

  if (toolName === 'workflow.media' && policy.phase !== 'media_generation') {
    return 'Production media is available only after the exact Visual Constitution is approved and before Final Export is requested.';
  }

  if (toolName === 'workflow.finalExport' && policy.phase !== 'media_generation') {
    return policy.phase === 'final_export_pending'
      ? 'The exact Final Export manifest is frozen while awaiting user approval.'
      : policy.phase === 'final_export_approved'
        ? 'The exact Final Export manifest is already approved; use render.start with its revision and hash.'
        : 'Final Export can be prepared only after media generation and grading are complete.';
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
