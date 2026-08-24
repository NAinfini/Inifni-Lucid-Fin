import { z } from 'zod';
import { canonicalJson, strictObject } from './canonical.js';
import {
  DeliveryFormatIntentSchema,
  DeliveryItemSemanticSnapshotSchema,
  DeliveryRefSchema,
} from './delivery.js';
import { GeneratedResultRefSchema } from './generation.js';
import {
  CausationRefSchema,
  EntityIdSchema,
  IsoTimestampSchema,
  Sha256Schema,
  UserChoiceRefSchema,
} from './primitives.js';
import { ProductionRefSchema, ShotResultDecisionValueSchema } from './production.js';
import { ProtectedFieldRefSchema } from './protection.js';

function uniqueSorted(values: string[]): boolean {
  return values.every((value, index) => index === 0 || values[index - 1]! < value);
}

function sameCanonical(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

export { UserChoiceRefSchema };

export const DirectUserChoiceAuthorizationSchema = strictObject({
  kind: z.literal('direct_user'),
  requestId: EntityIdSchema,
  inputHash: Sha256Schema,
});
export const CommanderChoiceAuthorizationSchema = strictObject({
  kind: z.literal('commander_dispatch'),
  dispatchOperationId: EntityIdSchema,
  inputHash: Sha256Schema,
  confirmationId: EntityIdSchema.nullable(),
});
export const ImportChoiceAuthorizationSchema = strictObject({
  kind: z.literal('import'),
  importId: EntityIdSchema,
  inputHash: Sha256Schema,
});
export const UserChoiceAuthorizationSchema = z.union([
  DirectUserChoiceAuthorizationSchema,
  CommanderChoiceAuthorizationSchema,
  ImportChoiceAuthorizationSchema,
]);

export const ChoiceOwnerRefSchema = z.union([ProductionRefSchema, DeliveryRefSchema]);

export const ResultDecisionChoiceSubjectSchema = strictObject({
  kind: z.literal('result_decision'),
  shotId: EntityIdSchema,
  resultIds: z
    .array(EntityIdSchema)
    .min(1)
    .max(32)
    .refine(uniqueSorted, { message: 'Result decision subject IDs must be unique and sorted' }),
});
export const ProtectionChoiceSubjectSchema = strictObject({
  kind: z.literal('protection'),
  field: ProtectedFieldRefSchema,
});
export const DeliveryChoiceSubjectSchema = strictObject({
  kind: z.literal('delivery'),
  deliveryId: EntityIdSchema,
  itemIds: z
    .array(EntityIdSchema)
    .max(20_000)
    .refine(uniqueSorted, { message: 'Delivery subject item IDs must be unique and sorted' }),
});
export const UserChoiceSubjectSchema = z.union([
  ResultDecisionChoiceSubjectSchema,
  ProtectionChoiceSubjectSchema,
  DeliveryChoiceSubjectSchema,
]);

export const SelectChoiceSchema = strictObject({
  kind: z.literal('select'),
  resultId: EntityIdSchema,
  feedback: z.string().max(20_000),
});
export const RejectChoiceSchema = strictObject({
  kind: z.literal('reject'),
  resultId: EntityIdSchema,
  feedback: z.string().trim().min(1).max(20_000),
});
export const RefineChoiceSchema = strictObject({
  kind: z.literal('refine'),
  resultId: EntityIdSchema,
  instruction: z.string().trim().min(1).max(20_000),
});
export const UseAsReferenceChoiceSchema = strictObject({
  kind: z.literal('use_as_reference'),
  resultId: EntityIdSchema,
  feedback: z.string().max(20_000),
});
export const ProtectChoiceSchema = strictObject({
  kind: z.literal('protect'),
  field: ProtectedFieldRefSchema,
  reason: z.string().max(4_000),
});
export const UnprotectChoiceSchema = strictObject({
  kind: z.literal('unprotect'),
  field: ProtectedFieldRefSchema,
  reason: z.string().max(4_000),
});
export const DeliveryMutationChoiceSchema = strictObject({
  kind: z.literal('delivery_mutation'),
  action: z.enum([
    'create',
    'updateSettings',
    'place',
    'remove',
    'reorder',
    'trim',
    'transition',
    'audioPolicy',
    'reviewState',
    'archive',
    'restore',
  ]),
});
export const UndoChoiceSchema = strictObject({
  kind: z.literal('undo'),
  targetChoiceId: EntityIdSchema,
});
export const UserChoiceIntentSchema = z.union([
  SelectChoiceSchema,
  RejectChoiceSchema,
  RefineChoiceSchema,
  UseAsReferenceChoiceSchema,
  ProtectChoiceSchema,
  UnprotectChoiceSchema,
  DeliveryMutationChoiceSchema,
  UndoChoiceSchema,
]);
export const UserChoiceDetailSchema = UserChoiceIntentSchema;

export const ResultDecisionEffectSchema = strictObject({
  kind: z.literal('result_decisions'),
  shotId: EntityIdSchema,
  entries: z
    .array(
      strictObject({
        resultId: EntityIdSchema,
        value: ShotResultDecisionValueSchema.nullable(),
      }),
    )
    .min(1)
    .max(32)
    .refine((entries) => uniqueSorted(entries.map((entry) => entry.resultId)), {
      message: 'Result decision effect entries must be unique and sorted',
    }),
});
export const ProtectionEffectSchema = strictObject({
  kind: z.literal('protection'),
  field: ProtectedFieldRefSchema,
  active: z.boolean(),
});
export const DeliveryEffectSchema = strictObject({
  kind: z.literal('delivery'),
  deliveryId: EntityIdSchema,
  settings: strictObject({
    name: z.string().trim().min(1).max(240),
    lifecycle: z.enum(['active', 'archived']),
    formatIntent: DeliveryFormatIntentSchema,
  }).nullable(),
  items: z
    .array(
      strictObject({
        itemId: EntityIdSchema,
        value: DeliveryItemSemanticSnapshotSchema.nullable(),
      }),
    )
    .max(20_000)
    .refine((entries) => uniqueSorted(entries.map((entry) => entry.itemId)), {
      message: 'Delivery effect items must be unique and sorted',
    }),
  order: z
    .array(EntityIdSchema)
    .max(20_000)
    .refine((values) => new Set(values).size === values.length, {
      message: 'Delivery effect order IDs must be unique',
    })
    .nullable(),
});
export const UserChoiceEffectSchema = z.union([
  ResultDecisionEffectSchema,
  ProtectionEffectSchema,
  DeliveryEffectSchema,
]);

export const UserChoiceSchema = strictObject({
  authority: z.literal('user_choice'),
  id: EntityIdSchema,
  projectId: EntityIdSchema,
  actor: z.enum(['user', 'commander', 'import']),
  authorization: UserChoiceAuthorizationSchema,
  causation: CausationRefSchema,
  subject: UserChoiceSubjectSchema,
  ownerBefore: ChoiceOwnerRefSchema.nullable(),
  ownerAfter: ChoiceOwnerRefSchema,
  choice: UserChoiceIntentSchema,
  beforeEffect: UserChoiceEffectSchema,
  afterEffect: UserChoiceEffectSchema,
  supersedesChoiceIds: z
    .array(EntityIdSchema)
    .max(32)
    .refine(uniqueSorted, { message: 'Superseded Choice IDs must be unique and sorted' }),
  createdAt: IsoTimestampSchema,
  choiceHash: Sha256Schema,
}).superRefine((record, context) => {
  const authorizationByActor = {
    user: 'direct_user',
    commander: 'commander_dispatch',
    import: 'import',
  } as const;
  if (record.authorization.kind !== authorizationByActor[record.actor]) {
    context.addIssue({
      code: 'custom',
      path: ['authorization', 'kind'],
      message: 'Choice actor and authorization must match',
    });
  }
  if (record.supersedesChoiceIds.includes(record.id)) {
    context.addIssue({
      code: 'custom',
      path: ['supersedesChoiceIds'],
      message: 'A Choice cannot supersede itself',
    });
  }

  const isCreate = record.choice.kind === 'delivery_mutation' && record.choice.action === 'create';
  if (isCreate !== (record.ownerBefore === null)) {
    context.addIssue({
      code: 'custom',
      path: ['ownerBefore'],
      message: 'Only Delivery creation can omit the prior owner',
    });
  }
  if (record.ownerBefore === null) {
    if (record.ownerAfter.authority !== 'delivery' || record.ownerAfter.revision !== 0) {
      context.addIssue({
        code: 'custom',
        path: ['ownerAfter'],
        message: 'Created Delivery owner must begin at revision zero',
      });
    }
  } else if (
    record.ownerBefore.authority !== record.ownerAfter.authority ||
    record.ownerBefore.id !== record.ownerAfter.id ||
    record.ownerAfter.revision !== record.ownerBefore.revision + 1
  ) {
    context.addIssue({
      code: 'custom',
      path: ['ownerAfter'],
      message: 'Choice owner must advance the exact prior owner by one revision',
    });
  }

  if (record.beforeEffect.kind !== record.afterEffect.kind) {
    context.addIssue({
      code: 'custom',
      path: ['afterEffect', 'kind'],
      message: 'Choice effects must use one typed effect kind',
    });
    return;
  }

  if (record.subject.kind === 'result_decision') {
    const subject = record.subject;
    const beforeMatches =
      record.beforeEffect.kind === 'result_decisions' &&
      record.beforeEffect.shotId === subject.shotId &&
      sameCanonical(
        record.beforeEffect.entries.map((entry) => entry.resultId),
        subject.resultIds,
      );
    const afterMatches =
      record.afterEffect.kind === 'result_decisions' &&
      record.afterEffect.shotId === subject.shotId &&
      sameCanonical(
        record.afterEffect.entries.map((entry) => entry.resultId),
        subject.resultIds,
      );
    if (
      record.ownerAfter.authority !== 'production' ||
      record.ownerAfter.id !== subject.shotId ||
      !beforeMatches ||
      !afterMatches
    ) {
      context.addIssue({
        code: 'custom',
        path: ['subject'],
        message: 'Result Choice subject, owner, and effects must identify the same Shot/results',
      });
    }
    if (
      record.choice.kind !== 'undo' &&
      (!('resultId' in record.choice) || !record.subject.resultIds.includes(record.choice.resultId))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['choice'],
        message: 'Result Choice intent must target its subject',
      });
    }
  } else if (record.subject.kind === 'protection') {
    const field = record.subject.field;
    const ownerMatches =
      (field.owner === 'production' &&
        record.ownerAfter.authority === 'production' &&
        field.objectId === record.ownerAfter.id) ||
      (field.owner === 'delivery' &&
        record.ownerAfter.authority === 'delivery' &&
        field.deliveryId === record.ownerAfter.id);
    const effectsMatch = [record.beforeEffect, record.afterEffect].every(
      (effect) => effect.kind === 'protection' && sameCanonical(effect.field, field),
    );
    const intentMatches =
      record.choice.kind === 'undo' ||
      ((record.choice.kind === 'protect' || record.choice.kind === 'unprotect') &&
        sameCanonical(record.choice.field, field));
    if (!ownerMatches || !effectsMatch || !intentMatches) {
      context.addIssue({
        code: 'custom',
        path: ['subject'],
        message: 'Protection Choice subject, owner, intent, and effects must match',
      });
    }
  } else {
    const subject = record.subject;
    const beforeMatches =
      record.beforeEffect.kind === 'delivery' &&
      record.beforeEffect.deliveryId === subject.deliveryId &&
      sameCanonical(
        record.beforeEffect.items.map((entry) => entry.itemId),
        subject.itemIds,
      );
    const afterMatches =
      record.afterEffect.kind === 'delivery' &&
      record.afterEffect.deliveryId === subject.deliveryId &&
      sameCanonical(
        record.afterEffect.items.map((entry) => entry.itemId),
        subject.itemIds,
      );
    if (
      record.ownerAfter.authority !== 'delivery' ||
      record.ownerAfter.id !== subject.deliveryId ||
      !beforeMatches ||
      !afterMatches ||
      (record.choice.kind !== 'delivery_mutation' && record.choice.kind !== 'undo')
    ) {
      context.addIssue({
        code: 'custom',
        path: ['subject'],
        message: 'Delivery Choice subject, owner, intent, and effects must match',
      });
    }
  }
});

