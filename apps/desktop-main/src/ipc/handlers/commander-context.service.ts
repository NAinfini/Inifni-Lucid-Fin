/**
 * Commander context-building service.
 *
 * Extracted from commander.handlers.ts — builds the AgentContext
 * (workspace snapshot, selected-node summaries, process-prompt detection,
 * master index) that gets injected into the LLM system prompt.
 */
import { createHash } from 'node:crypto';
import {
  COMMANDER_GUIDE_LIMITS,
  deriveNodeStatus,
  getCommanderSessionId,
  type Canvas,
  type CanvasNode,
  type ImageNodeData,
  type VideoNodeData,
  type PresetDefinition,
  type Character,
  type Location,
  type Equipment,
  type PlanApprovalGateKey,
  type PlanApproval,
  type TaskList,
  type TaskListId,
  type CommanderPromptGuide,
  type CommanderTaskListGuidePhase,
} from '@lucid-fin/contracts';
import { matchNode, resolveCanvasVisualStylePolicy } from '@lucid-fin/shared-utils';
import type { SqliteIndex } from '@lucid-fin/storage';
import {
  getMovieProductionTaskContract,
  type AgentContext,
  type TaskListToolPolicy,
} from '@lucid-fin/application';
import { isTerminalPersistentTaskListStatus } from './persistent-task-list-guard.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_CONTEXT_SELECTED_NODES = 10;
const MAX_CONTEXT_SELECTED_NODE_SUMMARIES = 4;
const MAX_CONTEXT_TASK_LISTS = 3;
const MAX_PLAN_DOCUMENT_CHARS = 6000;
const MAX_CONTEXT_MEDIA_ATTEMPTS = 24;
const MAX_CONTEXT_TASK_DECISIONS = 12;

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

