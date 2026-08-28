import { z } from 'zod';
import { strictObject } from '../canonical.js';
import {
  ArtifactRefSchema,
  CountAmountSchema,
  CountSchema,
  DomainObjectRefSchema,
  EntityIdSchema,
  PermissionModeSchema,
  ResourceAmountSchema,
  ResourceBudgetSchema,
  RevisionSchema,
  Sha256Schema,
} from '../primitives.js';
import { RunStateSchema, SelectedContextRefSchema, TaskListSchema } from '../run.js';
import {
  MAX_REFERENCE_COUNT,
  MAX_TOOL_NAMES,
  controlMetadata,
  defineTool,
  reversibleMetadata,
  uniqueArray,
  variantExecution,
} from './common.js';
import { ToolIdSchema } from './ids.js';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const TIME = '2026-08-15T12:00:00.000Z';

function runControlPolicy(
  domain: 'interaction' | 'task' | 'agent',
  result: 'summary' | 'object_links',
  run: 'current' | 'descendant' = 'current',
) {
  return controlMetadata({
    domain,
    scope: { project: 'current', run, crossProject: 'denied' },
    cas: { mode: 'revision', expectedFields: ['expectedRevision'] },
    publicProgress: {
      mode:
        domain === 'interaction' ? 'interaction' : domain === 'task' ? 'task_list' : 'child_run',
      redactArguments: true,
    },
    publicResult: { mode: result, redactProviderPayload: true },
    artifactProjection: { mode: 'none', fields: [] },
    contextFactProjection: { mode: 'run_state', fields: ['state'] },
    variantDiscriminant: null,
    variants: [],
  });
}

const InteractionOptionSchema = strictObject({
  optionId: EntityIdSchema,
  label: z.string().trim().min(1).max(500),
  description: z.string().max(4_000),
});

export const InteractionAskDefinition = defineTool({
  id: 'interaction.ask',
  description: 'Ask one material bounded question and wait for an exact user response event.',
  metadata: runControlPolicy('interaction', 'summary'),
  inputSchema: strictObject({
    prompt: z.string().trim().min(1).max(20_000),
    options: z.array(InteractionOptionSchema).max(20),
    allowFreeText: z.boolean(),
    contextRefs: uniqueArray(
      DomainObjectRefSchema,
      0,
      MAX_REFERENCE_COUNT,
      'interaction context refs',
    ),
    expectedRunRevision: RevisionSchema,
  }),
  successSchema: strictObject({
    interactionId: EntityIdSchema,
    state: z.literal('pending'),
    runState: z.literal('waiting_question'),
    runRevision: RevisionSchema,
  }),
  examples: {
    input: {
      prompt: 'Which result should become the primary reference?',
      options: [
        { optionId: 'option.1', label: 'Result A', description: 'Cool moonlit harbor.' },
        { optionId: 'option.2', label: 'Result B', description: 'Warmer dawn harbor.' },
      ],
      allowFreeText: true,
      contextRefs: [],
      expectedRunRevision: 3,
    },
    success: {
      interactionId: 'interaction.1',
      state: 'pending',
      runState: 'waiting_question',
      runRevision: 4,
    },
  },
});

export const SkillProposeDefinition = defineTool({
  id: 'skill.propose',
  description:
    'Propose one reviewed Project Skill for exact user confirmation and next-root activation.',
  metadata: {
    ...reversibleMetadata({
      domain: 'project',
      dynamicProtection: false,
      scope: { project: 'current', run: 'current', crossProject: 'denied' },
      cas: {
        mode: 'revision_and_content_hash',
        expectedFields: [],
      },
      publicProgress: { mode: 'interaction', redactArguments: true },
      publicResult: { mode: 'summary', redactProviderPayload: true },
      artifactProjection: { mode: 'none', fields: [] },
      contextFactProjection: {
        mode: 'run_state',
        fields: ['confirmationId', 'runState', 'runRevision'],
      },
      variantDiscriminant: null,
      variants: [],
    }),
    profile: 'PROTECTED',
    effect: {
      domainMutation: true,
      runMutation: true,
      externalSideEffect: false,
      destructive: false,
      credentialMutation: false,
    },
    permission: {
      required: ['project.write', 'run.control'],
      dynamicProtection: false,
    },
    confirmation: { mode: 'exact_protected', globallyWaivable: false },
    recovery: { mode: 'run_state', unknownStateNeverResubmit: false },
  },
  inputSchema: strictObject({
    name: z.string().trim().min(1).max(240),
    description: z.string().trim().min(1).max(4_000),
    content: z.string().min(1).max(200_000),
  }),
  successSchema: strictObject({
    confirmationId: EntityIdSchema,
    immutableInputHash: Sha256Schema,
    runState: z.literal('waiting_confirmation'),
    runRevision: RevisionSchema,
  }),
  examples: {
    input: {
      name: 'Continuity reviewer',
      description: 'Review shots for visible continuity errors.',
      content: 'Check props, wardrobe, lighting, and screen direction.',
    },
    success: {
      confirmationId: 'confirmation.skill.1',
      immutableInputHash: HASH_B,
      runState: 'waiting_confirmation',
      runRevision: 4,
    },
  },
});

