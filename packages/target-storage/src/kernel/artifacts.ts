import {
  SkillDocumentSchema,
  parseCanonical,
  type SkillDocument,
  z,
} from '@lucid-fin/target-contracts';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TargetStorageError } from './errors.js';

const canonicalContractsRoot = new URL('../../../target-contracts/', import.meta.url);
const sha256Pattern = /^[0-9a-f]{64}$/;

export interface SchemaBinding {
  readonly column: string;
  readonly schema: string;
}

export interface CanonicalSchemaArtifacts {
  readonly version: 1;
  readonly ddl: string;
  readonly ddlSha256: string;
  readonly schemaBindings: readonly SchemaBinding[];
  readonly schemaBindingsSha256: string;
}

export interface CanonicalBuiltInSkillPack {
  readonly version: 1;
  readonly artifactSha256: string;
  readonly skills: readonly SkillDocument[];
}

interface ManifestV1 {
  readonly version: 1;
  readonly parserPolicyVersion: 'strict-json-v1';
  readonly artifacts: Readonly<Record<string, string>>;
}

interface SchemaBindingsV1 {
  readonly version: 1;
  readonly parserPolicyVersion: 'strict-json-v1';
  readonly bindings: readonly SchemaBinding[];
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalidArtifact(message: string, cause?: unknown): TargetStorageError {
  return new TargetStorageError('SCHEMA_ARTIFACT_INVALID', message, { cause });
}

function parseManifest(bytes: Uint8Array): ManifestV1 {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(bytes).toString('utf8'));
  } catch (cause) {
    throw invalidArtifact('Canonical schema manifest is not valid JSON', cause);
  }
  if (
    !isRecord(parsed) ||
    parsed.version !== 1 ||
    parsed.parserPolicyVersion !== 'strict-json-v1' ||
    !isRecord(parsed.artifacts)
  ) {
    throw invalidArtifact('Canonical schema manifest does not match manifest v1');
  }
  const manifest = parsed as unknown as ManifestV1;
  for (const artifact of ['project-v1.sql', 'schema-bindings.v1.json'])
    artifactHash(manifest, artifact);
  return manifest;
}

function artifactHash(manifest: ManifestV1, artifact: string): string {
  const hash = manifest.artifacts[artifact];
  if (typeof hash !== 'string' || !sha256Pattern.test(hash)) {
    throw invalidArtifact(`Canonical schema manifest has no valid hash for ${artifact}`);
  }
  return hash;
}

function parseBuiltInSkills(bytes: Uint8Array): readonly SkillDocument[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(bytes).toString('utf8'));
  } catch (cause) {
    throw invalidArtifact('Canonical built-in Skill pack is not valid JSON', cause);
  }
  let skills: readonly SkillDocument[];
  try {
    skills = parseCanonical(z.array(SkillDocumentSchema).min(1).max(100_000), parsed);
  } catch (cause) {
    throw invalidArtifact('Canonical built-in Skill pack is invalid', cause);
  }
  const identities = new Set<string>();
  for (const skill of skills) {
    const identity = `${skill.skillId}\0${skill.version}`;
    if (
      skill.provenance !== 'built_in' ||
      sha256(Buffer.from(skill.content, 'utf8')) !== skill.contentHash ||
      identities.has(identity)
    ) {
      throw invalidArtifact(
        'Canonical built-in Skill pack has invalid provenance, content, or identity',
      );
    }
    identities.add(identity);
  }
  return skills;
}

function parseSchemaBindings(bytes: Uint8Array): SchemaBindingsV1 {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(bytes).toString('utf8'));
  } catch (cause) {
    throw invalidArtifact('Canonical schema bindings are not valid JSON', cause);
  }
  if (
    !isRecord(parsed) ||
    parsed.version !== 1 ||
    parsed.parserPolicyVersion !== 'strict-json-v1' ||
    !Array.isArray(parsed.bindings)
  ) {
    throw invalidArtifact('Canonical schema bindings do not match bindings v1');
  }

  const bindings: SchemaBinding[] = parsed.bindings.map((binding, index) => {
    if (
      !isRecord(binding) ||
      typeof binding.column !== 'string' ||
      binding.column.length === 0 ||
      typeof binding.schema !== 'string' ||
      binding.schema.length === 0
    ) {
      throw invalidArtifact(`Canonical schema binding ${index} is invalid`);
    }
    return Object.freeze({ column: binding.column, schema: binding.schema });
  });
  if (
    bindings.length === 0 ||
    new Set(bindings.map(({ column }) => column)).size !== bindings.length
  ) {
    throw invalidArtifact('Canonical schema bindings must contain unique columns');
  }
  return { version: 1, parserPolicyVersion: 'strict-json-v1', bindings };
}

function rootPath(root: string | URL | undefined): string {
  if (root instanceof URL) return fileURLToPath(root);
  if (root !== undefined) return resolve(root);
  return fileURLToPath(canonicalContractsRoot);
}

function assertHash(name: string, bytes: Uint8Array, expected: string): string {
  const actual = sha256(bytes);
  if (actual !== expected) {
    throw new TargetStorageError(
      'SCHEMA_ARTIFACT_HASH_MISMATCH',
      `Canonical schema artifact ${name} does not match its manifest hash`,
    );
  }
  return actual;
}

export async function loadCanonicalSchemaArtifacts(
  contractsPackageRoot?: string | URL,
): Promise<CanonicalSchemaArtifacts> {
  const root = rootPath(contractsPackageRoot);
  let ddlBytes: Buffer;
  let manifestBytes: Buffer;
  let bindingsBytes: Buffer;
  try {
    [ddlBytes, manifestBytes, bindingsBytes] = await Promise.all([
      readFile(resolve(root, 'ddl/project-v1.sql')),
      readFile(resolve(root, 'generated/manifest.v1.json')),
      readFile(resolve(root, 'generated/schema-bindings.v1.json')),
    ]);
  } catch (cause) {
    throw invalidArtifact('Canonical schema artifacts could not be read', cause);
  }

  const manifest = parseManifest(manifestBytes);
  const bindingsDocument = parseSchemaBindings(bindingsBytes);
  const ddlSha256 = assertHash('project-v1.sql', ddlBytes, manifest.artifacts['project-v1.sql']);
  const schemaBindingsSha256 = assertHash(
    'schema-bindings.v1.json',
    bindingsBytes,
    manifest.artifacts['schema-bindings.v1.json'],
  );

  return Object.freeze({
    version: 1,
    ddl: ddlBytes.toString('utf8'),
    ddlSha256,
    schemaBindings: Object.freeze(bindingsDocument.bindings),
    schemaBindingsSha256,
  });
}

export async function loadCanonicalBuiltInSkillPack(
  contractsPackageRoot?: string | URL,
): Promise<CanonicalBuiltInSkillPack> {
  const root = rootPath(contractsPackageRoot);
  let manifestBytes: Buffer;
  let skillsBytes: Buffer;
  try {
    [manifestBytes, skillsBytes] = await Promise.all([
      readFile(resolve(root, 'generated/manifest.v1.json')),
      readFile(resolve(root, 'generated/built-in-skills.v1.json')),
    ]);
  } catch (cause) {
    throw invalidArtifact('Canonical built-in Skill artifacts could not be read', cause);
  }

  const manifest = parseManifest(manifestBytes);
  const artifactSha256 = assertHash(
    'built-in-skills.v1.json',
    skillsBytes,
    artifactHash(manifest, 'built-in-skills.v1.json'),
  );
  return Object.freeze({
    version: 1,
    artifactSha256,
    skills: parseBuiltInSkills(skillsBytes),
  });
}
