import { z } from 'zod';
import { canonicalJson, strictObject } from './canonical.js';
import { SkillDocumentSchema } from './capability-catalog.js';
import {
  EntityIdSchema,
  IsoTimestampSchema,
  RevisionSchema,
  SequenceSchema,
  Sha256Schema,
} from './primitives.js';

const PluginPackageSkillDocumentV1Schema = SkillDocumentSchema.superRefine((skill, context) => {
  if (skill.provenance !== 'installed') {
    context.addIssue({
      code: 'custom',
      path: ['provenance'],
      message: 'Plugin package Skills must use installed provenance',
    });
  }
  if (skill.trust !== 'trusted') {
    context.addIssue({
      code: 'custom',
      path: ['trust'],
      message: 'Plugin package Skills must be trusted',
    });
  }
});

const pluginPackageManifestContentV1Shape = {
  packageId: EntityIdSchema,
  version: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(240),
  description: z.string().trim().min(1).max(4_000),
  skills: z
    .array(PluginPackageSkillDocumentV1Schema)
    .min(1)
    .max(500)
    .superRefine((skills, context) => {
      skills.forEach((skill, index) => {
        const previous = skills[index - 1];
        if (previous !== undefined && previous.skillId >= skill.skillId) {
          context.addIssue({
            code: 'custom',
            path: [index],
            message: 'Plugin package Skills must be unique and sorted by ID',
          });
        }
      });
    }),
} as const;

const PluginPackageManifestV1ContentSchema = strictObject(pluginPackageManifestContentV1Shape);

export const PluginPackageManifestV1Schema = strictObject({
  ...pluginPackageManifestContentV1Shape,
  manifestHash: Sha256Schema,
});

export const PluginPackageIdentityV1Schema = strictObject({
  packageId: EntityIdSchema,
  version: z.string().trim().min(1).max(80),
  manifestHash: Sha256Schema,
});

export type PluginPackageManifestV1HashInput = z.output<
  typeof PluginPackageManifestV1ContentSchema
>;

export function pluginPackageManifestHashInput(input: PluginPackageManifestV1HashInput): string {
  return canonicalJson(
    PluginPackageManifestV1ContentSchema.parse({
      packageId: input.packageId,
      version: input.version,
      name: input.name,
      description: input.description,
      skills: input.skills,
    }),
  );
}

export const PluginPackageInstallationStateV1Schema = z.enum(['installed', 'removed']);
export const PluginPackageInstallationV1Schema = strictObject({
  packageId: EntityIdSchema,
  version: z.string().trim().min(1).max(80),
  manifestHash: Sha256Schema,
  state: PluginPackageInstallationStateV1Schema,
  revision: RevisionSchema,
  installedAt: IsoTimestampSchema,
  removedAt: IsoTimestampSchema.nullable(),
}).superRefine((installation, context) => {
  if ((installation.state === 'removed') !== (installation.removedAt !== null)) {
    context.addIssue({
      code: 'custom',
      path: ['removedAt'],
      message: 'Removed timestamp must exactly match installation state',
    });
  }
});

export const PluginPackageAuditActionV1Schema = z.enum(['installed', 'removed']);
const pluginPackageAuditEventV1Shape = {
  id: EntityIdSchema,
  sequence: SequenceSchema,
  packageId: EntityIdSchema,
  version: z.string().trim().min(1).max(80),
  manifestHash: Sha256Schema,
  action: PluginPackageAuditActionV1Schema,
  installationRevision: RevisionSchema,
  previousEventHash: Sha256Schema.nullable(),
  eventHash: Sha256Schema,
  occurredAt: IsoTimestampSchema,
} as const;

export const PluginPackageAuditEventV1Schema = strictObject(pluginPackageAuditEventV1Shape);

export type PluginPackageAuditEventV1HashInput = Omit<
  z.output<typeof PluginPackageAuditEventV1Schema>,
  'eventHash'
>;

export function pluginPackageAuditEventHashInput(
  input: PluginPackageAuditEventV1HashInput,
): string {
  return canonicalJson({
    id: input.id,
    sequence: input.sequence,
    packageId: input.packageId,
    version: input.version,
    manifestHash: input.manifestHash,
    action: input.action,
    installationRevision: input.installationRevision,
    previousEventHash: input.previousEventHash,
    occurredAt: input.occurredAt,
  });
}

