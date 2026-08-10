/**
 * Commander context-building service.
 *
 * Extracted from commander.handlers.ts — builds the AgentContext
 * (workspace snapshot, selected-node summaries, process-prompt detection,
 * master index) that gets injected into the LLM system prompt.
 */
import {
  COMMANDER_GUIDE_LIMITS,
  deriveNodeStatus,
  type Canvas,
  type CanvasNode,
  type ImageNodeData,
  type VideoNodeData,
  type PresetDefinition,
  type Character,
  type Location,
  type Equipment,
  type WorkflowApprovalGateKey,
  type WorkflowApproval,
  type WorkflowRun,
  type WorkflowRunId,
  type CommanderPromptGuide,
  type CommanderWorkflowGuidePhase,
} from '@lucid-fin/contracts';
import { matchNode, resolveCanvasVisualStylePolicy } from '@lucid-fin/shared-utils';
import type { SqliteIndex } from '@lucid-fin/storage';
import {
  getMovieProductionTaskContract,
  type AgentContext,
  type WorkflowToolPolicy,
} from '@lucid-fin/application';
import { isTerminalPersistentWorkflowStatus } from './persistent-workflow-guard.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_CONTEXT_SELECTED_NODES = 10;
const MAX_CONTEXT_SELECTED_NODE_SUMMARIES = 4;
const MAX_CONTEXT_WORKFLOWS = 3;
const MAX_WORKFLOW_DOCUMENT_CHARS = 6000;
const MAX_CONTEXT_MEDIA_ATTEMPTS = 24;
const MAX_CONTEXT_WORKFLOW_DECISIONS = 12;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function summarizeCharacterRefIds(refs: unknown): string[] | undefined {
  if (!Array.isArray(refs) || refs.length === 0) return undefined;
  const result = refs.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const ref = entry as Record<string, unknown>;
    const characterId = normalizeOptionalString(ref.characterId);
    if (!characterId) return [];
    return [characterId];
  });
  return result.length > 0 ? result : undefined;
}

function summarizeLocationRefIds(refs: unknown): string[] | undefined {
  if (!Array.isArray(refs) || refs.length === 0) return undefined;
  const result = refs.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const ref = entry as Record<string, unknown>;
    const locationId = normalizeOptionalString(ref.locationId);
    if (!locationId) return [];
    return [locationId];
  });
  return result.length > 0 ? result : undefined;
}

function summarizeEquipmentRefIds(refs: unknown): string[] | undefined {
  if (!Array.isArray(refs) || refs.length === 0) return undefined;
  const result = refs.flatMap((entry) => {
    if (typeof entry === 'string') {
      return [entry];
    }
    if (!entry || typeof entry !== 'object') return [];
    const ref = entry as Record<string, unknown>;
    const equipmentId = normalizeOptionalString(ref.equipmentId);
    if (!equipmentId) return [];
    return [equipmentId];
  });
  return result.length > 0 ? result : undefined;
}

function summarizeSelectedNode(node: CanvasNode, _db: SqliteIndex): Record<string, unknown> {
  const summary: Record<string, unknown> = {
    id: node.id,
    type: node.type,
    title: node.title,
    status: deriveNodeStatus(node),
  };

  return matchNode(node.type, {
    text: () => {
      const content = normalizeOptionalString((node.data as { content?: unknown }).content);
      if (content) summary.content = content;
      return summary;
    },
    image: addMediaFields,
    video: () => {
      addMediaFields();
      const videoData = node.data as VideoNodeData;
      if (typeof videoData.duration === 'number') summary.duration = videoData.duration;
      if (typeof videoData.fps === 'number') summary.fps = videoData.fps;
      const firstFrameNodeId = normalizeOptionalString(videoData.firstFrameNodeId);
      const lastFrameNodeId = normalizeOptionalString(videoData.lastFrameNodeId);
      if (firstFrameNodeId) summary.firstFrameNodeId = firstFrameNodeId;
      if (lastFrameNodeId) summary.lastFrameNodeId = lastFrameNodeId;
      return summary;
    },
    audio: addMediaFields,
    backdrop: addMediaFields,
  });

  function addMediaFields(): Record<string, unknown> {
    const mediaData = node.data as ImageNodeData | VideoNodeData;
    const prompt = normalizeOptionalString((mediaData as { prompt?: unknown }).prompt);
    const negativePrompt = normalizeOptionalString(
      (mediaData as { negativePrompt?: unknown }).negativePrompt,
    );
    const providerId = normalizeOptionalString((mediaData as { providerId?: unknown }).providerId);
    const sourceImageHash = normalizeOptionalString(
      (mediaData as { sourceImageHash?: unknown }).sourceImageHash,
    );

    if (prompt) summary.hasPrompt = true;
    if (negativePrompt) summary.hasNegativePrompt = true;
    if (providerId) summary.providerId = providerId;
    if (sourceImageHash) summary.sourceImageHash = sourceImageHash;

    const characterRefIds = summarizeCharacterRefIds(
      (mediaData as { characterRefs?: unknown }).characterRefs,
    );
    const locationRefIds = summarizeLocationRefIds(
      (mediaData as { locationRefs?: unknown }).locationRefs,
    );
    const equipmentRefIds = summarizeEquipmentRefIds(
      (mediaData as { equipmentRefs?: unknown }).equipmentRefs,
    );
    if (characterRefIds) summary.characterRefIds = characterRefIds;
    if (locationRefIds) summary.locationRefIds = locationRefIds;
    if (equipmentRefIds) summary.equipmentRefIds = equipmentRefIds;

    return summary;
  }
}

