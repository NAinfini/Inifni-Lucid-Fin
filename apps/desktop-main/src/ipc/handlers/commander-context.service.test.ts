import { describe, expect, it, vi } from 'vitest';
import {
  selectPromptGuidesForContext,
  buildWorkspaceSnapshot,
  buildPersistentTaskListContext,
  buildPersistentTaskListManifest,
} from './commander-context.service.js';

function taskListRepoDefaults() {
  return {
    listTaskLists: vi.fn(() => ({ rows: [], degradedCount: 0 })),
    getTask: vi.fn(() => undefined),
    getLatestDocument: vi.fn(() => undefined),
    getLatestApproval: vi.fn(() => undefined),
    getDocumentRevision: vi.fn(() => undefined),
    getPendingApproval: vi.fn(() => undefined),
    getLatestDeliveryPackageAttempt: vi.fn(() => undefined),
    listProductionMediaAttempts: vi.fn(() => []),
    listTaskEvaluations: vi.fn(() => []),
    getTaskCostSummary: vi.fn(() => ({
      attemptCount: 0,
      regenerationCount: 0,
      estimatedCostUsd: 0,
      reportedActualCostUsd: 0,
      committedCostUsd: 0,
      hasUnreportedActualCosts: false,
    })),
    listPendingDecisions: vi.fn(() => []),
  };
}

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
      'Canvas manual style draft (not Task List authority): structured locks:',
    );
    expect(snapshot).toContain('lighting');
    expect(snapshot).toContain('palette');
    expect(snapshot).not.toContain('Canvas manual style draft (not Task List authority): NOT SET');
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

  it('ranks a later Task-List-critical guide ahead of the first eight low-priority guides', () => {
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
        retention: 'task_list' as const,
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

  it('keeps guides for other Task List phases discovery-only', () => {
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

describe('buildPersistentTaskListManifest', () => {
  it('projects the current durable task contract and bounded shot input', () => {
    const manifest = buildPersistentTaskListManifest({
      repos: {
        taskLists: {
          ...taskListRepoDefaults(),
          listTaskLists: vi.fn(() => ({
            rows: [
              {
                id: 'task-list-shot-1',
                taskListType: 'movie.production.v2',
                entityType: 'canvas',
                entityId: 'canvas-1',
                status: 'ready',
                rowVersion: 7,
                currentPhaseKey: 'preproduction',
                currentTaskId: 'task-shot-1',
              },
            ],
          })),
          getTask: vi.fn(() => ({
            id: 'task-shot-1',
            taskListId: 'task-list-shot-1',
            taskKey: 'shot-spec-003',
            phaseKey: 'preproduction',
            status: 'ready',
            input: {
              taskRole: 'shot_spec',
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

  it('projects the exact chat revision request into the current plan task context', () => {
    const manifest = buildPersistentTaskListManifest({
      repos: {
        taskLists: {
          ...taskListRepoDefaults(),
          listTaskLists: vi.fn(() => ({
            rows: [
              {
                id: 'task-list-plan-1',
                taskListType: 'movie.production.v2',
                entityType: 'canvas',
                entityId: 'canvas-1',
                status: 'ready',
                rowVersion: 8,
                currentPhaseKey: 'production-plan',
                currentTaskId: 'task-plan-1',
              },
            ],
          })),
          getTask: vi.fn(() => ({
            id: 'task-plan-1',
            taskListId: 'task-list-plan-1',
            taskKey: 'production-plan',
            phaseKey: 'production-plan',
            status: 'ready',
            input: {
              taskRole: 'document',
              documentLogicalKey: 'production-plan',
              revisionRequest: {
                action: 'request_changes',
                reason: 'Give the ending more hope.',
                previousRevision: 2,
                previousHash: 'a'.repeat(64),
                internalNote: 'must-not-leak',
              },
            },
          })),
          getLatestDocument: vi.fn(() => undefined),
          getPendingApproval: vi.fn(() => undefined),
        },
      },
    } as never);

    expect(manifest).toContain('Give the ending more hope.');
    expect(manifest).toContain('previousRevision');
    expect(manifest).not.toContain('internalNote');
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
    const manifest = buildPersistentTaskListManifest({
      repos: {
        taskLists: {
          ...taskListRepoDefaults(),
          listTaskLists: vi.fn(() => ({
            rows: [
              {
                id: 'task-list-plan-1',
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

    expect(manifest).toContain('Authority: SQLite Task List aggregate');
    expect(manifest).toContain('Approval state is represented by pending gate records');
    expect(manifest).toContain('Task List task-list-plan-1');
    expect(manifest).toContain('Production Plan: revision=2');
    expect(manifest).toContain('Pending human approval: production_plan');
    expect(manifest).toContain('maxTotalCostUsd');
    expect(manifest).not.toContain('the model may apply');
    expect(manifest).not.toContain('host-secret-hash');
  });

  it('fails closed when Task List persistence cannot be read', () => {
    const manifest = buildPersistentTaskListManifest({
      repos: {
        taskLists: {
          ...taskListRepoDefaults(),
          listTaskLists: vi.fn(() => {
            throw new Error('database unavailable');
          }),
        },
      },
    } as never);
    expect(manifest).toContain('pause Task List mutations');
  });

  it('reloads bounded visual audition heads, costs, grading evidence, and failures', () => {
    const manifest = buildPersistentTaskListManifest({
      repos: {
        taskLists: {
          ...taskListRepoDefaults(),
          listTaskLists: vi.fn(() => ({
            rows: [
              {
                id: 'task-list-visual-1',
                taskListType: 'movie.production.v2',
                entityType: 'canvas',
                entityId: 'canvas-1',
                status: 'ready',
                rowVersion: 9,
                currentPhaseKey: 'style-exploration',
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

  it('reloads the bounded Delivery manifest and package receipt without leaking paths', () => {
    const manifest = buildPersistentTaskListManifest({
      repos: {
        taskLists: {
          ...taskListRepoDefaults(),
          listTaskLists: vi.fn(() => ({
            rows: [
              {
                id: 'task-list-delivery-1',
                taskListType: 'movie.production.v2',
                entityType: 'canvas',
                entityId: 'canvas-1',
                status: 'ready',
                rowVersion: 12,
                currentPhaseKey: 'delivery',
              },
            ],
          })),
          getLatestDocument: vi.fn((_runId: string, logicalKey: string) =>
            logicalKey === 'delivery-manifest'
              ? {
                  revision: 3,
                  contentHash: 'f'.repeat(64),
                  status: 'active',
                  content: {
                    taskListId: 'task-list-delivery-1',
                    productionPlan: { revision: 1, contentHash: 'a'.repeat(64) },
                    visualConstitution: { revision: 2, contentHash: 'b'.repeat(64) },
                    canvasId: 'canvas-1',
                    deliverySequence: { revision: 4, contentHash: 'c'.repeat(64) },
                    namingPolicy: {
                      packageBaseName: 'movie',
                      orderPrefixWidth: 3,
                      separator: '_',
                      overwritePolicy: 'fail',
                    },
                    items: [
                      {
                        shotId: 'shot-1',
                        selectedVideoHash: 'd'.repeat(64),
                        packageFileName: '001_opening.mp4',
                        sourceFileName: 'a-deliberately-private-source-name.mp4',
                        sourceFormat: 'mp4',
                        sourceBytes: 1234,
                        sourceDurationMs: 5000,
                        trimInMs: 0,
                        trimOutMs: 5000,
                        embeddedAudioEnabled: true,
                        provenance: {
                          assetCreatedAt: 10,
                          nodeId: 'node-1',
                          taskId: 'task-1',
                        },
                      },
                    ],
                  },
                }
              : undefined,
          ),
          getLatestDeliveryPackageAttempt: vi.fn(() => ({
            status: 'ready_to_publish',
            attempt: 1,
            manifestRevision: 3,
            manifestHash: 'f'.repeat(64),
            packageHash: 'e'.repeat(64),
            packageBytes: 1234,
            fileCount: 3,
            destinationPath: 'C:\\Users\\secret\\movie-delivery-ffffffffffff',
          })),
          getPendingApproval: vi.fn(() => undefined),
        },
      },
    } as never);

    expect(manifest).toContain('Delivery Manifest: revision=3');
    expect(manifest).toContain('selectedVideoHash');
    expect(manifest).toContain('ready_to_publish');
    expect(manifest).toContain('packageBytes=1234');
    expect(manifest).not.toContain('C:\\Users\\secret');
    expect(manifest).not.toContain('deliberately-private-source-name');
  });

  it('reloads bounded production attempts and grading evidence without full prompts', () => {
    const manifest = buildPersistentTaskListManifest({
      repos: {
        taskLists: {
          ...taskListRepoDefaults(),
          listTaskLists: vi.fn(() => ({
            rows: [
              {
                id: 'task-list-media-1',
                taskListType: 'movie.production.v2',
                entityType: 'canvas',
                entityId: 'canvas-1',
                status: 'ready',
                rowVersion: 8,
                currentPhaseKey: 'media-generation',
              },
            ],
          })),
          getLatestDocument: vi.fn(() => undefined),
          getLatestDeliveryPackageAttempt: vi.fn(() => undefined),
          listProductionMediaAttempts: vi.fn(() => [
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
          listTaskEvaluations: vi.fn(() => [
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
          getTaskCostSummary: vi.fn(() => ({
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

  it('reloads pending and recovery-required Task decisions with their durable task facts', () => {
    const manifest = buildPersistentTaskListManifest({
      repos: {
        taskLists: {
          ...taskListRepoDefaults(),
          listTaskLists: vi.fn(() => ({
            rows: [
              {
                id: 'task-list-decisions-1',
                taskListType: 'movie.production.v2',
                entityType: 'canvas',
                entityId: 'canvas-1',
                status: 'blocked',
                rowVersion: 14,
                currentPhaseKey: 'media-generation',
                currentTaskId: 'task-media-2',
              },
            ],
          })),
          getTask: vi.fn((taskId: string) => ({
            id: taskId,
            taskListId: 'task-list-decisions-1',
            taskKey: taskId === 'task-media-2' ? 'media-shot-002' : 'media-shot-001',
            phaseKey: 'media-generation',
            status: 'blocked',
            input: { taskRole: 'production_media', shotId: 'shot-001' },
          })),
          getLatestDocument: vi.fn(() => undefined),
          getLatestDeliveryPackageAttempt: vi.fn(() => undefined),
          listProductionMediaAttempts: vi.fn(() => []),
          listTaskEvaluations: vi.fn(() => []),
          getTaskCostSummary: vi.fn(() => undefined),
          listPendingDecisions: vi.fn(() => [
            {
              id: 'decision-pending',
              taskListId: 'task-list-decisions-1',
              taskId: 'task-media-1',
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
              taskListId: 'task-list-decisions-1',
              taskId: 'task-media-2',
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

    expect(manifest).toContain('Task decision: status=pending');
    expect(manifest).toContain('decisionKey=missing-video-provider');
    expect(manifest).toContain('Which configured video provider');
    expect(manifest).toContain('task=media-shot-001 (task-media-1)');
    expect(manifest).toContain('Task decision: status=recovery_required');
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
    const context = buildPersistentTaskListContext(
      {
        repos: {
          taskLists: {
            ...taskListRepoDefaults(),
            listTaskLists: vi.fn(() => ({
              rows: [
                {
                  id: 'task-list-plan-1',
                  taskListType: 'movie.production.v2',
                  entityType: 'canvas',
                  entityId: 'canvas-1',
                  status: 'awaiting_approval',
                  rowVersion: 3,
                  currentGate: 'production_plan',
                  currentPhaseKey: 'production-plan',
                  currentTaskId: 'task-plan-1',
                  metadata: { commanderSessionId: 'session-1' },
                },
              ],
            })),
            getTask: vi.fn(() => ({
              id: 'task-plan-1',
              taskListId: 'task-list-plan-1',
              taskKey: 'production-plan',
              phaseKey: 'production-plan',
              status: 'blocked',
              input: { taskRole: 'document' },
            })),
            getLatestDocument: vi.fn(() => undefined),
            getLatestApproval: vi.fn(() => undefined),
            getPendingApproval,
            getDocumentRevision: vi.fn(() => ({ revision: 1, contentHash: subjectHash })),
          },
        },
      } as never,
      'canvas-1',
      'session-1',
    );

    expect(context.taskListToolPolicy).toEqual({
      taskListId: 'task-list-plan-1',
      rowVersion: 3,
      phase: 'production_plan_pending',
      gate: 'production_plan',
      currentTaskId: 'task-plan-1',
      currentTaskKey: 'production-plan',
      currentTaskRole: 'document',
      currentPhaseKey: 'production-plan',
      subjectRevision: 1,
    });
  });

  it('fails closed when a pending approval does not match its immutable document', () => {
    const context = buildPersistentTaskListContext(
      {
        repos: {
          taskLists: {
            ...taskListRepoDefaults(),
            listTaskLists: vi.fn(() => ({
              rows: [
                {
                  id: 'task-list-plan-1',
                  taskListType: 'movie.production.v2',
                  entityType: 'canvas',
                  entityId: 'canvas-1',
                  status: 'awaiting_approval',
                  rowVersion: 3,
                  currentGate: 'production_plan',
                  metadata: { commanderSessionId: 'session-1' },
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
      'session-1',
    );

    expect(context.taskListToolPolicy).toMatchObject({
      taskListId: 'task-list-plan-1',
      phase: 'blocked',
      gate: 'production_plan',
    });
    expect(context.taskListToolPolicy?.reason).toContain('could not be verified');
  });

  it('surfaces persistent Task List read failures instead of synthesizing a blocked manifest', () => {
    expect(() =>
      buildPersistentTaskListContext(
        {
          repos: {
            taskLists: {
              ...taskListRepoDefaults(),
              listTaskLists: vi.fn(() => {
                throw new Error('database unavailable');
              }),
            },
          },
        } as never,
        'canvas-1',
        'session-1',
      ),
    ).toThrow('database unavailable');
  });
});
