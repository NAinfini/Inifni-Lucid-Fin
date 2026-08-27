import { z } from 'zod';
import { strictObject } from '../canonical.js';
import {
  ArtifactRefSchema,
  CountAmountSchema,
  CountSchema,
  DomainObjectRefSchema,
  EntityIdSchema,
  ResourceAmountSchema,
  RevisionSchema,
  Sha256Schema,
} from '../primitives.js';
import { CONTROL_TOOL_DEFINITIONS } from './control-tools.js';
import {
  MAX_REFERENCE_COUNT,
  MAX_TOOL_PROGRAM_CALLS,
  MAX_TOOL_PROGRAM_CONCURRENCY,
  MAX_TOOL_PROGRAM_DEPTH,
  MAX_TOOL_PROGRAM_NODES,
  CanonicalToolDataSchema,
  GenericToolOutcomeSchema,
  ToolVersionSchema,
  type TargetToolDefinition,
  controlMetadata,
  defineTool,
  uniqueArray,
  variantExecution,
} from './common.js';
import { CONTEXT_TOOL_DEFINITIONS } from './context-tools.js';
import { DELIVERY_TOOL_DEFINITIONS } from './delivery-tools.js';
import { DOMAIN_TOOL_DEFINITIONS } from './domain-tools.js';
import { GENERATION_TOOL_DEFINITIONS } from './generation-tools.js';
import { EXACT_TOOL_IDS, ToolIdSchema } from './ids.js';

export { EXACT_TOOL_IDS } from './ids.js';

const EXAMPLE_HASH = 'a'.repeat(64);

const NON_PROGRAM_TOOL_DEFINITIONS = Object.freeze(
  [
    ...CONTEXT_TOOL_DEFINITIONS,
    ...DOMAIN_TOOL_DEFINITIONS,
    ...GENERATION_TOOL_DEFINITIONS,
    ...DELIVERY_TOOL_DEFINITIONS,
    ...CONTROL_TOOL_DEFINITIONS,
  ].sort((left, right) => left.id.localeCompare(right.id)),
);

const ProgramChildToolIdSchema = ToolIdSchema.exclude(['skill.propose', 'tool.program']);
export const DirectToolCallSchema = strictObject({
  toolId: ProgramChildToolIdSchema,
  toolVersion: ToolVersionSchema,
  input: CanonicalToolDataSchema,
});

const ProgramOutcomeStatusSchema = z.enum([
  'succeeded',
  'validation_failed',
  'permission_required',
  'permission_denied',
  'budget_blocked',
  'cost_unknown',
  'conflict',
  'provider_unavailable',
  'provider_state_unknown',
  'retryable_failure',
  'non_retryable_failure',
  'cancelled',
  'recovery_required',
]);
const ProgramCallStepSchema = strictObject({
  stepId: EntityIdSchema,
  operation: z.literal('call'),
  invocation: DirectToolCallSchema,
});
const ProgramMapStepSchema = strictObject({
  stepId: EntityIdSchema,
  operation: z.literal('map'),
  invocations: z.array(DirectToolCallSchema).min(1).max(MAX_TOOL_PROGRAM_CALLS),
  concurrency: z.number().int().positive().max(MAX_TOOL_PROGRAM_CONCURRENCY),
});
const ProgramBatchStepSchema = strictObject({
  stepId: EntityIdSchema,
  operation: z.literal('batch'),
  invocations: z.array(DirectToolCallSchema).min(1).max(MAX_TOOL_PROGRAM_CALLS),
});
const ProgramFilterStepSchema = strictObject({
  stepId: EntityIdSchema,
  operation: z.literal('filter'),
  sourceStepId: EntityIdSchema,
  predicate: strictObject({
    field: z.literal('outcome_status'),
    include: uniqueArray(ProgramOutcomeStatusSchema, 1, 13, 'filter statuses'),
  }),
});
const ProgramSortStepSchema = strictObject({
  stepId: EntityIdSchema,
  operation: z.literal('sort'),
  sourceStepId: EntityIdSchema,
  key: z.enum(['tool_id', 'outcome_status']),
  direction: z.enum(['ascending', 'descending']),
});
const ProgramValidateStepSchema = strictObject({
  stepId: EntityIdSchema,
  operation: z.literal('validate'),
  sourceStepId: EntityIdSchema,
  rule: z.union([
    strictObject({ kind: z.literal('all_succeeded') }),
    strictObject({ kind: z.literal('none_blocked') }),
    strictObject({ kind: z.literal('maximum_items'), maximum: CountSchema }),
  ]),
});
const ProgramTakeStepSchema = strictObject({
  stepId: EntityIdSchema,
  operation: z.literal('take'),
  sourceStepId: EntityIdSchema,
  count: z.number().int().positive().max(MAX_TOOL_PROGRAM_CALLS),
});