// ---------------------------------------------------------------------------
// Workspace Snapshot (1A)
// ---------------------------------------------------------------------------

function truncSnap(value: string, maxLen: number): string {
  if (value.length <= maxLen) return value;
  return value.slice(0, maxLen - 3) + '...';
}

function hasRefImage(entity: { referenceImages?: unknown[] }): boolean {
  return Array.isArray(entity.referenceImages) && entity.referenceImages.length > 0;
}

/**
 * Build a compact workspace snapshot (~500 bytes) for the system prompt.
 * The LLM can call canvas.getInfo / canvas.getNode (Tier A) for details.
 */
export function buildWorkspaceSnapshot(
  canvas: Canvas,
  selectedNodeIds: string[],
  db: SqliteIndex,
): string {
  const lines: string[] = [];

  // Canvas summary
  const nodesByType: Record<string, number> = {};
  for (const node of canvas.nodes) {
    nodesByType[node.type] = (nodesByType[node.type] ?? 0) + 1;
  }
  const typeBreakdown = Object.entries(nodesByType)
    .map(([t, c]) => `${t}:${c}`)
    .join(', ');
  lines.push(
    `Canvas: "${canvas.name}" (${canvas.nodes.length} nodes${typeBreakdown ? ` [${typeBreakdown}]` : ''}, ${canvas.edges.length} edges)`,
  );

  // Manual/pre-approval Canvas style draft (never an approved workflow authority).
  const resolvedStyleDraft = resolveCanvasVisualStylePolicy(canvas.settings);
  if (resolvedStyleDraft) {
    const lockedFields = Object.entries(resolvedStyleDraft.policy.locked ?? {})
      .filter(([, value]) => (Array.isArray(value) ? value.length > 0 : Boolean(value)))
      .map(([key]) => key)
      .slice(0, 4);
    const styleDraft =
      resolvedStyleDraft.policy.summary ??
      (lockedFields.length > 0
        ? `structured locks: ${lockedFields.join(', ')}`
        : 'constraint-only draft');
    lines.push(
      `Canvas manual style draft (not workflow authority): ${truncSnap(styleDraft, 80)} [${resolvedStyleDraft.provenance.source}, ${resolvedStyleDraft.provenance.policyHash}]`,
    );
  } else {
    lines.push('Canvas manual style draft (not workflow authority): NOT SET');
  }

  // Entity counts with ref-image status
  try {
    const chars: Character[] = db.repos.entities.listCharacters().rows;
    const locs: Location[] = db.repos.entities.listLocations().rows;
    const equips: Equipment[] = db.repos.entities.listEquipment().rows;
    const entityParts: string[] = [];
    if (chars.length > 0) {
      const withRef = chars.filter((c) => hasRefImage(c)).length;
      const names = chars
        .slice(0, 4)
        .map((c) => `${c.name}${hasRefImage(c) ? ' ✓ref' : ''}`)
        .join(', ');
      entityParts.push(
        `${chars.length} chars (${withRef} ref): ${names}${chars.length > 4 ? ', ...' : ''}`,
      );
    }
    if (locs.length > 0) {
      const withRef = locs.filter((l) => hasRefImage(l)).length;
      const names = locs
        .slice(0, 3)
        .map((l) => `${l.name}${hasRefImage(l) ? ' ✓ref' : ''}`)
        .join(', ');
      entityParts.push(
        `${locs.length} locs (${withRef} ref): ${names}${locs.length > 3 ? ', ...' : ''}`,
      );
    }
    if (equips.length > 0) {
      const withRef = equips.filter((e) => hasRefImage(e)).length;
      entityParts.push(`${equips.length} equip (${withRef} ref)`);
    }
    if (entityParts.length > 0) lines.push(`Entities: ${entityParts.join('; ')}`);
  } catch {
    /* entity query failed — omit */
  }

  // Selected nodes (compact)
  if (selectedNodeIds.length > 0) {
    const selected = selectedNodeIds
      .map((id) => canvas.nodes.find((n) => n.id === id))
      .filter((n): n is CanvasNode => Boolean(n));
    if (selected.length > 0) {
      const summaries = selected
        .slice(0, 4)
        .map((n) => `${n.title || n.id} (${n.type}, ${deriveNodeStatus(n)})`)
        .join('; ');
      lines.push(
        `Selected: ${summaries}${selected.length > 4 ? ` +${selected.length - 4} more` : ''}`,
      );
    }
  }

  return lines.join('\n');
}

