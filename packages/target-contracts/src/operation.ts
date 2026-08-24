import { z, type ZodRawShape } from 'zod';
import { strictObject } from './canonical.js';
import {
  ArtifactRefSchema,
  CountAmountSchema,
  DomainObjectRefSchema,
  EntityIdSchema,
  IsoTimestampSchema,
  ProviderModelSchema,
  ResourceAmountSchema,
  RevisionSchema,
  Sha256Schema,
} from './primitives.js';

export const AttemptStateSchema = z.enum([
  'prepared',
  'running',
  'submitted',
  'unknown',
  'succeeded',
  'failed',
  'cancelled',
]);
export const AttemptTerminalStateSchema = z.enum(['succeeded', 'failed', 'cancelled']);
export const OperationPublicErrorCodeSchema = z.enum([
  'invalid_request',
  'permission_denied',
  'budget_exceeded',
  'provider_failed',
  'execution_failed',
  'provider_state_unknown',
  'cancelled',
]);

export const ProviderReceiptSchema = strictObject({
  providerOperationId: z.string().min(1).max(500),
  submittedAt: IsoTimestampSchema,
  reconciledAt: IsoTimestampSchema.nullable(),
  receiptHash: Sha256Schema,
});
export const ProviderUsageSchema = strictObject({
  inputTokens: CountAmountSchema,
  outputTokens: CountAmountSchema,
  generatedUnits: CountAmountSchema,
  cost: ResourceAmountSchema,
});

export function providerReceiptHashInput(receipt: z.output<typeof ProviderReceiptSchema>) {
  return {
    providerOperationId: receipt.providerOperationId,
    submittedAt: receipt.submittedAt,
  } as const;
}

export const OperationFingerprintSourceSchema = strictObject({
  projectId: EntityIdSchema,
  runId: EntityIdSchema,
  capabilityCatalogSnapshotId: EntityIdSchema,
  toolId: EntityIdSchema,
  toolVersion: z.string().trim().min(1).max(80),
  inputHash: Sha256Schema,
});

export function operationFingerprintInput(
  source: z.output<typeof OperationFingerprintSourceSchema>,
) {
  return OperationFingerprintSourceSchema.parse(source);
}

export const ATTEMPT_COMMON_FIELDS = {
  revision: RevisionSchema,
  contentHash: Sha256Schema,
  state: AttemptStateSchema,
  provider: ProviderModelSchema.nullable(),
  receipt: ProviderReceiptSchema.nullable(),
  usage: ProviderUsageSchema.nullable(),
  cancelRequested: z.boolean(),
  progressPercent: z.number().min(0).max(100).finite().nullable(),
  publicErrorCode: OperationPublicErrorCodeSchema.nullable(),
  createdAt: IsoTimestampSchema,
  finishedAt: IsoTimestampSchema.nullable(),
} as const;

const AttemptCommonBaseSchema = strictObject(ATTEMPT_COMMON_FIELDS);
type AttemptCommonValue = z.output<typeof AttemptCommonBaseSchema>;

function addAttemptCommonIssues(attempt: AttemptCommonValue, context: z.RefinementCtx): void {
  const terminal = AttemptTerminalStateSchema.safeParse(attempt.state).success;
  if (terminal !== (attempt.finishedAt !== null)) {
    context.addIssue({
      code: 'custom',
      path: ['finishedAt'],
      message: 'Attempt terminal state and finishedAt must agree',
    });
  }
  if (attempt.provider === null && attempt.receipt !== null) {
    context.addIssue({
      code: 'custom',
      path: ['receipt'],
      message: 'A provider receipt requires a provider',
    });
  }
  if (attempt.state === 'submitted' && attempt.receipt === null) {
    context.addIssue({
      code: 'custom',
      path: ['receipt'],
      message: 'Submitted provider state requires a receipt',
    });
  }
  if (attempt.state === 'unknown' && attempt.provider === null) {
    context.addIssue({
      code: 'custom',
      path: ['provider'],
      message: 'Unknown provider state requires a provider',
    });
  }
  const expectedError =
    attempt.state === 'unknown'
      ? 'provider_state_unknown'
      : attempt.state === 'cancelled'
        ? 'cancelled'
        : null;
  if (expectedError !== null && attempt.publicErrorCode !== expectedError) {
    context.addIssue({
      code: 'custom',
      path: ['publicErrorCode'],
      message: `Attempt state ${attempt.state} requires ${expectedError}`,
    });
  }
  if (
    attempt.state === 'prepared' ||
    attempt.state === 'running' ||
    attempt.state === 'submitted' ||
    attempt.state === 'succeeded'
  ) {
    if (attempt.publicErrorCode !== null) {
      context.addIssue({
        code: 'custom',
        path: ['publicErrorCode'],
        message: `Attempt state ${attempt.state} forbids a public error`,
      });
    }
  }
  if (
    attempt.state === 'failed' &&
    (attempt.publicErrorCode === null ||
      attempt.publicErrorCode === 'cancelled' ||
      attempt.publicErrorCode === 'provider_state_unknown')
  ) {
    context.addIssue({
      code: 'custom',
      path: ['publicErrorCode'],
      message: 'Failed attempts require a non-cancellation failure code',
    });
  }
}

