import { createHash } from 'node:crypto';
import type {
  CreateVisualAuditionsInput,
  CreateVisualAuditionsResult,
  WorkflowEngine,
} from '@lucid-fin/application';
import { VISUAL_PREVIEW_RUBRIC_VERSION } from '@lucid-fin/application';
import type {
  VisualAuditionCandidate,
  VisualAuditionDocumentContent,
  VisualDirectionCandidateProposal,
  VisualPreviewAttempt,
  VisualPreviewGrade,
  WorkflowDocument,
} from '@lucid-fin/contracts';
import type { CAS, Keychain } from '@lucid-fin/storage';
import {
  CommanderImageGenerationError,
  type CommanderImageGenerationOptions,
  type CommanderImageGenerationResult,
} from './commander-image-gen.js';
import { analyzeImageAsset, type AnalyzeImageAssetResult } from './vision.handlers.js';

type GenerateImage = (
  prompt: string,
  options?: CommanderImageGenerationOptions,
) => Promise<CommanderImageGenerationResult>;

type GradeImage = (input: {
  assetHash: string;
  candidate: VisualDirectionCandidateProposal;
  productionPlan: Record<string, unknown>;
}) => Promise<VisualPreviewGrade>;

export interface StyleAuditionServiceDeps {
  workflowEngine: WorkflowEngine;
  generateImage: GenerateImage;
  gradeImage: GradeImage;
  now?: () => number;
}

const DEFAULT_PREVIEW_WIDTH = 1024;
const DEFAULT_PREVIEW_HEIGHT = 576;