/**
 * Rebuild the authoritative workflow facts needed by the model from SQLite.
 * Conversation history is intentionally excluded: this block survives clear,
 * restart, and compaction because the workflow aggregate is the source of truth.
 */
function listPersistentVideoRuns(db: SqliteIndex, canvasId?: string): WorkflowRun[] {
  return db.repos.workflows
    .listRuns({
      workflowType: 'movie.production.v2',
      ...(canvasId ? { entityType: 'canvas', entityId: canvasId } : {}),
    })
    .rows.filter((run) => !isTerminalPersistentWorkflowStatus(run.status))
    .filter((run) => !canvasId || (run.entityType === 'canvas' && run.entityId === canvasId))
    .slice(0, MAX_CONTEXT_WORKFLOWS);
}

function asContextRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function projectVisualAuditionFacts(content: Record<string, unknown>): Record<string, unknown> {
  const candidates = Array.isArray(content.candidates) ? content.candidates : [];
  return {
    status: content.status,
    requestHash: content.requestHash,
    rubricVersion: content.rubricVersion,
    productionPlan: content.productionPlan,
    providerId: content.providerId,
    width: content.width,
    height: content.height,
    recommendedCandidateId: content.recommendedCandidateId,
    budget: content.budget,
    failure: content.failure,
    candidates: candidates.map((value) => {
      const candidate = asContextRecord(value);
      const attempts = Array.isArray(candidate.attempts) ? candidate.attempts : [];
      return {
        id: candidate.id,
        name: candidate.name,
        summary: candidate.summary,
        status: candidate.status,
        selectedAttempt: candidate.selectedAttempt,
        attempts: attempts.map((attemptValue) => {
          const attempt = asContextRecord(attemptValue);
          const grade = asContextRecord(attempt.grade);
          return {
            attempt: attempt.attempt,
            status: attempt.status,
            promptHash: attempt.promptHash,
            providerId: attempt.providerId,
            model: attempt.model,
            requestedSeed: attempt.requestedSeed,
            reportedSeed: attempt.reportedSeed,
            width: attempt.width,
            height: attempt.height,
            estimatedCostUsd: attempt.estimatedCostUsd,
            reportedActualCostUsd: attempt.reportedActualCostUsd,
            assetHash: attempt.assetHash,
            error: attempt.error,
            grade:
              Object.keys(grade).length === 0
                ? undefined
                : {
                    rubricVersion: grade.rubricVersion,
                    total: grade.total,
                    verdict: grade.verdict,
                    strengths: grade.strengths,
                    risks: grade.risks,
                    evidence: grade.evidence,
                    visionProviderId: grade.visionProviderId,
                    visionModel: grade.visionModel,
                  },
          };
        }),
      };
    }),
  };
}

function projectWorkflowDocumentFacts(
  logicalKey: string,
  content: Record<string, unknown>,
): Record<string, unknown> {
  if (logicalKey === 'visual-auditions') {
    return projectVisualAuditionFacts(content);
  }
  if (logicalKey === 'visual-constitution') {
    const { candidates, ...lockedFacts } = content;
    return {
      ...lockedFacts,
      candidateCount: Array.isArray(candidates) ? candidates.length : 0,
    };
  }
  if (logicalKey === 'final-export') {
    const segments = Array.isArray(content.segments) ? content.segments : [];
    return {
      manifestVersion: content.manifestVersion,
      productionPlan: content.productionPlan,
      visualConstitution: content.visualConstitution,
      canvasId: content.canvasId,
      assemblySnapshotHash: content.assemblySnapshotHash,
      segments: segments.map((value) => {
        const segment = asContextRecord(value);
        return {
          order: segment.order,
          nodeId: segment.nodeId,
          nodeUpdatedAt: segment.nodeUpdatedAt,
          assetHash: segment.assetHash,
          assetFormat: segment.assetFormat,
          selectedVariantIndex: segment.selectedVariantIndex,
          trimInMs: segment.trimInMs,
          trimOutMs: segment.trimOutMs,
          sourceDurationMs: segment.sourceDurationMs,
          durationSeconds: segment.durationSeconds,
          speed: segment.speed,
        };
      }),
      audioTrackCount: Array.isArray(content.audioTracks) ? content.audioTracks.length : 0,
      subtitleTrackCount: Array.isArray(content.subtitleTracks) ? content.subtitleTracks.length : 0,
      output: content.output,
      expectedDurationMs: content.expectedDurationMs,
      maxRenderAttempts: content.maxRenderAttempts,
      capabilities: content.capabilities,
    };
  }
  return content;
}

