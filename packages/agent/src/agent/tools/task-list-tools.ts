import type { ContextFactRelation } from '@lucid-fin/contracts';
import {
  NO_TOOL_RESOURCE,
  meteredToolResource,
  toolResultSchema,
  type ToolDefinition,
  type ToolResult,
} from '../tool-registry.js';
import { authorityFact, contextProjector, record, resultRecord } from './context-replay.js';
import type {
  AudioTaskSubtype,
  AudioTaskView,
  PrepareDeliveryManifestInput,
  PrepareDeliveryManifestResult,
  PromptAssemblyRecord,
  PromptAssemblyOutputV1,
  VisualDirectionCandidateProposal,
} from '@lucid-fin/contracts';
import {
  ok,
  fail,
  requireString,
  TypedToolError,
  formatValidationError,
} from './tool-result-helpers.js';
import {
  arraySchema,
  audioTaskViewSchema,
  booleanSchema,
  canonicalJsonSchema,
  enumSchema,
  externalTaskCompletionSchema,
  numberSchema,
  objectSchema,
  planApprovalSchema,
  planDocumentSchema,
  productionMediaViewSchema,
  promptAssemblyRecordSchema,
  stringArraySchema,
  stringSchema,
  taskListSchema,
  unionSchema,
} from './tool-runtime-schemas.js';

const productionPlanResultSchema = objectSchema({
  taskListId: stringSchema,
  gate: { const: 'production_plan' },
  status: { const: 'awaiting_approval' },
  revision: numberSchema,
  contentHash: stringSchema,
});
const gateDecisionResultSchema = objectSchema(
  {
    decision: enumSchema(['approve', 'request_changes']),
    code: stringSchema,
    taskListId: stringSchema,
    gate: enumSchema(['production_plan', 'visual_constitution', 'delivery']),
    subjectRevision: numberSchema,
    subjectHash: stringSchema,
  },
  ['decision'],
);
const visualCandidateResultSchema = objectSchema(
  {
    id: stringSchema,
    name: stringSchema,
    assetHash: stringSchema,
    score: numberSchema,
    providerId: stringSchema,
    model: stringSchema,
    seed: numberSchema,
    estimatedCostUsd: numberSchema,
    reportedActualCostUsd: numberSchema,
  },
  ['id', 'name', 'assetHash', 'score', 'providerId', 'seed', 'estimatedCostUsd'],
);

export interface TaskListToolDeps {
  pauseTaskList: (id: string) => Promise<void>;
  resumeTaskList: (id: string) => Promise<void>;
  cancelTaskList: (id: string) => Promise<void>;
  retryTaskList: (id: string) => Promise<void>;
  decidePendingGate: (decision: 'approve' | 'request_changes') => Promise<unknown>;
  createProductionPlan: (input: CreateProductionPlanInput) => Promise<CreateProductionPlanResult>;
  reviseProductionPlan: (input: ReviseProductionPlanInput) => Promise<CreateProductionPlanResult>;
  completeCreativeTask: (input: CompleteCreativeTaskInput) => Promise<unknown>;
  createVisualAuditions: (
    input: CreateVisualAuditionsInput,
  ) => Promise<CreateVisualAuditionsResult>;
  produceMedia: (input: ProduceTaskMediaInput) => Promise<Record<string, unknown>>;
  refineMedia: (input: RefineTaskMediaInput) => Promise<Record<string, unknown>>;
  prepareDelivery: (
    input: PrepareDeliveryManifestInput,
  ) => Promise<PrepareDeliveryManifestResult>;
  prepareAudioTask: (input: PrepareAudioTaskInput) => Promise<AudioTaskView>;
  getAudioTask: (taskListId: string) => Promise<AudioTaskView>;
  submitAudioPrompt: (input: SubmitAudioPromptInput) => Promise<AudioTaskView>;
}

export interface PrepareAudioTaskInput {
  subtype: AudioTaskSubtype;
  prompt: string;
  providerId: string;
  model?: string;
  duration?: number;
  params?: Record<string, unknown>;
}

export interface SubmitAudioPromptInput {
  taskListId: string;
  promptAssemblyId: string;
  promptAssemblyOutput: PromptAssemblyOutputV1;
}

export interface CreateProductionPlanInput {
  canvasId: string;
  idea: string;
  plan: Record<string, unknown>;
}

export interface CreateProductionPlanResult {
  taskListId: string;
  gate: 'production_plan';
  status: 'awaiting_approval';
  revision: number;
  contentHash: string;
}

export interface ReviseProductionPlanInput {
  canvasId: string;
  taskListId: string;
  expectedRowVersion: number;
  plan: Record<string, unknown>;
}

export interface CompleteCreativeTaskInput {
  canvasId: string;
  taskListId: string;
  taskId: string;
  expectedRowVersion: number;
  summary: string;
  evidence?: string[];
  data?: Record<string, unknown>;
}

