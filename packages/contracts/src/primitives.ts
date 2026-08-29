import { z } from 'zod';
import { strictObject } from './canonical.js';

export const EntityIdSchema = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[A-Za-z0-9][A-Za-z0-9:._-]*$/);
export const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
export const IsoTimestampSchema = z.string().datetime({ offset: true });
export const RevisionSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).finite();
export const SequenceSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER).finite();
export const CountSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).finite();
export const PositiveCountSchema = z
  .number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER)
  .finite();
export const NonNegativeNumberSchema = z.number().nonnegative().finite();
export const PositiveNumberSchema = z.number().positive().finite();
export const CanonicalDecimalSchema = z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d*[1-9])?$/);
export const IsoCurrencySchema = z.string().regex(/^[A-Z]{3}$/);

function hasUnsafeLeafCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    if (character === '/' || character === '\\' || codePoint <= 0x1f || codePoint === 0x7f) {
      return true;
    }
  }
  return false;
}

export const SafeLeafDisplayLabelSchema = z
  .string()
  .trim()
  .min(1)
  .max(512)
  .refine(
    (label) =>
      label !== '.' &&
      label !== '..' &&
      !/^[A-Za-z]:/u.test(label) &&
      !hasUnsafeLeafCharacter(label),
    'Display label must be a safe leaf name without path information',
  );

export const AuthoritySchema = z.enum([
  'project',
  'project_settings',
  'media_blob',
  'global_media_folder',
  'global_media_asset',
  'project_media_ref',
  'media_derivation',
  'media_derivation_attempt',
  'production',
  'sequence',
  'canvas',
  'chat',
  'message',
  'run',
  'context_manifest',
  'task_list',
  'generation_attempt',
  'generated_result',
  'result_assessment_attempt',
  'user_choice',
  'delivery',
  'delivery_manifest',
  'review_cut_attempt',
  'delivery_export',
  'project_event',
  'project_memory',
  'skill',
]);

export const DomainObjectAuthoritySchema = z.enum([
  'project',
  'project_media_ref',
  'media_derivation_attempt',
  'production',
  'sequence',
  'canvas',
  'generation_attempt',
  'generated_result',
  'result_assessment_attempt',
  'delivery',
  'delivery_manifest',
  'review_cut_attempt',
  'delivery_export',
]);

export const ActorSchema = z.enum(['user', 'commander', 'system', 'import']);
export const PermissionModeSchema = z.enum(['read_only', 'reversible', 'full']);

export const ProviderModelSchema = strictObject({
  providerId: EntityIdSchema,
  model: z.string().trim().min(1).max(200),
  reasoningStrength: z.string().trim().min(1).max(80).nullable(),
});

export const ArtifactRefSchema = strictObject({
  kind: z.enum(['image', 'video', 'audio', 'document', 'review_cut', 'delivery_export']),
  id: EntityIdSchema,
  contentHash: Sha256Schema,
  mimeType: z.string().trim().min(1).max(160).nullable(),
  width: PositiveCountSchema.nullable(),
  height: PositiveCountSchema.nullable(),
  durationMs: PositiveCountSchema.nullable(),
});

export const KnownAmountSchema = strictObject({
  state: z.literal('known'),
  value: CanonicalDecimalSchema,
  currency: IsoCurrencySchema,
});
export const EstimatedAmountSchema = strictObject({
  state: z.literal('estimated'),
  value: CanonicalDecimalSchema,
  currency: IsoCurrencySchema,
});
export const UnknownAmountSchema = strictObject({
  state: z.literal('unknown'),
  currency: IsoCurrencySchema,
});
export const ResourceAmountSchema = z.union([
  KnownAmountSchema,
  EstimatedAmountSchema,
  UnknownAmountSchema,
]);
export const KnownCountAmountSchema = strictObject({
  state: z.literal('known'),
  value: CountSchema,
});
export const EstimatedCountAmountSchema = strictObject({
  state: z.literal('estimated'),
  value: CountSchema,
});
export const UnknownCountAmountSchema = strictObject({ state: z.literal('unknown') });
export const CountAmountSchema = z.union([
  KnownCountAmountSchema,
  EstimatedCountAmountSchema,
  UnknownCountAmountSchema,
]);

export const ResourceBudgetSchema = strictObject({
  costUsd: ResourceAmountSchema,
  maxGenerationCount: CountSchema,
  maxInputTokens: CountSchema,
  maxOutputTokens: CountSchema,
});

const PermissionRank = Object.freeze({ read_only: 0, reversible: 1, full: 2 } as const);