function projectCurrentTaskInput(input: Record<string, unknown>): Record<string, unknown> {
  const shot = asContextRecord(input.shot);
  const shotFacts = Object.fromEntries(
    ['id', 'actIndex', 'sceneIndex', 'title', 'summary', 'storyBeat', 'dialogueIntent'].flatMap(
      (key) => (shot[key] === undefined ? [] : [[key, shot[key]]]),
    ),
  );
  return {
    ...(typeof input.documentLogicalKey === 'string'
      ? { documentLogicalKey: input.documentLogicalKey }
      : {}),
    ...(typeof input.shotId === 'string' ? { shotId: input.shotId } : {}),
    ...(Object.keys(shotFacts).length > 0 ? { shot: shotFacts } : {}),
  };
}

function renderPersistentWorkflowManifest(db: SqliteIndex, runs: WorkflowRun[]): string {
  if (runs.length === 0) return '';
  const lines = ['Authority: SQLite workflow aggregate. Chat confirmations never approve a gate.'];
  for (const run of runs) {
    const runId = run.id as WorkflowRunId;
    const currentStage = run.currentStageId
      ? db.repos.workflows.getStageRun(run.currentStageId as never)
      : undefined;
    const currentTask = run.currentTaskId
      ? db.repos.workflows.getTaskRun(run.currentTaskId as never)
      : undefined;
    lines.push(
      `Run ${run.id}: status=${run.status}; rowVersion=${run.rowVersion ?? 0}; ` +
        `stage=${currentStage?.stageId ?? 'none'} (${run.currentStageId ?? 'none'}); ` +
        `task=${currentTask?.taskId ?? 'none'} (${run.currentTaskId ?? 'none'}); ` +
        `taskStatus=${currentTask?.status ?? 'none'}; ` +
        `taskRole=${typeof currentTask?.input.workflowTaskRole === 'string' ? currentTask.input.workflowTaskRole : 'none'}; ` +
        `gate=${run.currentGate ?? 'none'}`,
    );
    if (currentTask) {
      const taskRole = currentTask.input.workflowTaskRole;
      const taskContract = getMovieProductionTaskContract(taskRole);
      lines.push(
        taskContract
          ? `Current task contract: ${truncSnap(JSON.stringify(taskContract), 3000)}`
          : 'Current task contract: unavailable; do not mutate workflow state until the task role is recognized.',
      );
      const taskInput = projectCurrentTaskInput(currentTask.input);
      if (Object.keys(taskInput).length > 0) {
        lines.push(`Current task input: ${truncSnap(JSON.stringify(taskInput), 2000)}`);
      }
    }
    const continuation = asContextRecord(asContextRecord(run.metadata).commanderContinuation);
    const continuationClaim = asContextRecord(continuation.claim);
    if (typeof continuationClaim.status === 'string') {
      lines.push(
        `Commander continuation: status=${continuationClaim.status}; ` +
          `taskClaim=${continuationClaim.key ?? 'unknown'}; ` +
          `startedAt=${continuationClaim.startedAt ?? 'unknown'}; ` +
          `finishedAt=${continuationClaim.finishedAt ?? 'none'}; ` +
          `reason=${continuationClaim.reason ? truncSnap(String(continuationClaim.reason), 500) : 'none'}`,
      );
    }
    const contextRecovery = asContextRecord(asContextRecord(run.metadata).contextRecovery);
    if (typeof contextRecovery.state === 'string') {
      lines.push(
        `Context recovery: state=${contextRecovery.state}; ` +
          `consecutiveFailures=${contextRecovery.consecutiveFailures ?? 0}; ` +
          `reason=${contextRecovery.reason ?? 'none'}; ` +
          `previousRunStatus=${contextRecovery.previousRunStatus ?? 'none'}`,
      );
    }

    for (const [logicalKey, label] of [
      ['production-plan', 'Production Plan'],
      ['visual-auditions', 'Visual Auditions'],
      ['visual-constitution', 'Visual Constitution'],
      ['final-export', 'Final Export'],
      ['context-checkpoint', 'Context Checkpoint'],
    ] as const) {
      const document = db.repos.workflows.getLatestDocument(runId, logicalKey);
      if (!document) continue;
      lines.push(
        `${label}: revision=${document.revision}; sha256=${document.contentHash}; status=${document.status}`,
      );
      lines.push(
        `${label} facts: ${truncSnap(
          JSON.stringify(projectWorkflowDocumentFacts(logicalKey, document.content)),
          MAX_WORKFLOW_DOCUMENT_CHARS,
        )}`,
      );
    }

    const execution = db.repos.workflows.getLatestExportExecution?.(runId);
    if (execution) {
      lines.push(
        `Final Export execution: status=${execution.status}; attempt=${execution.attempt}; ` +
          `manifestRevision=${execution.manifestRevision}; manifestSha256=${execution.manifestHash}; ` +
          `outputSha256=${execution.outputHash ?? 'none'}; outputBytes=${execution.outputSize ?? 'unknown'}; ` +
          `error=${execution.error ? truncSnap(execution.error, 500) : 'none'}`,
      );
    }

    const mediaAttempts = db.repos.workflows.listMediaAttempts?.(runId) ?? [];
    const mediaEvaluations = db.repos.workflows.listMediaEvaluations?.(runId) ?? [];
    const mediaCost = db.repos.workflows.getMediaCostSummary?.(runId);
    if (mediaCost) {
      lines.push(
        `Production media budget ledger: attempts=${mediaCost.attemptCount}; ` +
          `regenerations=${mediaCost.regenerationCount}; ` +
          `estimatedUsd=${mediaCost.estimatedCostUsd}; actualUsd=${mediaCost.reportedActualCostUsd}; ` +
          `committedUsd=${mediaCost.committedCostUsd}; ` +
          `hasUnreportedActualCosts=${mediaCost.hasUnreportedActualCosts}`,
      );
    }
    const evaluationsByAttempt = new Map(
      mediaEvaluations.map((evaluation) => [evaluation.attemptId, evaluation]),
    );
    for (const attempt of mediaAttempts.slice(-MAX_CONTEXT_MEDIA_ATTEMPTS)) {
      const evaluation = evaluationsByAttempt.get(attempt.id);
      lines.push(
        `Media attempt: attemptId=${attempt.id}; node=${attempt.nodeId}; attempt=${attempt.attempt}; media=${attempt.mediaType}; ` +
          `status=${attempt.status}; specSha256=${attempt.specHash}; basePromptHash=${attempt.promptHash}; ` +
          `provider=${attempt.providerId}; model=${attempt.model ?? 'unknown'}; seed=${attempt.seed ?? 'none'}; ` +
          `estimatedUsd=${attempt.estimatedCostUsd}; actualUsd=${attempt.reportedActualCostUsd ?? 'unreported'}; ` +
          `asset=${attempt.assetHash ?? 'none'}; ` +
          `repairDelta=${attempt.repairDelta ? truncSnap(JSON.stringify(attempt.repairDelta), 800) : 'none'}; ` +
          `error=${attempt.error ? truncSnap(attempt.error, 500) : 'none'}`,
      );
      if (evaluation) {
        lines.push(
          `Media evaluation: attemptId=${evaluation.attemptId}; rubric=${evaluation.rubricVersion}; ` +
            `verdict=${evaluation.verdict}; total=${evaluation.total}; ` +
            `scores=${truncSnap(JSON.stringify(evaluation.scores), 500)}; ` +
            `risks=${truncSnap(JSON.stringify(evaluation.risks), 800)}; ` +
            `evidence=${truncSnap(JSON.stringify(evaluation.evidence), 1000)}; ` +
            `frames=${truncSnap(JSON.stringify(evaluation.frameEvidence), 800)}`,
        );
      }
    }

    const pendingDecisions =
      db.repos.workflows.listPendingDecisions?.({ workflowRunId: run.id }) ?? [];
    for (const decision of pendingDecisions.slice(0, MAX_CONTEXT_WORKFLOW_DECISIONS)) {
      const task = db.repos.workflows.getTaskRun(decision.taskRunId as never);
      const taskRole =
        typeof task?.input.workflowTaskRole === 'string' ? task.input.workflowTaskRole : 'none';
      const options = decision.options.slice(0, 8).map((option) => ({
        id: option.id,
        label: option.label,
        description: option.description,
      }));
      lines.push(
        `Workflow decision: status=${decision.status}; decisionKey=${decision.decisionKey}; ` +
          `questionId=${decision.questionId}; subjectRevision=${decision.subjectRevision}; ` +
          `task=${task?.taskId ?? 'missing'} (${decision.taskRunId}); ` +
          `taskStatus=${task?.status ?? 'missing'}; taskRole=${taskRole}; ` +
          `allowFreeText=${decision.allowFreeText}; selectedOption=${decision.selectedOptionId ?? 'none'}`,
      );
      lines.push(`Workflow decision question: ${truncSnap(decision.question, 1000)}`);
      lines.push(`Workflow decision options: ${truncSnap(JSON.stringify(options), 1500)}`);
      if (decision.status === 'recovery_required') {
        lines.push(
          `Workflow decision recovery facts: answer=${decision.answer ? truncSnap(decision.answer, 1000) : 'none'}; ` +
            `answeredAt=${decision.answeredAt ?? 'unknown'}; rowVersion=${decision.rowVersion}`,
        );
      }
    }

    if (run.currentGate) {
      const pending = db.repos.workflows.getPendingApproval(runId, run.currentGate);
      if (pending) {
        lines.push(
          `Pending human approval: ${pending.gateKey}; revision=${pending.subjectRevision}; ` +
            `sha256=${pending.subjectHash}; approvalId=${pending.id}`,
        );
      }
    }
  }
  return lines.join('\n');
}

