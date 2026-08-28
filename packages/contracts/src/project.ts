import { z } from 'zod';
import { strictObject } from './canonical.js';
import {
  CausationRefSchema,
  EntityIdSchema,
  IsoTimestampSchema,
  PermissionModeSchema,
  PositiveCountSchema,
  ResourceBudgetSchema,
  RevisionSchema,
  Sha256Schema,
} from './primitives.js';

export const ProjectLifecycleSchema = z.enum(['active', 'archived', 'deleted']);

export const ProjectRefSchema = strictObject({
  authority: z.literal('project'),
  id: EntityIdSchema,
  revision: RevisionSchema,
  contentHash: Sha256Schema,
});

export const ProjectSchema = strictObject({
  authority: z.literal('project'),
  id: EntityIdSchema,
  name: z.string().trim().min(1).max(240),
  lifecycle: ProjectLifecycleSchema,
  schemaRevision: RevisionSchema,
  revision: RevisionSchema,
  contentHash: Sha256Schema,
  createdBy: CausationRefSchema,
  createdAt: IsoTimestampSchema,
  updatedAt: IsoTimestampSchema,
  archivedAt: IsoTimestampSchema.nullable(),
  deletedAt: IsoTimestampSchema.nullable(),
}).superRefine(({ lifecycle, archivedAt, deletedAt }, context) => {
  const valid =
    (lifecycle === 'active' && archivedAt === null && deletedAt === null) ||
    (lifecycle === 'archived' && archivedAt !== null && deletedAt === null) ||
    (lifecycle === 'deleted' && archivedAt === null && deletedAt !== null);
  if (!valid) {
    context.addIssue({
      code: 'custom',
      path: ['lifecycle'],
      message: 'Project lifecycle must match its exclusive terminal timestamp',
    });
  }
});

export const ProjectAspectRatioSchema = z.enum(['16:9', '9:16', '1:1', '4:3', 'custom']);
export const ProjectCustomDimensionsSchema = strictObject({
  width: PositiveCountSchema.max(16_384),
  height: PositiveCountSchema.max(16_384),
});
export const ProjectFormatPolicySchema = strictObject({
  aspectRatio: ProjectAspectRatioSchema,
  customDimensions: ProjectCustomDimensionsSchema.nullable(),
  frameRate: PositiveCountSchema.max(240),
}).superRefine(({ aspectRatio, customDimensions }, context) => {
  if (aspectRatio === 'custom' && customDimensions === null) {
    context.addIssue({
      code: 'custom',
      path: ['customDimensions'],
      message: 'Custom aspect ratio requires explicit dimensions',
    });
  }
  if (aspectRatio !== 'custom' && customDimensions !== null) {
    context.addIssue({
      code: 'custom',
      path: ['customDimensions'],
      message: 'Preset aspect ratios cannot carry custom dimensions',
    });
  }
});

export const ProjectEnabledSkillSchema = strictObject({
  id: EntityIdSchema,
  version: z.string().trim().min(1).max(80),
});

export const ProjectEnabledSkillsSchema = z
  .array(ProjectEnabledSkillSchema)
  .max(500)
  .refine(
    (skills) => skills.every((skill, index) => index === 0 || skills[index - 1]!.id < skill.id),
    'Enabled skills must have unique IDs and be sorted by ID',
  );

export const ProjectSettingsSchema = strictObject({
  authority: z.literal('project_settings'),
  projectId: EntityIdSchema,
  revision: RevisionSchema,
  contentHash: Sha256Schema,
  defaultProviderProfileId: EntityIdSchema.nullable(),
  formatPolicy: ProjectFormatPolicySchema,
  permission: PermissionModeSchema,
  budget: ResourceBudgetSchema,
  enabledSkills: ProjectEnabledSkillsSchema,
  updatedAt: IsoTimestampSchema,
});

export type ProjectLifecycle = z.infer<typeof ProjectLifecycleSchema>;
export type ProjectRef = z.infer<typeof ProjectRefSchema>;
export type Project = z.infer<typeof ProjectSchema>;
export type ProjectAspectRatio = z.infer<typeof ProjectAspectRatioSchema>;
export type ProjectCustomDimensions = z.infer<typeof ProjectCustomDimensionsSchema>;
export type ProjectFormatPolicy = z.infer<typeof ProjectFormatPolicySchema>;
export type ProjectEnabledSkill = z.infer<typeof ProjectEnabledSkillSchema>;
export type ProjectEnabledSkills = z.infer<typeof ProjectEnabledSkillsSchema>;
export type ProjectSettings = z.infer<typeof ProjectSettingsSchema>;
