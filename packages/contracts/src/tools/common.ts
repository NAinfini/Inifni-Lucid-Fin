import { z } from 'zod';
import { parseCanonical, strictObject } from '../canonical.js';
import {
  AuthoritySchema,
  CountSchema,
  DomainObjectRefSchema,
  EntityIdSchema,
  IsoCurrencySchema,
  PositiveCountSchema,
  RevisionSchema,
  Sha256Schema,
} from '../primitives.js';
import { OperationRefSchema } from '../operation.js';
import { EXACT_TOOL_IDS } from './ids.js';

export const TOOL_VERSION = '1.0.0' as const;
export const ToolVersionSchema = z
  .string()
  .max(80)
  .regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/, 'Tool version must be SemVer');
export const MAX_PAGE_SIZE = 100;
export const MAX_TOOL_NAMES = EXACT_TOOL_IDS.length;
export const MAX_QUERY_LENGTH = 4_000;
export const MAX_REFERENCE_COUNT = 100;
export const MAX_MUTATION_BATCH = 500;
export const MAX_TOOL_PROGRAM_NODES = 64;
export const MAX_TOOL_PROGRAM_DEPTH = 8;
export const MAX_TOOL_PROGRAM_CALLS = 128;
export const MAX_TOOL_PROGRAM_CONCURRENCY = 8;

export function uniqueArray<Element extends z.ZodType>(
  element: Element,
  minimum: number,
  maximum: number,
  label: string,
) {
  return z
    .array(element)
    .min(minimum)
    .max(maximum)
    .refine(
      (entries) => new Set(entries.map((entry) => JSON.stringify(entry))).size === entries.length,
      {
        message: `${label} must be unique`,
      },
    );
}

export const PageRequestSchema = strictObject({
  cursor: z.string().min(1).max(1_000).nullable(),
  limit: PositiveCountSchema.max(MAX_PAGE_SIZE),
});

export function pageSchema<Item extends z.ZodType>(item: Item) {
  return strictObject({
    items: z.array(item).max(MAX_PAGE_SIZE),
    nextCursor: z.string().min(1).max(1_000).nullable(),
  });
}

export function mutationReceiptSchema<ObjectSchema extends z.ZodType>(object: ObjectSchema) {
  return strictObject({
    object,
    previousRevision: RevisionSchema.nullable(),
    eventId: EntityIdSchema,
    changedPaths: uniqueArray(z.string().trim().min(1).max(160), 1, 100, 'changedPaths'),
    undoRef: EntityIdSchema.nullable(),
  });
}

const FailureMessageSchema = z.string().min(1).max(20_000);
const ValidationIssueSchema = strictObject({
  fieldSegments: z.array(z.union([z.string().max(200), CountSchema])).max(100),
  code: z.string().min(1).max(120),
  message: FailureMessageSchema,
});
const ValidationFailedSchema = strictObject({
  status: z.literal('validation_failed'),
  issues: z.array(ValidationIssueSchema).min(1).max(100),
});
const PermissionRequiredSchema = strictObject({
  status: z.literal('permission_required'),
  confirmationId: EntityIdSchema,
  summary: FailureMessageSchema,
});
const PermissionDeniedSchema = strictObject({
  status: z.literal('permission_denied'),
  code: z.enum(['scope_denied', 'capability_denied', 'protected_denied']),
  message: FailureMessageSchema,
});
const BudgetBlockedSchema = strictObject({
  status: z.literal('budget_blocked'),
  dimension: z.enum(['cost', 'generation_count', 'input_tokens', 'output_tokens']),
  message: FailureMessageSchema,
});
const CostUnknownSchema = strictObject({
  status: z.literal('cost_unknown'),
  currency: IsoCurrencySchema,
  message: FailureMessageSchema,
});
const ConflictSchema = strictObject({
  status: z.literal('conflict'),
  authority: AuthoritySchema,
  objectId: EntityIdSchema,
  expectedRevision: RevisionSchema,
  currentRevision: RevisionSchema,
  currentContentHash: Sha256Schema,
});
const ProviderUnavailableSchema = strictObject({
  status: z.literal('provider_unavailable'),
  providerId: EntityIdSchema,
  model: z.string().min(1).max(200),
  message: FailureMessageSchema,
});
const ProviderStateUnknownSchema = strictObject({
  status: z.literal('provider_state_unknown'),
  operation: OperationRefSchema,
  message: FailureMessageSchema,
});
const RetryableFailureSchema = strictObject({
  status: z.literal('retryable_failure'),
  code: z.string().min(1).max(120),
  message: FailureMessageSchema,
  retryAfterMs: CountSchema.nullable(),
});
const NonRetryableFailureSchema = strictObject({
  status: z.literal('non_retryable_failure'),
  code: z.string().min(1).max(120),
  message: FailureMessageSchema,
});
const CancelledSchema = strictObject({
  status: z.literal('cancelled'),
  message: FailureMessageSchema,
  retainedOperations: z.array(OperationRefSchema).max(MAX_REFERENCE_COUNT),
});
const RecoveryRequiredSchema = strictObject({
  status: z.literal('recovery_required'),
  operation: OperationRefSchema.nullable(),
  message: FailureMessageSchema,
});