export function userChoiceHashInput(record: z.output<typeof UserChoiceSchema>) {
  const { choiceHash: _choiceHash, ...snapshot } = record;
  return snapshot;
}

export const DecisionRecordCommandSchema = z.union([
  strictObject({
    action: z.literal('select'),
    shot: ProductionRefSchema,
    result: GeneratedResultRefSchema,
    feedback: z.string().max(20_000),
  }),
  strictObject({
    action: z.literal('reject'),
    shot: ProductionRefSchema,
    result: GeneratedResultRefSchema,
    feedback: z.string().trim().min(1).max(20_000),
  }),
  strictObject({
    action: z.literal('refine'),
    shot: ProductionRefSchema,
    result: GeneratedResultRefSchema,
    instruction: z.string().trim().min(1).max(20_000),
  }),
  strictObject({
    action: z.literal('use_as_reference'),
    shot: ProductionRefSchema,
    result: GeneratedResultRefSchema,
    feedback: z.string().max(20_000),
  }),
  strictObject({
    action: z.literal('undo'),
    targetChoice: UserChoiceRefSchema,
    currentOwner: ChoiceOwnerRefSchema,
  }),
]);

export const DecisionProtectionCommandSchema = strictObject({
  mode: z.enum(['protect', 'unprotect']),
  owner: ChoiceOwnerRefSchema,
  field: ProtectedFieldRefSchema,
  reason: z.string().max(4_000),
}).superRefine((command, context) => {
  const matches =
    (command.field.owner === 'production' &&
      command.owner.authority === 'production' &&
      command.field.objectId === command.owner.id) ||
    (command.field.owner === 'delivery' &&
      command.owner.authority === 'delivery' &&
      command.field.deliveryId === command.owner.id);
  if (!matches) {
    context.addIssue({
      code: 'custom',
      path: ['field'],
      message: 'Protected field must belong to the exact owner',
    });
  }
});

export const DecisionSchema = UserChoiceSchema;

export type UserChoiceAuthorization = z.infer<typeof UserChoiceAuthorizationSchema>;
export type ChoiceOwnerRef = z.infer<typeof ChoiceOwnerRefSchema>;
export type UserChoiceSubject = z.infer<typeof UserChoiceSubjectSchema>;
export type UserChoiceIntent = z.infer<typeof UserChoiceIntentSchema>;
export type UserChoiceDetail = UserChoiceIntent;
export type UserChoiceEffect = z.infer<typeof UserChoiceEffectSchema>;
export type UserChoice = z.infer<typeof UserChoiceSchema>;
export type DecisionRecordCommand = z.infer<typeof DecisionRecordCommandSchema>;
export type DecisionProtectionCommand = z.infer<typeof DecisionProtectionCommandSchema>;
export type Decision = z.infer<typeof DecisionSchema>;
