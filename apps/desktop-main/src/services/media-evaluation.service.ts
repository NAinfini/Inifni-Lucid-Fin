import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  ProductionMediaGenerationSpec,
  ProductionMediaScope,
  ProductionMediaTaskAttempt,
  RepairDelta,
  TaskEvaluation,
  TaskEvaluationFrameEvidence,
  TaskEvaluationScoreSet,
  TaskEvaluationVerdict,
  LLMAdapter,
} from '@lucid-fin/contracts';
import {
  detectScenes as defaultDetectScenes,
  extractFrameAtTime as defaultExtractFrameAtTime,
  probeMedia as defaultProbeMedia,
  type MediaProbeResult,
  type SceneCut,
} from '@lucid-fin/media-engine';
import type { CAS, SqliteIndex } from '@lucid-fin/storage';
import log from '../logger.js';
import { normalizeErrorMessage } from '../ipc/handlers/generation-helpers.js';
import type { VisualAnalyzer } from './visual-analyzer.service.js';

export const PRODUCTION_MEDIA_RUBRIC_VERSION = 'production-media-rubric-v2';
const MAX_VISION_EVIDENCE_IMAGES = 12;

export const MEDIA_EVALUATION_PROFILE_BY_SCOPE = {
  canvas: 'canvas_media.v1',
  style_audition: 'style_audition.v1',
  production: 'production_media.v1',
} as const satisfies Record<ProductionMediaScope, TaskEvaluation['profile']>;

export interface MediaEvaluationGradeRequest {
  assetHashes: string[];
  mediaType: 'image' | 'video';
  generationSpec: ProductionMediaGenerationSpec;
  productionPlan: Record<string, unknown>;
  visualConstitution: Record<string, unknown>;
  metadata: Record<string, unknown>;
  frameEvidence: TaskEvaluationFrameEvidence[];
}

export interface MediaEvaluationGradeResponse {
  text: string;
  providerId: string;
  model?: string;
}

export interface MediaEvaluationRunOptions {
  /** Commander-selected LLM. A visual-capable adapter exclusively owns grading for this run. */
  preferredLLMAdapter?: LLMAdapter;
}

export type MediaEvaluationGrader = (
  request: MediaEvaluationGradeRequest,
  options?: MediaEvaluationRunOptions,
) => Promise<MediaEvaluationGradeResponse>;

export interface MediaEvaluationVerdictBounds {
  canRetry: boolean;
  budgetExceeded: boolean;
}

export type MediaEvaluationValidationCallback = (
  attempt: ProductionMediaTaskAttempt,
) => void | boolean | Promise<void | boolean>;

export interface EvaluateMediaInput {
  attempt: ProductionMediaTaskAttempt;
  productionPlan: Record<string, unknown>;
  visualConstitution: Record<string, unknown>;
  rubricVersion: string;
  runOptions?: MediaEvaluationRunOptions;
  /** Called before evaluation begins; false or a thrown error fails closed to human review. */
  validateAuthority?: MediaEvaluationValidationCallback;
  /** Called before evaluation begins; false or a thrown error fails closed to human review. */
  validateNodeRevision?: MediaEvaluationValidationCallback;
  /** Resolved only after a successful visual grade, so transient grading failures remain retryable. */
  getVerdictBounds?: (
    attempt: ProductionMediaTaskAttempt,
  ) => MediaEvaluationVerdictBounds | Promise<MediaEvaluationVerdictBounds>;
}

export type MediaEvaluationResult =
  | {
      status: 'recorded';
      evaluation: TaskEvaluation;
      attempt: ProductionMediaTaskAttempt;
    }
  | {
      status: 'evaluation_pending';
      attempt: ProductionMediaTaskAttempt;
      message: string;
    }
  | {
      status: 'human_review';
      attempt: ProductionMediaTaskAttempt;
      message: string;
    };

export interface MediaEvaluationServiceDeps {
  db: SqliteIndex;
  cas: CAS;
  visualAnalyzer: VisualAnalyzer;
  gradeAssets?: MediaEvaluationGrader;
  probeMedia?: (filePath: string) => Promise<MediaProbeResult>;
  detectScenes?: (filePath: string, threshold?: number) => Promise<SceneCut[]>;
  extractFrameAtTime?: (
    videoPath: string,
    timeSeconds: number,
    outputPath: string,
  ) => Promise<void>;
  now?: () => number;
  idFactory?: () => string;
}