export const ToolFailureSchema = z.union([
  ValidationFailedSchema,
  PermissionRequiredSchema,
  PermissionDeniedSchema,
  BudgetBlockedSchema,
  CostUnknownSchema,
  ConflictSchema,
  ProviderUnavailableSchema,
  ProviderStateUnknownSchema,
  RetryableFailureSchema,
  NonRetryableFailureSchema,
  CancelledSchema,
  RecoveryRequiredSchema,
]);

export function toolOutcomeSchema<Success extends z.ZodType>(success: Success) {
  return z.union([
    strictObject({ status: z.literal('succeeded'), data: success }),
    ToolFailureSchema,
  ]);
}

export const CanonicalToolDataSchema = z.record(z.string().min(1).max(200), z.json());
export const GenericToolOutcomeSchema = toolOutcomeSchema(CanonicalToolDataSchema);

export const ToolDomainSchema = z.enum([
  'discovery',
  'project',
  'production',
  'canvas',
  'media',
  'provider',
  'generation',
  'result',
  'evaluation',
  'decision',
  'delivery',
  'operation',
  'interaction',
  'task',
  'agent',
  'program',
]);
export const ToolCategorySchema = z.enum([
  'read',
  'reversible_write',
  'external',
  'protected_external',
  'run_control',
]);
export const EffectProfileSchema = z.enum(['R', 'RW', 'CTRL', 'EXT', 'PROTECTED']);
export const PermissionSchema = z.enum([
  'project.read',
  'project.write',
  'run.control',
  'generate',
  'evaluate',
  'delivery.export',
]);

export const VariantExecutionMetadataSchema = strictObject({
  discriminant: z.string().min(1).max(120),
  profile: EffectProfileSchema,
  effect: ToolCategorySchema,
  permissions: uniqueArray(PermissionSchema, 1, 6, 'variant permissions'),
  confirmation: z.enum(['none', 'dynamic_protection', 'exact_protected']),
  cost: z.enum(['none', 'quote_only', 'metered_known_or_unknown']),
  unknownCost: z.enum(['not_applicable', 'blocked_when_capped', 'project_policy']),
  cas: z.enum(['none', 'revision', 'content_hash', 'state', 'revision_and_content_hash']),
  idempotency: z.enum(['read_fingerprint', 'operation_fingerprint', 'attempt_fingerprint']),
  retry: z.enum(['safe', 'before_commit', 'before_submission', 'receipt_reconcile_only', 'never']),
  timeout: z.enum(['bounded_read', 'bounded_write', 'long_running', 'provider', 'wait']),
  cancellation: z.enum(['read_only', 'before_commit', 'cooperative', 'provider_declared']),
  recovery: z.enum(['authority_reread', 'event_receipt', 'provider_receipt', 'run_state']),
  unknownStateNeverResubmit: z.boolean(),
});