export const ToolProgramStepSchema = z.union([
  ProgramCallStepSchema,
  ProgramMapStepSchema,
  ProgramBatchStepSchema,
  ProgramFilterStepSchema,
  ProgramSortStepSchema,
  ProgramValidateStepSchema,
  ProgramTakeStepSchema,
]);

export const ToolProgramInputSchema = strictObject({
  version: z.literal(1),
  displayName: z.string().trim().min(1).max(240),
  expectedRunRevision: RevisionSchema,
  contextRefs: uniqueArray(DomainObjectRefSchema, 0, MAX_REFERENCE_COUNT, 'program context refs'),
  steps: z.array(ToolProgramStepSchema).min(1).max(MAX_TOOL_PROGRAM_NODES),
}).superRefine((program, context) => {
  const knownSteps = new Set<string>();
  const depthByStep = new Map<string, number>();
  let callCount = 0;

  for (let index = 0; index < program.steps.length; index += 1) {
    const step = program.steps[index];
    if (knownSteps.has(step.stepId)) {
      context.addIssue({
        code: 'custom',
        path: ['steps', index, 'stepId'],
        message: 'Tool Program step IDs must be unique',
      });
      continue;
    }

    let depth = 1;
    if ('sourceStepId' in step) {
      const sourceDepth = depthByStep.get(step.sourceStepId);
      if (sourceDepth === undefined) {
        context.addIssue({
          code: 'custom',
          path: ['steps', index, 'sourceStepId'],
          message: 'Tool Program sources must reference an earlier step',
        });
      } else {
        depth = sourceDepth + 1;
      }
    }
    if (depth > MAX_TOOL_PROGRAM_DEPTH) {
      context.addIssue({
        code: 'custom',
        path: ['steps', index],
        message: `Tool Program dependency depth exceeds ${MAX_TOOL_PROGRAM_DEPTH}`,
      });
    }

    if (step.operation === 'call') callCount += 1;
    if (step.operation === 'map' || step.operation === 'batch') {
      callCount += step.invocations.length;
    }
    knownSteps.add(step.stepId);
    depthByStep.set(step.stepId, depth);
  }

  if (callCount > MAX_TOOL_PROGRAM_CALLS) {
    context.addIssue({
      code: 'custom',
      path: ['steps'],
      message: `Tool Program child calls exceed ${MAX_TOOL_PROGRAM_CALLS}`,
    });
  }
});

const ToolProgramDurableCallSchema = strictObject({
  stepId: EntityIdSchema,
  callIndex: CountSchema,
  toolId: ToolIdSchema.exclude(['skill.propose', 'tool.program']),
  toolVersion: ToolVersionSchema,
  inputHash: Sha256Schema,
});

/** The only tool.program representation allowed in durable public storage. */
export const ToolProgramDurableInputSchema = strictObject({
  version: z.literal(1),
  displayName: z.string().trim().min(1).max(240),
  expectedRunRevision: RevisionSchema,
  contextRefs: uniqueArray(DomainObjectRefSchema, 0, MAX_REFERENCE_COUNT, 'program context refs'),
  programHash: Sha256Schema,
  calls: z.array(ToolProgramDurableCallSchema).min(1).max(MAX_TOOL_PROGRAM_CALLS),
}).superRefine(({ calls }, context) => {
  const seen = new Set<string>();
  calls.forEach((call, index) => {
    const identity = `${call.stepId}/${call.callIndex}`;
    if (seen.has(identity)) {
      context.addIssue({
        code: 'custom',
        path: ['calls', index],
        message: 'Tool Program durable call identities must be unique',
      });
    }
    seen.add(identity);
  });
});