const TaskDraftSchema = strictObject({
  draftId: EntityIdSchema,
  title: z.string().trim().min(1).max(500),
  parentDraftId: EntityIdSchema.nullable(),
  order: CountSchema,
});
const TaskDraftListSchema = z
  .array(TaskDraftSchema)
  .max(100)
  .superRefine((drafts, context) => {
    const draftById = new Map<string, (typeof drafts)[number]>();
    drafts.forEach((draft, index) => {
      if (draftById.has(draft.draftId)) {
        context.addIssue({
          code: 'custom',
          path: [index, 'draftId'],
          message: 'Task draft IDs must be unique',
        });
      }
      draftById.set(draft.draftId, draft);
    });
    const siblingOrders = new Map<string, number[]>();
    drafts.forEach((draft, index) => {
      if (draft.parentDraftId !== null && !draftById.has(draft.parentDraftId)) {
        context.addIssue({
          code: 'custom',
          path: [index, 'parentDraftId'],
          message: 'Task draft parent must be part of the same create request',
        });
      }
      const siblingKey = draft.parentDraftId ?? '';
      const orders = siblingOrders.get(siblingKey) ?? [];
      orders.push(draft.order);
      siblingOrders.set(siblingKey, orders);

      const visited = new Set([draft.draftId]);
      let parentId = draft.parentDraftId;
      while (parentId !== null) {
        if (visited.has(parentId)) {
          context.addIssue({
            code: 'custom',
            path: [index, 'parentDraftId'],
            message: 'Task draft parents cannot contain cycles',
          });
          break;
        }
        visited.add(parentId);
        parentId = draftById.get(parentId)?.parentDraftId ?? null;
      }
    });
    for (const orders of siblingOrders.values()) {
      const sorted = [...orders].sort((left, right) => left - right);
      if (sorted.some((order, index) => order !== index)) {
        context.addIssue({
          code: 'custom',
          message: 'Sibling Task draft order must be unique and contiguous from zero',
        });
      }
    }
  });
const TaskChangeSummarySchema = z.string().trim().min(1).max(10_000);
const TaskManageInputSchema = z.union([
  strictObject({ action: z.literal('get') }),
  strictObject({
    action: z.literal('create'),
    expectedRunRevision: RevisionSchema,
    title: z.string().trim().min(1).max(500),
    tasks: TaskDraftListSchema,
    publicSummary: TaskChangeSummarySchema,
  }),
  strictObject({
    action: z.literal('rename'),
    expectedRevision: RevisionSchema,
    title: z.string().trim().min(1).max(500),
    publicSummary: TaskChangeSummarySchema,
  }),
  strictObject({
    action: z.literal('add'),
    expectedRevision: RevisionSchema,
    parentTaskId: EntityIdSchema.nullable(),
    order: CountSchema,
    title: z.string().trim().min(1).max(500),
    publicSummary: TaskChangeSummarySchema,
  }),
  strictObject({
    action: z.literal('update'),
    expectedRevision: RevisionSchema,
    taskId: EntityIdSchema,
    title: z.string().trim().min(1).max(500).nullable(),
    state: z.enum(['pending', 'in_progress', 'blocked', 'completed', 'cancelled']).nullable(),
    resultSummary: z.string().max(4_000).nullable(),
    childRunId: EntityIdSchema.nullable(),
    publicSummary: TaskChangeSummarySchema,
  }),
  strictObject({
    action: z.literal('reorder'),
    expectedRevision: RevisionSchema,
    parentTaskId: EntityIdSchema.nullable(),
    orderedTaskIds: uniqueArray(EntityIdSchema, 1, 1_000, 'ordered task IDs'),
    publicSummary: TaskChangeSummarySchema,
  }),
  strictObject({
    action: z.literal('remove'),
    expectedRevision: RevisionSchema,
    taskId: EntityIdSchema,
    publicSummary: TaskChangeSummarySchema,
  }),
  strictObject({
    action: z.literal('terminalize'),
    expectedRevision: RevisionSchema,
    state: z.enum(['completed', 'cancelled']),
    publicSummary: TaskChangeSummarySchema,
  }),
]);