export const ToolMetadataSchema = strictObject({
  version: ToolVersionSchema,
  description: z.string().min(1).max(2_000),
  domain: ToolDomainSchema,
  category: ToolCategorySchema,
  scope: strictObject({
    project: z.literal('current'),
    run: z.enum(['current', 'descendant', 'frozen_snapshot']),
    crossProject: z.literal('denied'),
  }),
  profile: EffectProfileSchema,
  effect: strictObject({
    domainMutation: z.boolean(),
    runMutation: z.boolean(),
    externalSideEffect: z.boolean(),
    destructive: z.boolean(),
    credentialMutation: z.boolean(),
  }),
  permission: strictObject({
    required: uniqueArray(PermissionSchema, 1, 6, 'permissions'),
    dynamicProtection: z.boolean(),
  }),
  confirmation: strictObject({
    mode: z.enum(['none', 'dynamic_protection', 'exact_protected']),
    globallyWaivable: z.literal(false),
  }),
  cost: strictObject({
    mode: z.enum(['none', 'quote_only', 'metered_known_or_unknown']),
    unknownCost: z.enum(['not_applicable', 'blocked_when_capped', 'project_policy']),
    dimension: z.enum(['none', 'cost', 'generation_count']),
  }),
  cas: strictObject({
    mode: z.enum(['none', 'revision', 'content_hash', 'state', 'revision_and_content_hash']),
    expectedFields: uniqueArray(z.string().min(1).max(120), 0, 20, 'CAS fields'),
  }),
  fingerprint: strictObject({
    mode: z.enum(['canonical_read', 'canonical_operation', 'canonical_attempt']),
    hostAssignedIdempotency: z.boolean(),
  }),
  retry: strictObject({
    mode: z.enum(['safe', 'before_commit', 'before_submission', 'receipt_reconcile_only', 'never']),
    technicalAttemptLimit: PositiveCountSchema.max(3),
  }),
  timeout: strictObject({
    mode: z.enum(['bounded_read', 'bounded_write', 'long_running', 'provider', 'wait']),
    maximumMs: PositiveCountSchema.max(86_400_000),
  }),
  cancellation: strictObject({
    mode: z.enum(['read_only', 'before_commit', 'cooperative', 'provider_declared']),
    preservesCommittedResults: z.literal(true),
  }),
  recovery: strictObject({
    mode: z.enum(['authority_reread', 'event_receipt', 'provider_receipt', 'run_state']),
    unknownStateNeverResubmit: z.boolean(),
  }),
  secretPaths: uniqueArray(z.string().min(1).max(200), 0, 20, 'secretPaths'),
  publicProgress: strictObject({
    mode: z.enum(['none', 'summary', 'operation', 'task_list', 'child_run', 'interaction']),
    redactArguments: z.literal(true),
  }),
  publicResult: strictObject({
    mode: z.enum(['none', 'summary', 'object_links', 'result_cards', 'artifact_card']),
    redactProviderPayload: z.literal(true),
  }),
  artifactProjection: strictObject({
    mode: z.enum(['none', 'from_success']),
    fields: uniqueArray(z.string().min(1).max(160), 0, 20, 'artifact fields'),
  }),
  contextFactProjection: strictObject({
    mode: z.enum(['none', 'authority_refs', 'mutation_receipts', 'operation_state', 'run_state']),
    fields: uniqueArray(z.string().min(1).max(160), 0, 20, 'context fact fields'),
  }),
  variantDiscriminant: z.string().min(1).max(120).nullable(),
  variants: z.array(VariantExecutionMetadataSchema).max(40),
});

type ToolMetadataInput = z.input<typeof ToolMetadataSchema>;

export interface ToolDefinition<
  Id extends string = string,
  Input extends z.ZodType = z.ZodType,
  Success extends z.ZodType = z.ZodType,
  Version extends string = string,
