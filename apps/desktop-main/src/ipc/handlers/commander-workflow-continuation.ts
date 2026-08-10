import { randomUUID } from 'node:crypto';
import log from '../../logger.js';
import type { WorkflowCommanderContinuationConfig, WorkflowEngine } from '@lucid-fin/application';
import { MAX_PERSISTED_PRODUCTION_SHOTS } from '@lucid-fin/application';
import type { CommanderChatRequest, LLMProviderRuntimeConfig } from '@lucid-fin/contracts';
import type { SqliteIndex } from '@lucid-fin/storage';
import type { CanvasStore } from './canvas.handlers.js';
import { buildPersistentWorkflowContext } from './commander-context.service.js';

const MAX_CHAINED_CONTINUATIONS = MAX_PERSISTED_PRODUCTION_SHOTS * 2 + 8;
const TERMINAL_RUN_STATUSES = new Set([
  'completed',
  'completed_with_errors',
  'failed',
  'cancelled',
  'dead',
]);
const EXECUTABLE_PHASES = new Set([
  'production_plan_revision',
  'style_exploration',
  'preproduction',
  'media_generation',
  'assembly',
  'final_export_preparation',
  'final_export_approved',
]);

export interface CommanderWorkflowContinuationController {
  request(workflowRunId: string, reason: string): void;
  recoverPending(): void;
}

export function buildWorkflowCommanderContinuation(
  args: CommanderChatRequest,
): WorkflowCommanderContinuationConfig | undefined {
  const sessionId = cleanString(args.sessionId);
  const provider = args.customLLMProvider;
  if (!sessionId || !provider) return undefined;

  const defaultProviders = Object.fromEntries(
    Object.entries(args.defaultProviders ?? {}).flatMap(([kind, id]) => {
      const normalized = cleanString(id);
      return normalized && ['image', 'video', 'audio'].includes(kind) ? [[kind, normalized]] : [];
    }),
  );
  const safeProvider: LLMProviderRuntimeConfig = {
    id: provider.id,
    name: provider.name,
    baseUrl: provider.baseUrl,
    model: provider.model,
    protocol: provider.protocol,
    authStyle: provider.authStyle,
    ...(provider.credentialMode ? { credentialMode: provider.credentialMode } : {}),
    ...(provider.oauthTarget
      ? {
          oauthTarget: {
            provider: provider.oauthTarget.provider,
            capability: provider.oauthTarget.capability,
          },
        }
      : {}),
    ...(typeof provider.supportsVision === 'boolean'
      ? { supportsVision: provider.supportsVision }
      : {}),
    ...(typeof provider.contextWindow === 'number' && Number.isFinite(provider.contextWindow)
      ? { contextWindow: provider.contextWindow }
      : {}),
  };
  return {
    version: 1,
    sessionId,
    provider: safeProvider,
    permissionMode: args.permissionMode ?? 'normal',
    ...(cleanString(args.locale) ? { locale: cleanString(args.locale) } : {}),
    ...(positiveFinite(args.maxSteps) ? { maxSteps: args.maxSteps } : {}),
    ...(typeof args.temperature === 'number' && Number.isFinite(args.temperature)
      ? { temperature: args.temperature }
      : {}),
    ...(positiveFinite(args.maxTokens) ? { maxTokens: args.maxTokens } : {}),
    ...(Object.keys(defaultProviders).length > 0 ? { defaultProviders } : {}),
    ...(args.processSettings
      ? {
          processSettings: {
            ...(args.processSettings.qualityGateBehavior
              ? { qualityGateBehavior: args.processSettings.qualityGateBehavior }
              : {}),
            ...(typeof args.processSettings.requireStylePlateBeforeRefImage === 'boolean'
              ? {
                  requireStylePlateBeforeRefImage:
                    args.processSettings.requireStylePlateBeforeRefImage,
                }
              : {}),
          },
        }
      : {}),
  };
}

