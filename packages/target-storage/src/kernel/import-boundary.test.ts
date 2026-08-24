import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as hostApi from '../host/index.js';
import * as publicApi from './index.js';

const packageRoot = fileURLToPath(new URL('../..', import.meta.url));

async function productionSourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return productionSourceFiles(path);
      return entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')
        ? [path]
        : [];
    }),
  );
  return files.flat();
}

describe('target-storage import boundary', () => {
  it('has exactly one runtime dependency and no legacy or third-party storage imports', async () => {
    const packageJson = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
    };
    expect(packageJson.dependencies).toEqual({
      '@lucid-fin/target-contracts': 'workspace:*',
    });

    const sourceDirectory = join(packageRoot, 'src');
    const sourceFiles = await productionSourceFiles(sourceDirectory);
    const source = (await Promise.all(sourceFiles.map((path) => readFile(path, 'utf8')))).join(
      '\n',
    );
    expect(source).not.toMatch(/better-sqlite3|@lucid-fin\/(?:storage|contracts)(?:['"/])/);
    const imports = [
      ...source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g),
      ...source.matchAll(/\bimport\s+['"]([^'"]+)['"]/g),
      ...source.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]/g),
    ].map((match) => match[1]);
    expect(
      imports.filter(
        (specifier) =>
          !specifier.startsWith('node:') &&
          !specifier.startsWith('.') &&
          specifier !== '@lucid-fin/target-contracts',
      ),
    ).toEqual([]);
  });

  it('does not expose node:sqlite handles or the internal SQL transaction helper', () => {
    expect(Object.keys(publicApi)).not.toContain('DatabaseSync');
    expect(Object.keys(publicApi)).not.toContain('loadCanonicalSchemaArtifacts');
    expect(Object.keys(publicApi)).not.toContain('withImmediateTransaction');
  });

  it('keeps the root and host export graphs exact and has one writer for each core ledger', async () => {
    const packageJson = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8')) as {
      exports: Record<string, unknown>;
    };
    expect(packageJson.exports).toEqual({
      '.': { types: './dist/kernel/index.d.ts', import: './dist/kernel/index.js' },
      './host': { types: './dist/host/index.d.ts', import: './dist/host/index.js' },
    });
    expect(Object.keys(publicApi).sort()).toEqual([
      'MessageSendAcceptanceSeedSchema',
      'PRIVATE_RECOVERY_ALGORITHM',
      'PRIVATE_RECOVERY_AUTHENTICATION_TAG_BYTES',
      'PRIVATE_RECOVERY_KEY_BYTES',
      'PRIVATE_RECOVERY_NONCE_BYTES',
      'TargetStorageError',
      'createAes256GcmPrivateRecoveryCodec',
      'createFilesystemMediaCas',
      'createProjectResultsReadModel',
      'createTargetDataAccess',
      'createTargetStore',
      'isRecoverySafeRuntimeReadTool',
      'isRuntimeReadTool',
      'openTargetStore',
    ]);
    expect(Object.keys(hostApi)).toEqual([
      'createHostCatalogProvisioning',
      'provisionCanonicalBuiltInSkills',
      'createHostInteractionAuthority',
      'createHostConfirmationAuthority',
    ]);
    expect(publicApi).not.toHaveProperty('createHostCatalogProvisioning');
    expect(hostApi).not.toHaveProperty('createTargetDataAccess');

    const sourceFiles = await productionSourceFiles(join(packageRoot, 'src'));
    const sources = await Promise.all(
      sourceFiles.map(async (path) => ({
        path: relative(packageRoot, path).replaceAll('\\', '/'),
        source: await readFile(path, 'utf8'),
      })),
    );
    const writers = (table: string) =>
      sources
        .filter(({ source }) => source.includes(`INSERT INTO ${table}`))
        .map(({ path }) => path)
        .sort();
    expect(writers('dispatch_operations')).toEqual(['src/internal/operation-dispatch.ts']);
    expect(writers('run_resource_entries')).toEqual(['src/internal/run-resource-ledger.ts']);
    expect(writers('run_events')).toEqual(['src/internal/run-journal.ts']);
    expect(writers('run_event_payloads')).toEqual(['src/internal/run-journal.ts']);
    expect(writers('project_events')).toEqual(['src/internal/project-events.ts']);
    expect(writers('project_event_payloads')).toEqual(['src/internal/project-events.ts']);
    expect(writers('private_recovery_envelopes')).toEqual(['src/internal/private-recovery.ts']);

    const composition = await readFile(join(packageRoot, 'src/kernel/data-access.ts'), 'utf8');
    expect(composition.match(/operations:\s*createOperationsAuthority\(/g)).toHaveLength(1);
  });
});