export const TaskManageDefinition = defineTool({
  id: 'task.manage',
  description: 'Read or revise the optional Commander-owned TaskList for the current Run.',
  metadata: {
    ...runControlPolicy('task', 'summary'),
    variantDiscriminant: 'action',
    variants: [
      variantExecution({
        discriminant: 'get',
        profile: 'R',
        effect: 'read',
        permissions: ['run.control'],
        confirmation: 'none',
        cost: 'none',
        unknownCost: 'not_applicable',
        cas: 'none',
        idempotency: 'read_fingerprint',
        retry: 'safe',
        timeout: 'bounded_read',
        cancellation: 'read_only',
        recovery: 'run_state',
        unknownStateNeverResubmit: false,
      }),
      ...['create', 'rename', 'add', 'update', 'reorder', 'remove', 'terminalize'].map(
        (discriminant) =>
          variantExecution({
            discriminant,
            profile: 'CTRL',
            effect: 'run_control',
            permissions: ['run.control'],
            confirmation: 'none',
            cost: 'none',
            unknownCost: 'not_applicable',
            cas: 'revision',
            idempotency: 'operation_fingerprint',
            retry: 'before_commit',
            timeout: 'bounded_write',
            cancellation: 'before_commit',
            recovery: 'run_state',
            unknownStateNeverResubmit: false,
          }),
      ),
    ],
  },
  inputSchema: TaskManageInputSchema,
  successSchema: strictObject({
    taskList: TaskListSchema.nullable(),
    changedTaskIds: z.array(EntityIdSchema).max(1_000),
  }),
  examples: {
    input: {
      action: 'create',
      expectedRunRevision: 3,
      title: 'Create the harbor sequence',
      tasks: [
        {
          draftId: 'draft.inspect',
          title: 'Inspect references',
          parentDraftId: null,
          order: 0,
        },
      ],
      publicSummary: 'Created the working task list for the harbor sequence.',
    },
    success: {
      taskList: {
        authority: 'task_list',
        id: 'tasklist.1',
        runId: 'run.1',
        title: 'Create the harbor sequence',
        state: 'active',
        revision: 1,
        contentHash: HASH_A,
        items: [
          {
            id: 'task.1',
            title: 'Inspect references',
            state: 'pending',
            order: 0,
            parentItemId: null,
            childRunIds: [],
            publicNote: '',
          },
        ],
        createdAt: TIME,
        updatedAt: TIME,
        terminalizedAt: null,
      },
      changedTaskIds: ['task.1'],
    },
  },
});

const ChildRunRefSchema = strictObject({
  childRunId: EntityIdSchema,
  revision: RevisionSchema,
  contentHash: Sha256Schema,
  state: RunStateSchema,
  objectiveHash: Sha256Schema,
});
const ChildRunSummarySchema = strictObject({
  child: ChildRunRefSchema,
  displayName: z.string().min(1).max(240),
  summary: z.string().max(100_000),
  resultRefs: z.array(DomainObjectRefSchema).max(MAX_REFERENCE_COUNT),
  artifacts: z.array(ArtifactRefSchema).max(MAX_REFERENCE_COUNT),
  blockers: z.array(z.string().min(1).max(4_000)).max(100),
  usage: strictObject({
    costUsd: ResourceAmountSchema,
    generationCount: CountAmountSchema,
    inputTokens: CountAmountSchema,
    outputTokens: CountAmountSchema,
  }),
});

const AgentSpawnSharedInputFields = {
  displayName: z.string().trim().min(1).max(240),
  publicSummary: z.string().trim().min(1).max(20_000),
  contextRefs: uniqueArray(SelectedContextRefSchema, 0, MAX_REFERENCE_COUNT, 'child context refs'),
  toolAllowlist: uniqueArray(ToolIdSchema, 1, MAX_TOOL_NAMES, 'child tool allowlist').nullable(),
  permissionCeiling: PermissionModeSchema.nullable(),
  budgetCaps: ResourceBudgetSchema.nullable(),
  expectedParentRevision: RevisionSchema,
} as const;