export function createStyleAuditionService(deps: StyleAuditionServiceDeps) {
  const now = deps.now ?? (() => Date.now());

  return async function createVisualAuditions(
    input: CreateVisualAuditionsInput,
  ): Promise<CreateVisualAuditionsResult> {
    let current = deps.workflowEngine.beginVisualAudition({
      canvasId: input.canvasId,
      workflowRunId: input.workflowRunId,
      providerId: input.providerId,
      width: input.width ?? DEFAULT_PREVIEW_WIDTH,
      height: input.height ?? DEFAULT_PREVIEW_HEIGHT,
      candidates: input.candidates,
    }).document;
    const state = clone(current.content as VisualAuditionDocumentContent);
    if (state.status === 'complete') {
      throw new Error(
        `Visual auditions are already complete at revision ${current.revision}; use the host preview selector instead of generating them again`,
      );
    }
    assertReportedCostWithinApprovedBudget(state);
    if (state.status === 'ambiguous') {
      const recoverable = state.candidates.some((candidate) => {
        const last = candidate.attempts.at(-1);
        return candidate.status === 'ambiguous' && Boolean(last?.assetHash) && !last?.grade;
      });
      if (!recoverable) {
        throw new Error(
          'A previous style-audition provider submission has an ambiguous outcome and cannot be retried safely',
        );
      }
    }

    const productionPlan = deps.workflowEngine.getApprovedProductionPlan(
      input.workflowRunId,
    ).content;

    const persist = (): WorkflowDocument => {
      recomputeBudget(state);
      const saved = deps.workflowEngine.saveVisualAuditionSnapshot({
        workflowRunId: input.workflowRunId,
        expectedRevision: current.revision,
        content: state,
      });
      current = saved;
      return saved;
    };

    for (const candidate of state.candidates) {
      if (candidate.status === 'completed') continue;

      while (candidate.status !== 'completed') {
        const previousAttempt = candidate.attempts.at(-1);
        if (
          candidate.status === 'ambiguous' &&
          previousAttempt?.assetHash &&
          !previousAttempt.grade
        ) {
          try {
            previousAttempt.grade = await deps.gradeImage({
              assetHash: previousAttempt.assetHash,
              candidate: proposal(candidate),
              productionPlan,
            });
            previousAttempt.status = 'completed';
            previousAttempt.completedAt = now();
            delete previousAttempt.error;
          } catch (error) {
            throw new Error(
              `Vision grading remains unavailable for candidate "${candidate.name}": ${message(error)}`,
              { cause: error },
            );
          }
        } else {
          if (candidate.attempts.length >= state.budget.maxAttemptsPerCandidate) {
            throw new Error(`Visual candidate "${candidate.name}" exhausted its attempt bound`);
          }
          const attemptNumber = candidate.attempts.length + 1;
          const repairDirective = previousAttempt?.grade?.repairPrompt;
          const prompt = repairDirective
            ? `${candidate.prompt}\n\nRepair directives for this new attempt: ${repairDirective}`
            : candidate.prompt;
          const startedAt = now();
          const budgetConsumed = Math.max(
            state.budget.estimatedCommittedUsd,
            state.budget.reportedActualUsd ?? 0,
          );
          const remainingBudget = Math.max(
            0,
            state.budget.approvedStyleAuditionCostUsd - budgetConsumed,
          );
          const reservationMessage = 'Provider submission reserved; outcome is not yet known';
          const attempt: VisualPreviewAttempt = {
            attempt: attemptNumber,
            status: 'ambiguous',
            prompt,
            promptHash: sha256(prompt),
            providerId: state.providerId,
            requestedSeed: candidate.seed,
            width: state.width,
            height: state.height,
            // Until the provider returns its estimate, reserve the full remaining
            // approved amount. A crash from this point onward must fail closed.
            estimatedCostUsd: remainingBudget,
            error: reservationMessage,
            startedAt,
            completedAt: startedAt,
          };
          candidate.attempts.push(attempt);
          candidate.status = 'ambiguous';
          state.status = 'ambiguous';
          state.failure = {
            candidateId: candidate.id,
            message: reservationMessage,
            ambiguous: true,
          };
          persist();

          let generated: CommanderImageGenerationResult;
          try {
            generated = await deps.generateImage(prompt, {
              providerId: state.providerId,
              width: state.width,
              height: state.height,
              seed: candidate.seed,
              ...(candidate.negativePrompt ? { negativePrompt: candidate.negativePrompt } : {}),
              maxEstimatedCostUsd: remainingBudget,
            });
          } catch (error) {
            const ambiguous = error instanceof CommanderImageGenerationError;
            const details = ambiguous ? error.details : undefined;
            attempt.status = ambiguous ? 'ambiguous' : 'failed';
            attempt.providerId = details?.providerId ?? state.providerId;
            attempt.requestedSeed = details?.requestedSeed ?? candidate.seed;
            attempt.width = details?.width ?? state.width;
            attempt.height = details?.height ?? state.height;
            attempt.estimatedCostUsd = details?.estimatedCostUsd ?? 0;
            attempt.error = message(error);
            attempt.completedAt = now();
            candidate.status = ambiguous ? 'ambiguous' : 'failed';
            state.status = ambiguous ? 'ambiguous' : 'failed';
            state.failure = { candidateId: candidate.id, message: message(error), ambiguous };
            persist();
            throw error;
          }

          attempt.providerId = generated.providerId;
          if (generated.model) attempt.model = generated.model;
          attempt.requestedSeed = generated.requestedSeed ?? candidate.seed;
          if (generated.reportedSeed !== undefined) {
            attempt.reportedSeed = generated.reportedSeed;
          }
          attempt.width = generated.width;
          attempt.height = generated.height;
          attempt.estimatedCostUsd = generated.estimatedCostUsd;
          if (generated.reportedActualCostUsd !== undefined) {
            attempt.reportedActualCostUsd = generated.reportedActualCostUsd;
          }
          attempt.assetHash = generated.assetHash;
          attempt.completedAt = now();

          const reportedTotal = reportedActualTotal(state);
          if (reportedTotal > state.budget.approvedStyleAuditionCostUsd + 1e-9) {
            const budgetError = `Provider-reported style audition cost $${reportedTotal.toFixed(4)} exceeds the approved budget $${state.budget.approvedStyleAuditionCostUsd.toFixed(4)}`;
            attempt.status = 'failed';
            attempt.error = budgetError;
            candidate.status = 'failed';
            state.status = 'failed';
            state.failure = { candidateId: candidate.id, message: budgetError, ambiguous: false };
            persist();
            throw new Error(budgetError);
          }

          const gradingPendingMessage = 'Vision grading is pending for the durable generated asset';
          attempt.error = gradingPendingMessage;
          candidate.status = 'ambiguous';
          state.status = 'ambiguous';
          state.failure = {
            candidateId: candidate.id,
            message: gradingPendingMessage,
            ambiguous: true,
          };
          persist();
          try {
            attempt.grade = await deps.gradeImage({
              assetHash: generated.assetHash,
              candidate: proposal(candidate),
              productionPlan,
            });
            attempt.status = 'completed';
            attempt.completedAt = now();
            delete attempt.error;
          } catch (error) {
            const gradingError = `Vision grading failed: ${message(error)}`;
            attempt.error = gradingError;
            candidate.status = 'ambiguous';
            state.status = 'ambiguous';
            state.failure = {
              candidateId: candidate.id,
              message: gradingError,
              ambiguous: true,
            };
            persist();
            throw new Error(gradingError, { cause: error });
          }
        }

        const completedAttempt = candidate.attempts.at(-1);
        if (!completedAttempt?.grade) throw new Error('Visual grade was not persisted');
        const regenerationsUsed = state.candidates.reduce(
          (total, entry) => total + Math.max(0, entry.attempts.length - 1),
          0,
        );
        const canRepair =
          completedAttempt.grade.verdict === 'repair' &&
          Boolean(completedAttempt.grade.repairPrompt) &&
          candidate.attempts.length < state.budget.maxAttemptsPerCandidate &&
          regenerationsUsed < state.budget.maxRegenerations;
        if (canRepair) {
          candidate.status = 'pending';
          state.status = 'in_progress';
          delete state.failure;
          persist();
          continue;
        }

        candidate.status = 'completed';
        candidate.selectedAttempt = completedAttempt.attempt;
        state.status = 'in_progress';
        delete state.failure;
        persist();
      }
    }

    state.status = 'complete';
    state.recommendedCandidateId = recommend(state.candidates).id;
    delete state.failure;
    const completed = persist();
    return toToolResult(input.workflowRunId, completed);
  };
}