> {
  readonly id: Id;
  readonly version: Version;
  readonly description: string;
  readonly metadata: z.output<typeof ToolMetadataSchema>;
  readonly inputSchema: Input;
  readonly successSchema: Success;
  readonly outcomeSchema: ReturnType<typeof toolOutcomeSchema<Success>>;
  readonly parseInput: (input: z.input<Input>) => z.output<Input>;
  readonly parseSuccess: (input: z.input<Success>) => z.output<Success>;
  readonly parseOutcome: (
    input: z.input<ReturnType<typeof toolOutcomeSchema<Success>>>,
  ) => z.output<ReturnType<typeof toolOutcomeSchema<Success>>>;
  readonly examples: Readonly<{
    input: z.output<Input>;
    success: z.output<Success>;
  }>;
}

export function defineTool<
  const Id extends string,
  Input extends z.ZodType,
  Success extends z.ZodType,
  const Version extends string = typeof TOOL_VERSION,
>(definition: {
  id: Id;
  version?: Version;
  description: string;
  metadata: Omit<ToolMetadataInput, 'version' | 'description'>;
  inputSchema: Input;
  successSchema: Success;
  examples: { input: z.input<Input>; success: z.input<Success> };
}): ToolDefinition<Id, Input, Success, Version> {
  const version = parseCanonical(ToolVersionSchema, definition.version ?? TOOL_VERSION) as Version;
  const metadata = parseCanonical(ToolMetadataSchema, {
    version,
    description: definition.description,
    ...definition.metadata,
  });
  const outcomeSchema = toolOutcomeSchema(definition.successSchema);
  const examples = Object.freeze({
    input: parseCanonical(definition.inputSchema, definition.examples.input),
    success: parseCanonical(definition.successSchema, definition.examples.success),
  });
  return Object.freeze({
    id: definition.id,
    version,
    description: definition.description,
    metadata,
    inputSchema: definition.inputSchema,
    successSchema: definition.successSchema,
    outcomeSchema,
    parseInput: (input: z.input<Input>) => parseCanonical(definition.inputSchema, input),
    parseSuccess: (input: z.input<Success>) => parseCanonical(definition.successSchema, input),
    parseOutcome: (input: z.input<typeof outcomeSchema>) => parseCanonical(outcomeSchema, input),
    examples,
  });
}

type MetadataOverrides = Pick<
  ToolMetadataInput,
  | 'domain'
  | 'scope'
  | 'cas'
  | 'publicProgress'
  | 'publicResult'
  | 'artifactProjection'
  | 'contextFactProjection'
  | 'variantDiscriminant'
  | 'variants'
>;

export function readMetadata(
  overrides: MetadataOverrides,
): Omit<ToolMetadataInput, 'version' | 'description'> {
  return {
    ...overrides,
    category: 'read',
    profile: 'R',
    effect: {
      domainMutation: false,
      runMutation: false,
      externalSideEffect: false,
      destructive: false,
      credentialMutation: false,
    },
    permission: { required: ['project.read'], dynamicProtection: false },
    confirmation: { mode: 'none', globallyWaivable: false },
    cost: { mode: 'none', unknownCost: 'not_applicable', dimension: 'none' },
    fingerprint: { mode: 'canonical_read', hostAssignedIdempotency: false },
    retry: { mode: 'safe', technicalAttemptLimit: 1 },
    timeout: { mode: 'bounded_read', maximumMs: 30_000 },
    cancellation: { mode: 'read_only', preservesCommittedResults: true },
    recovery: { mode: 'authority_reread', unknownStateNeverResubmit: false },
    secretPaths: [],
  };
}