/** Private-only complete Tool Program binding for a delegated program child Run. */
export const ToolProgramRecoveryPayloadV1Schema = strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal('tool_program'),
  runId: EntityIdSchema,
  inboxMessageId: EntityIdSchema,
  parentRunId: EntityIdSchema,
  parentEventId: EntityIdSchema,
  parentDispatchOperationId: EntityIdSchema,
  programHash: Sha256Schema,
  program: ToolProgramInputSchema,
}).superRefine((payload, context) => {
  if (payload.program.version !== payload.schemaVersion) {
    context.addIssue({
      code: 'custom',
      path: ['program'],
      message: 'Tool Program recovery version must match its envelope schema version',
    });
  }
});

const ProgramChildCallViewSchema = strictObject({
  stepId: EntityIdSchema,
  callIndex: CountSchema,
  toolId: ProgramChildToolIdSchema,
  toolVersion: ToolVersionSchema,
  outcomeStatus: ProgramOutcomeStatusSchema,
  operationFingerprint: EntityIdSchema,
  outcome: GenericToolOutcomeSchema,
  outcomeHash: Sha256Schema,
}).superRefine((call, context) => {
  if (call.outcome.status !== call.outcomeStatus) {
    context.addIssue({
      code: 'custom',
      path: ['outcomeStatus'],
      message: 'Tool Program child outcome status must match its canonical outcome',
    });
  }
});
const ProgramStepViewSchema = strictObject({
  stepId: EntityIdSchema,
  operation: z.enum(['call', 'map', 'batch', 'filter', 'sort', 'validate', 'take']),
  state: z.enum(['pending', 'running', 'succeeded', 'blocked', 'failed', 'cancelled']),
  itemCount: CountSchema,
});
const ToolProgramSuccessSchema = strictObject({
  programRunId: EntityIdSchema,
  state: z.enum(['running', 'succeeded', 'blocked', 'failed', 'cancelled']),
  steps: z.array(ProgramStepViewSchema).min(1).max(MAX_TOOL_PROGRAM_NODES),
  childCalls: z.array(ProgramChildCallViewSchema).max(MAX_TOOL_PROGRAM_CALLS),
  resultRefs: z.array(DomainObjectRefSchema).max(MAX_REFERENCE_COUNT),
  artifacts: z.array(ArtifactRefSchema).max(MAX_REFERENCE_COUNT),
  usage: strictObject({
    inputTokens: CountAmountSchema,
    outputTokens: CountAmountSchema,
    cost: ResourceAmountSchema,
  }),
  blocker: z.string().max(20_000),
});

