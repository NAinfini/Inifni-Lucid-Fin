import { describe, expect, it, vi } from 'vitest';
import {
  selectPromptGuidesForContext,
  buildWorkspaceSnapshot,
  buildPersistentWorkflowContext,
  buildPersistentWorkflowManifest,
} from './commander-context.service.js';

describe('buildWorkspaceSnapshot', () => {
  it('recognizes a structured Canvas style draft even when it has no summary', () => {
    const snapshot = buildWorkspaceSnapshot(
      {
        id: 'canvas-1',
        name: 'Storyboard',
        nodes: [],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
        notes: [],
        settings: {
          visualStylePolicy: {
            version: 1,
            locked: { lighting: 'low-key tungsten', palette: 'amber and teal' },
          },
        },
        createdAt: 1,
        updatedAt: 1,
      },
      [],
      {
        repos: {
          entities: {
            listCharacters: () => ({ rows: [] }),
            listLocations: () => ({ rows: [] }),
            listEquipment: () => ({ rows: [] }),
          },
        },
      } as never,
    );

    expect(snapshot).toContain(
      'Canvas manual style draft (not workflow authority): structured locks:',
    );
    expect(snapshot).toContain('lighting');
    expect(snapshot).toContain('palette');
    expect(snapshot).not.toContain('Canvas manual style draft (not workflow authority): NOT SET');
  });
});

describe('selectPromptGuidesForContext', () => {
  it('keeps applicable guides discovery-only unless autoInject is explicitly enabled', () => {
    const selected = selectPromptGuidesForContext(
      [
        { id: 'manual', name: 'Manual guide', content: 'manual', priority: 100 },
        {
          id: 'automatic',
          name: 'Automatic guide',
          content: 'full automatic guide',
          autoInject: true,
          autoInjectContent: 'automatic kernel',
          priority: 1,
        },
      ],
      'media_generation',
    );

    expect(selected.injected).toEqual([
      expect.objectContaining({ id: 'automatic', content: 'automatic kernel' }),
    ]);
    expect(selected.discoveryOnly).toContainEqual({ id: 'manual', name: 'Manual guide' });
  });

  it('ranks a later workflow-critical guide ahead of the first eight low-priority guides', () => {
    const guides = [
      ...Array.from({ length: 8 }, (_, index) => ({
        id: `low-${index}`,
        name: `Low ${index}`,
        content: 'low',
        autoInject: true,
        autoInjectContent: 'low',
        priority: 1,
      })),
      {
        id: 'story-to-video',
        name: 'Story to Video',
        content: 'critical',
        autoInject: true,
        autoInjectContent: 'critical',
        priority: 100,
        retention: 'workflow' as const,
        phases: ['media_generation' as const],
      },
    ];

    const selected = selectPromptGuidesForContext(guides, 'media_generation');

    expect(selected.injected.map((guide) => guide.id)).toContain('story-to-video');
    expect(selected.injected).toHaveLength(8);
    expect(selected.discoveryOnly.map((guide) => guide.id)).toContain('low-7');
  });

  it('enforces the hard character budget even for auto-injected guides', () => {
    const selected = selectPromptGuidesForContext(
      Array.from({ length: 5 }, (_, index) => ({
        id: `guide-${index}`,
        name: `Guide ${index}`,
        content: `full guide ${index}`,
        autoInject: true,
        autoInjectContent: String(index).repeat(2000),
        priority: 5 - index,
      })),
      'unbound',
    );

    expect(selected.injected.map((guide) => guide.id)).toEqual([
      'guide-0',
      'guide-1',
      'guide-2',
      'guide-3',
    ]);
    expect(
      selected.injected.reduce((sum, guide) => sum + guide.content.length, 0),
    ).toBeLessThanOrEqual(8000);
    expect(selected.discoveryOnly).toEqual([{ id: 'guide-4', name: 'Guide 4' }]);
  });

  it('keeps a full guide discovery-only when its injection summary is missing or oversized', () => {
    const selected = selectPromptGuidesForContext(
      [
        { id: 'missing', name: 'Missing', content: 'full', autoInject: true },
        {
          id: 'oversized',
          name: 'Oversized',
          content: 'full',
          autoInject: true,
          autoInjectContent: 'x'.repeat(2001),
        },
      ],
      'unbound',
    );

    expect(selected.injected).toEqual([]);
    expect(selected.discoveryOnly).toEqual([
      { id: 'missing', name: 'Missing' },
      { id: 'oversized', name: 'Oversized' },
    ]);
  });

  it('keeps guides for other workflow phases discovery-only', () => {
    const selected = selectPromptGuidesForContext(
      [
        {
          id: 'style-only',
          name: 'Style only',
          content: 'style',
          autoInject: true,
          autoInjectContent: 'style kernel',
          phases: ['style_exploration'],
        },
      ],
      'media_generation',
    );

    expect(selected.injected).toEqual([]);
    expect(selected.discoveryOnly).toEqual([{ id: 'style-only', name: 'Style only' }]);
  });
});