export const PluginPackageViewV1Schema = strictObject({
  manifest: PluginPackageManifestV1Schema,
  installation: PluginPackageInstallationV1Schema.nullable(),
  auditEvents: z.array(PluginPackageAuditEventV1Schema).max(500),
}).superRefine(({ manifest, installation, auditEvents }, context) => {
  if (
    installation !== null &&
    (installation.packageId !== manifest.packageId ||
      installation.version !== manifest.version ||
      installation.manifestHash !== manifest.manifestHash)
  ) {
    context.addIssue({
      code: 'custom',
      path: ['installation'],
      message: 'Installation must bind this exact immutable Plugin package manifest',
    });
  }
  auditEvents.forEach((event, index) => {
    if (
      event.packageId !== manifest.packageId ||
      event.version !== manifest.version ||
      event.manifestHash !== manifest.manifestHash
    ) {
      context.addIssue({
        code: 'custom',
        path: ['auditEvents', index],
        message: 'Plugin audit event must bind this exact immutable Plugin package manifest',
      });
    }
  });
});

export const PluginPackageQueryInputV1Schema = strictObject({});
export const PluginPackageQueryOutputV1Schema = strictObject({
  packages: z
    .array(PluginPackageViewV1Schema)
    .max(500)
    .superRefine((packages, context) => {
      packages.forEach((entry, index) => {
        const previous = packages[index - 1];
        if (
          previous !== undefined &&
          (previous.manifest.packageId > entry.manifest.packageId ||
            (previous.manifest.packageId === entry.manifest.packageId &&
              previous.manifest.version >= entry.manifest.version))
        ) {
          context.addIssue({
            code: 'custom',
            path: [index],
            message: 'Plugin packages must be unique and sorted by package ID and version',
          });
        }
      });
    }),
});

const PluginPackageInstallInputV1Schema = strictObject({
  action: z.literal('install'),
  packageId: EntityIdSchema,
  version: z.string().trim().min(1).max(80),
  manifestHash: Sha256Schema,
  expectedInstallationRevision: RevisionSchema.nullable(),
});
const PluginPackageRemoveInputV1Schema = strictObject({
  action: z.literal('remove'),
  packageId: EntityIdSchema,
  version: z.string().trim().min(1).max(80),
  manifestHash: Sha256Schema,
  expectedInstallationRevision: RevisionSchema,
});

export const PluginPackageApplyInputV1Schema = z.union([
  PluginPackageInstallInputV1Schema,
  PluginPackageRemoveInputV1Schema,
]);
export const PluginPackageApplyOutputV1Schema = strictObject({
  manifest: PluginPackageManifestV1Schema,
  installation: PluginPackageInstallationV1Schema,
  auditEvent: PluginPackageAuditEventV1Schema.nullable(),
}).superRefine(({ manifest, installation, auditEvent }, context) => {
  if (
    installation.packageId !== manifest.packageId ||
    installation.version !== manifest.version ||
    installation.manifestHash !== manifest.manifestHash
  ) {
    context.addIssue({
      code: 'custom',
      path: ['installation'],
      message: 'Installation must bind this exact immutable Plugin package manifest',
    });
  }
  if (
    auditEvent !== null &&
    (auditEvent.packageId !== manifest.packageId ||
      auditEvent.version !== manifest.version ||
      auditEvent.manifestHash !== manifest.manifestHash)
  ) {
    context.addIssue({
      code: 'custom',
      path: ['auditEvent'],
      message: 'Plugin audit event must bind this exact immutable Plugin package manifest',
    });
  }
});

export type PluginPackageManifestV1 = z.output<typeof PluginPackageManifestV1Schema>;
export type PluginPackageIdentityV1 = z.output<typeof PluginPackageIdentityV1Schema>;
export type PluginPackageInstallationV1 = z.output<typeof PluginPackageInstallationV1Schema>;
export type PluginPackageAuditEventV1 = z.output<typeof PluginPackageAuditEventV1Schema>;
export type PluginPackageViewV1 = z.output<typeof PluginPackageViewV1Schema>;
export type PluginPackageQueryInputV1 = z.output<typeof PluginPackageQueryInputV1Schema>;
export type PluginPackageQueryOutputV1 = z.output<typeof PluginPackageQueryOutputV1Schema>;
export type PluginPackageApplyInputV1 = z.output<typeof PluginPackageApplyInputV1Schema>;
export type PluginPackageApplyOutputV1 = z.output<typeof PluginPackageApplyOutputV1Schema>;