export const AttemptCommonSchema = AttemptCommonBaseSchema.superRefine(addAttemptCommonIssues);

type AttemptShape<Shape extends ZodRawShape> = Omit<typeof ATTEMPT_COMMON_FIELDS, keyof Shape> &
  Shape;

export function withAttemptCommonFields<const Shape extends ZodRawShape>(shape: Shape) {
  const fields = { ...ATTEMPT_COMMON_FIELDS, ...shape } as AttemptShape<Shape>;
  return strictObject(fields).superRefine((attempt, context) => {
    addAttemptCommonIssues(attempt as AttemptCommonValue, context);
  });
}

export function attemptContentHashInput<Attempt extends AttemptCommonValue>(attempt: Attempt) {
  const { contentHash: _contentHash, ...content } = attempt;
  return content;
}

export const OperationKindSchema = z.enum([
  'generation_attempt',
  'media_derivation',
  'result_assessment',
  'review_cut_attempt',
  'delivery_export',
]);

const operationRefBase = { id: EntityIdSchema, revision: RevisionSchema } as const;
export const GenerationOperationRefSchema = strictObject({
  ...operationRefBase,
  kind: z.literal('generation_attempt'),
  ownerRef: strictObject({
    authority: z.literal('generation_attempt'),
    id: EntityIdSchema,
    revision: RevisionSchema,
    contentHash: Sha256Schema,
  }),
});
export const MediaDerivationOperationRefSchema = strictObject({
  ...operationRefBase,
  kind: z.literal('media_derivation'),
  ownerRef: strictObject({
    authority: z.literal('media_derivation_attempt'),
    id: EntityIdSchema,
    revision: RevisionSchema,
    contentHash: Sha256Schema,
  }),
});
export const ResultAssessmentOperationRefSchema = strictObject({
  ...operationRefBase,
  kind: z.literal('result_assessment'),
  ownerRef: strictObject({
    authority: z.literal('result_assessment_attempt'),
    id: EntityIdSchema,
    revision: RevisionSchema,
    contentHash: Sha256Schema,
  }),
});
export const ReviewCutOperationRefSchema = strictObject({
  ...operationRefBase,
  kind: z.literal('review_cut_attempt'),
  ownerRef: strictObject({
    authority: z.literal('review_cut_attempt'),
    id: EntityIdSchema,
    revision: RevisionSchema,
    contentHash: Sha256Schema,
  }),
});
export const DeliveryExportOperationRefSchema = strictObject({
  ...operationRefBase,
  kind: z.literal('delivery_export'),
  ownerRef: strictObject({
    authority: z.literal('delivery_export'),
    id: EntityIdSchema,
    revision: RevisionSchema,
    contentHash: Sha256Schema,
  }),
});
export const OperationRefSchema = z
  .union([
    GenerationOperationRefSchema,
    MediaDerivationOperationRefSchema,
    ResultAssessmentOperationRefSchema,
    ReviewCutOperationRefSchema,
    DeliveryExportOperationRefSchema,
  ])
  .superRefine((operation, context) => {
    if (operation.revision !== operation.ownerRef.revision) {
      context.addIssue({
        code: 'custom',
        path: ['ownerRef', 'revision'],
        message: 'Operation and owner revisions must match',
      });
    }
  });

export const OperationPublicViewSchema = strictObject({
  ref: OperationRefSchema,
  state: AttemptStateSchema,
  cancelRequested: z.boolean(),
  progressPercent: z.number().min(0).max(100).finite().nullable(),
  usage: ProviderUsageSchema.nullable(),
  publicErrorCode: OperationPublicErrorCodeSchema.nullable(),
  resultRefs: z.array(DomainObjectRefSchema).max(100),
  artifacts: z.array(ArtifactRefSchema).max(100),
});

function uniqueOperations<T extends { ref?: { id: string }; id?: string }>(operations: T[]) {
  return (
    new Set(operations.map((operation) => operation.ref?.id ?? operation.id)).size ===
    operations.length
  );
}

export const OperationGetInputSchema = strictObject({
  operations: z
    .array(OperationRefSchema)
    .min(1)
    .max(100)
    .refine(uniqueOperations, { message: 'Operations must be unique' }),
});
export const OperationGetOutputSchema = strictObject({
  operations: z.array(OperationPublicViewSchema).min(1).max(100),
});