type EvaluationDecision = {
  scores: TaskEvaluationScoreSet;
  total: number;
  verdict: TaskEvaluationVerdict;
  strengths: string[];
  risks: string[];
  evidence: string[];
  repairDelta?: RepairDelta;
};

export class MediaEvaluationService {
  private readonly now: () => number;
  private readonly idFactory: () => string;
  private readonly gradeAssets: MediaEvaluationGrader;
  private readonly probeMedia: NonNullable<MediaEvaluationServiceDeps['probeMedia']>;
  private readonly detectScenes: NonNullable<MediaEvaluationServiceDeps['detectScenes']>;
  private readonly extractFrameAtTime: NonNullable<
    MediaEvaluationServiceDeps['extractFrameAtTime']
  >;

  constructor(private readonly deps: MediaEvaluationServiceDeps) {
    this.now = deps.now ?? (() => Date.now());
    this.idFactory = deps.idFactory ?? randomUUID;
    this.gradeAssets = deps.gradeAssets ?? createDefaultMediaEvaluationGrader(deps);
    this.probeMedia = deps.probeMedia ?? defaultProbeMedia;
    this.detectScenes = deps.detectScenes ?? defaultDetectScenes;
    this.extractFrameAtTime = deps.extractFrameAtTime ?? defaultExtractFrameAtTime;
  }

  async evaluate(input: EvaluateMediaInput): Promise<MediaEvaluationResult> {
    const { attempt } = input;
    if (!attempt.assetHash) throw new Error('Gradeable attempt is missing its CAS asset hash');
    const assetHash = attempt.assetHash;
    const outputArtifact = this.deps.db.repos.taskLists.getArtifactByAttempt(
      attempt.id,
      'media_output',
    );
    if (!outputArtifact?.assetHash || outputArtifact.assetHash !== assetHash) {
      return this.failClosed(
        attempt,
        'The generated asset is not bound to this attempt by a durable media-output artifact; automatic grading is fail-closed.',
      );
    }

    const authorityFailure = await this.validate(
      input.validateAuthority,
      attempt,
      'The media attempt failed authority validation; automatic grading is fail-closed.',
    );
    if (authorityFailure) return this.failClosed(attempt, authorityFailure);
    const nodeFailure = await this.validate(
      input.validateNodeRevision,
      attempt,
      'The canvas node changed after reservation; the generated artifact cannot be selected automatically.',
    );
    if (nodeFailure) return this.failClosed(attempt, nodeFailure);

    let evaluating = attempt;
    if (attempt.status === 'asset_ready') {
      evaluating = this.deps.db.repos.taskLists.transitionProductionMediaAttempt({
        id: attempt.id,
        expectedRowVersion: attempt.rowVersion,
        expectedStatuses: ['asset_ready'],
        status: 'evaluating',
        updatedAt: this.now(),
      });
    } else if (attempt.status !== 'evaluating') {
      throw new Error(`Media evaluation requires an asset_ready attempt, received ${attempt.status}`);
    }

    let evidence: MediaEvaluationEvidence;
    let response: MediaEvaluationGradeResponse;
    let parsed: EvaluationDecision;
    try {
      evidence = await this.collectEvidence(evaluating, input.rubricVersion);
      response = await this.gradeAssets(
        {
          assetHashes: evidence.assetHashes,
          mediaType: evaluating.mediaType,
          generationSpec: evaluating.generationSpec,
          productionPlan: input.productionPlan,
          visualConstitution: input.visualConstitution,
          metadata: evidence.metadata,
          frameEvidence: evidence.frameEvidence,
        },
        input.runOptions,
      );
      parsed = parseEvaluation(response.text, evaluating.mediaType);
    } catch (error) {
      const message = normalizeErrorMessage(error);
      const pending = this.deps.db.repos.taskLists.transitionProductionMediaAttempt({
        id: evaluating.id,
        expectedRowVersion: evaluating.rowVersion,
        expectedStatuses: ['evaluating'],
        status: 'asset_ready',
        error: `Evaluation pending: ${message}`,
        updatedAt: this.now(),
      });
      log.warn('Production-media evaluation deferred without repeating provider work', {
        category: 'production-media',
        taskListId: pending.taskListId,
        nodeId: pending.nodeId,
        attempt: pending.attempt,
        error: message,
      });
      return {
        status: 'evaluation_pending',
        attempt: pending,
        message: pending.error ?? 'Evaluation is pending.',
      };
    }

    const bounds = input.getVerdictBounds
      ? await input.getVerdictBounds(evaluating)
      : { canRetry: true, budgetExceeded: false };
    const verdict = boundVerdict(parsed, bounds);
    const boundedRisks = bounds.budgetExceeded
      ? [...parsed.risks, 'Reported provider cost exceeded the approved total budget.']
      : parsed.risks;
    const boundedEvidence = bounds.budgetExceeded
      ? [...parsed.evidence, 'The durable cost ledger is above the approved maxTotalCostUsd.']
      : parsed.evidence;
    const evaluationId = this.idFactory();
    const repairDeltaBase =
      verdict === 'repair' || verdict === 'regenerate'
        ? normalizeRepairDelta(parsed.repairDelta, boundedRisks, verdict)
        : undefined;
    const repairDelta = repairDeltaBase
      ? {
          ...repairDeltaBase,
          sourceEvaluationId: evaluationId,
          sourceArtifactId: outputArtifact.id,
        }
      : undefined;
    const finalVerdict =
      (verdict === 'repair' || verdict === 'regenerate') && !repairDelta
        ? 'human_review'
        : verdict;
    const createdAt = this.now();
    const evaluation: TaskEvaluation = {
      kind: 'production_media',
      id: evaluationId,
      attemptId: evaluating.id,
      taskListId: evaluating.taskListId,
      canvasId: evaluating.canvasId,
      nodeId: evaluating.nodeId,
      artifactId: outputArtifact.id,
      assetHash,
      mediaType: evaluating.mediaType,
      profile: mediaEvaluationProfileForScope(evaluating.scope),
      sourcePromptHash: evaluating.promptHash,
      rubricVersion: input.rubricVersion,
      evaluatorProviderId: response.providerId,
      ...(response.model ? { evaluatorModel: response.model } : {}),
      scores: parsed.scores,
      total: parsed.total,
      verdict: finalVerdict,
      strengths: parsed.strengths,
      risks: boundedRisks,
      evidence: boundedEvidence,
      ...(repairDelta ? { repairDelta } : {}),
      metadata: evidence.metadata,
      frameEvidence: evidence.frameEvidence,
      createdAt,
    };
    const resultingAttemptStatus =
      finalVerdict === 'pass'
        ? 'accepted'
        : finalVerdict === 'repair'
          ? 'repair_required'
          : finalVerdict === 'regenerate'
            ? 'regenerate_required'
            : 'human_review';
    const recorded = this.deps.db.repos.taskLists.recordTaskEvaluation({
      evaluation,
      expectedAttemptRowVersion: evaluating.rowVersion,
      expectedAttemptStatuses: ['evaluating'],
      resultingAttemptStatus,
      evaluatedAt: createdAt,
    });
    return { status: 'recorded', evaluation: recorded.evaluation, attempt: recorded.attempt };
  }