function compareCanonicalDecimal(left: string, right: string): number {
  const [leftInteger, leftFraction = ''] = left.split('.');
  const [rightInteger, rightFraction = ''] = right.split('.');
  if (leftInteger!.length !== rightInteger!.length) {
    return leftInteger!.length < rightInteger!.length ? -1 : 1;
  }
  if (leftInteger !== rightInteger) return leftInteger! < rightInteger! ? -1 : 1;
  const width = Math.max(leftFraction.length, rightFraction.length);
  const normalizedLeft = leftFraction.padEnd(width, '0');
  const normalizedRight = rightFraction.padEnd(width, '0');
  return normalizedLeft === normalizedRight ? 0 : normalizedLeft < normalizedRight ? -1 : 1;
}

export function assertPolicyNarrowing(
  ceilingPermissionInput: PermissionMode,
  ceilingBudgetInput: ResourceBudget,
  effectivePermissionInput: PermissionMode,
  effectiveBudgetInput: ResourceBudget,
): void {
  const ceilingPermission = PermissionModeSchema.parse(ceilingPermissionInput);
  const effectivePermission = PermissionModeSchema.parse(effectivePermissionInput);
  const ceilingBudget = ResourceBudgetSchema.parse(ceilingBudgetInput);
  const effectiveBudget = ResourceBudgetSchema.parse(effectiveBudgetInput);
  if (PermissionRank[effectivePermission] > PermissionRank[ceilingPermission]) {
    throw new Error('Effective permission exceeds its ceiling');
  }
  for (const field of ['maxGenerationCount', 'maxInputTokens', 'maxOutputTokens'] as const) {
    if (effectiveBudget[field] > ceilingBudget[field]) {
      throw new Error(`Effective budget ${field} exceeds its ceiling`);
    }
  }
  if (effectiveBudget.costUsd.currency !== ceilingBudget.costUsd.currency) {
    throw new Error('Effective cost currency differs from its ceiling');
  }
  if (ceilingBudget.costUsd.state === 'unknown') return;
  if (effectiveBudget.costUsd.state === 'unknown') {
    throw new Error('Effective cost cannot be unknown under a finite ceiling');
  }
  if (compareCanonicalDecimal(effectiveBudget.costUsd.value, ceilingBudget.costUsd.value) > 0) {
    throw new Error('Effective cost exceeds its ceiling');
  }
}

export const MessageCausationSchema = strictObject({
  kind: z.literal('message'),
  messageId: EntityIdSchema,
});
export const RunCausationSchema = strictObject({
  kind: z.literal('run'),
  runId: EntityIdSchema,
});
export const UserChoiceCausationSchema = strictObject({
  kind: z.literal('user_choice'),
  choiceId: EntityIdSchema,
});
export const ImportCausationSchema = strictObject({
  kind: z.literal('import'),
  importId: EntityIdSchema,
});
export const DirectUiCausationSchema = strictObject({
  kind: z.literal('direct_ui'),
  actionId: EntityIdSchema,
});
export const InboxCausationSchema = strictObject({
  kind: z.literal('run_inbox'),
  inboxMessageId: EntityIdSchema,
});
export const CausationRefSchema = z.union([
  MessageCausationSchema,
  RunCausationSchema,
  UserChoiceCausationSchema,
  ImportCausationSchema,
  DirectUiCausationSchema,
  InboxCausationSchema,
]);

export const DomainObjectRefSchema = strictObject({
  authority: DomainObjectAuthoritySchema,
  id: EntityIdSchema,
  revision: RevisionSchema,
  contentHash: Sha256Schema,
});

export const UserChoiceRefSchema = strictObject({
  authority: z.literal('user_choice'),
  id: EntityIdSchema,
  choiceHash: Sha256Schema,
});

export const EventHeadSchema = strictObject({
  sequence: SequenceSchema,
  hash: Sha256Schema,
});

export type Authority = z.infer<typeof AuthoritySchema>;
export type DomainObjectAuthority = z.infer<typeof DomainObjectAuthoritySchema>;
export type Actor = z.infer<typeof ActorSchema>;
export type PermissionMode = z.infer<typeof PermissionModeSchema>;
export type ProviderModel = z.infer<typeof ProviderModelSchema>;
export type ArtifactRef = z.infer<typeof ArtifactRefSchema>;
export type ResourceAmount = z.infer<typeof ResourceAmountSchema>;
export type CountAmount = z.infer<typeof CountAmountSchema>;
export type ResourceBudget = z.infer<typeof ResourceBudgetSchema>;
export type CausationRef = z.infer<typeof CausationRefSchema>;
export type DomainObjectRef = z.infer<typeof DomainObjectRefSchema>;
export type UserChoiceRef = z.infer<typeof UserChoiceRefSchema>;
export type EventHead = z.infer<typeof EventHeadSchema>;
