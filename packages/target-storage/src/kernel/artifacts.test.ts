import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadCanonicalBuiltInSkillPack, loadCanonicalSchemaArtifacts } from './artifacts.js';

const disposablePaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    disposablePaths.splice(0).map((path) => rm(path, { force: true, recursive: true })),
  );
});

describe('canonical schema artifacts', () => {
  it('verifies the canonical DDL and schema bindings against the manifest', async () => {
    const artifacts = await loadCanonicalSchemaArtifacts();

    expect(artifacts.version).toBe(1);
    expect(artifacts.ddlSha256).toBe(createHash('sha256').update(artifacts.ddl).digest('hex'));
    expect(artifacts.schemaBindings.length).toBeGreaterThan(0);
    expect(new Set(artifacts.schemaBindings.map(({ column }) => column)).size).toBe(
      artifacts.schemaBindings.length,
    );
  });

  it('loads every manifest-bound built-in Skill with unique identities', async () => {
    const pack = await loadCanonicalBuiltInSkillPack();

    expect(pack.version).toBe(1);
    expect(pack.artifactSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(pack.skills).toHaveLength(287);
    expect(new Set(pack.skills.map(({ skillId, version }) => `${skillId}\0${version}`)).size).toBe(
      pack.skills.length,
    );
    expect(pack.skills.filter(({ trust }) => trust === 'trusted')).toHaveLength(252);
    expect(pack.skills.filter(({ trust }) => trust === 'unreviewed')).toHaveLength(35);
    expect(pack.skills.every(({ provenance }) => provenance === 'built_in')).toBe(true);
  });

  it('rejects a DDL whose bytes no longer match the canonical manifest', async () => {
    const sourceRoot = new URL('../../../target-contracts/', import.meta.url);
    const artifactRoot = await mkdtemp(join(tmpdir(), 'lucid-fin-artifact-mismatch-'));
    disposablePaths.push(artifactRoot);
    await mkdir(join(artifactRoot, 'ddl'));
    await mkdir(join(artifactRoot, 'generated'));

    const [ddl, manifest, bindings] = await Promise.all([
      readFile(new URL('ddl/project-v1.sql', sourceRoot), 'utf8'),
      readFile(new URL('generated/manifest.v1.json', sourceRoot)),
      readFile(new URL('generated/schema-bindings.v1.json', sourceRoot)),
    ]);
    await Promise.all([
      writeFile(join(artifactRoot, 'ddl', 'project-v1.sql'), `${ddl}\n-- drift`),
      writeFile(join(artifactRoot, 'generated', 'manifest.v1.json'), manifest),
      writeFile(join(artifactRoot, 'generated', 'schema-bindings.v1.json'), bindings),
    ]);

    await expect(loadCanonicalSchemaArtifacts(artifactRoot)).rejects.toMatchObject({
      code: 'SCHEMA_ARTIFACT_HASH_MISMATCH',
    });
  });

  it('rejects a built-in Skill pack whose bytes no longer match the canonical manifest', async () => {
    const sourceRoot = new URL('../../../target-contracts/', import.meta.url);
    const artifactRoot = await mkdtemp(join(tmpdir(), 'lucid-fin-skill-pack-mismatch-'));
    disposablePaths.push(artifactRoot);
    await mkdir(join(artifactRoot, 'generated'));

    const [manifest, skills] = await Promise.all([
      readFile(new URL('generated/manifest.v1.json', sourceRoot)),
      readFile(new URL('generated/built-in-skills.v1.json', sourceRoot), 'utf8'),
    ]);
    await Promise.all([
      writeFile(join(artifactRoot, 'generated', 'manifest.v1.json'), manifest),
      writeFile(join(artifactRoot, 'generated', 'built-in-skills.v1.json'), `${skills}\n`),
    ]);

    await expect(loadCanonicalBuiltInSkillPack(artifactRoot)).rejects.toMatchObject({
      code: 'SCHEMA_ARTIFACT_HASH_MISMATCH',
    });
  });
});