export function reversibleMetadata(
  overrides: MetadataOverrides & { dynamicProtection: boolean },
): Omit<ToolMetadataInput, 'version' | 'description'> {
  const { dynamicProtection, ...rest } = overrides;
  return {
    ...rest,
    category: 'reversible_write',
    profile: 'RW',
    effect: {
      domainMutation: true,
      runMutation: false,
      externalSideEffect: false,
      destructive: false,
      credentialMutation: false,
    },
    permission: { required: ['project.write'], dynamicProtection },
    confirmation: {
      mode: dynamicProtection ? 'dynamic_protection' : 'none',
      globallyWaivable: false,
    },
    cost: { mode: 'none', unknownCost: 'not_applicable', dimension: 'none' },
    fingerprint: { mode: 'canonical_operation', hostAssignedIdempotency: true },
    retry: { mode: 'before_commit', technicalAttemptLimit: 1 },
    timeout: { mode: 'bounded_write', maximumMs: 30_000 },
    cancellation: { mode: 'before_commit', preservesCommittedResults: true },
    recovery: { mode: 'event_receipt', unknownStateNeverResubmit: false },
    secretPaths: [],
  };
}

export function controlMetadata(
  overrides: MetadataOverrides,
): Omit<ToolMetadataInput, 'version' | 'description'> {
  return {
    ...overrides,
    category: 'run_control',
    profile: 'CTRL',
    effect: {
      domainMutation: false,
      runMutation: true,
      externalSideEffect: false,
      destructive: false,
      credentialMutation: false,
    },
    permission: { required: ['run.control'], dynamicProtection: false },
    confirmation: { mode: 'none', globallyWaivable: false },
    cost: { mode: 'none', unknownCost: 'not_applicable', dimension: 'none' },
    fingerprint: { mode: 'canonical_operation', hostAssignedIdempotency: true },
    retry: { mode: 'before_commit', technicalAttemptLimit: 1 },
    timeout: { mode: 'bounded_write', maximumMs: 30_000 },
    cancellation: { mode: 'cooperative', preservesCommittedResults: true },
    recovery: { mode: 'run_state', unknownStateNeverResubmit: false },
    secretPaths: [],
  };
}

export function externalMetadata(
  overrides: MetadataOverrides & {
    domainMutation: boolean;
    permissions: z.input<typeof PermissionSchema>[];
    category?: 'external' | 'protected_external';
    exactConfirmation?: boolean;
  },
): Omit<ToolMetadataInput, 'version' | 'description'> {
  const {
    domainMutation,
    permissions,
    category = 'external',
    exactConfirmation = false,
    ...rest
  } = overrides;
  return {
    ...rest,
    category,
    profile: exactConfirmation ? 'PROTECTED' : 'EXT',
    effect: {
      domainMutation,
      runMutation: false,
      externalSideEffect: true,
      destructive: false,
      credentialMutation: false,
    },
    permission: { required: permissions, dynamicProtection: false },
    confirmation: {
      mode: exactConfirmation ? 'exact_protected' : 'none',
      globallyWaivable: false,
    },
    cost: {
      mode: 'metered_known_or_unknown',
      unknownCost: 'blocked_when_capped',
      dimension: 'cost',
    },
    fingerprint: { mode: 'canonical_attempt', hostAssignedIdempotency: true },
    retry: { mode: 'receipt_reconcile_only', technicalAttemptLimit: 1 },
    timeout: { mode: 'provider', maximumMs: 86_400_000 },
    cancellation: { mode: 'provider_declared', preservesCommittedResults: true },
    recovery: { mode: 'provider_receipt', unknownStateNeverResubmit: true },
    secretPaths: [],
  };
}

export function variantExecution(input: z.input<typeof VariantExecutionMetadataSchema>) {
  return parseCanonical(VariantExecutionMetadataSchema, input);
}

export const ZERO_COST = Object.freeze({
  state: 'known' as const,
  value: '0' as const,
  currency: 'USD' as const,
});

export const AuthorityRefListSchema = uniqueArray(
  DomainObjectRefSchema,
  0,
  MAX_REFERENCE_COUNT,
  'authority refs',
);

export type ToolFailure = z.infer<typeof ToolFailureSchema>;
export type ToolMetadata = z.infer<typeof ToolMetadataSchema>;