/** The only agent.spawn input representation allowed in durable public storage. */
export const AgentSpawnDurableInputSchema = strictObject({
  displayName: AgentSpawnSharedInputFields.displayName,
  objectiveHash: Sha256Schema,
  publicSummary: AgentSpawnSharedInputFields.publicSummary,
  contextRefs: AgentSpawnSharedInputFields.contextRefs,
  toolAllowlist: AgentSpawnSharedInputFields.toolAllowlist,
  permissionCeiling: AgentSpawnSharedInputFields.permissionCeiling,
  budgetCaps: AgentSpawnSharedInputFields.budgetCaps,
  expectedParentRevision: AgentSpawnSharedInputFields.expectedParentRevision,
});

export const AgentSpawnDefinition = defineTool({
  id: 'agent.spawn',
  description:
    'Create one scoped child Run with selected context and equal-or-narrower boundaries.',
  metadata: runControlPolicy('agent', 'object_links', 'descendant'),
  inputSchema: strictObject({
    displayName: AgentSpawnSharedInputFields.displayName,
    objective: z.string().trim().min(1).max(20_000),
    publicSummary: AgentSpawnSharedInputFields.publicSummary,
    contextRefs: AgentSpawnSharedInputFields.contextRefs,
    toolAllowlist: AgentSpawnSharedInputFields.toolAllowlist,
    permissionCeiling: AgentSpawnSharedInputFields.permissionCeiling,
    budgetCaps: AgentSpawnSharedInputFields.budgetCaps,
    expectedParentRevision: AgentSpawnSharedInputFields.expectedParentRevision,
  }),
  successSchema: strictObject({
    child: ChildRunRefSchema,
    manifestHash: Sha256Schema,
    capabilityCatalogHash: Sha256Schema,
  }),
  examples: {
    input: {
      displayName: 'Continuity check',
      objective: 'Compare the two harbor shots for visible continuity differences.',
      publicSummary: 'Checking the selected harbor shots for visual continuity.',
      contextRefs: [
        {
          ref: { authority: 'production', id: 'shot.1', revision: 2, contentHash: HASH_A },
          role: 'target',
        },
      ],
      toolAllowlist: null,
      permissionCeiling: null,
      budgetCaps: null,
      expectedParentRevision: 3,
    },
    success: {
      child: {
        childRunId: 'run.child.1',
        revision: 1,
        contentHash: HASH_B,
        state: 'accepted',
        objectiveHash: HASH_A,
      },
      manifestHash: HASH_B,
      capabilityCatalogHash: HASH_A,
    },
  },
});

/** The only agent.send input representation allowed in durable public storage. */
export const AgentSendDurableInputSchema = strictObject({
  childRunId: EntityIdSchema,
  expectedChildRevision: RevisionSchema,
  messageHash: Sha256Schema,
  contextRefs: uniqueArray(DomainObjectRefSchema, 0, MAX_REFERENCE_COUNT, 'follow-up context refs'),
});

export const AgentSendDefinition = defineTool({
  id: 'agent.send',
  description: 'Append one bounded follow-up direction to a descendant Run inbox.',
  metadata: runControlPolicy('agent', 'summary', 'descendant'),
  inputSchema: strictObject({
    childRunId: EntityIdSchema,
    expectedChildRevision: RevisionSchema,
    message: z.string().trim().min(1).max(20_000),
    contextRefs: uniqueArray(
      DomainObjectRefSchema,
      0,
      MAX_REFERENCE_COUNT,
      'follow-up context refs',
    ),
  }),
  successSchema: strictObject({
    inboxMessageId: EntityIdSchema,
    inboxSequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    activationNumber: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    deliveryState: z.enum(['queued', 'delivered']),
    child: ChildRunRefSchema,
  }),
  examples: {
    input: {
      childRunId: 'run.child.1',
      expectedChildRevision: 1,
      message: 'Also compare the prop position.',
      contextRefs: [],
    },
    success: {
      inboxMessageId: 'inbox.1',
      inboxSequence: 2,
      activationNumber: 2,
      deliveryState: 'queued',
      child: {
        childRunId: 'run.child.1',
        revision: 2,
        contentHash: HASH_B,
        state: 'running',
        objectiveHash: HASH_A,
      },
    },
  },
});

