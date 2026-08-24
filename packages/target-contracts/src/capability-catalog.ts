import { z } from 'zod';
import { canonicalJson, strictObject } from './canonical.js';
import { EntityIdSchema, IsoTimestampSchema, Sha256Schema } from './primitives.js';
import { ToolMetadataSchema, ToolVersionSchema } from './tools/common.js';
import { EXACT_TOOL_IDS, ToolIdSchema } from './tools/ids.js';

export const PARSER_POLICY_VERSION = 'strict-json-v1' as const;

export const SkillProvenanceSchema = z.enum(['built_in', 'installed', 'project']);
export const SkillTrustSchema = z.enum(['trusted', 'reviewed', 'unreviewed']);
export const SkillDocumentSchema = strictObject({
  skillId: EntityIdSchema,
  name: z.string().trim().min(1).max(240),
  description: z.string().trim().min(1).max(4_000),
  version: z.string().trim().min(1).max(80),
  contentHash: Sha256Schema,
  provenance: SkillProvenanceSchema,
  trust: SkillTrustSchema,
  content: z.string().min(1).max(200_000),
  createdAt: IsoTimestampSchema,
});

export const SkillIndexEntrySchema = strictObject({
  id: EntityIdSchema,
  name: z.string().trim().min(1).max(240),
  description: z.string().trim().min(1).max(4_000),
  version: z.string().trim().min(1).max(80),
  contentHash: Sha256Schema,
  provenance: SkillProvenanceSchema,
  trust: SkillTrustSchema,
});

export function skillIndexFromSkills(skills: readonly SkillDocument[]): SkillIndexEntry[] {
  return skills.map(
    ({ skillId: id, name, description, version, contentHash, provenance, trust }) => ({
      id,
      name,
      description,
      version,
      contentHash,
      provenance,
      trust,
    }),
  );
}

export const CanonicalJsonDigestV1Schema = strictObject({
  canonicalJson: z.string().min(1).max(8_000_000),
  sha256: Sha256Schema,
}).superRefine(({ canonicalJson: text }, context) => {
  try {
    const parsed: unknown = JSON.parse(text);
    if (canonicalJson(parsed) !== text) {
      context.addIssue({
        code: 'custom',
        path: ['canonicalJson'],
        message: 'JSON text must be canonical and round-trip byte-identically',
      });
    }
  } catch {
    context.addIssue({
      code: 'custom',
      path: ['canonicalJson'],
      message: 'Canonical JSON text must contain valid JSON',
    });
  }
});

export const CapabilityToolDocumentV1Schema = strictObject({
  id: ToolIdSchema,
  version: ToolVersionSchema,
  description: z.string().min(1).max(2_000),
  metadata: ToolMetadataSchema,
  metadataHash: Sha256Schema,
  schemaDigest: Sha256Schema,
  inputSchema: CanonicalJsonDigestV1Schema,
  successSchema: CanonicalJsonDigestV1Schema,
  outcomeSchema: CanonicalJsonDigestV1Schema,
  examples: CanonicalJsonDigestV1Schema,
}).superRefine((tool, context) => {
  if (tool.metadata.version !== tool.version) {
    context.addIssue({
      code: 'custom',
      path: ['metadata', 'version'],
      message: 'Tool metadata version must match the document version',
    });
  }
  if (tool.metadata.description !== tool.description) {
    context.addIssue({
      code: 'custom',
      path: ['metadata', 'description'],
      message: 'Tool metadata description must match the document description',
    });
  }
});

export const CapabilityIndexEntrySchema = strictObject({
  name: ToolIdSchema,
  version: ToolVersionSchema,
  domain: z.string().min(1).max(80),
  purpose: z.string().min(1).max(2_000),
  schemaDigest: Sha256Schema,
  availability: z.enum(['available', 'confirmation_required']),
});

function compareIdentity(
  left: { readonly id: string; readonly version: string },
  right: { readonly id: string; readonly version: string },
): number {
  return left.id.localeCompare(right.id) || left.version.localeCompare(right.version);
}

function sortedUniqueByIdentity(
  values: readonly { readonly id: string; readonly version: string }[],
): boolean {
  return values.every(
    (value, index) => index === 0 || compareIdentity(values[index - 1]!, value) < 0,
  );
}

const capabilityCatalogSnapshotWithoutHashV1Shape = {
  version: z.literal(1),
  parserPolicyVersion: z.literal(PARSER_POLICY_VERSION),
  parentCatalogHash: Sha256Schema.nullable(),
  toolCatalogDigest: Sha256Schema,
  skillCatalogDigest: Sha256Schema,
  capabilityIndexDigest: Sha256Schema,
  tools: z.array(CapabilityToolDocumentV1Schema).max(EXACT_TOOL_IDS.length),
  skills: z.array(SkillDocumentSchema).max(500),
  capabilityIndex: z.array(CapabilityIndexEntrySchema).max(EXACT_TOOL_IDS.length),
} as const;

const CapabilityCatalogSnapshotWithoutHashV1Schema = strictObject(
  capabilityCatalogSnapshotWithoutHashV1Shape,
);