  private async validate(
    callback: MediaEvaluationValidationCallback | undefined,
    attempt: ProductionMediaTaskAttempt,
    fallbackMessage: string,
  ): Promise<string | undefined> {
    if (!callback) return undefined;
    try {
      return (await callback(attempt)) === false ? fallbackMessage : undefined;
    } catch (error) {
      return normalizeErrorMessage(error);
    }
  }

  private failClosed(
    attempt: ProductionMediaTaskAttempt,
    message: string,
  ): Extract<MediaEvaluationResult, { status: 'human_review' }> {
    const reviewed = this.deps.db.repos.taskLists.transitionProductionMediaAttempt({
      id: attempt.id,
      expectedRowVersion: attempt.rowVersion,
      expectedStatuses: [attempt.status],
      status: 'human_review',
      error: message,
      completedAt: this.now(),
      updatedAt: this.now(),
    });
    return { status: 'human_review', attempt: reviewed, message: reviewed.error ?? message };
  }

  private async collectEvidence(
    attempt: ProductionMediaTaskAttempt,
    rubricVersion: string,
  ): Promise<MediaEvaluationEvidence> {
    if (!attempt.assetHash) throw new Error('Attempt has no asset to evaluate');
    const references = normalizeReferenceEvidence(attempt.generationSpec);
    for (const reference of references) {
      const asset = this.deps.db.repos.assets.findByHash(reference.assetHash);
      if (!asset || asset.type !== 'image') {
        throw new Error(
          `Required grading reference "${reference.assetHash}" is missing from the image index`,
        );
      }
      const referencePath = this.deps.cas.getAssetPath(reference.assetHash, 'image', asset.format);
      if (!fs.existsSync(referencePath)) {
        throw new Error(`Required grading reference is missing from CAS: ${reference.assetHash}`);
      }
    }

    if (attempt.mediaType === 'image') {
      assertVisionEvidenceLimit(references.length + 1);
      return {
        assetHashes: [...references.map((reference) => reference.assetHash), attempt.assetHash],
        metadata: {
          visionImageOrder: [
            ...references.map((reference, index) => ({
              index,
              kind: 'reference',
              assetHash: reference.assetHash,
              roles: reference.roles,
            })),
            {
              index: references.length,
              kind: 'generated_output',
              assetHash: attempt.assetHash,
            },
          ],
        },
        frameEvidence: [],
      };
    }

    const asset = this.deps.db.repos.assets.findByHash(attempt.assetHash);
    if (!asset || asset.type !== 'video') {
      throw new Error(`Video asset "${attempt.assetHash}" is missing from the index`);
    }
    const videoPath = this.deps.cas.getAssetPath(attempt.assetHash, 'video', asset.format);
    if (!fs.existsSync(videoPath)) throw new Error(`Video CAS file is missing: ${attempt.assetHash}`);
    const probe = await this.probeMedia(videoPath);
    if (probe.durationSeconds <= 0) throw new Error('Video duration is unavailable for grading');

    let detectedCuts: SceneCut[] = [];
    let sceneDetectionError: string | undefined;
    try {
      detectedCuts = await this.detectScenes(videoPath, 0.4);
    } catch (error) {
      sceneDetectionError = normalizeErrorMessage(error);
      log.warn('Scene detection failed; grading continues with five temporal anchors', {
        category: 'production-media',
        attemptId: attempt.id,
        error: sceneDetectionError,
      });
    }
    const timestamps = sampleVideoTimestamps(probe.durationSeconds, detectedCuts);
    assertVisionEvidenceLimit(references.length + timestamps.length);
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lucid-media-grade-'));
    const frameEvidence: TaskEvaluationFrameEvidence[] = [];
    try {
      for (const [index, timestampSeconds] of timestamps.entries()) {
        const outputPath = path.join(tempRoot, `frame-${index + 1}.png`);
        await this.extractFrameAtTime(videoPath, timestampSeconds, outputPath);
        const imported = await this.deps.cas.importAsset(outputPath, 'image');
        this.deps.db.repos.assets.insert({
          ...imported.meta,
          provider: 'ffmpeg-8.1.2',
          tags: [
            'production-media-evidence',
            `task-list:${attempt.taskListId}`,
            `attempt:${attempt.id}`,
            `timestamp:${timestampSeconds}`,
          ],
          generationMetadata: {
            prompt: 'Timestamped production-media evaluation frame',
            provider: 'ffmpeg-8.1.2',
            sourceVideoHash: attempt.assetHash,
            timestampSeconds,
            rubricVersion,
          },
        });
        frameEvidence.push({ timestampSeconds, assetHash: imported.ref.hash });
      }
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
    return {
      assetHashes: [
        ...references.map((reference) => reference.assetHash),
        ...frameEvidence.map((frame) => frame.assetHash),
      ],
      metadata: {
        ffprobe: probe,
        sampledTimestampsSeconds: timestamps,
        selectedSceneCuts: detectedCuts
          .filter((cut) => timestamps.includes(Number(cut.time.toFixed(3))))
          .map((cut) => ({ time: cut.time, score: cut.score })),
        ...(sceneDetectionError ? { sceneDetectionError } : {}),
        visionImageOrder: [
          ...references.map((reference, index) => ({
            index,
            kind: 'reference',
            assetHash: reference.assetHash,
            roles: reference.roles,
          })),
          ...frameEvidence.map((frame, frameIndex) => ({
            index: references.length + frameIndex,
            kind: 'generated_video_frame',
            assetHash: frame.assetHash,
            timestampSeconds: frame.timestampSeconds,
          })),
        ],
      },
      frameEvidence,
    };
  }
}

export interface MediaEvaluationEvidence {
  assetHashes: string[];
  metadata: Record<string, unknown>;
  frameEvidence: TaskEvaluationFrameEvidence[];
}

export function mediaEvaluationProfileForScope(
  scope: ProductionMediaScope,
): TaskEvaluation['profile'] {
  return MEDIA_EVALUATION_PROFILE_BY_SCOPE[scope];
}

export function createDefaultMediaEvaluationGrader(
  deps: Pick<MediaEvaluationServiceDeps, 'visualAnalyzer'>,
): MediaEvaluationGrader {
  return async (request, options) => {
    const response = await deps.visualAnalyzer.analyzeImageAssets(request.assetHashes, {
      systemPrompt: `You are the strict visual quality controller for an AI film production pipeline.
Return exactly one JSON object and no markdown. Score every field from 0 to 100.
Required schema:
{"scores":{"identity":0,"style":0,"scriptAlignment":0,"continuity":0,"composition":0,"lighting":0,"motion":0,"technical":0,"safety":0},"strengths":["..."],"risks":["..."],"evidence":["observable fact tied to a supplied image"],"repairDelta":{"version":1,"reason":"...","reasonCodes":["visual.rubric_failure"],"promptAdditions":["..."],"negativeAdditions":["..."],"preserve":["..."],"seedStrategy":"keep|increment","parameterChanges":{}}}
The supplied images are ordered and labeled in technicalMetadata. Compare every generated output/frame against every applicable reference label; do not mistake a reference image for generated output. Missing, contradictory, or visibly drifted identity evidence must not pass silently. For video, use all temporal anchors and scene-cut frames when scoring motion and continuity. Do not infer success from the prompt. Judge only visible evidence. For still images score motion as 100. Identity, approved style, script alignment, continuity, and safety are critical. A Repair Delta may refine the current attempt but must not change the approved story or Visual Constitution.`,
      userPrompt: canonicalJson({
        mediaType: request.mediaType,
        generationSpec: request.generationSpec,
        productionPlan: request.productionPlan,
        visualConstitution: request.visualConstitution,
        technicalMetadata: request.metadata,
        orderedFrames: request.frameEvidence,
      }),
      preferredLLMAdapter: options?.preferredLLMAdapter,
    });
    return { text: response.text, providerId: response.providerId, model: response.model };
  };
}

function normalizeReferenceEvidence(
  spec: ProductionMediaGenerationSpec,
): ProductionMediaGenerationSpec['referenceEvidence'] {
  const source = [...spec.referenceEvidence].sort((a, b) => a.order - b.order);
  const merged = new Map<
    string,
    ProductionMediaGenerationSpec['referenceEvidence'][number]
  >();
  for (const reference of source) {
    const existing = merged.get(reference.assetHash);
    if (!existing) {
      merged.set(reference.assetHash, {
        order: merged.size,
        assetHash: reference.assetHash,
        roles: [...reference.roles],
      });
      continue;
    }
    for (const role of reference.roles) {
      if (!existing.roles.some((candidate) => canonicalJson(candidate) === canonicalJson(role))) {
        existing.roles.push(role);
      }
    }
  }
  return [...merged.values()];
}

function assertVisionEvidenceLimit(count: number): void {
  if (count > MAX_VISION_EVIDENCE_IMAGES) {
    throw new Error(
      `Vision evidence contains ${count} images, above the hard limit of ${MAX_VISION_EVIDENCE_IMAGES}`,
    );
  }
}

function parseEvaluation(text: string, mediaType: 'image' | 'video'): EvaluationDecision {
  const parsed = parseJsonObject(text);
  const rawScores = asRecord(parsed.scores);
  const score = (key: keyof TaskEvaluationScoreSet): number => {
    const value = rawScores[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) {
      throw new Error(`Vision evaluation score ${key} must be between 0 and 100`);
    }
    return Math.round(value * 100) / 100;
  };
  const scores: TaskEvaluationScoreSet = {
    identity: score('identity'),
    style: score('style'),
    scriptAlignment: score('scriptAlignment'),
    continuity: score('continuity'),
    composition: score('composition'),
    lighting: score('lighting'),
    motion: mediaType === 'image' ? 100 : score('motion'),
    technical: score('technical'),
    safety: score('safety'),
  };
  const weighted =
    scores.identity * 0.15 +
    scores.style * 0.15 +
    scores.scriptAlignment * 0.15 +
    scores.continuity * 0.15 +
    scores.composition * 0.1 +
    scores.lighting * 0.1 +
    scores.motion * (mediaType === 'video' ? 0.1 : 0) +
    scores.technical * (mediaType === 'video' ? 0.05 : 0.15) +
    scores.safety * 0.05;
  const total = Math.round(weighted * 100) / 100;
  let verdict: TaskEvaluationVerdict;
  if (scores.safety < 80) verdict = 'human_review';
  else if (
    total >= 78 &&
    Math.min(
      scores.identity,
      scores.style,
      scores.scriptAlignment,
      scores.continuity,
      scores.technical,
    ) >= 65
  ) {
    verdict = 'pass';
  } else if (total >= 55) verdict = 'repair';
  else verdict = 'regenerate';
  return {
    scores,
    total,
    verdict,
    strengths: readBoundedStringArray(parsed.strengths),
    risks: readBoundedStringArray(parsed.risks),
    evidence: readBoundedStringArray(parsed.evidence),
    repairDelta: parseRepairDelta(parsed.repairDelta),
  };
}

function boundVerdict(
  decision: EvaluationDecision,
  bounds: MediaEvaluationVerdictBounds,
): TaskEvaluationVerdict {
  if (bounds.budgetExceeded) return 'human_review';
  if ((decision.verdict === 'repair' || decision.verdict === 'regenerate') && !bounds.canRetry) {
    return 'human_review';
  }
  return decision.verdict;
}

function parseRepairDelta(value: unknown): RepairDelta | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const reason = typeof record.reason === 'string' ? record.reason.trim() : '';
  const seedStrategy = record.seedStrategy;
  if (!reason || (seedStrategy !== 'keep' && seedStrategy !== 'increment')) return undefined;
  const rawChanges = asRecord(record.parameterChanges);
  const parameterChanges: Record<string, string | number | boolean> = {};
  for (const key of ['steps', 'cfgScale', 'img2imgStrength']) {
    const change = rawChanges[key];
    if (typeof change === 'number' && Number.isFinite(change)) parameterChanges[key] = change;
  }
  return {
    version: 1,
    reason,
    reasonCodes: readBoundedStringArray(record.reasonCodes).length
      ? readBoundedStringArray(record.reasonCodes)
      : ['vision.evaluation'],
    promptAdditions: readBoundedStringArray(record.promptAdditions),
    negativeAdditions: readBoundedStringArray(record.negativeAdditions),
    preserve: readBoundedStringArray(record.preserve),
    seedStrategy,
    source: 'vision_evaluation',
    ...(Object.keys(parameterChanges).length > 0 ? { parameterChanges } : {}),
  };
}

