import { z } from 'zod';

const NonEmptyStyleText = z.string().trim().min(1);

export const VisualStyleGrammarSchema = z
  .object({
    medium: NonEmptyStyleText,
    era: NonEmptyStyleText,
    rendering: NonEmptyStyleText,
    linework: NonEmptyStyleText,
    palette: NonEmptyStyleText,
    lighting: NonEmptyStyleText,
    texture: NonEmptyStyleText,
    mood: NonEmptyStyleText,
    cameraGrammar: NonEmptyStyleText,
    lensGrammar: NonEmptyStyleText,
    compositionGrammar: NonEmptyStyleText,
    motionGrammar: NonEmptyStyleText,
    characterAnchors: z.array(NonEmptyStyleText),
    locationAnchors: z.array(NonEmptyStyleText),
    negativeConstraints: z.array(NonEmptyStyleText),
  })
  .strict();

export const CanvasVisualStylePolicySchema = z
  .object({
    version: z.literal(1),
    summary: NonEmptyStyleText.optional(),
    locked: VisualStyleGrammarSchema.partial().optional(),
    allowedVariations: z.array(NonEmptyStyleText).optional(),
    negativeConstraints: z.array(NonEmptyStyleText).optional(),
  })
  .strict()
  .refine(
    (value) =>
      Boolean(value.summary) ||
      Boolean(
        value.locked &&
        Object.values(value.locked).some((entry) =>
          Array.isArray(entry) ? entry.length > 0 : Boolean(entry),
        ),
      ) ||
      Boolean(value.allowedVariations?.length) ||
      Boolean(value.negativeConstraints?.length),
    { message: 'A visual-style policy must contain at least one style constraint' },
  );

export const VisualStyleProvenanceSchema = z
  .object({
    source: z.enum(['canvas-draft', 'legacy-style-plate', 'visual-constitution']),
    policyHash: z.string().min(1),
    workflowRunId: z.string().min(1).optional(),
    revision: z.number().int().positive().optional(),
    contentHash: z.string().min(1).optional(),
  })
  .strict();

export type CanvasVisualStylePolicyDto = z.infer<typeof CanvasVisualStylePolicySchema>;
export type VisualStyleProvenanceDto = z.infer<typeof VisualStyleProvenanceSchema>;
