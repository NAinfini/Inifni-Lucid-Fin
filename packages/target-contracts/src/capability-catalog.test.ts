import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { SCHEMA_BINDINGS_V1 } from '../../../scripts/generate-target-contracts.js';
import * as targetContracts from './index.js';
import {
  CapabilityCatalogSnapshotV1Schema,
  CanonicalJsonDigestV1Schema,
  EXACT_TOOL_IDS,
  SkillDocumentSchema,
  TOOL_DEFINITIONS,
  assertCapabilityCatalogLineage,
  canonicalJson,
  capabilityCatalogHashInput,
  capabilityIndexDigestInput,
  parseCanonical,
  skillCatalogDigestInput,
  toolCatalogDigestInput,
  toolSchemaDigestInput,
} from './index.js';

const HASH_A = 'a'.repeat(64);
const NOW = '2026-08-15T12:00:00.000Z';

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function digestDocument(value: unknown) {
  const canonicalText = canonicalJson(value);
  return { canonicalJson: canonicalText, sha256: sha256(canonicalText) };
}

function jsonSchema(schema: z.ZodType): unknown {
  return JSON.parse(JSON.stringify(z.toJSONSchema(schema))) as unknown;
}

function makeSnapshot(
  definitions: readonly (typeof TOOL_DEFINITIONS)[number][],
  parentCatalogHash: string | null,
) {
  const tools = definitions.map((definition) => {
    const inputSchema = digestDocument(jsonSchema(definition.inputSchema));
    const successSchema = digestDocument(jsonSchema(definition.successSchema));
    const outcomeSchema = digestDocument(jsonSchema(definition.outcomeSchema));
    const examples = digestDocument(definition.examples);
    return {
      id: definition.id,
      version: definition.version,
      description: definition.description,
      metadata: definition.metadata,
      metadataHash: sha256(canonicalJson(definition.metadata)),
      schemaDigest: sha256(
        toolSchemaDigestInput({ inputSchema, successSchema, outcomeSchema, examples }),
      ),
      inputSchema,
      successSchema,
      outcomeSchema,
      examples,
    };
  });
  const skills: never[] = [];
  const capabilityIndex = tools.map((tool) => ({
    name: tool.id,
    version: tool.version,
    domain: tool.metadata.domain,
    purpose: tool.description,
    schemaDigest: tool.schemaDigest,
    availability:
      tool.metadata.confirmation.mode === 'none'
        ? ('available' as const)
        : ('confirmation_required' as const),
  }));
  const withoutHash = {
    version: 1 as const,
    parserPolicyVersion: 'strict-json-v1' as const,
    parentCatalogHash,
    toolCatalogDigest: sha256(toolCatalogDigestInput(tools)),
    skillCatalogDigest: sha256(skillCatalogDigestInput(skills)),
    capabilityIndexDigest: sha256(capabilityIndexDigestInput(capabilityIndex)),
    tools,
    skills,
    capabilityIndex,
  };
  return {
    ...withoutHash,
    catalogHash: sha256(capabilityCatalogHashInput(withoutHash)),
  };
}

describe('CapabilityCatalogSnapshotV1', () => {
  it('parses the exact sorted 40-tool root and defines deterministic digest preimages', () => {
    const root = makeSnapshot(TOOL_DEFINITIONS, null);
    const parsed = parseCanonical(CapabilityCatalogSnapshotV1Schema, root);

    expect(parsed.tools.map(({ id }) => id)).toEqual(EXACT_TOOL_IDS);
    expect(parsed.tools).toHaveLength(40);
    expect(
      parsed.tools
        .filter(({ id }) =>
          ['canvas.query', 'production.query', 'project.get', 'tool.get', 'tool.program'].includes(
            id,
          ),
        )
        .map(({ id, version }) => ({ id, version })),
    ).toEqual([
      { id: 'canvas.query', version: '2.0.0' },
      { id: 'production.query', version: '2.0.0' },
      { id: 'project.get', version: '2.0.0' },
      { id: 'tool.get', version: '2.0.0' },
      { id: 'tool.program', version: '2.0.0' },
    ]);
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(parsed.catalogHash).toBe(root.catalogHash);
    expect(parsed.toolCatalogDigest).toBe(sha256(toolCatalogDigestInput(parsed.tools)));
    expect(parsed.skillCatalogDigest).toBe(sha256(skillCatalogDigestInput(parsed.skills)));
    expect(parsed.capabilityIndexDigest).toBe(
      sha256(capabilityIndexDigestInput(parsed.capabilityIndex)),
    );
  });

  it('requires canonical schema/example text to round-trip byte-identically', () => {
    expect(CanonicalJsonDigestV1Schema.parse({ canonicalJson: '{"a":1}', sha256: HASH_A })).toEqual(
      { canonicalJson: '{"a":1}', sha256: HASH_A },
    );
    expect(() =>
      CanonicalJsonDigestV1Schema.parse({ canonicalJson: '{ "a": 1 }', sha256: HASH_A }),
    ).toThrow();
    expect(() =>
      CanonicalJsonDigestV1Schema.parse({ canonicalJson: '{"b":1,"a":2}', sha256: HASH_A }),
    ).toThrow();
  });

  it('rejects unsorted/duplicate root entries and validates child subsets against the parent', () => {
    const root = makeSnapshot(TOOL_DEFINITIONS, null);
    expect(() =>
      CapabilityCatalogSnapshotV1Schema.parse({
        ...root,
        tools: [root.tools[1], root.tools[0], ...root.tools.slice(2)],
      }),
    ).toThrow();

    const child = makeSnapshot(TOOL_DEFINITIONS.slice(0, 2), root.catalogHash);
    expect(() => assertCapabilityCatalogLineage(root, child)).not.toThrow();
    const restrictedParent = makeSnapshot(TOOL_DEFINITIONS.slice(1), HASH_A);
    const nonSubset = makeSnapshot(TOOL_DEFINITIONS.slice(0, 2), restrictedParent.catalogHash);
    expect(() => assertCapabilityCatalogLineage(restrictedParent, nonSubset)).toThrow();
  });

  it('uses one immutable full Skill document and the skill.load provenance/trust enums', () => {
    const skill = {
      skillId: 'skill.continuity',
      name: 'Continuity review',
      description: 'Review visible continuity evidence.',
      version: '1.0.0',
      contentHash: HASH_A,
      provenance: 'installed' as const,
      trust: 'reviewed' as const,
      content: 'Compare visible production facts and cite every finding.',
      createdAt: NOW,
    };
    expect(SkillDocumentSchema.parse(skill)).toEqual(skill);
    expect(() => SkillDocumentSchema.parse({ ...skill, provenance: 'user' })).toThrow();
    expect(() => SkillDocumentSchema.parse({ ...skill, trust: 'untrusted' })).toThrow();
  });

  it('resolves the generated capability catalog binding to a real exported parser', () => {
    const binding = SCHEMA_BINDINGS_V1.find(
      ([column]) => column === 'capability_catalog_snapshots.catalog_v1_json',
    );
    expect(binding?.[1]).toBe('CapabilityCatalogSnapshotV1');
    expect(targetContracts.CapabilityCatalogSnapshotV1).toBe(CapabilityCatalogSnapshotV1Schema);
  });
});