interface VisualAuditionIdentity {
  canvasId: string;
  taskListId: string;
}

export type CreateVisualAuditionsInput =
  | (VisualAuditionIdentity & {
      action: 'prepare';
      providerId: string;
      width?: number;
      height?: number;
      candidates: VisualDirectionCandidateProposal[];
    })
  | (VisualAuditionIdentity & {
      action: 'submit';
      promptAssemblyId: string;
      promptAssemblyOutput: PromptAssemblyOutputV1;
    })
  | (VisualAuditionIdentity & { action: 'status' });

export interface CompleteVisualAuditionsResult {
  taskListId: string;
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

export type CreateVisualAuditionsResult =
  | CompleteVisualAuditionsResult
  | {
      taskListId: string;
      status: 'awaiting_prompt_assembly';
      revision: number;
      contentHash: string;
      candidateId: string;
      promptAssembly: PromptAssemblyRecord;
      nextAction: 'assemble_prompt';
    }
  | {
      taskListId: string;
      status: 'evaluation_pending';
      revision: number;
      contentHash: string;
      candidateId: string;
      promptAssemblyId: string;
      assetHash: string;
      message: string;
      nextAction: 'retry_evaluation';
    };

export interface ProduceTaskMediaInput {
  canvasId: string;
  taskListId: string;
  taskId: string;
  nodeId: string;
  expectedRowVersion: number;
  promptAssemblyId?: string;
  promptAssemblyOutput?: PromptAssemblyOutputV1;
}

export interface RefineTaskMediaInput {
  canvasId: string;
  taskListId: string;
  nodeId: string;
  expectedRowVersion: number;
  targetAttemptId: string;
  basePromptHash: string;
  feedback: string;
  promptAssemblyId?: string;
  promptAssemblyOutput?: PromptAssemblyOutputV1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function promptAssemblyOutputSchema(): ToolDefinition['inputSchema']['properties'][string] {
  return {
    type: 'object',
    description:
      'Commander-authored output for the persisted input. Copy every ID/hash exactly and provide one decision per source.',
    properties: {
      version: { type: 'number', description: 'Must be 1.' },
      assemblyId: { type: 'string', description: 'Copy from the prepared input.' },
      inputHash: { type: 'string', description: 'Copy from the prepared input.' },
      finalPrompt: { type: 'string', description: 'The complete provider-facing prompt.' },
      negativePrompt: { type: 'string', description: 'Optional provider-facing negative prompt.' },
      sourceDecisions: {
        type: 'array',
        description: 'Exactly one decision for every prepared source.',
        items: {
          type: 'object',
          description: 'How one source affected the final prompt.',
          properties: {
            sourceId: { type: 'string', description: 'Copy from the source.' },
            sourceHash: { type: 'string', description: 'Copy from the source.' },
            disposition: {
              type: 'string',
              enum: ['applied', 'omitted', 'conflict-resolved'],
              description: 'How the source was reconciled.',
            },
            reason: { type: 'string', description: 'Optional concise reason.' },
          },
        },
      },
      summary: { type: 'string', description: 'Concise assembly rationale.' },
      warnings: {
        type: 'array',
        description: 'Non-blocking prompt risks.',
        items: { type: 'string', description: 'Warning text.' },
      },
    },
  };
}

function readOptionalPromptAssembly(
  args: Record<string, unknown>,
  toolName: string,
): Pick<ProduceTaskMediaInput, 'promptAssemblyId' | 'promptAssemblyOutput'> {
  const rawId = args.promptAssemblyId;
  const rawOutput = args.promptAssemblyOutput;
  if (rawId === undefined && rawOutput === undefined) return {};
  if (typeof rawId !== 'string' || !rawId.trim()) {
    throw new TypedToolError(`${toolName}: promptAssemblyId is required`, 'validation');
  }
  const promptAssemblyId = rawId.trim();
  if (rawOutput === undefined) return { promptAssemblyId };
  if (!isRecord(rawOutput) || rawOutput.version !== 1) {
    throw new TypedToolError(
      `${toolName}: promptAssemblyOutput must be a version 1 object`,
      'validation',
    );
  }
  if (rawOutput.assemblyId !== promptAssemblyId) {
    throw new TypedToolError(
      `${toolName}: promptAssemblyId does not match promptAssemblyOutput.assemblyId`,
      'validation',
    );
  }
  return {
    promptAssemblyId,
    promptAssemblyOutput: rawOutput as unknown as PromptAssemblyOutputV1,
  };
}

function requirePlanString(
  plan: Record<string, unknown>,
  key: string,
  args: Record<string, unknown>,
): void {
  if (typeof plan[key] === 'string' && plan[key].trim().length > 0) return;
  throw new TypedToolError(
    formatValidationError(
      "taskList.manage { action: 'createProductionPlan' }",
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
        "taskList.manage { action: 'createProductionPlan' }",
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
        "taskList.manage { action: 'createProductionPlan' }",
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
        "taskList.manage { action: 'createProductionPlan' }",
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
          "taskList.manage { action: 'createProductionPlan' }",
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
        "taskList.manage { action: 'createProductionPlan' }",
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
        "taskList.manage { action: 'createProductionPlan' }",
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
    visualDirections.length > 20 ||
    !visualDirections.every((entry) => typeof entry === 'string' && entry.trim().length > 0)
  ) {
    throw new TypedToolError(
      formatValidationError(
        "taskList.manage { action: 'createProductionPlan' }",
        'plan.visualDirections',
        'must contain between 1 and 20 non-empty visual direction strings',
        args,
      ),
      'validation',
    );
  }

  if (value.taskNames !== undefined) {
    if (!isRecord(value.taskNames)) {
      throw new TypedToolError(
        formatValidationError(
          "taskList.manage { action: 'createProductionPlan' }",
          'plan.taskNames',
          'must be an object mapping stable task keys to display-only names',
          args,
        ),
        'validation',
      );
    }
    const taskNames = Object.entries(value.taskNames);
    if (taskNames.length > 200) {
      throw new TypedToolError(
        'taskList.manage: plan.taskNames must contain at most 200 entries',
        'validation',
      );
    }
    for (const [taskKey, displayName] of taskNames) {
      if (
        !taskKey.trim() ||
        typeof displayName !== 'string' ||
        !displayName.trim() ||
        displayName.length > 120
      ) {
        throw new TypedToolError(
          'taskList.manage: every plan.taskNames entry must map a non-empty task key to a non-empty display name of at most 120 characters',
          'validation',
        );
      }
    }
  }

  return value;
}

function requireTaskListRowVersion(args: Record<string, unknown>, toolName: string): number {
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
  if (!Array.isArray(value) || value.length === 0 || value.length > 4) {
    throw new TypedToolError(
      formatValidationError(
        'task.visual',
        'candidates',
        'must contain between 1 and 4 structured visual directions',
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
      throw new TypedToolError(`task.visual: candidates[${index}] must be an object`, 'validation');
    }
    for (const key of ['id', 'name', 'summary', 'prompt']) {
      if (typeof raw[key] !== 'string' || raw[key].trim().length === 0) {
        throw new TypedToolError(
          `task.visual: candidates[${index}].${key} must be a non-empty string`,
          'validation',
        );
      }
    }
    const id = (raw.id as string).trim();
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id) || ids.has(id)) {
      throw new TypedToolError(
        `task.visual: candidates[${index}].id must be unique and use 1-64 letters, digits, _ or -`,
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
        `task.visual: candidates[${index}].seed must be a uint32 integer`,
        'validation',
      );
    }
    if (!isRecord(raw.constitution)) {
      throw new TypedToolError(
        `task.visual: candidates[${index}].constitution is required`,
        'validation',
      );
    }
    for (const key of grammarStrings) {
      if (
        typeof raw.constitution[key] !== 'string' ||
        (raw.constitution[key] as string).trim().length === 0
      ) {
        throw new TypedToolError(
          `task.visual: candidates[${index}].constitution.${key} must be a non-empty string`,
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
          `task.visual: candidates[${index}].constitution.${key} must be an array of non-empty strings`,
          'validation',
        );
      }
    }
  }
  return value as VisualDirectionCandidateProposal[];
}

export function createTaskListTools(deps: TaskListToolDeps): ToolDefinition[] {
  const contexts = ['canvas'];
  const taskReplayFacts = (
    result: ToolResult,
    args: Record<string, unknown>,
    relation: ContextFactRelation,
  ) => {
    const data = resultRecord(result);
    const promptAssembly = record(data?.promptAssembly);
    const promptAssemblyOutput = record(args.promptAssemblyOutput);
    return [
      authorityFact(
        'task_list',
        relation,
        data?.taskListId ?? data?.id ?? args.taskListId ?? args.id,
        { revision: data?.rowVersion ?? data?.revision ?? args.expectedRowVersion },
      ),
      authorityFact(
        'prompt_assembly',
        args.promptAssemblyId ? 'read' : 'created',
        data?.promptAssemblyId ?? promptAssembly?.assemblyId ?? args.promptAssemblyId,
        {
          revision: promptAssembly?.revision,
          contentHash: promptAssembly?.inputHash ?? promptAssemblyOutput?.inputHash,
        },
      ),
    ];
  };

  const manage: ToolDefinition = {
    name: 'taskList.manage',
    process: 'task-list-orchestration',
    category: 'mutation',
    contextReplay: 'authority_reread',
    resource: NO_TOOL_RESOURCE,
    description:
      'Create or revise the persistent Production Plan, make a structured decision about the current pending human gate, complete the current host-bound creative task after its work is persisted, or control the task list.',
    contexts,
    tier: 2,
    outputSchema: toolResultSchema(
      unionSchema(
        objectSchema({ id: stringSchema, action: enumSchema(['pause', 'resume', 'cancel', 'retry']) }),
        productionPlanResultSchema,
        gateDecisionResultSchema,
        externalTaskCompletionSchema,
      ),
    ),
    projectPublicResult: contextProjector((result, args) =>
      taskReplayFacts(
        result,
        args,
        args.action === 'createProductionPlan' ? 'created' : 'updated',
      ),
    ),
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: 'Action to perform.',
          enum: [
            'control',
            'createProductionPlan',
            'reviseProductionPlan',
            'decidePendingGate',
            'completeCurrentTask',
          ],
        },
        id: { type: 'string', description: 'Task-list ID.' },
        canvasId: {
          type: 'string',
          description: 'Host-injected canvas ID that owns the persistent task list.',
        },
        controlAction: {
          type: 'string',
          description: 'Action to perform on the task list.',
          enum: ['pause', 'resume', 'cancel', 'retry'],
        },
        idea: {
          type: 'string',
          description: "The user's original one-line idea, preserved verbatim.",
        },
        taskListId: {
          type: 'string',
          description: 'Host-injected active persistent task-list ID.',
        },
        taskId: {
          type: 'string',
          description: 'Host-injected current durable task ID.',
        },
        expectedRowVersion: {
          type: 'number',
          description: 'Host-injected SQLite task-list CAS version.',
        },
        decision: {
          type: 'string',
          enum: ['approve', 'request_changes'],
          description:
            'Model-selected structured decision for the current pending human gate. The host binds the exact Task List, gate, row version, subject revision, and subject hash; request_changes uses the authentic user message as its reason.',
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
          properties: {},
          additionalProperties: true,
        },
        plan: {
          type: 'object',
          description:
            'The AI-expanded production plan. This exact revision will be shown to the user for approval.',
          properties: {
            title: { type: 'string', description: 'Working title.' },
            logline: {
              type: 'string',
              description: 'One-sentence dramatic premise.',
            },
            synopsis: {
              type: 'string',
              description: 'Concise complete story synopsis.',
            },
            genre: {
              type: 'string',
              description: 'Primary genre and useful subgenre.',
            },
            tone: { type: 'string', description: 'Emotional and dramatic tone.' },
            targetAudience: {
              type: 'string',
              description: 'Intended audience.',
            },
            format: {
              type: 'object',
              description: 'Runtime and frame format.',
              properties: {
                targetDurationSeconds: {
                  type: 'number',
                  description: 'Target finished runtime in seconds.',
                },
                aspectRatio: {
                  type: 'string',
                  description: 'Target aspect ratio, for example 16:9 or 9:16.',
                },
              },
              required: ['targetDurationSeconds', 'aspectRatio'],
            },
            story: {
              type: 'object',
              description:
                'Ordered acts and scenes. Include dialogue intent where dialogue matters.',
              properties: {
                acts: {
                  type: 'array',
                  description: 'Ordered dramatic acts.',
                  items: {
                    type: 'object',
                    description: 'One dramatic act.',
                    properties: {
                      name: { type: 'string', description: 'Act name.' },
                      purpose: {
                        type: 'string',
                        description: 'Dramatic purpose.',
                      },
                      scenes: {
                        type: 'array',
                        description: 'Ordered scenes in this act.',
                        items: {
                          type: 'object',
                          description: 'One production-planning scene.',
                          properties: {
                            title: { type: 'string', description: 'Scene title.' },
                            summary: {
                              type: 'string',
                              description: 'What visibly happens.',
                            },
                            storyBeat: {
                              type: 'string',
                              description: 'Dramatic beat served by the scene.',
                            },
                            dialogueIntent: {
                              type: 'string',
                              description: 'Dialogue goal or no-dialogue note.',
                            },
                          },
                          required: ['title', 'summary', 'storyBeat', 'dialogueIntent'],
                        },
                      },
                    },
                    required: ['name', 'purpose', 'scenes'],
                  },
                },
              },
              required: ['acts'],
            },
            assumptions: {
              type: 'array',
              description: 'Low-risk assumptions the user can review at the plan gate.',
              items: { type: 'string', description: 'One explicit assumption.' },
            },
            budget: {
              type: 'object',
              description: 'Cost and automatic retry boundaries that approval will lock.',
              properties: {
                maxTotalCostUsd: {
                  type: 'number',
                  description: 'Maximum total provider cost in USD.',
                },
                styleAuditionCostUsd: {
                  type: 'number',
                  description: 'Maximum style-audition cost in USD.',
                },
                maxAttemptsPerShot: {
                  type: 'number',
                  description: 'Maximum attempts per shot.',
                },
                maxRegenerations: {
                  type: 'number',
                  description: 'Maximum total regenerations.',
                },
              },
              required: [
                'maxTotalCostUsd',
                'styleAuditionCostUsd',
                'maxAttemptsPerShot',
                'maxRegenerations',
              ],
            },
            visualDirections: {
              type: 'array',
              description:
                'Non-empty directions to audition later; these are not yet the approved Visual Constitution. Maximum 20 entries.',
              items: { type: 'string', description: 'One candidate visual direction.' },
            },
            taskNames: {
              type: 'object',
              description:
                'Optional display-only map from stable taskKey to an AI-authored non-empty task name. Names do not change task keys, dependencies, status, or execution behavior; keep each name at most 120 characters and the map at most 200 entries.',
              properties: {},
              additionalProperties: { type: 'string' },
            },
          },
          required: [
            'title',
            'logline',
            'synopsis',
            'genre',
            'tone',
            'targetAudience',
            'format',
            'story',
            'assumptions',
            'budget',
            'visualDirections',
          ],
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
            await deps.pauseTaskList(id);
          } else if (controlAction === 'resume') {
            await deps.resumeTaskList(id);
          } else if (controlAction === 'cancel') {
            await deps.cancelTaskList(id);
          } else if (controlAction === 'retry') {
            await deps.retryTaskList(id);
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
                "taskList.manage { action: 'createProductionPlan' }",
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
          const expectedRowVersion = requireTaskListRowVersion(args, 'taskList.manage');
          return ok(
            await deps.reviseProductionPlan({
              canvasId: requireString(args, 'canvasId'),
              taskListId: requireString(args, 'taskListId'),
              expectedRowVersion,
              plan: validateProductionPlan(args.plan, args),
            }),
          );
        } catch (error) {
          return fail(error);
        }
      } else if (action === 'decidePendingGate') {
        try {
          const decision = args.decision;
          if (decision !== 'approve' && decision !== 'request_changes') {
            throw new TypedToolError(
              'taskList.manage: decision must be approve or request_changes',
              'validation',
            );
          }
          return ok(await deps.decidePendingGate(decision));
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
              'taskList.manage: evidence must be an array of non-empty strings',
              'validation',
            );
          }
          if (args.data !== undefined && !isRecord(args.data)) {
            throw new TypedToolError('taskList.manage: data must be an object', 'validation');
          }
          return ok(
            await deps.completeCreativeTask({
              canvasId: requireString(args, 'canvasId'),
              taskListId: requireString(args, 'taskListId'),
              taskId: requireString(args, 'taskId'),
              expectedRowVersion: requireTaskListRowVersion(args, 'taskList.manage'),
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

  const visual: ToolDefinition = {
    name: 'task.visual',
    process: 'task-list-orchestration',
    category: 'mutation',
    contextReplay: 'authority_reread',
    resource: meteredToolResource((args) => args.action === 'submit'),
    description:
      'Three-action persistent style audition. Call prepare with one or more candidates within the host budget (maximum 4); the host persists the current candidate sources and returns awaiting_prompt_assembly without provider or grader work. Reconcile every returned source, then call submit with its ID/output. The provider receives only the persisted final/negative prompt. Use status after a durable background evaluation. Never call a second LLM from inside this tool.',
    contexts,
    tier: 2,
    outputSchema: toolResultSchema(
      unionSchema(
        objectSchema({
          taskListId: stringSchema,
          status: { const: 'complete' },
          revision: numberSchema,
          contentHash: stringSchema,
          recommendedCandidateId: stringSchema,
          candidates: arraySchema(visualCandidateResultSchema),
        }),
        objectSchema({
          taskListId: stringSchema,
          status: { const: 'awaiting_prompt_assembly' },
          revision: numberSchema,
          contentHash: stringSchema,
          candidateId: stringSchema,
          promptAssembly: promptAssemblyRecordSchema,
          nextAction: { const: 'assemble_prompt' },
        }),
        objectSchema({
          taskListId: stringSchema,
          status: { const: 'evaluation_pending' },
          revision: numberSchema,
          contentHash: stringSchema,
          candidateId: stringSchema,
          promptAssemblyId: stringSchema,
          assetHash: stringSchema,
          message: stringSchema,
          nextAction: { const: 'retry_evaluation' },
        }),
      ),
    ),
    projectPublicResult: contextProjector((result, args) =>
      taskReplayFacts(result, args, args.action === 'status' ? 'read' : 'updated'),
    ),
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['prepare', 'submit', 'status'],
          description:
            'Prepare the next assembly, submit one assembled candidate, or inspect state.',
        },
        canvasId: {
          type: 'string',
          description: 'Host-injected canvas ID that owns the persistent task list.',
        },
        taskListId: {
          type: 'string',
          description: 'Persistent movie task-list ID from the SQLite task-list manifest.',
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
            'Non-empty project-specific directions for the user to compare. Maximum 4 entries is the host budget boundary.',
          items: {
            type: 'object',
            description: 'One fully specified direction and its locked grammar if selected.',
            properties: {
              id: {
                type: 'string',
                description: 'Stable short slug, unique in this candidate set.',
              },
              name: {
                type: 'string',
                description: 'Clear user-facing direction name.',
              },
              summary: {
                type: 'string',
                description: 'Plain-language explanation of what this direction feels like.',
              },
              prompt: {
                type: 'string',
                description:
                  'Project-specific preview prompt using a representative scene from the approved story.',
              },
              negativePrompt: {
                type: 'string',
                description: 'Optional explicit visual exclusions.',
              },
              seed: {
                type: 'number',
                description: 'Deterministic uint32 generation seed.',
              },
              constitution: {
                type: 'object',
                description:
                  'Visual grammar that will be immutable if the user selects this candidate.',
                properties: {
                  medium: { type: 'string', description: 'Medium.' },
                  era: {
                    type: 'string',
                    description: 'Era or temporal design language.',
                  },
                  rendering: {
                    type: 'string',
                    description: 'Rendering treatment.',
                  },
                  linework: { type: 'string', description: 'Edge/line treatment.' },
                  palette: { type: 'string', description: 'Palette grammar.' },
                  lighting: { type: 'string', description: 'Lighting grammar.' },
                  texture: { type: 'string', description: 'Texture and finish.' },
                  mood: { type: 'string', description: 'Emotional visual mood.' },
                  cameraGrammar: { type: 'string', description: 'Camera grammar.' },
                  lensGrammar: { type: 'string', description: 'Lens grammar.' },
                  compositionGrammar: {
                    type: 'string',
                    description: 'Composition grammar.',
                  },
                  motionGrammar: {
                    type: 'string',
                    description: 'Motion grammar for eventual video.',
                  },
                  characterAnchors: {
                    type: 'array',
                    description: 'Story-specific character identity anchors; may be empty.',
                    items: { type: 'string', description: 'One identity anchor.' },
                  },
                  locationAnchors: {
                    type: 'array',
                    description: 'Story-specific location identity anchors; may be empty.',
                    items: { type: 'string', description: 'One location anchor.' },
                  },
                  negativeConstraints: {
                    type: 'array',
                    description: 'Visual drift and style exclusions.',
                    items: { type: 'string', description: 'One exclusion.' },
                  },
                },
                required: [
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
                  'characterAnchors',
                  'locationAnchors',
                  'negativeConstraints',
                ],
              },
            },
            required: ['id', 'name', 'summary', 'prompt', 'seed', 'constitution'],
          },
        },
        promptAssemblyId: {
          type: 'string',
          description: 'ID returned by prepare for the current candidate.',
        },
        promptAssemblyOutput: promptAssemblyOutputSchema(),
      },
      required: ['action', 'canvasId', 'taskListId'],
    },
    async execute(args) {
      try {
        const action = requireString(args, 'action');
        const identity = {
          canvasId: requireString(args, 'canvasId'),
          taskListId: requireString(args, 'taskListId'),
        };
        if (action === 'status') {
          return ok(await deps.createVisualAuditions({ action, ...identity }));
        }
        if (action === 'submit') {
          const assembly = readOptionalPromptAssembly(args, 'task.visual');
          if (!assembly.promptAssemblyId || !assembly.promptAssemblyOutput) {
            throw new TypedToolError(
              'task.visual: submit requires promptAssemblyId and promptAssemblyOutput',
              'validation',
            );
          }
          return ok(
            await deps.createVisualAuditions({
              action,
              ...identity,
              promptAssemblyId: assembly.promptAssemblyId,
              promptAssemblyOutput: assembly.promptAssemblyOutput,
            }),
          );
        }
        if (action !== 'prepare') {
          throw new TypedToolError(
            'task.visual: action must be prepare, submit, or status',
            'validation',
          );
        }
        const width = args.width;
        const height = args.height;
        if (
          width !== undefined &&
          (typeof width !== 'number' || !Number.isInteger(width) || width <= 0)
        ) {
          throw new TypedToolError('task.visual: width must be a positive integer', 'validation');
        }
        if (
          height !== undefined &&
          (typeof height !== 'number' || !Number.isInteger(height) || height <= 0)
        ) {
          throw new TypedToolError('task.visual: height must be a positive integer', 'validation');
        }
        return ok(
          await deps.createVisualAuditions({
            action,
            ...identity,
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

  const delivery: ToolDefinition = {
    name: 'task.delivery',
    process: 'ordered-delivery',
    category: 'mutation',
    contextReplay: 'authority_reread',
    resource: NO_TOOL_RESOURCE,
    description:
      'Prepare the immutable third-gate Delivery manifest. The host derives ordering, selected source hashes, technical metadata, trims, audio preferences, naming, and provenance; this opens approval and never starts packaging.',
    contexts,
    tier: 2,
    outputSchema: toolResultSchema(
      objectSchema({
        context: objectSchema(
          {
            taskList: taskListSchema,
            manifest: planDocumentSchema,
            approval: planApprovalSchema,
            packageAttempt: canonicalJsonSchema,
          },
          ['taskList', 'manifest', 'approval'],
        ),
        created: booleanSchema,
      }),
    ),
    projectPublicResult: contextProjector((result, args) =>
      taskReplayFacts(result, args, 'updated'),
    ),
    inputSchema: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'Host-injected canvas ID.' },
        taskListId: { type: 'string', description: 'Persistent movie task-list ID.' },
        expectedRowVersion: {
          type: 'number',
          description: 'Latest SQLite task-list row version from the host manifest.',
        },
        packageBaseName: {
          type: 'string',
          description: 'Readable package base name. The host sanitizes it deterministically.',
        },
      },
      required: ['canvasId', 'taskListId', 'expectedRowVersion', 'packageBaseName'],
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
            'task.delivery: expectedRowVersion must be a non-negative integer',
            'validation',
          );
        }
        return ok(
          await deps.prepareDelivery({
            canvasId: requireString(args, 'canvasId'),
            taskListId: requireString(args, 'taskListId'),
            expectedRowVersion,
            packageBaseName: requireString(args, 'packageBaseName'),
          }),
        );
      } catch (error) {
        return fail(error);
      }
    },
  };

