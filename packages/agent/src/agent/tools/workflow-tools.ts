import type { AgentTool } from '../tool-registry.js';
import type {
  PrepareFinalExportManifestInput,
  PrepareFinalExportManifestResult,
  VisualDirectionCandidateProposal,
} from '@lucid-fin/contracts';
import {
  ok,
  fail,
  requireString,
  TypedToolError,
  formatValidationError,
} from './tool-result-helpers.js';

export interface WorkflowToolDeps {
  pauseWorkflow: (id: string) => Promise<void>;
  resumeWorkflow: (id: string) => Promise<void>;
  cancelWorkflow: (id: string) => Promise<void>;
  retryWorkflow: (id: string) => Promise<void>;
  createProductionPlan: (input: CreateProductionPlanInput) => Promise<CreateProductionPlanResult>;
  reviseProductionPlan: (input: ReviseProductionPlanInput) => Promise<CreateProductionPlanResult>;
  completeCreativeTask: (input: CompleteCreativeTaskInput) => Promise<unknown>;
  createVisualAuditions: (
    input: CreateVisualAuditionsInput,
  ) => Promise<CreateVisualAuditionsResult>;
  produceMedia: (input: ProduceWorkflowMediaInput) => Promise<Record<string, unknown>>;
  refineMedia: (input: RefineWorkflowMediaInput) => Promise<Record<string, unknown>>;
  prepareFinalExport: (
    input: PrepareFinalExportManifestInput,
  ) => Promise<PrepareFinalExportManifestResult>;
}

export interface CreateProductionPlanInput {
  canvasId: string;
  idea: string;
  plan: Record<string, unknown>;
}

export interface CreateProductionPlanResult {
  workflowRunId: string;
  gate: 'production_plan';
  status: 'awaiting_approval';
  revision: number;
  contentHash: string;
}

export interface ReviseProductionPlanInput {
  canvasId: string;
  workflowRunId: string;
  expectedRowVersion: number;
  plan: Record<string, unknown>;
}

export interface CompleteCreativeTaskInput {
  canvasId: string;
  workflowRunId: string;
  taskRunId: string;
  expectedRowVersion: number;
  summary: string;
  evidence?: string[];
  data?: Record<string, unknown>;
}

export interface CreateVisualAuditionsInput {
  canvasId: string;
  workflowRunId: string;
  providerId: string;
  width?: number;
  height?: number;
  candidates: VisualDirectionCandidateProposal[];
}

export interface CreateVisualAuditionsResult {
  workflowRunId: string;
  status: 'complete';
  revision: number;
  contentHash: string;
  recommendedCandidateId: string;
  candidates: Array<{
    id: string;
    name: string;
    assetHash: string;
    score: number;
    providerId: string;
    model?: string;
    seed: number;
    estimatedCostUsd: number;
    reportedActualCostUsd?: number;
  }>;
}

export interface ProduceWorkflowMediaInput {
  canvasId: string;
  workflowRunId: string;
  taskRunId: string;
  nodeId: string;
  expectedRowVersion: number;
}