export function createCommanderWorkflowContinuationController(options: {
  workflowEngine: WorkflowEngine;
  db: SqliteIndex;
  canvasStore: CanvasStore;
  isCanvasBusy: (canvasId: string) => boolean;
  runCommander: (args: CommanderChatRequest) => Promise<boolean>;
}): CommanderWorkflowContinuationController {
  const queued = new Set<string>();
  const claimOwnerId = randomUUID();
  let tail = Promise.resolve();

  const request = (workflowRunId: string, reason: string): void => {
    if (!workflowRunId || queued.has(workflowRunId)) return;
    queued.add(workflowRunId);
    tail = tail
      .catch(() => undefined)
      .then(async () => {
        try {
          await continueRun(workflowRunId, reason);
        } catch (error) {
          log.error('Commander workflow continuation failed', {
            category: 'workflow',
            workflowRunId,
            reason,
            error: error instanceof Error ? error.message : String(error),
          });
        } finally {
          queued.delete(workflowRunId);
        }
      });
  };

  const continueRun = async (workflowRunId: string, reason: string): Promise<void> => {
    await options.workflowEngine.waitForAutoPump();
    for (let index = 0; index < MAX_CHAINED_CONTINUATIONS; index += 1) {
      const run = options.workflowEngine.get(workflowRunId);
      if (
        !run ||
        run.workflowType !== 'movie.production.v2' ||
        run.entityType !== 'canvas' ||
        !run.entityId ||
        run.currentGate ||
        run.status === 'paused' ||
        TERMINAL_RUN_STATUSES.has(run.status) ||
        !run.currentTaskId
      ) {
        return;
      }
      const canvasId = run.entityId;
      if (!options.canvasStore.get(canvasId) || options.isCanvasBusy(canvasId)) return;
      const task = options.workflowEngine
        .getTasks(workflowRunId)
        .find((candidate) => candidate.id === run.currentTaskId);
      if (!task || task.status !== 'ready' || task.input.executionMode !== 'external') {
        return;
      }

      const policy = buildPersistentWorkflowContext(options.db, canvasId).workflowToolPolicy;
      if (
        !policy ||
        policy.workflowRunId !== workflowRunId ||
        !EXECUTABLE_PHASES.has(policy.phase)
      ) {
        return;
      }
      const claimKey = `${task.id}:${policy.phase}:${policy.subjectRevision ?? 0}`;
      const claimed = options.workflowEngine.claimCommanderContinuation({
        workflowRunId,
        taskRunId: task.id,
        claimKey,
        claimOwnerId,
        expectedRowVersion: run.rowVersion ?? 0,
      });
      if (!claimed.ok) return;

      log.info('Commander workflow continuation started', {
        category: 'workflow',
        workflowRunId,
        canvasId,
        taskRunId: task.id,
        taskRole: task.input.workflowTaskRole,
        phase: policy.phase,
        reason,
      });
      const commanderSucceeded = await options.runCommander({
        canvasId,
        sessionId: claimed.continuation.sessionId,
        message: continuationMessage(policy.phase),
        history: [],
        selectedNodeIds: [],
        promptGuides: [],
        customLLMProvider: claimed.continuation.provider,
        permissionMode: claimed.continuation.permissionMode,
        ...(claimed.continuation.locale ? { locale: claimed.continuation.locale } : {}),
        ...(claimed.continuation.maxSteps !== undefined
          ? { maxSteps: claimed.continuation.maxSteps }
          : {}),
        ...(claimed.continuation.temperature !== undefined
          ? { temperature: claimed.continuation.temperature }
          : {}),
        ...(claimed.continuation.maxTokens !== undefined
          ? { maxTokens: claimed.continuation.maxTokens }
          : {}),
        ...(claimed.continuation.defaultProviders
          ? { defaultProviders: claimed.continuation.defaultProviders }
          : {}),
        ...(claimed.continuation.processSettings
          ? { processSettings: claimed.continuation.processSettings }
          : {}),
      });
      await options.workflowEngine.waitForAutoPump();

      const nextRun = options.workflowEngine.get(workflowRunId);
      if (!nextRun) return;
      const nextTask = options.workflowEngine
        .getTasks(workflowRunId)
        .find((candidate) => candidate.id === nextRun.currentTaskId);
      const taskProgressed =
        Boolean(nextRun.currentGate) ||
        TERMINAL_RUN_STATUSES.has(nextRun.status) ||
        nextRun.currentTaskId !== task.id ||
        nextTask?.status !== 'ready';
      const outcome = taskProgressed ? 'completed' : 'failed';
      const outcomeReason = !commanderSucceeded
        ? 'Commander run failed before the continuation could finish cleanly.'
        : !taskProgressed
          ? 'Commander run ended before the durable current task was completed.'
          : undefined;
      const finished = options.workflowEngine.finishCommanderContinuationClaim({
        workflowRunId,
        claimKey,
        claimOwnerId,
        expectedRowVersion: nextRun.rowVersion ?? 0,
        outcome,
        ...(outcomeReason ? { reason: outcomeReason } : {}),
      });
      if (!finished) {
        log.warn('Commander workflow continuation claim could not be finalized', {
          category: 'workflow',
          workflowRunId,
          taskRunId: task.id,
          claimKey,
        });
        return;
      }
      if (!commanderSucceeded || !taskProgressed) {
        log.error('Commander workflow continuation stopped before task completion', {
          category: 'workflow',
          workflowRunId,
          taskRunId: task.id,
          reason: outcomeReason,
        });
        return;
      }
      if (nextRun.currentGate || TERMINAL_RUN_STATUSES.has(nextRun.status)) return;
    }

    log.warn('Commander workflow continuation reached its chain bound', {
      category: 'workflow',
      workflowRunId,
      maxContinuations: MAX_CHAINED_CONTINUATIONS,
    });
  };

  return {
    request,
    recoverPending() {
      for (const run of options.workflowEngine.list({
        workflowType: 'movie.production.v2',
        entityType: 'canvas',
      })) {
        request(run.id, 'application-recovery');
      }
    },
  };
}

function continuationMessage(phase: string): string {
  if (phase === 'final_export_approved') {
    return 'The exact Final Export manifest is approved. Execute render.start from the SQLite manifest, then stop. Do not modify media, ordering, output settings, or approval facts.';
  }
  return 'Continue the active persistent movie workflow. Complete only the current durable task described by the SQLite task contract, persist every required evidence item through the named tools, and then stop. Use tool.get when a schema is not loaded. Stop immediately at a human gate, durable question, paused/recovery state, or terminal state. Never treat chat text as approval.';
}

function cleanString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function positiveFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}