export function buildPersistentWorkflowManifest(db: SqliteIndex, canvasId?: string): string {
  try {
    return renderPersistentWorkflowManifest(db, listPersistentVideoRuns(db, canvasId));
  } catch {
    return 'Persistent workflow manifest unavailable; pause workflow mutations until SQLite can be read.';
  }
}

function getExactApprovedGate(
  db: SqliteIndex,
  runId: WorkflowRunId,
  gateKey: WorkflowApprovalGateKey,
): WorkflowApproval | undefined {
  const approval = db.repos.workflows.getLatestApproval(runId, gateKey);
  if (!approval || approval.status !== 'approved') return undefined;
  const document = db.repos.workflows.getDocumentRevision(
    runId,
    approval.subjectLogicalKey,
    approval.subjectRevision,
  );
  return document &&
    document.revision === approval.subjectRevision &&
    document.contentHash === approval.subjectHash
    ? approval
    : undefined;
}

function deriveWorkflowToolPolicy(db: SqliteIndex, run: WorkflowRun): WorkflowToolPolicy {
  const runId = run.id as WorkflowRunId;
  const currentStage = run.currentStageId
    ? db.repos.workflows.getStageRun(run.currentStageId as never)
    : undefined;
  const currentTask = run.currentTaskId
    ? db.repos.workflows.getTaskRun(run.currentTaskId as never)
    : undefined;
  const base = {
    workflowRunId: run.id,
    rowVersion: run.rowVersion ?? 0,
    currentTaskRunId: run.currentTaskId,
    currentTaskId: currentTask?.taskId,
    currentTaskRole:
      typeof currentTask?.input.workflowTaskRole === 'string'
        ? currentTask.input.workflowTaskRole
        : undefined,
    currentStageId: currentStage?.stageId,
  };
  if (
    (run.currentStageId && (!currentStage || currentStage.workflowRunId !== run.id)) ||
    (run.currentTaskId && (!currentTask || currentTask.workflowRunId !== run.id))
  ) {
    return {
      ...base,
      phase: 'blocked',
      reason: 'The current durable stage/task binding could not be verified.',
    };
  }
  if (run.status === 'paused') {
    const recovery = asContextRecord(asContextRecord(run.metadata).contextRecovery);
    return {
      ...base,
      phase: 'blocked',
      gate: run.currentGate,
      reason:
        recovery.state === 'recovery_required'
          ? `Workflow is paused for context recovery after ${recovery.consecutiveFailures ?? 0} consecutive failures.`
          : 'Workflow is paused.',
    };
  }
  const planApproval = getExactApprovedGate(db, runId, 'production_plan');
  const visualApproval = getExactApprovedGate(db, runId, 'visual_constitution');
  const finalApproval = getExactApprovedGate(db, runId, 'final_export');
  const planApproved = Boolean(planApproval);
  const visualApproved = Boolean(visualApproval);

  if (run.currentGate) {
    const pending = db.repos.workflows.getPendingApproval(runId, run.currentGate);
    const subject = pending
      ? db.repos.workflows.getDocumentRevision(
          runId,
          pending.subjectLogicalKey,
          pending.subjectRevision,
        )
      : undefined;
    if (!pending || !subject || subject.contentHash !== pending.subjectHash) {
      return {
        ...base,
        phase: 'blocked',
        gate: run.currentGate,
        reason: 'The pending approval subject revision/hash could not be verified.',
      };
    }
    if (run.currentGate === 'production_plan') {
      return {
        ...base,
        phase: 'production_plan_pending',
        gate: run.currentGate,
        subjectRevision: pending.subjectRevision,
      };
    }
    if (!planApproved) {
      return {
        ...base,
        phase: 'blocked',
        gate: run.currentGate,
        reason: 'Production Plan approval is missing or inconsistent.',
      };
    }
    if (run.currentGate === 'visual_constitution') {
      return {
        ...base,
        phase: 'visual_constitution_pending',
        gate: run.currentGate,
        subjectRevision: pending.subjectRevision,
      };
    }
    if (!visualApproved) {
      return {
        ...base,
        phase: 'blocked',
        gate: run.currentGate,
        reason: 'Visual Constitution approval is missing or inconsistent.',
      };
    }
    return {
      ...base,
      phase: 'final_export_pending',
      gate: run.currentGate,
      subjectRevision: pending.subjectRevision,
    };
  }

  if (finalApproval) {
    return {
      ...base,
      phase: 'final_export_approved',
      subjectRevision: finalApproval.subjectRevision,
    };
  }
  switch (currentStage?.stageId) {
    case 'production-plan': {
      const latestPlan = db.repos.workflows.getLatestDocument(runId, 'production-plan');
      const latestApproval = db.repos.workflows.getLatestApproval(runId, 'production_plan');
      return latestPlan && latestApproval?.status === 'rejected'
        ? { ...base, phase: 'production_plan_revision', subjectRevision: latestPlan.revision + 1 }
        : {
            ...base,
            phase: 'blocked',
            reason: 'Production Plan revision state is inconsistent.',
          };
    }
    case 'style-exploration': {
      if (!planApproval) break;
      const latest = db.repos.workflows.getLatestDocument(runId, 'visual-constitution');
      return {
        ...base,
        phase: 'style_exploration',
        subjectRevision: (latest?.revision ?? 0) + 1,
      };
    }
    case 'preproduction':
      if (planApproval && visualApproval) {
        return { ...base, phase: 'preproduction', subjectRevision: visualApproval.subjectRevision };
      }
      break;
    case 'media-generation':
      if (planApproval && visualApproval) {
        return {
          ...base,
          phase: 'media_generation',
          subjectRevision: visualApproval.subjectRevision,
        };
      }
      break;
    case 'assembly':
      if (planApproval && visualApproval) {
        return { ...base, phase: 'assembly', subjectRevision: visualApproval.subjectRevision };
      }
      break;
    case 'final-export': {
      if (!planApproval || !visualApproval) break;
      const latest = db.repos.workflows.getLatestDocument(runId, 'final-export');
      return {
        ...base,
        phase: 'final_export_preparation',
        subjectRevision: (latest?.revision ?? 0) + 1,
      };
    }
  }
  return {
    ...base,
    phase: 'blocked',
    reason: 'The durable workflow stage does not have all exact approved prerequisite revisions.',
  };
}