export interface RefineWorkflowMediaInput {
  canvasId: string;
  workflowRunId: string;
  nodeId: string;
  expectedRowVersion: number;
  targetAttemptId: string;
  basePromptHash: string;
  feedback: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requirePlanString(
  plan: Record<string, unknown>,
  key: string,
  args: Record<string, unknown>,
): void {
  if (typeof plan[key] === 'string' && plan[key].trim().length > 0) return;
  throw new TypedToolError(
    formatValidationError(
      "workflow.manage { action: 'createProductionPlan' }",
      `plan.${key}`,
      'is required and must be a non-empty string',
      args,
      'Expand the idea into the complete structured plan before calling this tool.',
    ),
    'validation',
  );
}

function validateProductionPlan(
  value: unknown,
  args: Record<string, unknown>,
): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new TypedToolError(
      formatValidationError(
        "workflow.manage { action: 'createProductionPlan' }",
        'plan',
        'is required and must be an object',
        args,
        'Provide the expanded story, format, assumptions, budget, and visual directions.',
      ),
      'validation',
    );
  }

  for (const key of ['title', 'logline', 'synopsis', 'genre', 'tone', 'targetAudience']) {
    requirePlanString(value, key, args);
  }

  const format = value.format;
  if (
    !isRecord(format) ||
    typeof format.targetDurationSeconds !== 'number' ||
    !Number.isFinite(format.targetDurationSeconds) ||
    format.targetDurationSeconds <= 0 ||
    typeof format.aspectRatio !== 'string' ||
    format.aspectRatio.trim().length === 0
  ) {
    throw new TypedToolError(
      formatValidationError(
        "workflow.manage { action: 'createProductionPlan' }",
        'plan.format',
        'must include a positive targetDurationSeconds and a non-empty aspectRatio',
        args,
      ),
      'validation',
    );
  }

  const story = value.story;
  if (!isRecord(story) || !Array.isArray(story.acts) || story.acts.length === 0) {
    throw new TypedToolError(
      formatValidationError(
        "workflow.manage { action: 'createProductionPlan' }",
        'plan.story.acts',
        'must contain at least one structured act',
        args,
      ),
      'validation',
    );
  }
  for (const [actIndex, act] of story.acts.entries()) {
    if (!isRecord(act) || !Array.isArray(act.scenes) || act.scenes.length === 0) {
      throw new TypedToolError(
        formatValidationError(
          "workflow.manage { action: 'createProductionPlan' }",
          `plan.story.acts[${actIndex}].scenes`,
          'must contain at least one scene',
          args,
        ),
        'validation',
      );
    }
  }

  const assumptions = value.assumptions;
  if (!Array.isArray(assumptions) || !assumptions.every((entry) => typeof entry === 'string')) {
    throw new TypedToolError(
      formatValidationError(
        "workflow.manage { action: 'createProductionPlan' }",
        'plan.assumptions',
        'must be an array of strings (use an empty array when none are needed)',
        args,
      ),
      'validation',
    );
  }

  const budget = value.budget;
  const budgetKeys = [
    'maxTotalCostUsd',
    'styleAuditionCostUsd',
    'maxAttemptsPerShot',
    'maxRegenerations',
  ];
  if (
    !isRecord(budget) ||
    budgetKeys.some(
      (key) =>
        typeof budget[key] !== 'number' ||
        !Number.isFinite(budget[key]) ||
        (budget[key] as number) < 0,
    )
  ) {
    throw new TypedToolError(
      formatValidationError(
        "workflow.manage { action: 'createProductionPlan' }",
        'plan.budget',
        `must include non-negative numeric ${budgetKeys.join(', ')}`,
        args,
      ),
      'validation',
    );
  }

  const visualDirections = value.visualDirections;
  if (
    !Array.isArray(visualDirections) ||
    visualDirections.length === 0 ||
    !visualDirections.every((entry) => typeof entry === 'string' && entry.trim().length > 0)
  ) {
    throw new TypedToolError(
      formatValidationError(
        "workflow.manage { action: 'createProductionPlan' }",
        'plan.visualDirections',
        'must contain at least one concise visual direction string',
        args,
      ),
      'validation',
    );
  }

  return value;
}

function requireWorkflowRowVersion(args: Record<string, unknown>, toolName: string): number {
  const value = args.expectedRowVersion;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new TypedToolError(
      `${toolName}: expectedRowVersion must be a non-negative integer`,
      'validation',
    );
  }
  return value;
}