describe('buildPersistentWorkflowManifest', () => {
  it('projects the current durable task contract and bounded shot input', () => {
    const manifest = buildPersistentWorkflowManifest({
      repos: {
        workflows: {
          listRuns: vi.fn(() => ({
            rows: [
              {
                id: 'wf-shot-1',
                workflowType: 'movie.production.v2',
                entityType: 'canvas',
                entityId: 'canvas-1',
                status: 'ready',
                rowVersion: 7,
                currentStageId: 'stage-preproduction-1',
                currentTaskId: 'task-shot-1',
              },
            ],
          })),
          getStageRun: vi.fn(() => ({
            id: 'stage-preproduction-1',
            workflowRunId: 'wf-shot-1',
            stageId: 'preproduction',
          })),
          getTaskRun: vi.fn(() => ({
            id: 'task-shot-1',
            workflowRunId: 'wf-shot-1',
            taskId: 'shot-spec-003',
            status: 'ready',
            input: {
              workflowTaskRole: 'shot_spec',
              executionMode: 'external',
              privateProviderConfig: 'must-not-leak',
              shot: {
                id: '003',
                actIndex: 0,
                sceneIndex: 2,
                title: 'Crossing the salt flats',
                storyBeat: 'Mara sees the beacon',
                privateNotes: 'must-not-leak',
              },
            },
          })),
          getLatestDocument: vi.fn(() => undefined),
          getPendingApproval: vi.fn(() => undefined),
        },
      },
    } as never);

    expect(manifest).toContain('Current task contract');
    expect(manifest).toContain('Persist the structured shot contract');
    expect(manifest).toContain('canvas.setNodeRefs');
    expect(manifest).toContain('Crossing the salt flats');
    expect(manifest).toContain('Mara sees the beacon');
    expect(manifest).not.toContain('privateProviderConfig');
    expect(manifest).not.toContain('privateNotes');
  });

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
                currentStageId: 'stage-visual-1',
              },
            ],
          })),
          getStageRun: vi.fn(() => ({
            id: 'stage-visual-1',
            workflowRunId: 'wf-visual-1',
            stageId: 'style-exploration',
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
                currentStageId: 'stage-final-1',
              },
            ],
          })),
          getStageRun: vi.fn(() => ({
            id: 'stage-final-1',
            workflowRunId: 'wf-final-1',
            stageId: 'final-export',
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
                currentStageId: 'stage-media-1',
              },
            ],
          })),
          getStageRun: vi.fn(() => ({
            id: 'stage-media-1',
            workflowRunId: 'wf-media-1',
            stageId: 'media-generation',
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
    expect(manifest).toContain('attemptId=attempt-1');
    expect(manifest).toContain(`basePromptHash=${'p'.repeat(64)}`);
    expect(manifest).toContain('status=repair_required');
    expect(manifest).toContain('production-media-rubric-v1');
    expect(manifest).toContain('middle frame shows a blue scarf');
    expect(manifest).toContain('restore red scarf');
    expect(manifest).not.toContain('very long private provider prompt');
  });

  it('reloads pending and recovery-required workflow decisions with their durable task facts', () => {
    const manifest = buildPersistentWorkflowManifest({
      repos: {
        workflows: {
          listRuns: vi.fn(() => ({
            rows: [
              {
                id: 'wf-decisions-1',
                workflowType: 'movie.production.v2',
                entityType: 'canvas',
                entityId: 'canvas-1',
                status: 'blocked',
                rowVersion: 14,
                currentStageId: 'stage-media-1',
                currentTaskId: 'task-media-2',
              },
            ],
          })),
          getStageRun: vi.fn(() => ({
            id: 'stage-media-1',
            workflowRunId: 'wf-decisions-1',
            stageId: 'media-generation',
          })),
          getTaskRun: vi.fn((taskRunId: string) => ({
            id: taskRunId,
            workflowRunId: 'wf-decisions-1',
            taskId: taskRunId === 'task-media-2' ? 'media-shot-002' : 'media-shot-001',
            status: 'blocked',
            input: { workflowTaskRole: 'production_media', shotId: 'shot-001' },
          })),
          getLatestDocument: vi.fn(() => undefined),
          getLatestExportExecution: vi.fn(() => undefined),
          listMediaAttempts: vi.fn(() => []),
          listMediaEvaluations: vi.fn(() => []),
          getMediaCostSummary: vi.fn(() => undefined),
          listPendingDecisions: vi.fn(() => [
            {
              id: 'decision-pending',
              workflowRunId: 'wf-decisions-1',
              taskRunId: 'task-media-1',
              canvasId: 'canvas-1',
              questionId: 'question-provider',
              decisionKey: 'missing-video-provider',
              subjectRevision: 3,
              question: 'Which configured video provider should render this shot?',
              options: [
                {
                  id: 'primary',
                  label: 'Primary provider',
                  description: 'Use the approved default.',
                },
              ],
              allowFreeText: false,
              status: 'pending',
              rowVersion: 1,
              createdAt: 100,
              updatedAt: 100,
            },
            {
              id: 'decision-recovery',
              workflowRunId: 'wf-decisions-1',
              taskRunId: 'task-media-2',
              canvasId: 'canvas-1',
              questionId: 'question-budget',
              decisionKey: 'budget-overrun',
              subjectRevision: 3,
              question: 'The approved retry budget is exhausted. What should happen next?',
              options: [{ id: 'stop', label: 'Stop here' }],
              allowFreeText: true,
              status: 'recovery_required',
              answer: 'Stop and keep the latest accepted clip.',
              selectedOptionId: 'stop',
              rowVersion: 2,
              createdAt: 200,
              updatedAt: 300,
              answeredAt: 300,
            },
          ]),
          getPendingApproval: vi.fn(() => undefined),
        },
      },
    } as never);

    expect(manifest).toContain('Workflow decision: status=pending');
    expect(manifest).toContain('decisionKey=missing-video-provider');
    expect(manifest).toContain('Which configured video provider');
    expect(manifest).toContain('task=media-shot-001 (task-media-1)');
    expect(manifest).toContain('Workflow decision: status=recovery_required');
    expect(manifest).toContain('Stop and keep the latest accepted clip.');
    expect(manifest).toContain('selectedOption=stop');
    expect(manifest).toContain('task=media-shot-002 (task-media-2)');
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
                  currentStageId: 'stage-plan-1',
                  currentTaskId: 'task-plan-1',
                },
              ],
            })),
            getStageRun: vi.fn(() => ({
              id: 'stage-plan-1',
              workflowRunId: 'wf-plan-1',
              stageId: 'production-plan',
            })),
            getTaskRun: vi.fn(() => ({
              id: 'task-plan-1',
              workflowRunId: 'wf-plan-1',
              taskId: 'production-plan',
              status: 'blocked',
              input: { workflowTaskRole: 'document' },
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
      currentTaskRunId: 'task-plan-1',
      currentTaskId: 'production-plan',
      currentTaskRole: 'document',
      currentStageId: 'production-plan',
      subjectRevision: 1,
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