function summarizeSelectedNode(
  canvasId: string,
  node: CanvasNode,
  db: SqliteIndex,
): Record<string, unknown> {
  const summary: Record<string, unknown> = {
    id: node.id,
    type: node.type,
    title: node.title,
    status: deriveNodeStatus(node),
  };
  if (node.type === 'image' || node.type === 'video') {
    const promptAssemblies = db.repos.promptAssemblies;
    const assemblies = promptAssemblies ? promptAssemblies.listByNode(canvasId, node.id, 3) : [];
    if (assemblies.length > 0) {
      summary.promptAssemblyHistory = assemblies.map((assembly) => ({
        id: assembly.id,
        status: assembly.status,
        purpose: assembly.purpose,
        inputHash: assembly.inputHash,
        ...(assembly.output ? { finalPromptHash: sha256Text(assembly.output.finalPrompt) } : {}),
        ...(assembly.parentAssemblyId ? { parentAssemblyId: assembly.parentAssemblyId } : {}),
        ...(assembly.sourceAssetHash ? { sourceAssetHash: assembly.sourceAssetHash } : {}),
        updatedAt: assembly.updatedAt,
      }));
    }
  }

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

  // Manual/pre-approval Canvas style draft (never an approved Task List authority).
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
      `Canvas manual style draft (not Task List authority): ${truncSnap(styleDraft, 80)} [${resolvedStyleDraft.provenance.source}, ${resolvedStyleDraft.provenance.policyHash}]`,
    );
  } else {
    lines.push('Canvas manual style draft (not Task List authority): NOT SET');
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
    const nodesById = new Map(canvas.nodes.map((node) => [node.id, node]));
    const selected = selectedNodeIds
      .map((id) => nodesById.get(id))
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
 * Rebuild the authoritative Task List facts needed by the model from SQLite.
 * Conversation history is intentionally excluded: this block survives clear,
 * restart, and compaction because the Task List aggregate is the source of truth.
 */
function listPersistentVideoTaskLists(
  db: SqliteIndex,
  canvasId?: string,
  commanderSessionId?: string,
): TaskList[] {
  return db.repos.taskLists
    .listTaskLists({
      taskListType: 'movie.production.v2',
      ...(canvasId ? { entityType: 'canvas', entityId: canvasId } : {}),
    })
    .rows.filter((taskList) => !isTerminalPersistentTaskListStatus(taskList.status))
    .filter(
      (taskList) =>
        !canvasId || (taskList.entityType === 'canvas' && taskList.entityId === canvasId),
    )
    .filter(
      (taskList) =>
        !commanderSessionId || getCommanderSessionId(taskList.metadata) === commanderSessionId,
    )
    .slice(0, MAX_CONTEXT_TASK_LISTS);
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

function projectPlanDocumentFacts(
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
  if (logicalKey === 'delivery-manifest') {
    const items = Array.isArray(content.items) ? content.items : [];
    return {
      productionPlan: content.productionPlan,
      visualConstitution: content.visualConstitution,
      deliverySequence: content.deliverySequence,
      canvasId: content.canvasId,
      taskListId: content.taskListId,
      namingPolicy: content.namingPolicy,
      items: items.map((value, index) => {
        const item = asContextRecord(value);
        return {
          order: index + 1,
          shotId: item.shotId,
          selectedVideoHash: item.selectedVideoHash,
          packageFileName: item.packageFileName,
          sourceFormat: item.sourceFormat,
          sourceBytes: item.sourceBytes,
          sourceDurationMs: item.sourceDurationMs,
          trimInMs: item.trimInMs,
          trimOutMs: item.trimOutMs,
          embeddedAudioEnabled: item.embeddedAudioEnabled,
          provenance: item.provenance,
        };
      }),
    };
  }
  return content;
}

function projectCurrentTaskInput(input: Record<string, unknown>): Record<string, unknown> {
  const shot = asContextRecord(input.shot);
  const revisionRequest = asContextRecord(input.revisionRequest);
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
    ...(typeof revisionRequest.reason === 'string' && revisionRequest.reason.trim()
      ? {
          revisionRequest: {
            action: revisionRequest.action,
            reason: revisionRequest.reason.trim(),
            previousRevision: revisionRequest.previousRevision,
            previousHash: revisionRequest.previousHash,
          },
        }
      : {}),
  };
}

function renderPersistentTaskListManifest(db: SqliteIndex, taskLists: TaskList[]): string {
  if (taskLists.length === 0) return '';
  const lines = [
    'Authority: SQLite Task List aggregate. Approval state is represented by pending gate records with exact revision and SHA-256 values.',
  ];
  for (const taskList of taskLists) {
    const taskListId = taskList.id as TaskListId;
    const currentTask = taskList.currentTaskId
      ? db.repos.taskLists.getTask(taskList.currentTaskId as never)
      : undefined;
    lines.push(
      `Task List ${taskList.id}: status=${taskList.status}; rowVersion=${taskList.rowVersion ?? 0}; ` +
        `phase=${taskList.currentPhaseKey ?? 'none'}; ` +
        `task=${currentTask?.taskKey ?? 'none'} (${taskList.currentTaskId ?? 'none'}); ` +
        `taskStatus=${currentTask?.status ?? 'none'}; ` +
        `taskRole=${typeof currentTask?.input.taskRole === 'string' ? currentTask.input.taskRole : 'none'}; ` +
        `gate=${taskList.currentGate ?? 'none'}`,
    );
    if (currentTask) {
      const taskRole = currentTask.input.taskRole;
      const taskContract = getMovieProductionTaskContract(taskRole);
      lines.push(
        taskContract
          ? `Current task contract: ${truncSnap(JSON.stringify(taskContract), 3000)}`
          : 'Current task contract: unavailable; do not mutate Task List state until the task role is recognized.',
      );
      const taskInput = projectCurrentTaskInput(currentTask.input);
      if (Object.keys(taskInput).length > 0) {
        lines.push(`Current task input: ${truncSnap(JSON.stringify(taskInput), 2000)}`);
      }
    }
    const continuation = asContextRecord(asContextRecord(taskList.metadata).commanderContinuation);
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
    const contextRecovery = asContextRecord(asContextRecord(taskList.metadata).contextRecovery);
    if (typeof contextRecovery.state === 'string') {
      lines.push(
        `Context recovery: state=${contextRecovery.state}; ` +
          `consecutiveFailures=${contextRecovery.consecutiveFailures ?? 0}; ` +
          `reason=${contextRecovery.reason ?? 'none'}; ` +
          `previousTaskListStatus=${contextRecovery.previousTaskListStatus ?? 'none'}`,
      );
    }

    for (const [logicalKey, label] of [
      ['production-plan', 'Production Plan'],
      ['visual-auditions', 'Visual Auditions'],
      ['visual-constitution', 'Visual Constitution'],
      ['delivery-manifest', 'Delivery Manifest'],
      ['context-checkpoint', 'Context Checkpoint'],
    ] as const) {
      const document = db.repos.taskLists.getLatestDocument(taskListId, logicalKey);
      if (!document) continue;
      lines.push(
        `${label}: revision=${document.revision}; sha256=${document.contentHash}; status=${document.status}`,
      );
      lines.push(
        `${label} facts: ${truncSnap(
          JSON.stringify(projectPlanDocumentFacts(logicalKey, document.content)),
          MAX_PLAN_DOCUMENT_CHARS,
        )}`,
      );
    }

    const execution = db.repos.taskLists.getLatestDeliveryPackageAttempt(taskListId);
    if (execution) {
      lines.push(
        `Delivery package attempt: status=${execution.status}; attempt=${execution.attempt}; ` +
          `manifestRevision=${execution.manifestRevision}; manifestSha256=${execution.manifestHash}; ` +
          `packageSha256=${execution.packageHash ?? 'none'}; packageBytes=${execution.packageBytes ?? 'unknown'}; ` +
          `fileCount=${execution.fileCount ?? 'unknown'}; ` +
          `error=${execution.error ? truncSnap(execution.error, 500) : 'none'}`,
      );
    }

    const mediaAttempts = db.repos.taskLists.listProductionMediaAttempts(taskListId);
    const mediaEvaluations = db.repos.taskLists.listTaskEvaluations(taskListId);
    const mediaCost = db.repos.taskLists.getTaskCostSummary(taskListId);
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

    const pendingDecisions = db.repos.taskLists.listPendingDecisions({ taskListId: taskList.id });
    for (const decision of pendingDecisions.slice(0, MAX_CONTEXT_TASK_DECISIONS)) {
      const task = db.repos.taskLists.getTask(decision.taskId as never);
      const taskRole = typeof task?.input.taskRole === 'string' ? task.input.taskRole : 'none';
      const options = decision.options.slice(0, 8).map((option) => ({
        id: option.id,
        label: option.label,
        description: option.description,
      }));
      lines.push(
        `Task decision: status=${decision.status}; decisionKey=${decision.decisionKey}; ` +
          `questionId=${decision.questionId}; subjectRevision=${decision.subjectRevision}; ` +
          `task=${task?.taskKey ?? 'missing'} (${decision.taskId}); ` +
          `taskStatus=${task?.status ?? 'missing'}; taskRole=${taskRole}; ` +
          `allowFreeText=${decision.allowFreeText}; selectedOption=${decision.selectedOptionId ?? 'none'}`,
      );
      lines.push(`Task decision question: ${truncSnap(decision.question, 1000)}`);
      lines.push(`Task decision options: ${truncSnap(JSON.stringify(options), 1500)}`);
      if (decision.status === 'recovery_required') {
        lines.push(
          `Task decision recovery facts: answer=${decision.answer ? truncSnap(decision.answer, 1000) : 'none'}; ` +
            `answeredAt=${decision.answeredAt ?? 'unknown'}; rowVersion=${decision.rowVersion}`,
        );
      }
    }

    if (taskList.currentGate) {
      const pending = db.repos.taskLists.getPendingApproval(taskListId, taskList.currentGate);
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

/** Global diagnostic/test manifest. Commander runs must use the session-scoped context below. */
export function buildPersistentTaskListManifest(db: SqliteIndex, canvasId?: string): string {
  try {
    return renderPersistentTaskListManifest(db, listPersistentVideoTaskLists(db, canvasId));
  } catch {
    return 'Persistent Task List manifest unavailable; pause Task List mutations until SQLite can be read.';
  }
}

function getExactApprovedGate(
  db: SqliteIndex,
  taskListId: TaskListId,
  gateKey: PlanApprovalGateKey,
): PlanApproval | undefined {
  const approval = db.repos.taskLists.getLatestApproval(taskListId, gateKey);
  if (!approval || approval.status !== 'approved') return undefined;
  const document = db.repos.taskLists.getDocumentRevision(
    taskListId,
    approval.subjectLogicalKey,
    approval.subjectRevision,
  );
  return document &&
    document.revision === approval.subjectRevision &&
    document.contentHash === approval.subjectHash
    ? approval
    : undefined;
}

function deriveTaskListToolPolicy(db: SqliteIndex, taskList: TaskList): TaskListToolPolicy {
  const taskListId = taskList.id as TaskListId;
  const currentTask = taskList.currentTaskId
    ? db.repos.taskLists.getTask(taskList.currentTaskId as never)
    : undefined;
  const base = {
    taskListId: taskList.id,
    rowVersion: taskList.rowVersion ?? 0,
    currentTaskId: taskList.currentTaskId,
    currentTaskKey: currentTask?.taskKey,
    currentTaskRole:
      typeof currentTask?.input.taskRole === 'string' ? currentTask.input.taskRole : undefined,
    currentPhaseKey: taskList.currentPhaseKey,
  };
  if (
    (taskList.currentTaskId && (!currentTask || currentTask.taskListId !== taskList.id)) ||
    (taskList.currentPhaseKey && currentTask && currentTask.phaseKey !== taskList.currentPhaseKey)
  ) {
    return {
      ...base,
      phase: 'blocked',
      reason: 'The current durable phase/task binding could not be verified.',
    };
  }
  if (taskList.status === 'paused') {
    const recovery = asContextRecord(asContextRecord(taskList.metadata).contextRecovery);
    return {
      ...base,
      phase: 'blocked',
      gate: taskList.currentGate,
      reason:
        recovery.state === 'recovery_required'
          ? `Task List is paused for context recovery after ${recovery.consecutiveFailures ?? 0} consecutive failures.`
          : 'Task List is paused.',
    };
  }
  const planApproval = getExactApprovedGate(db, taskListId, 'production_plan');
  const visualApproval = getExactApprovedGate(db, taskListId, 'visual_constitution');
  const deliveryApproval = getExactApprovedGate(db, taskListId, 'delivery');
  const planApproved = Boolean(planApproval);
  const visualApproved = Boolean(visualApproval);

  if (taskList.currentGate) {
    const pending = db.repos.taskLists.getPendingApproval(taskListId, taskList.currentGate);
    const subject = pending
      ? db.repos.taskLists.getDocumentRevision(
          taskListId,
          pending.subjectLogicalKey,
          pending.subjectRevision,
        )
      : undefined;
    if (!pending || !subject || subject.contentHash !== pending.subjectHash) {
      return {
        ...base,
        phase: 'blocked',
        gate: taskList.currentGate,
        reason: 'The pending approval subject revision/hash could not be verified.',
      };
    }
    if (taskList.currentGate === 'production_plan') {
      return {
        ...base,
        phase: 'production_plan_pending',
        gate: taskList.currentGate,
        subjectRevision: pending.subjectRevision,
      };
    }
    if (!planApproved) {
      return {
        ...base,
        phase: 'blocked',
        gate: taskList.currentGate,
        reason: 'Production Plan approval is missing or inconsistent.',
      };
    }
    if (taskList.currentGate === 'visual_constitution') {
      return {
        ...base,
        phase: 'visual_constitution_pending',
        gate: taskList.currentGate,
        subjectRevision: pending.subjectRevision,
      };
    }
    if (!visualApproved) {
      return {
        ...base,
        phase: 'blocked',
        gate: taskList.currentGate,
        reason: 'Visual Constitution approval is missing or inconsistent.',
      };
    }
    return {
      ...base,
      phase: 'delivery_pending',
      gate: taskList.currentGate,
      subjectRevision: pending.subjectRevision,
    };
  }

  if (deliveryApproval) {
    return {
      ...base,
      phase: 'delivery_approved',
      subjectRevision: deliveryApproval.subjectRevision,
    };
  }
  switch (taskList.currentPhaseKey) {
    case 'production-plan': {
      const latestPlan = db.repos.taskLists.getLatestDocument(taskListId, 'production-plan');
      const latestApproval = db.repos.taskLists.getLatestApproval(taskListId, 'production_plan');
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
      const latest = db.repos.taskLists.getLatestDocument(taskListId, 'visual-constitution');
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
    case 'delivery': {
      if (!planApproval || !visualApproval) break;
      const latest = db.repos.taskLists.getLatestDocument(taskListId, 'delivery-manifest');
      return {
        ...base,
        phase: 'delivery_preparation',
        subjectRevision: (latest?.revision ?? 0) + 1,
      };
    }
  }
  return {
    ...base,
    phase: 'blocked',
    reason: 'The durable Task List phase does not have all exact approved prerequisite revisions.',
  };
}

export function buildPersistentTaskListContext(
  db: SqliteIndex,
  canvasId: string,
  commanderSessionId: string,
): { taskListManifest: string; taskListToolPolicy?: TaskListToolPolicy } {
  const sessionId = normalizeOptionalString(commanderSessionId);
  if (!sessionId) {
    throw new TypeError('Commander session is required for persistent Task List context');
  }
  const taskLists = listPersistentVideoTaskLists(db, canvasId, sessionId);
  const taskListManifest = renderPersistentTaskListManifest(db, taskLists);
  if (taskLists.length === 0) return { taskListManifest };
  if (taskLists.length > 1) {
    return {
      taskListManifest,
      taskListToolPolicy: {
        phase: 'blocked',
        reason: 'Multiple non-terminal persistent video Task Lists are bound to this Commander session.',
      },
    };
  }
  return {
    taskListManifest,
    taskListToolPolicy: deriveTaskListToolPolicy(db, taskLists[0]!),
  };
}

// ---------------------------------------------------------------------------
// Context builder
// ---------------------------------------------------------------------------

export function buildAuthorizedContext(
  canvases: Canvas[],
  defaultCanvasId: string | undefined,
  presetLibrary: PresetDefinition[],
  selectedNodes: Array<{ canvasId: string; nodeId: string }>,
  db: SqliteIndex,
  promptGuides?: CommanderPromptGuide[],
  commanderSessionId?: string,
): AgentContext {
  const defaultCanvas = defaultCanvasId
    ? canvases.find((canvas) => canvas.id === defaultCanvasId)
    : undefined;
  const context = defaultCanvas
    ? buildContext(
        defaultCanvas,
        presetLibrary,
        selectedNodes
          .filter((selected) => selected.canvasId === defaultCanvas.id)
          .map((selected) => selected.nodeId),
        db,
        promptGuides,
        undefined,
        commanderSessionId,
      )
    : { page: 'canvas', extra: {} };
  const extra = context.extra as Record<string, unknown>;
  extra.authorizedCanvasIds = canvases.map((canvas) => canvas.id);
  extra.authorizedCanvases = canvases.map((canvas) => {
    const selectedNodeIds = selectedNodes
      .filter((selected) => selected.canvasId === canvas.id)
      .map((selected) => selected.nodeId);
    return {
      id: canvas.id,
      name: canvas.name,
      nodeCount: canvas.nodes.length,
      edgeCount: canvas.edges.length,
      selectedNodeIds,
      workspaceSnapshot: buildWorkspaceSnapshot(canvas, selectedNodeIds, db),
    };
  });
  if (!defaultCanvas) extra.selectedNodeIds = [];
  return context as AgentContext;
}

export function buildContext(
  canvas: Canvas,
  _presetLibrary: PresetDefinition[],
  selectedNodeIds: string[],
  db: SqliteIndex,
  promptGuides?: CommanderPromptGuide[],
  editingNodeId?: string | null,
  commanderSessionId?: string,
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
      .map((node) => summarizeSelectedNode(canvas.id, node, db)),
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
  const persistentTaskList = commanderSessionId
    ? buildPersistentTaskListContext(db, canvas.id, commanderSessionId)
    : undefined;
  if (persistentTaskList?.taskListManifest) {
    extra.taskListManifest = persistentTaskList.taskListManifest;
  }
  if (persistentTaskList?.taskListToolPolicy) {
    extra.taskListToolPolicy = persistentTaskList.taskListToolPolicy;
  }
  if (Array.isArray(promptGuides) && promptGuides.length > 0) {
    const selected = selectPromptGuidesForContext(
      promptGuides,
      persistentTaskList?.taskListToolPolicy?.phase,
    );
    const autoInjected = selected.injected;
    if (autoInjected.length > 0) {
      extra.autoInjectGuides = autoInjected;
    }
  }
  // v2: Master Index removed — tool.get() browsing provides equivalent info.
  return { page: 'canvas', extra };
}

function sha256Text(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function selectPromptGuidesForContext(
  promptGuides: CommanderPromptGuide[],
  phase?: CommanderTaskListGuidePhase,
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
  phase: CommanderTaskListGuidePhase | undefined,
): boolean {
  return !guide.phases || guide.phases.length === 0 || (!!phase && guide.phases.includes(phase));
}

// ---------------------------------------------------------------------------
// Master index — removed in v2; tool.get() browsing provides equivalent info.
// ---------------------------------------------------------------------------
