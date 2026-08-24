import { z } from 'zod';
import { strictObject } from './canonical.js';

export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number().finite(),
    z.string(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ]),
);

export const LegacySkillSourceKindSchema = z.enum([
  'preset',
  'shot_template',
  'renderer_skill',
  'process_prompt',
  'prompt_template',
]);

export const LegacySkillSourceStateSchema = z.enum(['built_in', 'override', 'custom']);

export const LegacySkillContentV1Schema = strictObject({
  schema: z.literal('lucid-fin.legacy-skill-content/v1'),
  source: strictObject({
    kind: LegacySkillSourceKindSchema,
    logicalKey: z.string().min(1).max(1_000),
    state: LegacySkillSourceStateSchema,
    store: z.string().min(1).max(240),
  }),
  effectiveInstruction: z.string().max(190_000),
  sourceRecord: JsonValueSchema,
});

export type LegacySkillSourceKind = z.infer<typeof LegacySkillSourceKindSchema>;
export type LegacySkillSourceState = z.infer<typeof LegacySkillSourceStateSchema>;
export type LegacySkillContentV1 = z.infer<typeof LegacySkillContentV1Schema>;