function validateVisualCandidates(
  value: unknown,
  args: Record<string, unknown>,
): VisualDirectionCandidateProposal[] {
  if (!Array.isArray(value) || value.length < 2 || value.length > 4) {
    throw new TypedToolError(
      formatValidationError(
        'workflow.visual',
        'candidates',
        'must contain between 2 and 4 project-specific visual directions',
        args,
      ),
      'validation',
    );
  }
  const ids = new Set<string>();
  const grammarStrings = [
    'medium',
    'era',
    'rendering',
    'linework',
    'palette',
    'lighting',
    'texture',
    'mood',
    'cameraGrammar',
    'lensGrammar',
    'compositionGrammar',
    'motionGrammar',
  ];
  const grammarLists = ['characterAnchors', 'locationAnchors', 'negativeConstraints'];
  for (const [index, raw] of value.entries()) {
    if (!isRecord(raw)) {
      throw new TypedToolError(
        `workflow.visual: candidates[${index}] must be an object`,
        'validation',
      );
    }
    for (const key of ['id', 'name', 'summary', 'prompt']) {
      if (typeof raw[key] !== 'string' || raw[key].trim().length === 0) {
        throw new TypedToolError(
          `workflow.visual: candidates[${index}].${key} must be a non-empty string`,
          'validation',
        );
      }
    }
    const id = (raw.id as string).trim();
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id) || ids.has(id)) {
      throw new TypedToolError(
        `workflow.visual: candidates[${index}].id must be unique and use 1-64 letters, digits, _ or -`,
        'validation',
      );
    }
    ids.add(id);
    if (
      typeof raw.seed !== 'number' ||
      !Number.isInteger(raw.seed) ||
      raw.seed < 0 ||
      raw.seed > 0xffff_ffff
    ) {
      throw new TypedToolError(
        `workflow.visual: candidates[${index}].seed must be a uint32 integer`,
        'validation',
      );
    }
    if (!isRecord(raw.constitution)) {
      throw new TypedToolError(
        `workflow.visual: candidates[${index}].constitution is required`,
        'validation',
      );
    }
    for (const key of grammarStrings) {
      if (
        typeof raw.constitution[key] !== 'string' ||
        (raw.constitution[key] as string).trim().length === 0
      ) {
        throw new TypedToolError(
          `workflow.visual: candidates[${index}].constitution.${key} must be a non-empty string`,
          'validation',
        );
      }
    }
    for (const key of grammarLists) {
      if (
        !Array.isArray(raw.constitution[key]) ||
        !(raw.constitution[key] as unknown[]).every(
          (entry) => typeof entry === 'string' && entry.trim().length > 0,
        )
      ) {
        throw new TypedToolError(
          `workflow.visual: candidates[${index}].constitution.${key} must be an array of non-empty strings`,
          'validation',
        );
      }
    }
  }
  return value as VisualDirectionCandidateProposal[];
}

