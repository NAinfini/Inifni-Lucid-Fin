/**
 * Zod schemas for ContextItem variants — Phase G2a-1.
 *
 * Used by SessionRepository to parse `context_graph_json` from the DB
 * via `parseOrDegrade`. Each variant is individually defined and combined
 * via `z.discriminatedUnion('kind', [...])`.
 *
 * Lives in contracts-parse (zod runtime) per the package pact.
 */

import { z } from 'zod';

// ── Shared helpers ─────────────────────────────────────────────

const ContextItemIdSchema = z.string().min(1);

const EntityRefSchema = z.object({
  entityType: z.string(),
  entityId: z.string(),
});

const ToolCallSchema = z.object({
  id: z.string(),
  name: z.string(),
  arguments: z.record(z.string(), z.unknown()),
});

// ── Variant schemas ────────────────────────────────────────────

const UserMessageItemSchema = z.object({
  kind: z.literal('user-message'),
  itemId: ContextItemIdSchema,
  producedAtStep: z.number().int().nonnegative(),
  content: z.string(),
});

const AssistantTurnItemSchema = z.object({
  kind: z.literal('assistant-turn'),
  itemId: ContextItemIdSchema,
  producedAtStep: z.number().int().nonnegative(),
  content: z.string(),
  toolCalls: z.array(ToolCallSchema).optional(),
  reasoning: z.string().optional(),
});

const ToolResultItemSchema = z.object({
  kind: z.literal('tool-result'),
  itemId: ContextItemIdSchema,
  producedAtStep: z.number().int().nonnegative(),
  toolKey: z.string().min(1),
  paramsHash: z.string(),
  entityRef: EntityRefSchema.optional(),
  content: z.unknown(),
  schemaVersion: z.number().int().nonnegative(),
  toolCallId: z.string().optional(),
});

const EntitySnapshotItemSchema = z.object({
  kind: z.literal('entity-snapshot'),
  itemId: ContextItemIdSchema,
  producedAtStep: z.number().int().nonnegative(),
  entityRef: EntityRefSchema,
  snapshot: z.unknown(),
});

const GuideItemSchema = z.object({
  kind: z.literal('guide'),
  itemId: ContextItemIdSchema,
  producedAtStep: z.number().int().nonnegative(),
  guideKey: z.string(),
  content: z.string(),
});

const SystemMessageItemSchema = z.object({
  kind: z.literal('system-message'),
  itemId: ContextItemIdSchema,
  producedAtStep: z.number().int().nonnegative(),
  content: z.string(),
});

const SessionSummaryItemSchema = z.object({
  kind: z.literal('session-summary'),
  itemId: ContextItemIdSchema,
  producedAtStep: z.number().int().nonnegative(),
  stepsFrom: z.number().int().nonnegative(),
  stepsTo: z.number().int().nonnegative(),
  content: z.string(),
});

const ReferenceItemSchema = z.object({
  kind: z.literal('reference'),
  itemId: ContextItemIdSchema,
  producedAtStep: z.number().int().nonnegative(),
  referencedItemId: ContextItemIdSchema,
});

// ── Combined discriminated union ───────────────────────────────

export const ContextItemSchema = z.discriminatedUnion('kind', [
  UserMessageItemSchema,
  AssistantTurnItemSchema,
  ToolResultItemSchema,
  EntitySnapshotItemSchema,
  GuideItemSchema,
  SystemMessageItemSchema,
  SessionSummaryItemSchema,
  ReferenceItemSchema,
]);

export type ContextItemSchemaType = z.infer<typeof ContextItemSchema>;