function normalizeRepairDelta(
  parsed: RepairDelta | undefined,
  risks: string[],
  verdict: 'repair' | 'regenerate',
): RepairDelta | undefined {
  if (parsed && (parsed.promptAdditions.length > 0 || parsed.negativeAdditions.length > 0)) {
    return parsed;
  }
  if (risks.length === 0) return undefined;
  return {
    version: 1,
    reason: `${verdict === 'repair' ? 'Repair' : 'Regenerate'} visible rubric failures`,
    reasonCodes: ['vision.rubric_failure'],
    promptAdditions: risks.map((risk) => `Correct: ${risk}`),
    negativeAdditions: risks,
    preserve: [],
    seedStrategy: verdict === 'regenerate' ? 'increment' : 'keep',
    source: 'vision_evaluation',
  };
}

function parseJsonObject(text: string): Record<string, unknown> {
  const trimmed = text.trim();
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
  const first = withoutFence.indexOf('{');
  const last = withoutFence.lastIndexOf('}');
  if (first < 0 || last <= first) throw new Error('Vision evaluation did not return JSON');
  const parsed = JSON.parse(withoutFence.slice(first, last + 1));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Vision evaluation must be a JSON object');
  }
  return parsed as Record<string, unknown>;
}

function sampleVideoTimestamps(durationSeconds: number, sceneCuts: SceneCut[] = []): number[] {
  const end = Math.max(0, durationSeconds - 0.1);
  const anchors = [
    Math.min(0.1, end),
    durationSeconds * 0.25,
    durationSeconds * 0.5,
    durationSeconds * 0.75,
    end,
  ].map((value) => Number(Math.min(end, Math.max(0, value)).toFixed(3)));
  const selectedCuts = [...sceneCuts]
    .filter(
      (cut) =>
        Number.isFinite(cut.time) &&
        Number.isFinite(cut.score) &&
        cut.time >= 0 &&
        cut.time <= durationSeconds,
    )
    .sort((a, b) => b.score - a.score || a.time - b.time)
    .map((cut) => Number(Math.min(end, cut.time).toFixed(3)))
    .filter((time, index, all) => {
      if (all.indexOf(time) !== index) return false;
      return anchors.every((anchor) => Math.abs(anchor - time) >= 0.15);
    })
    .slice(0, 3);
  return [...new Set([...anchors, ...selectedCuts])].sort((a, b) => a - b);
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    : [];
}

function readBoundedStringArray(value: unknown): string[] {
  return readStringArray(value)
    .slice(0, 20)
    .map((entry) => entry.slice(0, 500));
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(',')}}`;
}