export const OperationCancelRequestSchema = strictObject({
  ref: OperationRefSchema,
  expectedRevision: RevisionSchema,
  expectedState: AttemptStateSchema,
}).superRefine((request, context) => {
  if (request.expectedRevision !== request.ref.revision) {
    context.addIssue({
      code: 'custom',
      path: ['expectedRevision'],
      message: 'Expected revision must match the supplied Operation ref',
    });
  }
  if (AttemptTerminalStateSchema.safeParse(request.expectedState).success) {
    context.addIssue({
      code: 'custom',
      path: ['expectedState'],
      message: 'Terminal Operations cannot be cancelled',
    });
  }
});
export const OperationCancelInputSchema = strictObject({
  operations: z
    .array(OperationCancelRequestSchema)
    .min(1)
    .max(100)
    .refine(uniqueOperations, { message: 'Cancellation requests must be unique' }),
});
export const OperationCancelOutputSchema = OperationGetOutputSchema;

export const AttemptStateTransitions = Object.freeze({
  prepared: Object.freeze(['running', 'submitted', 'unknown', 'failed', 'cancelled']),
  running: Object.freeze(['submitted', 'unknown', 'succeeded', 'failed', 'cancelled']),
  submitted: Object.freeze(['unknown', 'succeeded', 'failed', 'cancelled']),
  unknown: Object.freeze(['submitted', 'succeeded', 'failed', 'cancelled']),
  succeeded: Object.freeze([]),
  failed: Object.freeze([]),
  cancelled: Object.freeze([]),
} satisfies {
  [State in z.infer<typeof AttemptStateSchema>]: readonly z.infer<typeof AttemptStateSchema>[];
});

export function assertAttemptStateTransition(
  from: z.infer<typeof AttemptStateSchema>,
  to: z.infer<typeof AttemptStateSchema>,
  receiptReconciled: boolean,
): void {
  if (AttemptTerminalStateSchema.safeParse(from).success) {
    throw new Error(`Attempt terminal state ${from} cannot transition to ${to}`);
  }
  if (from === 'unknown' && !receiptReconciled) {
    throw new Error('Attempt unknown state requires receipt reconciliation');
  }
  const allowed: readonly z.infer<typeof AttemptStateSchema>[] = AttemptStateTransitions[from];
  if (!allowed.includes(to)) throw new Error(`Illegal attempt transition ${from} -> ${to}`);
}

export function assertAttemptCommonTransition(
  fromInput: z.input<typeof AttemptCommonSchema>,
  toInput: z.input<typeof AttemptCommonSchema>,
  receiptReconciled: boolean,
): void {
  const from = AttemptCommonSchema.parse(fromInput);
  const to = AttemptCommonSchema.parse(toInput);
  if (to.revision !== from.revision + 1) throw new Error('Attempt revision must advance by one');
  if (from.cancelRequested && !to.cancelRequested) {
    throw new Error('Attempt cancellation cannot be withdrawn');
  }
  if (
    from.progressPercent !== null &&
    to.progressPercent !== null &&
    to.progressPercent < from.progressPercent
  ) {
    throw new Error('Attempt progress cannot decrease');
  }
  if (from.state !== to.state)
    assertAttemptStateTransition(from.state, to.state, receiptReconciled);
  if (from.state === 'unknown' && to.state !== 'unknown') {
    if (!receiptReconciled) {
      throw new Error('Unknown Attempt may exit only through matching receipt reconciliation');
    }
    if (from.receipt !== null) {
      if (
        to.receipt === null ||
        from.receipt.receiptHash !== to.receipt.receiptHash ||
        to.receipt.reconciledAt === null
      ) {
        throw new Error('Unknown Attempt may exit only through matching receipt reconciliation');
      }
    } else if (to.receipt !== null) {
      if (to.receipt.reconciledAt === null) {
        throw new Error('Discovered provider receipt must be reconciled before leaving unknown');
      }
    } else if (to.state !== 'failed' && to.state !== 'cancelled') {
      throw new Error(
        'Receipt-less unknown may exit without a receipt only after authoritative terminal reconciliation',
      );
    }
  }
}

export type AttemptState = z.infer<typeof AttemptStateSchema>;
export type OperationPublicErrorCode = z.infer<typeof OperationPublicErrorCodeSchema>;
export type ProviderReceipt = z.infer<typeof ProviderReceiptSchema>;
export type ProviderUsage = z.infer<typeof ProviderUsageSchema>;
export type AttemptCommon = z.infer<typeof AttemptCommonSchema>;
export type OperationKind = z.infer<typeof OperationKindSchema>;
export type OperationRef = z.infer<typeof OperationRefSchema>;
export type OperationPublicView = z.infer<typeof OperationPublicViewSchema>;