export function createVisualPreviewGrader(deps: { cas: CAS; keychain: Keychain }): GradeImage {
  return async ({ assetHash, candidate, productionPlan }) => {
    const systemPrompt = `You are the evidence-producing visual evaluator in an AI filmmaking workflow.
Evaluate the attached style preview against the approved story and the candidate's stated Visual Constitution.
Return exactly one JSON object and no markdown. Scores are integers from 0 to 100.
Schema: {"promptAdherence":number,"styleClarity":number,"storyFit":number,"lighting":number,"composition":number,"continuityPotential":number,"strengths":string[],"risks":string[],"repairPrompt":string,"evidence":string}.
Evidence must cite visible details. Never claim a detail that is not visible.`;
    const userPrompt = JSON.stringify({
      approvedStory: {
        title: productionPlan.title,
        logline: productionPlan.logline,
        synopsis: productionPlan.synopsis,
        genre: productionPlan.genre,
        tone: productionPlan.tone,
      },
      candidate,
    });
    const analyzed = await analyzeImageAsset(deps.cas, deps.keychain, assetHash, {
      systemPrompt,
      userPrompt,
    });
    return parseGrade(analyzed);
  };
}

function parseGrade(result: AnalyzeImageAssetResult): VisualPreviewGrade {
  const start = result.text.indexOf('{');
  const end = result.text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('Vision grader did not return a JSON object');
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(result.text.slice(start, end + 1)) as Record<string, unknown>;
  } catch (error) {
    throw new Error(`Vision grader returned invalid JSON: ${message(error)}`, { cause: error });
  }
  const keys = [
    'promptAdherence',
    'styleClarity',
    'storyFit',
    'lighting',
    'composition',
    'continuityPotential',
  ] as const;
  const scores = Object.fromEntries(
    keys.map((key) => {
      const value = raw[key];
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) {
        throw new Error(`Vision grader score ${key} must be between 0 and 100`);
      }
      return [key, Math.round(value)];
    }),
  ) as Record<(typeof keys)[number], number>;
  const strengths = stringArray(raw.strengths, 'strengths');
  const risks = stringArray(raw.risks, 'risks');
  const evidence = nonEmpty(raw.evidence, 'evidence');
  const repairPrompt = typeof raw.repairPrompt === 'string' ? raw.repairPrompt.trim() : '';
  const total = Math.round(keys.reduce((sum, key) => sum + scores[key], 0) / keys.length);
  const verdict = total >= 75 ? 'pass' : total >= 50 && repairPrompt ? 'repair' : 'human_review';
  return {
    rubricVersion: VISUAL_PREVIEW_RUBRIC_VERSION,
    ...scores,
    total,
    verdict,
    strengths,
    risks,
    ...(repairPrompt ? { repairPrompt } : {}),
    evidence,
    visionProviderId: result.providerId,
    ...(result.model ? { visionModel: result.model } : {}),
  };
}