export const AgentWaitDefinition = defineTool({
  id: 'agent.wait',
  description: 'Wait for bounded descendant Run state changes without polling unrelated Runs.',
  metadata: {
    ...runControlPolicy('agent', 'summary', 'descendant'),
    cas: { mode: 'none', expectedFields: [] },
    fingerprint: { mode: 'canonical_read', hostAssignedIdempotency: false },
    retry: { mode: 'safe', technicalAttemptLimit: 1 },
    timeout: { mode: 'wait', maximumMs: 300_000 },
  },
  inputSchema: strictObject({
    childRunIds: uniqueArray(EntityIdSchema, 1, 20, 'child Run IDs'),
    condition: z.enum(['any_terminal', 'all_terminal', 'any_change']),
    timeoutMs: z.number().int().positive().max(300_000).nullable(),
  }),
  successSchema: strictObject({
    children: z.array(ChildRunSummarySchema).min(1).max(20),
    timedOut: z.boolean(),
  }),
  examples: {
    input: { childRunIds: ['run.child.1'], condition: 'any_terminal', timeoutMs: 30_000 },
    success: {
      children: [
        {
          child: {
            childRunId: 'run.child.1',
            revision: 3,
            contentHash: HASH_B,
            state: 'completed',
            objectiveHash: HASH_A,
          },
          displayName: 'Continuity check',
          summary: 'Continuity check completed.',
          resultRefs: [],
          artifacts: [],
          blockers: [],
          usage: {
            costUsd: { state: 'known', value: '0.1', currency: 'USD' },
            generationCount: { state: 'known', value: 0 },
            inputTokens: { state: 'known', value: 2_000 },
            outputTokens: { state: 'known', value: 500 },
          },
        },
      ],
      timedOut: false,
    },
  },
});

export const AgentResultDefinition = defineTool({
  id: 'agent.result',
  description: 'Retrieve validated public results, usage, and blockers from terminal descendants.',
  metadata: {
    ...runControlPolicy('agent', 'object_links', 'descendant'),
    cas: { mode: 'none', expectedFields: [] },
    fingerprint: { mode: 'canonical_read', hostAssignedIdempotency: false },
    retry: { mode: 'safe', technicalAttemptLimit: 1 },
  },
  inputSchema: strictObject({
    childRunIds: uniqueArray(EntityIdSchema, 1, 20, 'child Run IDs'),
  }),
  successSchema: strictObject({
    children: z.array(ChildRunSummarySchema).min(1).max(20),
  }),
  examples: {
    input: { childRunIds: ['run.child.1'] },
    success: {
      children: [
        {
          child: {
            childRunId: 'run.child.1',
            revision: 3,
            contentHash: HASH_B,
            state: 'completed',
            objectiveHash: HASH_A,
          },
          displayName: 'Continuity check',
          summary: 'The prop moves between shots.',
          resultRefs: [],
          artifacts: [],
          blockers: [],
          usage: {
            costUsd: { state: 'known', value: '0.1', currency: 'USD' },
            generationCount: { state: 'known', value: 0 },
            inputTokens: { state: 'known', value: 2_000 },
            outputTokens: { state: 'known', value: 500 },
          },
        },
      ],
    },
  },
});

export const AgentCancelDefinition = defineTool({
  id: 'agent.cancel',
  description: 'Cancel a descendant Run cooperatively while preserving events, results, and usage.',
  metadata: runControlPolicy('agent', 'summary', 'descendant'),
  inputSchema: strictObject({
    childRunId: EntityIdSchema,
    expectedRevision: RevisionSchema,
    reason: z.string().max(4_000),
  }),
  successSchema: strictObject({
    children: z.array(ChildRunSummarySchema).min(1).max(100),
    retainedArtifactCount: CountSchema,
    unknownOperationCount: CountSchema,
  }),
  examples: {
    input: {
      childRunId: 'run.child.1',
      expectedRevision: 2,
      reason: 'The user changed direction.',
    },
    success: {
      children: [
        {
          child: {
            childRunId: 'run.child.1',
            revision: 3,
            contentHash: HASH_B,
            state: 'cancelled',
            objectiveHash: HASH_A,
          },
          displayName: 'Continuity check',
          summary: 'Cancelled after preserving completed findings.',
          resultRefs: [],
          artifacts: [],
          blockers: [],
          usage: {
            costUsd: { state: 'known', value: '0.1', currency: 'USD' },
            generationCount: { state: 'known', value: 0 },
            inputTokens: { state: 'known', value: 2_000 },
            outputTokens: { state: 'known', value: 500 },
          },
        },
      ],
      retainedArtifactCount: 0,
      unknownOperationCount: 0,
    },
  },
});

export const CONTROL_TOOL_DEFINITIONS = Object.freeze([
  InteractionAskDefinition,
  SkillProposeDefinition,
  TaskManageDefinition,
  AgentSpawnDefinition,
  AgentSendDefinition,
  AgentWaitDefinition,
  AgentResultDefinition,
  AgentCancelDefinition,
] as const);