export const ToolProgramDefinition = defineTool({
  id: 'tool.program',
  version: '2.0.0',
  description:
    'Execute a bounded typed call/map/batch/filter/sort/validate/take program over this Run catalog.',
  metadata: {
    ...controlMetadata({
      domain: 'program',
      scope: { project: 'current', run: 'current', crossProject: 'denied' },
      cas: { mode: 'revision', expectedFields: ['expectedRunRevision'] },
      publicProgress: { mode: 'operation', redactArguments: true },
      publicResult: { mode: 'summary', redactProviderPayload: true },
      artifactProjection: { mode: 'from_success', fields: ['artifacts'] },
      contextFactProjection: { mode: 'run_state', fields: ['steps', 'childCalls'] },
      variantDiscriminant: 'steps.operation',
      variants: [],
    }),
    variants: ['call', 'map', 'batch', 'filter', 'sort', 'validate', 'take'].map((discriminant) =>
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
        timeout: 'long_running',
        cancellation: 'cooperative',
        recovery: 'run_state',
        unknownStateNeverResubmit: false,
      }),
    ),
  },
  inputSchema: ToolProgramInputSchema,
  successSchema: ToolProgramSuccessSchema,
  examples: {
    input: {
      version: 1,
      displayName: 'Read Project and Production context',
      expectedRunRevision: 4,
      contextRefs: [],
      steps: [
        {
          stepId: 'step.project',
          operation: 'call',
          invocation: {
            toolId: 'project.get',
            toolVersion: '2.0.0',
            input: { include: ['metadata'] },
          },
        },
        {
          stepId: 'step.validate',
          operation: 'validate',
          sourceStepId: 'step.project',
          rule: { kind: 'all_succeeded' },
        },
      ],
    },
    success: {
      programRunId: 'run.program.1',
      state: 'succeeded',
      steps: [
        { stepId: 'step.project', operation: 'call', state: 'succeeded', itemCount: 1 },
        { stepId: 'step.validate', operation: 'validate', state: 'succeeded', itemCount: 1 },
      ],
      childCalls: [
        {
          stepId: 'step.project',
          callIndex: 0,
          toolId: 'project.get',
          toolVersion: '2.0.0',
          outcomeStatus: 'succeeded',
          operationFingerprint: 'fingerprint.1',
          outcome: {
            status: 'succeeded',
            data: {
              sections: [
                {
                  section: 'metadata',
                  revision: 1,
                  contentHash: EXAMPLE_HASH,
                  name: 'Example Project',
                  lifecycle: 'active',
                },
              ],
            },
          },
          outcomeHash: EXAMPLE_HASH,
        },
      ],
      resultRefs: [],
      artifacts: [],
      usage: {
        inputTokens: { state: 'known', value: 0 },
        outputTokens: { state: 'known', value: 0 },
        cost: { state: 'known', value: '0', currency: 'USD' },
      },
      blocker: '',
    },
  },
});

const assembledDefinitions = Object.freeze(
  [...NON_PROGRAM_TOOL_DEFINITIONS, ToolProgramDefinition].sort((left, right) =>
    left.id.localeCompare(right.id),
  ),
);

if (
  assembledDefinitions.length !== EXACT_TOOL_IDS.length ||
  assembledDefinitions.some((definition, index) => definition.id !== EXACT_TOOL_IDS[index])
) {
  throw new Error(
    `Target Tool Catalog does not match the exact frozen ${EXACT_TOOL_IDS.length}-tool inventory`,
  );
}

type CatalogToolDefinition = TargetToolDefinition<
  string,
  z.ZodType<unknown, never>,
  z.ZodType<unknown, never>
>;

export const TOOL_DEFINITIONS = assembledDefinitions as unknown as readonly CatalogToolDefinition[];
export const TOOL_DEFINITION_BY_ID = Object.freeze(
  Object.fromEntries(TOOL_DEFINITIONS.map((definition) => [definition.id, definition])),
) as Readonly<{ [name: string]: CatalogToolDefinition }>;
export function toolDefinitionIdentity(toolId: string, toolVersion: string): string {
  return `${toolId}\u0000${toolVersion}`;
}
export const TOOL_DEFINITION_BY_ID_AND_VERSION = Object.freeze(
  Object.fromEntries(
    TOOL_DEFINITIONS.map((definition) => [
      toolDefinitionIdentity(definition.id, definition.version),
      definition,
    ]),
  ),
) as Readonly<{ [identity: string]: CatalogToolDefinition }>;

export function executableToolDefinition(toolId: string, toolVersion: string) {
  return TOOL_DEFINITION_BY_ID_AND_VERSION[toolDefinitionIdentity(toolId, toolVersion)];
}

export type ToolDefinition = (typeof TOOL_DEFINITIONS)[number];
export type ToolProgramInput = z.infer<typeof ToolProgramInputSchema>;
export type ToolProgramDurableInput = z.infer<typeof ToolProgramDurableInputSchema>;
export type ToolProgramRecoveryPayloadV1 = z.infer<typeof ToolProgramRecoveryPayloadV1Schema>;