function recomputeBudget(state: VisualAuditionDocumentContent): void {
  const attempts = state.candidates.flatMap((candidate) => candidate.attempts);
  state.budget.estimatedCommittedUsd = sum(attempts.map((attempt) => attempt.estimatedCostUsd));
  const reported = attempts.flatMap((attempt) =>
    attempt.reportedActualCostUsd === undefined ? [] : [attempt.reportedActualCostUsd],
  );
  state.budget.reportedActualUsd = sum(reported);
  state.budget.hasUnreportedActualCosts = reported.length !== attempts.length;
}

function reportedActualTotal(state: VisualAuditionDocumentContent): number {
  return sum(
    state.candidates.flatMap((candidate) =>
      candidate.attempts.flatMap((attempt) =>
        attempt.reportedActualCostUsd === undefined ? [] : [attempt.reportedActualCostUsd],
      ),
    ),
  );
}

function assertReportedCostWithinApprovedBudget(state: VisualAuditionDocumentContent): void {
  const reported = state.budget.reportedActualUsd ?? reportedActualTotal(state);
  if (reported > state.budget.approvedStyleAuditionCostUsd + 1e-9) {
    throw new Error(
      `Provider-reported style audition cost $${reported.toFixed(4)} exceeds the approved budget $${state.budget.approvedStyleAuditionCostUsd.toFixed(4)}; no further provider work is allowed`,
    );
  }
}

function recommend(candidates: VisualAuditionCandidate[]): VisualAuditionCandidate {
  const ranked = [...candidates].sort((left, right) => score(right) - score(left));
  const winner = ranked[0];
  if (!winner) throw new Error('No completed visual candidate is available to recommend');
  return winner;
}

function score(candidate: VisualAuditionCandidate): number {
  return (
    candidate.attempts.find((attempt) => attempt.attempt === candidate.selectedAttempt)?.grade
      ?.total ?? -1
  );
}

function toToolResult(
  workflowRunId: string,
  document: WorkflowDocument,
): CreateVisualAuditionsResult {
  const content = document.content as VisualAuditionDocumentContent;
  if (content.status !== 'complete' || !content.recommendedCandidateId) {
    throw new Error('Visual auditions were not completed');
  }
  return {
    workflowRunId,
    status: 'complete',
    revision: document.revision,
    contentHash: document.contentHash,
    recommendedCandidateId: content.recommendedCandidateId,
    candidates: content.candidates.map((candidate) => {
      const attempt = candidate.attempts.find(
        (entry) => entry.attempt === candidate.selectedAttempt && entry.status === 'completed',
      );
      if (!attempt?.assetHash || !attempt.grade) {
        throw new Error(`Visual candidate "${candidate.id}" is incomplete`);
      }
      return {
        id: candidate.id,
        name: candidate.name,
        assetHash: attempt.assetHash,
        score: attempt.grade.total,
        providerId: attempt.providerId,
        ...(attempt.model ? { model: attempt.model } : {}),
        seed: attempt.reportedSeed ?? attempt.requestedSeed,
        estimatedCostUsd: attempt.estimatedCostUsd,
        ...(attempt.reportedActualCostUsd !== undefined
          ? { reportedActualCostUsd: attempt.reportedActualCostUsd }
          : {}),
      };
    }),
  };
}

function proposal(candidate: VisualAuditionCandidate): VisualDirectionCandidateProposal {
  return {
    id: candidate.id,
    name: candidate.name,
    summary: candidate.summary,
    prompt: candidate.prompt,
    ...(candidate.negativePrompt ? { negativePrompt: candidate.negativePrompt } : {}),
    seed: candidate.seed,
    constitution: candidate.constitution,
  };
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function sum(values: number[]): number {
  return Number(values.reduce((total, value) => total + value, 0).toFixed(8));
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string')) {
    throw new Error(`Vision grader ${label} must be a string array`);
  }
  return value.map((entry) => entry.trim()).filter(Boolean);
}

function nonEmpty(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Vision grader ${label} must be a non-empty string`);
  }
  return value.trim();
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