  const media: ToolDefinition = {
    name: 'task.media',
    process: 'task-list-orchestration',
    category: 'mutation',
    contextReplay: 'authority_reread',
    resource: meteredToolResource((args) => args.promptAssemblyOutput !== undefined),
    description:
      'Two-stage persistent image/video production. First call with task-list/canvas/task/node identity only: the host persists every approved prompt source and returns status awaiting_prompt_assembly. Reconcile every returned source into one final provider prompt, then call again with the same identity, promptAssemblyId, and promptAssemblyOutput. Only the second call reserves cost and submits the exact persisted finalPrompt/negativePrompt byte-for-byte. Never call a second LLM from inside this tool.',
    contexts,
    tier: 1,
    outputSchema: toolResultSchema(productionMediaViewSchema),
    projectPublicResult: contextProjector((result, args) =>
      taskReplayFacts(result, args, 'updated'),
    ),
    inputSchema: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'Host-injected canvas ID.' },
        taskListId: { type: 'string', description: 'Persistent movie task-list ID.' },
        taskId: {
          type: 'string',
          description: 'Host-injected current durable task-list task ID.',
        },
        nodeId: { type: 'string', description: 'Image or video canvas node to produce.' },
        expectedRowVersion: {
          type: 'number',
          description: 'Latest SQLite task-list row version from the host manifest.',
        },
        promptAssemblyId: {
          type: 'string',
          description: 'ID returned by the first awaiting_prompt_assembly result.',
        },
        promptAssemblyOutput: promptAssemblyOutputSchema(),
      },
      required: ['canvasId', 'taskListId', 'taskId', 'nodeId', 'expectedRowVersion'],
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
            'task.media: expectedRowVersion must be a non-negative integer',
            'validation',
          );
        }
        return ok(
          await deps.produceMedia({
            canvasId: requireString(args, 'canvasId'),
            taskListId: requireString(args, 'taskListId'),
            taskId: requireString(args, 'taskId'),
            nodeId: requireString(args, 'nodeId'),
            expectedRowVersion,
            ...readOptionalPromptAssembly(args, 'task.media'),
          }),
        );
      } catch (error) {
        return fail(error);
      }
    },
  };

  const mediaFeedback: ToolDefinition = {
    name: 'task.mediaFeedback',
    process: 'task-list-orchestration',
    category: 'mutation',
    contextReplay: 'authority_reread',
    resource: meteredToolResource((args) => args.promptAssemblyOutput !== undefined),
    description:
      'Two-stage refinement from a small user quality comment. First pass the comment verbatim plus exact latest attempt identity; the host returns a persisted assembly containing the exact parent provider prompt and feedback. Reconcile those sources, then repeat the call with promptAssemblyId and promptAssemblyOutput. The provider receives only the validated persisted final prompt; the host never appends the feedback itself.',
    contexts,
    tier: 1,
    outputSchema: toolResultSchema(productionMediaViewSchema),
    projectPublicResult: contextProjector((result, args) =>
      taskReplayFacts(result, args, 'updated'),
    ),
    inputSchema: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'Host-injected canvas ID.' },
        taskListId: {
          type: 'string',
          description: 'Host-injected persistent movie task-list ID.',
        },
        nodeId: { type: 'string', description: 'Existing image or video canvas node.' },
        expectedRowVersion: {
          type: 'number',
          description: 'Host-injected SQLite task-list row version.',
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
        promptAssemblyId: {
          type: 'string',
          description: 'ID returned by the first awaiting_prompt_assembly result.',
        },
        promptAssemblyOutput: promptAssemblyOutputSchema(),
      },
      required: [
        'canvasId',
        'taskListId',
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
            'task.mediaFeedback: expectedRowVersion must be a non-negative integer',
            'validation',
          );
        }
        const basePromptHash = requireString(args, 'basePromptHash');
        if (!/^[a-f0-9]{64}$/i.test(basePromptHash)) {
          throw new TypedToolError(
            'task.mediaFeedback: basePromptHash must be a SHA-256 hex digest',
            'validation',
          );
        }
        const feedback = requireString(args, 'feedback');
        if (feedback.length > 2_000) {
          throw new TypedToolError(
            'task.mediaFeedback: feedback must be 2000 characters or fewer',
            'validation',
          );
        }
        return ok(
          await deps.refineMedia({
            canvasId: requireString(args, 'canvasId'),
            taskListId: requireString(args, 'taskListId'),
            nodeId: requireString(args, 'nodeId'),
            expectedRowVersion,
            targetAttemptId: requireString(args, 'targetAttemptId'),
            basePromptHash,
            feedback,
            ...readOptionalPromptAssembly(args, 'task.mediaFeedback'),
          }),
        );
      } catch (error) {
        return fail(error);
      }
    },
  };

  const audio: ToolDefinition = {
    name: 'task.audio',
    process: 'task-list-orchestration',
    category: 'mutation',
    contextReplay: 'authority_reread',
    resource: meteredToolResource((args) => args.action === 'submit'),
    description:
      'Two-stage durable audio generation owned by Commander. Call prepare once to create an audio.production.v1 Task List and receive its persisted Prompt Assembly. Reconcile every source into one final provider prompt, then call submit with that exact assembly ID and your complete output. The host only validates and persists your output; it never calls another LLM or edits the final prompt. Use status only to recover an existing request.',
    contexts,
    tier: 2,
    outputSchema: toolResultSchema(audioTaskViewSchema),
    projectPublicResult: contextProjector((result, args) =>
      taskReplayFacts(
        result,
        args,
        args.action === 'prepare' ? 'created' : args.action === 'status' ? 'read' : 'updated',
      ),
    ),
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['prepare', 'status', 'submit'],
          description: 'Create the request, recover its persisted state, or submit the final prompt.',
        },
        subtype: {
          type: 'string',
          enum: ['voice', 'music', 'sfx'],
          description: 'Audio output type.',
        },
        prompt: {
          type: 'string',
          description: "The user's audio intent, preserved without hidden prompt injection.",
        },
        providerId: { type: 'string', description: 'Configured audio provider ID.' },
        model: { type: 'string', description: 'Optional configured provider model.' },
        duration: { type: 'number', description: 'Optional positive duration in seconds.' },
        params: {
          type: 'object',
          properties: {},
          additionalProperties: true,
          description: 'Optional provider-specific audio parameters.',
        },
        taskListId: {
          type: 'string',
          description: 'Durable audio Task List ID supplied by Audio Studio.',
        },
        promptAssemblyId: {
          type: 'string',
          description: 'Copy from the prepared Prompt Assembly returned by status.',
        },
        promptAssemblyOutput: promptAssemblyOutputSchema(),
      },
      required: ['action'],
    },
    async execute(args) {
      try {
        const action = requireString(args, 'action');
        if (action === 'prepare') {
          const subtype = requireString(args, 'subtype');
          if (subtype !== 'voice' && subtype !== 'music' && subtype !== 'sfx') {
            throw new TypedToolError(
              'task.audio: subtype must be voice, music, or sfx',
              'validation',
            );
          }
          const duration = args.duration;
          if (duration !== undefined && (typeof duration !== 'number' || duration <= 0)) {
            throw new TypedToolError(
              'task.audio: duration must be a positive number',
              'validation',
            );
          }
          if (args.params !== undefined && !isRecord(args.params)) {
            throw new TypedToolError('task.audio: params must be an object', 'validation');
          }
          return ok(
            await deps.prepareAudioTask({
              subtype,
              prompt: requireString(args, 'prompt'),
              providerId: requireString(args, 'providerId'),
              ...(typeof args.model === 'string' && args.model.trim()
                ? { model: args.model.trim() }
                : {}),
              ...(typeof duration === 'number' ? { duration } : {}),
              ...(isRecord(args.params) ? { params: args.params } : {}),
            }),
          );
        }
        const taskListId = requireString(args, 'taskListId');
        if (action === 'status') return ok(await deps.getAudioTask(taskListId));
        if (action !== 'submit') {
          throw new TypedToolError(
            'task.audio: action must be prepare, status, or submit',
            'validation',
          );
        }
        const assembly = readOptionalPromptAssembly(args, 'task.audio');
        if (!assembly.promptAssemblyId || !assembly.promptAssemblyOutput) {
          throw new TypedToolError(
            'task.audio: submit requires promptAssemblyId and promptAssemblyOutput',
            'validation',
          );
        }
        return ok(
          await deps.submitAudioPrompt({
            taskListId,
            promptAssemblyId: assembly.promptAssemblyId,
            promptAssemblyOutput: assembly.promptAssemblyOutput,
          }),
        );
      } catch (error) {
        return fail(error);
      }
    },
  };

  return [manage, visual, media, mediaFeedback, audio, delivery];
}
