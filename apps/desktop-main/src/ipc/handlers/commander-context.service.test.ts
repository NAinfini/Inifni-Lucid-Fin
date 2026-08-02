import { describe, expect, it, vi } from 'vitest';
import {
  buildPersistentWorkflowContext,
  buildPersistentWorkflowManifest,
} from './commander-context.service.js';

describe('buildPersistentWorkflowManifest', () => {
  it('reloads the exact pending gate and approved bounds without exposing the resume token', () => {
    const getLatestDocument = vi.fn((_runId: string, logicalKey: string) =>
      logicalKey === 'production-plan'
        ? {
            revision: 2,
            contentHash: 'a'.repeat(64),
            status: 'active',
            content: {
              title: 'The Last Signal',
              budget: { maxTotalCostUsd: 25, maxRegenerations: 8 },
              visualDirections: ['analog cosmic horror'],
            },
          }
        : undefined,
    );
    const manifest = buildPersistentWorkflowManifest({
      repos: {
        workflows: {
          listRuns: vi.fn(() => ({
            rows: [
              {
                id: 'wf-plan-1',
                status: 'awaiting_approval',
                rowVersion: 4,
                currentGate: 'production_plan',
              },
            ],
          })),
          getLatestDocument,
          getPendingApproval: vi.fn(() => ({
            id: 'approval-2',
            gateKey: 'production_plan',
            subjectRevision: 2,
            subjectHash: 'a'.repeat(64),
            resumeTokenHash: 'host-secret-hash',
          })),
        },
      },
    } as never);

    expect(manifest).toContain('Authority: SQLite workflow aggregate');
    expect(manifest).toContain('Run wf-plan-1');
    expect(manifest).toContain('Production Plan: revision=2');
    expect(manifest).toContain('Pending human approval: production_plan');
    expect(manifest).toContain('maxTotalCostUsd');
    expect(manifest).not.toContain('host-secret-hash');
  });

  it('fails closed when workflow persistence cannot be read', () => {
    const manifest = buildPersistentWorkflowManifest({
      repos: {
        workflows: {
          listRuns: vi.fn(() => {
            throw new Error('database unavailable');
          }),
        },
      },
    } as never);
    expect(manifest).toContain('pause workflow mutations');
  });

  it('reloads bounded visual audition heads, costs, grading evidence, and failures', () => {
    const manifest = buildPersistentWorkflowManifest({
      repos: {
        workflows: {
          listRuns: vi.fn(() => ({
            rows: [
              {
                id: 'wf-visual-1',
                workflowType: 'movie.production.v2',
                entityType: 'canvas',
                entityId: 'canvas-1',
                status: 'ready',
                rowVersion: 9,
                currentStageId: 'style-exploration',
              },
            ],
          })),
          getLatestDocument: vi.fn((_runId: string, logicalKey: string) =>
            logicalKey === 'visual-auditions'
              ? {
                  revision: 6,
                  contentHash: 'd'.repeat(64),
                  status: 'active',
                  content: {
                    status: 'ambiguous',
                    requestHash: 'r'.repeat(64),
                    rubricVersion: 'visual-preview-rubric-v1',
                    productionPlan: { revision: 2, contentHash: 'p'.repeat(64) },
                    providerId: 'image-provider',
                    width: 1024,
                    height: 576,
                    budget: {
                      approvedStyleAuditionCostUsd: 2,
                      estimatedCommittedUsd: 0.3,
                      reportedActualUsd: 0.25,
                      hasUnreportedActualCosts: false,
                      unpricedOperations: ['vision-grade'],
                    },
                    failure: {
                      candidateId: 'analog-horror',
                      message: 'Vision grading unavailable',
                      ambiguous: true,
                    },
                    candidates: [
                      {
                        id: 'analog-horror',
                        name: 'Analog Horror',
                        summary: 'Tactile dread',
                        prompt: 'do not duplicate this long provider prompt',
                        constitution: { palette: 'amber' },
                        status: 'ambiguous',
                        selectedAttempt: 1,
                        attempts: [
                          {
                            attempt: 1,
                            status: 'ambiguous',
                            promptHash: 'h'.repeat(64),
                            providerId: 'image-provider',
                            model: 'image-model',
                            requestedSeed: 42,
                            assetHash: 'asset-preview',
                            estimatedCostUsd: 0.3,
                            reportedActualCostUsd: 0.25,
                            error: 'Vision grading unavailable',
                            grade: {
                              rubricVersion: 'visual-preview-rubric-v1',
                              total: 82,
                              verdict: 'pass',
                              evidence: 'The tungsten practical is visible.',
                              visionProviderId: 'vision-provider',
                            },
                          },
                        ],
                      },
                    ],
                  },
                }
              : undefined,
          ),
          getPendingApproval: vi.fn(() => undefined),
        },
      },
    } as never);

    expect(manifest).toContain('Visual Auditions: revision=6');
    expect(manifest).toContain('asset-preview');
    expect(manifest).toContain('vision-provider');
    expect(manifest).toContain('reportedActualUsd');
    expect(manifest).toContain('Vision grading unavailable');
    expect(manifest).not.toContain('do not duplicate this long provider prompt');
    expect(manifest).not.toContain('constitution');
  });

  it('reloads the bounded Final Export manifest and execution receipt without leaking paths', () => {
    const manifest = buildPersistentWorkflowManifest({
      repos: {
        workflows: {
          listRuns: vi.fn(() => ({
            rows: [
              {
                id: 'wf-final-1',
                workflowType: 'movie.production.v2',
                entityType: 'canvas',
                entityId: 'canvas-1',
                status: 'ready',
                rowVersion: 12,
                currentStageId: 'final-export',
              },
            ],
          })),
          getLatestDocument: vi.fn((_runId: string, logicalKey: string) =>
            logicalKey === 'final-export'
              ? {
                  revision: 3,
                  contentHash: 'f'.repeat(64),
                  status: 'active',
                  content: {
                    manifestVersion: 1,
                    productionPlan: { revision: 1, contentHash: 'a'.repeat(64) },
                    visualConstitution: { revision: 2, contentHash: 'b'.repeat(64) },
                    canvasId: 'canvas-1',
                    assemblySnapshotHash: 'c'.repeat(64),
                    segments: [
                      {
                        order: 0,
                        nodeId: 'shot-1',
                        nodeUpdatedAt: 20,
                        title: 'A deliberately verbose title need not enter model context',
                        assetHash: 'd'.repeat(64),
                        assetFormat: 'mp4',
                        selectedVariantIndex: 0,
                        trimInMs: 0,
                        trimOutMs: 5000,
                        sourceDurationMs: 5000,
                        durationSeconds: 5,
                        speed: 1,
                      },
                    ],
                    audioTracks: [],
                    subtitleTracks: [],
                    output: { codec: 'h264', container: 'mp4', width: 1920, height: 1080, fps: 24 },
                    expectedDurationMs: 5000,
                    maxRenderAttempts: 2,
                    capabilities: {
                      embeddedClipAudio: true,
                      separateAudioMix: false,
                      subtitles: false,
                    },
                  },
                }
              : undefined,
          ),
          getLatestExportExecution: vi.fn(() => ({
            status: 'ready_to_publish',
            attempt: 1,
            manifestRevision: 3,
            manifestHash: 'f'.repeat(64),
            outputHash: 'e'.repeat(64),
            outputSize: 1234,
            destinationPath: 'C:\\Users\\secret\\movie.mp4',
          })),
          getPendingApproval: vi.fn(() => undefined),
        },
      },
    } as never);

    expect(manifest).toContain('Final Export: revision=3');
    expect(manifest).toContain('assetHash');
    expect(manifest).toContain('ready_to_publish');
    expect(manifest).toContain('outputBytes=1234');
    expect(manifest).not.toContain('C:\\Users\\secret');
    expect(manifest).not.toContain('deliberately verbose title');
  });

  it('reloads bounded production attempts and grading evidence without full prompts', () => {
    const manifest = buildPersistentWorkflowManifest({
      repos: {
        workflows: {
          listRuns: vi.fn(() => ({
            rows: [
              {
                id: 'wf-media-1',
                workflowType: 'movie.production.v2',
                entityType: 'canvas',
                entityId: 'canvas-1',
                status: 'ready',
                rowVersion: 8,
                currentStageId: 'media-generation',
              },
            ],
          })),
          getLatestDocument: vi.fn(() => undefined),
          getLatestExportExecution: vi.fn(() => undefined),
          listMediaAttempts: vi.fn(() => [
            {
              id: 'attempt-1',
              nodeId: 'shot-1',
              attempt: 1,
              mediaType: 'video',
              status: 'repair_required',
              specHash: 's'.repeat(64),
              promptHash: 'p'.repeat(64),
              prompt: 'a very long private provider prompt must not enter context',
              providerId: 'video-provider',
              model: 'video-model',
              seed: 42,
              estimatedCostUsd: 0.5,
              reportedActualCostUsd: 0.45,
              assetHash: 'asset-video-1',
              repairDelta: {
                reason: 'identity drift',
                promptAdditions: ['restore red scarf'],
              },
            },
          ]),
          listMediaEvaluations: vi.fn(() => [
            {
              attemptId: 'attempt-1',
              rubricVersion: 'production-media-rubric-v1',
              verdict: 'repair',
              total: 68,
              scores: { identity: 45, style: 80 },
              risks: ['red scarf is missing'],
              evidence: ['middle frame shows a blue scarf'],
              frameEvidence: [{ timestampSeconds: 3, assetHash: 'frame-2' }],
            },
          ]),
          getMediaCostSummary: vi.fn(() => ({
            attemptCount: 1,
            regenerationCount: 0,
            estimatedCostUsd: 0.5,
            reportedActualCostUsd: 0.45,
            committedCostUsd: 0.45,
            hasUnreportedActualCosts: false,
          })),
          getPendingApproval: vi.fn(() => undefined),
        },
      },
    } as never);

    expect(manifest).toContain('Production media budget ledger');
    expect(manifest).toContain('status=repair_required');
    expect(manifest).toContain('production-media-rubric-v1');
    expect(manifest).toContain('middle frame shows a blue scarf');
    expect(manifest).toContain('restore red scarf');
    expect(manifest).not.toContain('very long private provider prompt');
  });

  it('derives a production-plan pending policy only from the exact stored subject', () => {
    const subjectHash = 'b'.repeat(64);
    const getPendingApproval = vi.fn(() => ({
      id: 'approval-1',
      gateKey: 'production_plan',
      subjectLogicalKey: 'production-plan',
      subjectRevision: 1,
      subjectHash,
      status: 'pending',
    }));
    const context = buildPersistentWorkflowContext(
      {
        repos: {
          workflows: {
            listRuns: vi.fn(() => ({
              rows: [
                {
                  id: 'wf-plan-1',
                  workflowType: 'movie.production.v2',
                  entityType: 'canvas',
                  entityId: 'canvas-1',
                  status: 'awaiting_approval',
                  rowVersion: 3,
                  currentGate: 'production_plan',
                },
              ],
            })),
            getLatestDocument: vi.fn(() => undefined),
            getLatestApproval: vi.fn(() => undefined),
            getPendingApproval,
            getDocumentRevision: vi.fn(() => ({ revision: 1, contentHash: subjectHash })),
          },
        },
      } as never,
      'canvas-1',
    );

    expect(context.workflowToolPolicy).toEqual({
      workflowRunId: 'wf-plan-1',
      rowVersion: 3,
      phase: 'production_plan_pending',
      gate: 'production_plan',
    });
  });

  it('fails closed when a pending approval does not match its immutable document', () => {
    const context = buildPersistentWorkflowContext(
      {
        repos: {
          workflows: {
            listRuns: vi.fn(() => ({
              rows: [
                {
                  id: 'wf-plan-1',
                  workflowType: 'movie.production.v2',
                  entityType: 'canvas',
                  entityId: 'canvas-1',
                  status: 'awaiting_approval',
                  rowVersion: 3,
                  currentGate: 'production_plan',
                },
              ],
            })),
            getLatestDocument: vi.fn(() => undefined),
            getLatestApproval: vi.fn(() => undefined),
            getPendingApproval: vi.fn(() => ({
              id: 'approval-1',
              gateKey: 'production_plan',
              subjectLogicalKey: 'production-plan',
              subjectRevision: 1,
              subjectHash: 'b'.repeat(64),
              status: 'pending',
            })),
            getDocumentRevision: vi.fn(() => ({
              revision: 1,
              contentHash: 'c'.repeat(64),
            })),
          },
        },
      } as never,
      'canvas-1',
    );

    expect(context.workflowToolPolicy).toMatchObject({
      workflowRunId: 'wf-plan-1',
      phase: 'blocked',
      gate: 'production_plan',
    });
    expect(context.workflowToolPolicy?.reason).toContain('could not be verified');
  });
});