export const CapabilityCatalogSnapshotV1Schema = strictObject({
  catalogHash: Sha256Schema,
  ...capabilityCatalogSnapshotWithoutHashV1Shape,
}).superRefine((snapshot, context) => {
  const sortedTools = snapshot.tools.every(
    (tool, index) => index === 0 || snapshot.tools[index - 1]!.id < tool.id,
  );
  if (!sortedTools) {
    context.addIssue({
      code: 'custom',
      path: ['tools'],
      message: 'Catalog tools must be unique and sorted by ID',
    });
  }
  if (
    !sortedUniqueByIdentity(
      snapshot.skills.map(({ skillId, version }) => ({ id: skillId, version })),
    )
  ) {
    context.addIssue({
      code: 'custom',
      path: ['skills'],
      message: 'Catalog skills must be unique and sorted by ID and version',
    });
  }
  const sortedIndex = snapshot.capabilityIndex.every(
    (entry, index) => index === 0 || snapshot.capabilityIndex[index - 1]!.name < entry.name,
  );
  if (!sortedIndex) {
    context.addIssue({
      code: 'custom',
      path: ['capabilityIndex'],
      message: 'Capability index entries must be unique and sorted by name',
    });
  }

  if (
    snapshot.parentCatalogHash === null &&
    (snapshot.tools.length !== EXACT_TOOL_IDS.length ||
      snapshot.tools.some((tool, index) => tool.id !== EXACT_TOOL_IDS[index]))
  ) {
    context.addIssue({
      code: 'custom',
      path: ['tools'],
      message: `Root capability catalog must contain the exact frozen ${EXACT_TOOL_IDS.length}-tool inventory`,
    });
  }

  if (snapshot.capabilityIndex.length !== snapshot.tools.length) {
    context.addIssue({
      code: 'custom',
      path: ['capabilityIndex'],
      message: 'Capability index must contain exactly one entry for every catalog tool',
    });
    return;
  }
  snapshot.tools.forEach((tool, index) => {
    const entry = snapshot.capabilityIndex[index];
    const availability =
      tool.metadata.confirmation.mode === 'none' ? 'available' : 'confirmation_required';
    if (
      entry === undefined ||
      entry.name !== tool.id ||
      entry.version !== tool.version ||
      entry.domain !== tool.metadata.domain ||
      entry.purpose !== tool.description ||
      entry.schemaDigest !== tool.schemaDigest ||
      entry.availability !== availability
    ) {
      context.addIssue({
        code: 'custom',
        path: ['capabilityIndex', index],
        message: 'Capability index entry must exactly describe its catalog tool',
      });
    }
  });
});

export const CapabilityCatalogSnapshotV1 = CapabilityCatalogSnapshotV1Schema;

export function toolSchemaDigestInput(tool: {
  readonly inputSchema: { readonly sha256: string };
  readonly successSchema: { readonly sha256: string };
  readonly outcomeSchema: { readonly sha256: string };
  readonly examples: { readonly sha256: string };
}): string {
  return canonicalJson({
    examples: tool.examples.sha256,
    inputSchema: tool.inputSchema.sha256,
    outcomeSchema: tool.outcomeSchema.sha256,
    successSchema: tool.successSchema.sha256,
  });
}

export function toolCatalogDigestInput(
  tools: readonly z.input<typeof CapabilityToolDocumentV1Schema>[],
): string {
  return canonicalJson(tools);
}

export function skillCatalogDigestInput(
  skills: readonly z.input<typeof SkillDocumentSchema>[],
): string {
  return canonicalJson(skills);
}

export function capabilityIndexDigestInput(
  capabilityIndex: readonly z.input<typeof CapabilityIndexEntrySchema>[],
): string {
  return canonicalJson(capabilityIndex);
}

export function capabilityCatalogHashInput(
  snapshot: z.input<typeof CapabilityCatalogSnapshotWithoutHashV1Schema>,
): string {
  return canonicalJson(snapshot);
}

export function assertCapabilityCatalogLineage(parentInput: unknown, childInput: unknown): void {
  const parent = CapabilityCatalogSnapshotV1Schema.parse(parentInput);
  const child = CapabilityCatalogSnapshotV1Schema.parse(childInput);
  if (child.parentCatalogHash !== parent.catalogHash) {
    throw new Error('Child capability catalog must name its exact parent catalog hash');
  }

  const parentTools = new Map(parent.tools.map((tool) => [tool.id, canonicalJson(tool)]));
  for (const tool of child.tools) {
    if (parentTools.get(tool.id) !== canonicalJson(tool)) {
      throw new Error(`Child capability tool ${tool.id} is not an immutable parent subset`);
    }
  }
  const parentSkills = new Map(
    parent.skills.map((skill) => [`${skill.skillId}\u0000${skill.version}`, canonicalJson(skill)]),
  );
  for (const skill of child.skills) {
    if (parentSkills.get(`${skill.skillId}\u0000${skill.version}`) !== canonicalJson(skill)) {
      throw new Error(
        `Child capability skill ${skill.skillId}@${skill.version} is not an immutable parent subset`,
      );
    }
  }
}

export type SkillProvenance = z.infer<typeof SkillProvenanceSchema>;
export type SkillTrust = z.infer<typeof SkillTrustSchema>;
export type SkillDocument = z.infer<typeof SkillDocumentSchema>;
export type SkillIndexEntry = z.infer<typeof SkillIndexEntrySchema>;
export type CanonicalJsonDigestV1 = z.infer<typeof CanonicalJsonDigestV1Schema>;
export type CapabilityToolDocumentV1 = z.infer<typeof CapabilityToolDocumentV1Schema>;
export type CapabilityIndexEntry = z.infer<typeof CapabilityIndexEntrySchema>;
export type CapabilityCatalogSnapshotV1 = z.infer<typeof CapabilityCatalogSnapshotV1Schema>;