export function createWorkflowTools(deps: WorkflowToolDeps): AgentTool[] {
  const context = ['canvas'];

  const manage: AgentTool = {
    name: 'workflow.manage',
    description:
      'Create or revise the persistent Production Plan, complete the current host-bound creative task after its work is persisted, or control the workflow. These actions never approve a human gate.',
    context,
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: 'Action to perform.',
          enum: ['control', 'createProductionPlan', 'reviseProductionPlan', 'completeCurrentTask'],
        },
        id: { type: 'string', description: 'Workflow run ID.' },
        canvasId: {
          type: 'string',
          description: 'Host-injected canvas ID that owns the persistent workflow.',
        },
        controlAction: {
          type: 'string',
          description: 'Action to perform on the workflow.',
          enum: ['pause', 'resume', 'cancel', 'retry'],
        },
        idea: {
          type: 'string',
          description: "The user's original one-line idea, preserved verbatim.",
        },
        workflowRunId: {
          type: 'string',
          description: 'Host-injected active persistent workflow run ID.',
        },
        taskRunId: {
          type: 'string',
          description: 'Host-injected current durable task-run ID.',
        },
        expectedRowVersion: {
          type: 'number',
          description: 'Host-injected SQLite workflow CAS version.',
        },
        summary: {
          type: 'string',
          description: 'Concise description of the persisted work completed for this task.',
        },
        evidence: {
          type: 'array',
          description: 'Bounded IDs or facts that let the next step inspect the completed work.',
          items: { type: 'string', description: 'One durable evidence reference.' },
        },
        data: {
          type: 'object',
          description: 'Optional structured task output, such as one shot specification.',
        },
        plan: {
          type: 'object',
          description:
            'The AI-expanded production plan. This exact revision will be shown to the user for approval.',
          properties: {
            title: { type: 'string', description: 'Working title.', required: true },
            logline: {
              type: 'string',
              description: 'One-sentence dramatic premise.',
              required: true,
            },
            synopsis: {
              type: 'string',
              description: 'Concise complete story synopsis.',
              required: true,
            },
            genre: {
              type: 'string',
              description: 'Primary genre and useful subgenre.',
              required: true,
            },
            tone: { type: 'string', description: 'Emotional and dramatic tone.', required: true },
            targetAudience: {
              type: 'string',
              description: 'Intended audience.',
              required: true,
            },
            format: {
              type: 'object',
              description: 'Runtime and frame format.',
              required: true,
              properties: {
                targetDurationSeconds: {
                  type: 'number',
                  description: 'Target finished runtime in seconds.',
                  required: true,
                },
                aspectRatio: {
                  type: 'string',
                  description: 'Target aspect ratio, for example 16:9 or 9:16.',
                  required: true,
                },
              },
            },
            story: {
              type: 'object',
              description:
                'Ordered acts and scenes. Include dialogue intent where dialogue matters.',
              required: true,
              properties: {
                acts: {
                  type: 'array',
                  description: 'Ordered dramatic acts.',
                  required: true,
                  items: {
                    type: 'object',
                    description: 'One dramatic act.',
                    properties: {
                      name: { type: 'string', description: 'Act name.', required: true },
                      purpose: {
                        type: 'string',
                        description: 'Dramatic purpose.',
                        required: true,
                      },
                      scenes: {
                        type: 'array',
                        description: 'Ordered scenes in this act.',
                        required: true,
                        items: {
                          type: 'object',
                          description: 'One production-planning scene.',
                          properties: {
                            title: { type: 'string', description: 'Scene title.', required: true },
                            summary: {
                              type: 'string',
                              description: 'What visibly happens.',
                              required: true,
                            },
                            storyBeat: {
                              type: 'string',
                              description: 'Dramatic beat served by the scene.',
                              required: true,
                            },
                            dialogueIntent: {
                              type: 'string',
                              description: 'Dialogue goal or no-dialogue note.',
                              required: true,
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
            assumptions: {
              type: 'array',
              description: 'Low-risk assumptions the user can review at the plan gate.',
              required: true,
              items: { type: 'string', description: 'One explicit assumption.' },
            },
            budget: {
              type: 'object',
              description: 'Cost and automatic retry boundaries that approval will lock.',
              required: true,
              properties: {
                maxTotalCostUsd: {
                  type: 'number',
                  description: 'Maximum total provider cost in USD.',
                  required: true,
                },
                styleAuditionCostUsd: {
                  type: 'number',
                  description: 'Maximum style-audition cost in USD.',
                  required: true,
                },
                maxAttemptsPerShot: {
                  type: 'number',
                  description: 'Maximum attempts per shot.',
                  required: true,
                },
                maxRegenerations: {
                  type: 'number',
                  description: 'Maximum total regenerations.',
                  required: true,
                },
              },
            },
            visualDirections: {
              type: 'array',
              description:
                'Two or three concise directions to audition later; these are not yet the approved Visual Constitution.',
              required: true,
              items: { type: 'string', description: 'One candidate visual direction.' },
            },
          },
        },
      },
      required: ['action', 'canvasId'],
    },
    async execute(args) {
      const action = args.action as string;
      if (action === 'control') {
        try {
          const id = requireString(args, 'id');
          const controlAction = requireString(args, 'controlAction');
          if (controlAction === 'pause') {
            await deps.pauseWorkflow(id);
          } else if (controlAction === 'resume') {
            await deps.resumeWorkflow(id);
          } else if (controlAction === 'cancel') {
            await deps.cancelWorkflow(id);
          } else if (controlAction === 'retry') {
            await deps.retryWorkflow(id);
          } else {
            throw new Error(
              `Unknown action: ${controlAction}. Must be pause, resume, cancel, or retry.`,
            );
          }
          return ok({ id, action: controlAction });
        } catch (error) {
          return fail(error);
        }
      } else if (action === 'createProductionPlan') {
        try {
          const rawIdea = args.idea;
          if (typeof rawIdea !== 'string' || rawIdea.trim().length === 0) {
            throw new TypedToolError(
              formatValidationError(
                "workflow.manage { action: 'createProductionPlan' }",
                'idea',
                'is required and must be a non-empty string',
                args,
                'Correct call: { action: "createProductionPlan", idea: "<the user idea>", plan: { ...complete structured plan... } }.',
              ),
              'validation',
            );
          }
          const plan = validateProductionPlan(args.plan, args);
          return ok(
            await deps.createProductionPlan({
              canvasId: requireString(args, 'canvasId'),
              idea: rawIdea.trim(),
              plan,
            }),
          );
        } catch (error) {
          return fail(error);
        }
      } else if (action === 'reviseProductionPlan') {
        try {
          const expectedRowVersion = requireWorkflowRowVersion(args, 'workflow.manage');
          return ok(
            await deps.reviseProductionPlan({
              canvasId: requireString(args, 'canvasId'),
              workflowRunId: requireString(args, 'workflowRunId'),
              expectedRowVersion,
              plan: validateProductionPlan(args.plan, args),
            }),
          );
        } catch (error) {
          return fail(error);
        }
      } else if (action === 'completeCurrentTask') {
        try {
          const rawEvidence = args.evidence;
          if (
            rawEvidence !== undefined &&
            (!Array.isArray(rawEvidence) ||
              rawEvidence.some((entry) => typeof entry !== 'string' || !entry.trim()))
          ) {
            throw new TypedToolError(
              'workflow.manage: evidence must be an array of non-empty strings',
              'validation',
            );
          }
          if (args.data !== undefined && !isRecord(args.data)) {
            throw new TypedToolError('workflow.manage: data must be an object', 'validation');
          }
          return ok(
            await deps.completeCreativeTask({
              canvasId: requireString(args, 'canvasId'),
              workflowRunId: requireString(args, 'workflowRunId'),
              taskRunId: requireString(args, 'taskRunId'),
              expectedRowVersion: requireWorkflowRowVersion(args, 'workflow.manage'),
              summary: requireString(args, 'summary'),
              ...(Array.isArray(rawEvidence)
                ? { evidence: rawEvidence.map((entry) => String(entry).trim()) }
                : {}),
              ...(isRecord(args.data) ? { data: args.data } : {}),
            }),
          );
        } catch (error) {
          return fail(error);
        }
      } else {
        return fail(new Error(`Unknown action: ${action}`));
      }
    },
  };

  const visual: AgentTool = {
    name: 'workflow.visual',
    description:
      'After the exact Production Plan is approved, generate and vision-grade 2-4 real project-specific style previews with one configured image provider. The host persists every attempt and cost record. This never approves the Visual Constitution; the user chooses a preview and approves the exact resulting revision in the host UI.',
    context,
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        canvasId: {
          type: 'string',
          description: 'Host-injected canvas ID that owns the persistent workflow.',
        },
        workflowRunId: {
          type: 'string',
          description: 'Persistent movie workflow run ID from the SQLite workflow manifest.',
        },
        providerId: {
          type: 'string',
          description:
            'Configured image provider to use for every candidate so the comparison reflects production behavior.',
        },
        width: {
          type: 'number',
          description: 'Optional preview width. Defaults to a bounded 16:9 preview.',
        },
        height: {
          type: 'number',
          description: 'Optional preview height. Defaults to a bounded 16:9 preview.',
        },
        candidates: {
          type: 'array',
          description:
            'Two to four distinct project-specific directions for a non-expert user to compare.',
          items: {
            type: 'object',
            description: 'One fully specified direction and its locked grammar if selected.',
            properties: {
              id: {
                type: 'string',
                description: 'Stable short slug, unique in this candidate set.',
                required: true,
              },
              name: {
                type: 'string',
                description: 'Clear user-facing direction name.',
                required: true,
              },
              summary: {
                type: 'string',
                description: 'Plain-language explanation of what this direction feels like.',
                required: true,
              },
              prompt: {
                type: 'string',
                description:
                  'Project-specific preview prompt using a representative scene from the approved story.',
                required: true,
              },
              negativePrompt: {
                type: 'string',
                description: 'Optional explicit visual exclusions.',
              },
              seed: {
                type: 'number',
                description: 'Deterministic uint32 generation seed.',
                required: true,
              },
              constitution: {
                type: 'object',
                description:
                  'Visual grammar that will be immutable if the user selects this candidate.',
                required: true,
                properties: {
                  medium: { type: 'string', description: 'Medium.', required: true },
                  era: {
                    type: 'string',
                    description: 'Era or temporal design language.',
                    required: true,
                  },
                  rendering: {
                    type: 'string',
                    description: 'Rendering treatment.',
                    required: true,
                  },
                  linework: { type: 'string', description: 'Edge/line treatment.', required: true },
                  palette: { type: 'string', description: 'Palette grammar.', required: true },
                  lighting: { type: 'string', description: 'Lighting grammar.', required: true },
                  texture: { type: 'string', description: 'Texture and finish.', required: true },
                  mood: { type: 'string', description: 'Emotional visual mood.', required: true },
                  cameraGrammar: { type: 'string', description: 'Camera grammar.', required: true },
                  lensGrammar: { type: 'string', description: 'Lens grammar.', required: true },
                  compositionGrammar: {
                    type: 'string',
                    description: 'Composition grammar.',
                    required: true,
                  },
                  motionGrammar: {
                    type: 'string',
                    description: 'Motion grammar for eventual video.',
                    required: true,
                  },
                  characterAnchors: {
                    type: 'array',
                    description: 'Story-specific character identity anchors; may be empty.',
                    required: true,
                    items: { type: 'string', description: 'One identity anchor.' },
                  },
                  locationAnchors: {
                    type: 'array',
                    description: 'Story-specific location identity anchors; may be empty.',
                    required: true,
                    items: { type: 'string', description: 'One location anchor.' },
                  },
                  negativeConstraints: {
                    type: 'array',
                    description: 'Visual drift and style exclusions.',
                    required: true,
                    items: { type: 'string', description: 'One exclusion.' },
                  },
                },
              },
            },
          },
        },
      },
      required: ['canvasId', 'workflowRunId', 'providerId', 'candidates'],
    },
    async execute(args) {
      try {
        const width = args.width;
        const height = args.height;
        if (
          width !== undefined &&
          (typeof width !== 'number' || !Number.isInteger(width) || width <= 0)
        ) {
          throw new TypedToolError(
            'workflow.visual: width must be a positive integer',
            'validation',
          );
        }
        if (
          height !== undefined &&
          (typeof height !== 'number' || !Number.isInteger(height) || height <= 0)
        ) {
          throw new TypedToolError(
            'workflow.visual: height must be a positive integer',
            'validation',
          );
        }
        return ok(
          await deps.createVisualAuditions({
            canvasId: requireString(args, 'canvasId'),
            workflowRunId: requireString(args, 'workflowRunId'),
            providerId: requireString(args, 'providerId'),
            ...(typeof width === 'number' ? { width } : {}),
            ...(typeof height === 'number' ? { height } : {}),
            candidates: validateVisualCandidates(args.candidates, args),
          }),
        );
      } catch (error) {
        return fail(error);
      }
    },
  };

  const finalExport: AgentTool = {
    name: 'workflow.finalExport',
    description:
      'Prepare the immutable third-gate Final Export manifest from the host canvas and selected CAS assets. You may choose codec, quality, size, and fps, but cannot supply clips or paths. This opens approval and never approves or renders.',
    context,
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'Host-injected canvas ID.' },
        workflowRunId: { type: 'string', description: 'Persistent movie workflow run ID.' },
        expectedRowVersion: {
          type: 'number',
          description: 'Latest SQLite workflow row version from the host manifest.',
        },
        codec: {
          type: 'string',
          enum: ['h264', 'h265', 'prores'],
          description: 'Approved output codec proposal.',
        },
        quality: {
          type: 'string',
          enum: ['draft', 'standard', 'high'],
          description: 'Render quality preset.',
        },
        width: { type: 'number', description: 'Even output width, at most 7680.' },
        height: { type: 'number', description: 'Even output height, at most 7680.' },
        fps: { type: 'number', description: 'Integer frame rate from 12 to 120.' },
        fitMode: {
          type: 'string',
          enum: ['contain', 'cover', 'stretch'],
          description:
            'How source clips fit the output. Defaults to contain (preserve composition with padding); cover crops; stretch distorts.',
        },
        backgroundColor: {
          type: 'string',
          description: 'Six-digit hex padding color for contain mode. Defaults to #000000.',
        },
      },
      required: [
        'canvasId',
        'workflowRunId',
        'expectedRowVersion',
        'codec',
        'quality',
        'width',
        'height',
        'fps',
      ],
    },
    async execute(args) {
      try {
        const expectedRowVersion = args.expectedRowVersion;
        if (
          typeof expectedRowVersion !== 'number' ||
          !Number.isInteger(expectedRowVersion) ||
          expectedRowVersion < 0
        ) {
          throw new TypedToolError(
            'workflow.finalExport: expectedRowVersion must be a non-negative integer',
            'validation',
          );
        }
        const codec = requireString(args, 'codec');
        if (codec !== 'h264' && codec !== 'h265' && codec !== 'prores') {
          throw new TypedToolError(
            'workflow.finalExport: codec must be h264, h265, or prores',
            'validation',
          );
        }
        const quality = requireString(args, 'quality');
        if (quality !== 'draft' && quality !== 'standard' && quality !== 'high') {
          throw new TypedToolError(
            'workflow.finalExport: quality must be draft, standard, or high',
            'validation',
          );
        }
        const numeric = (key: 'width' | 'height' | 'fps'): number => {
          const value = args[key];
          if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
            throw new TypedToolError(
              `workflow.finalExport: ${key} must be a positive integer`,
              'validation',
            );
          }
          return value;
        };
        const fitMode = args.fitMode;
        if (
          fitMode !== undefined &&
          fitMode !== 'contain' &&
          fitMode !== 'cover' &&
          fitMode !== 'stretch'
        ) {
          throw new TypedToolError(
            'workflow.finalExport: fitMode must be contain, cover, or stretch',
            'validation',
          );
        }
        const backgroundColor = args.backgroundColor;
        if (
          backgroundColor !== undefined &&
          (typeof backgroundColor !== 'string' || !/^#[0-9a-f]{6}$/i.test(backgroundColor))
        ) {
          throw new TypedToolError(
            'workflow.finalExport: backgroundColor must be a six-digit hex color',
            'validation',
          );
        }
        return ok(
          await deps.prepareFinalExport({
            canvasId: requireString(args, 'canvasId'),
            workflowRunId: requireString(args, 'workflowRunId'),
            expectedRowVersion,
            output: {
              codec,
              quality,
              width: numeric('width'),
              height: numeric('height'),
              fps: numeric('fps'),
              ...(fitMode ? { fitMode } : {}),
              ...(typeof backgroundColor === 'string' ? { backgroundColor } : {}),
            },
          }),
        );
      } catch (error) {
        return fail(error);
      }
    },
  };

  const media: AgentTool = {
    name: 'workflow.media',
    description:
      'Generate and quality-control one image or video node inside an approved persistent workflow. The host compiles the exact Generation Spec, reserves cost before provider submission, grades visible evidence, and applies bounded Repair Deltas. Do not supply a prompt or provider override.',
    context,
    tier: 1,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'Host-injected canvas ID.' },
        workflowRunId: { type: 'string', description: 'Persistent movie workflow run ID.' },
        taskRunId: {
          type: 'string',
          description: 'Host-injected current durable workflow task ID.',
        },
        nodeId: { type: 'string', description: 'Image or video canvas node to produce.' },
        expectedRowVersion: {
          type: 'number',
          description: 'Latest SQLite workflow row version from the host manifest.',
        },
      },
      required: ['canvasId', 'workflowRunId', 'taskRunId', 'nodeId', 'expectedRowVersion'],
    },
    async execute(args) {
      try {
        const expectedRowVersion = args.expectedRowVersion;
        if (
          typeof expectedRowVersion !== 'number' ||
          !Number.isInteger(expectedRowVersion) ||
          expectedRowVersion < 0
        ) {
          throw new TypedToolError(
            'workflow.media: expectedRowVersion must be a non-negative integer',
            'validation',
          );
        }
        return ok(
          await deps.produceMedia({
            canvasId: requireString(args, 'canvasId'),
            workflowRunId: requireString(args, 'workflowRunId'),
            taskRunId: requireString(args, 'taskRunId'),
            nodeId: requireString(args, 'nodeId'),
            expectedRowVersion,
          }),
        );
      } catch (error) {
        return fail(error);
      }
    },
  };

  const mediaFeedback: AgentTool = {
    name: 'workflow.mediaFeedback',
    description:
      'Refine an already generated image/video from a small user quality comment. Pass the user comment verbatim plus the exact latest attempt ID and prompt SHA-256 from the persistent manifest. The host loads the exact provider prompt, verifies lineage, appends an immutable Repair Delta, preserves approvals/references/provider/budget, generates a new attempt, and grades it. Never write or pass a full replacement prompt.',
    context,
    tier: 1,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'Host-injected canvas ID.' },
        workflowRunId: {
          type: 'string',
          description: 'Host-injected persistent movie workflow run ID.',
        },
        nodeId: { type: 'string', description: 'Existing image or video canvas node.' },
        expectedRowVersion: {
          type: 'number',
          description: 'Host-injected SQLite workflow row version.',
        },
        targetAttemptId: {
          type: 'string',
          description: 'Exact latest immutable media attempt ID from the persistent manifest.',
        },
        basePromptHash: {
          type: 'string',
          description: 'Exact latest provider prompt SHA-256 from the persistent manifest.',
        },
        feedback: {
          type: 'string',
          description:
            "The user's small quality comment verbatim, not a rewritten or full replacement prompt.",
        },
      },
      required: [
        'canvasId',
        'workflowRunId',
        'nodeId',
        'expectedRowVersion',
        'targetAttemptId',
        'basePromptHash',
        'feedback',
      ],
    },
    async execute(args) {
      try {
        const expectedRowVersion = args.expectedRowVersion;
        if (
          typeof expectedRowVersion !== 'number' ||
          !Number.isInteger(expectedRowVersion) ||
          expectedRowVersion < 0
        ) {
          throw new TypedToolError(
            'workflow.mediaFeedback: expectedRowVersion must be a non-negative integer',
            'validation',
          );
        }
        const basePromptHash = requireString(args, 'basePromptHash');
        if (!/^[a-f0-9]{64}$/i.test(basePromptHash)) {
          throw new TypedToolError(
            'workflow.mediaFeedback: basePromptHash must be a SHA-256 hex digest',
            'validation',
          );
        }
        const feedback = requireString(args, 'feedback');
        if (feedback.length > 2_000) {
          throw new TypedToolError(
            'workflow.mediaFeedback: feedback must be 2000 characters or fewer',
            'validation',
          );
        }
        return ok(
          await deps.refineMedia({
            canvasId: requireString(args, 'canvasId'),
            workflowRunId: requireString(args, 'workflowRunId'),
            nodeId: requireString(args, 'nodeId'),
            expectedRowVersion,
            targetAttemptId: requireString(args, 'targetAttemptId'),
            basePromptHash,
            feedback,
          }),
        );
      } catch (error) {
        return fail(error);
      }
    },
  };

  return [manage, visual, media, mediaFeedback, finalExport];
}