export function buildPersistentWorkflowContext(
  db: SqliteIndex,
  canvasId: string,
): { workflowManifest: string; workflowToolPolicy?: WorkflowToolPolicy } {
  try {
    const runs = listPersistentVideoRuns(db, canvasId);
    const workflowManifest = renderPersistentWorkflowManifest(db, runs);
    if (runs.length === 0) return { workflowManifest };
    if (runs.length > 1) {
      return {
        workflowManifest,
        workflowToolPolicy: {
          phase: 'blocked',
          reason: 'Multiple non-terminal persistent video workflows are bound to this canvas.',
        },
      };
    }
    return {
      workflowManifest,
      workflowToolPolicy: deriveWorkflowToolPolicy(db, runs[0]!),
    };
  } catch {
    return {
      workflowManifest:
        'Persistent workflow manifest unavailable; pause workflow mutations until SQLite can be read.',
      workflowToolPolicy: {
        phase: 'blocked',
        reason: 'Persistent workflow state could not be read from SQLite.',
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Context builder
// ---------------------------------------------------------------------------

export function buildContext(
  canvas: Canvas,
  _presetLibrary: PresetDefinition[],
  selectedNodeIds: string[],
  db: SqliteIndex,
  promptGuides?: CommanderPromptGuide[],
  editingNodeId?: string | null,
): AgentContext {
  const limitedSelectedNodeIds = selectedNodeIds.slice(0, MAX_CONTEXT_SELECTED_NODES);
  const nodeMap = new Map(canvas.nodes.map((node) => [node.id, node]));
  const extra: Record<string, unknown> = {
    canvasId: canvas.id,
    nodeCount: canvas.nodes.length,
    edgeCount: canvas.edges.length,
    selectedNodeIds: limitedSelectedNodeIds,
    selectedNodes: limitedSelectedNodeIds
      .slice(0, MAX_CONTEXT_SELECTED_NODE_SUMMARIES)
      .map((nodeId) => nodeMap.get(nodeId))
      .filter((node): node is CanvasNode => Boolean(node))
      .map((node) => summarizeSelectedNode(node, db)),
  };
  // R28: Editing awareness — tell the LLM which node the user is actively
  // editing so it avoids mutating it mid-keystroke. Only included when set.
  if (editingNodeId) {
    extra.editingNodeId = editingNodeId;
    const editingNode = nodeMap.get(editingNodeId);
    if (editingNode) {
      extra.editingNodeWarning = `Node "${editingNode.title || editingNodeId}" (id: ${editingNodeId}) is currently being edited by the user. Do NOT modify this node.`;
    }
  }
  // 1A: Workspace snapshot — rich structured overview of canvas + entities.
  // Rendered as its own section in the system prompt so the LLM can reason
  // about the project without calling read tools on step 1.
  extra.workspaceSnapshot = buildWorkspaceSnapshot(canvas, limitedSelectedNodeIds, db);
  const persistentWorkflow = buildPersistentWorkflowContext(db, canvas.id);
  if (persistentWorkflow.workflowManifest) {
    extra.workflowManifest = persistentWorkflow.workflowManifest;
  }
  if (persistentWorkflow.workflowToolPolicy) {
    extra.workflowToolPolicy = persistentWorkflow.workflowToolPolicy;
  }
  if (Array.isArray(promptGuides) && promptGuides.length > 0) {
    const selected = selectPromptGuidesForContext(
      promptGuides,
      persistentWorkflow.workflowToolPolicy?.phase,
    );
    const autoInjected = selected.injected;
    if (autoInjected.length > 0) {
      extra.autoInjectGuides = autoInjected;
    }
  }
  // v2: Master Index removed — tool.get() browsing provides equivalent info.
  return { page: 'canvas', extra };
}

export function selectPromptGuidesForContext(
  promptGuides: CommanderPromptGuide[],
  phase?: CommanderWorkflowGuidePhase,
): {
  injected: CommanderPromptGuide[];
  discoveryOnly: Array<{ id: string; name: string }>;
} {
  const ranked = promptGuides
    .map((guide, index) => ({ guide, index }))
    .sort((left, right) => {
      const leftApplicable = isGuideApplicable(left.guide, phase) ? 1 : 0;
      const rightApplicable = isGuideApplicable(right.guide, phase) ? 1 : 0;
      if (leftApplicable !== rightApplicable) return rightApplicable - leftApplicable;
      const leftAuto = left.guide.autoInject ? 1 : 0;
      const rightAuto = right.guide.autoInject ? 1 : 0;
      if (leftAuto !== rightAuto) return rightAuto - leftAuto;
      const priorityDifference = (right.guide.priority ?? 0) - (left.guide.priority ?? 0);
      return priorityDifference || left.index - right.index;
    });

  const injected: CommanderPromptGuide[] = [];
  const selectedIds = new Set<string>();
  let usedChars = 0;
  for (const { guide } of ranked) {
    if (
      guide.autoInject !== true ||
      !isGuideApplicable(guide, phase) ||
      guide.retention === 'discovery'
    ) {
      continue;
    }
    const summary = guide.autoInjectContent;
    if (
      typeof summary !== 'string' ||
      summary.length === 0 ||
      summary.length > COMMANDER_GUIDE_LIMITS.maxAutoInjectCharsPerGuide
    ) {
      continue;
    }
    if (injected.length >= COMMANDER_GUIDE_LIMITS.maxAutoInjectItems) continue;
    if (usedChars + summary.length > COMMANDER_GUIDE_LIMITS.maxAutoInjectCharsTotal) continue;
    const { autoInjectContent: _autoInjectContent, ...guideMetadata } = guide;
    injected.push({ ...guideMetadata, content: summary });
    selectedIds.add(guide.id);
    usedChars += summary.length;
  }

  return {
    injected,
    discoveryOnly: promptGuides
      .filter((guide) => !selectedIds.has(guide.id))
      .map((guide) => ({ id: guide.id, name: guide.name })),
  };
}

function isGuideApplicable(
  guide: CommanderPromptGuide,
  phase: CommanderWorkflowGuidePhase | undefined,
): boolean {
  return !guide.phases || guide.phases.length === 0 || (!!phase && guide.phases.includes(phase));
}

// ---------------------------------------------------------------------------
// Master index — removed in v2; tool.get() browsing provides equivalent info.
// ---------------------------------------------------------------------------
