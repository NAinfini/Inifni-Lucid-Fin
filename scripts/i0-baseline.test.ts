import { createHash } from 'node:crypto';
import { readdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  canonicalJson,
  checkInventory,
  inventoryHashes,
  REQUIRED_CONTRACT_PATHS,
  writeSyntheticFixtures,
  type BaselineInventory,
  type BaselineManifest,
} from './i0-baseline.js';

function fixtureInventory(): BaselineInventory {
  return {
    contracts: REQUIRED_CONTRACT_PATHS.map((contractPath, index) => ({
      path: contractPath,
      sha256: `hash-${index}`,
    })),
    schema: [{ kind: 'table', name: 'example', columns: ['id'], sources: ['schema.ts'] }],
    tools: [],
    excludedTools: [],
    modelTools: [],
    channels: [],
    routes: [],
    localStorage: [],
  };
}

function fixtureManifest(): BaselineManifest {
  const inventory = fixtureInventory();
  return {
    version: 1,
    contracts: REQUIRED_CONTRACT_PATHS.map((contractPath, index) => ({
      path: contractPath,
      sha256: `hash-${index}`,
    })),
    inventoryHashes: inventoryHashes(inventory),
    schemaObjects: [
      { id: 'example-table', kind: 'table', name: 'example', disposition: 'target:Example' },
    ],
    columns: [
      {
        table: 'example',
        default: { id: 'example-column', disposition: 'target:Example' },
        overrides: [],
      },
    ],
    tools: [],
    modelTools: [],
    channels: [],
    routes: [],
    localStorage: [],
  };
}

describe('i0-baseline', () => {
  it('uses locale-independent code-point ordering for canonical JSON', () => {
    expect(canonicalJson({ z: 4, a: 3, _: 2, Z: 1 })).toBe('{"Z":1,"_":2,"a":3,"z":4}');
  });

  it('fails when a frozen contract drifts', () => {
    const inventory = fixtureInventory();
    inventory.contracts[0] = { ...inventory.contracts[0]!, sha256: 'changed' };

    expect(checkInventory(inventory, fixtureManifest())).toContain(
      `contract drift: ${REQUIRED_CONTRACT_PATHS[0]}`,
    );
  });

  it('fails unknown and duplicate dispositions', () => {
    const manifest = fixtureManifest();
    manifest.schemaObjects.push({
      id: 'example-table-again',
      kind: 'table',
      name: 'example',
      disposition: 'target:AnotherExample',
    });
    const duplicateErrors = checkInventory(fixtureInventory(), manifest);
    expect(duplicateErrors).toContain('schema table:example has 2 disposition rules');

    const unknownManifest = fixtureManifest();
    unknownManifest.schemaObjects = [];
    const unknownErrors = checkInventory(fixtureInventory(), unknownManifest);
    expect(unknownErrors).toContain('schema table:example has no disposition rule');
  });

  it('rejects wildcards and new frozen catalog members', () => {
    const wildcardManifest = fixtureManifest();
    wildcardManifest.schemaObjects[0]!.name = '*';
    expect(checkInventory(fixtureInventory(), wildcardManifest)).toContain(
      'schema disposition example-table must not use wildcard',
    );

    const inventory = fixtureInventory();
    inventory.tools.push({ name: 'new-tool', sources: ['new-tool.ts'] });
    inventory.channels.push({
      name: 'new:channel',
      channelKind: 'invoke',
      sources: ['new-channel.ts'],
    });
    inventory.schema.push({
      kind: 'index',
      name: 'new_index',
      columns: [],
      sources: ['schema.ts'],
    });
    const errors = checkInventory(inventory, fixtureManifest());
    expect(errors).toContain('tool new-tool has no disposition rule');
    expect(errors).toContain('IPC channel new:channel has no disposition rule');
    expect(errors).toContain('schema index:new_index has no disposition rule');
  });

  it('writes deterministic canonical synthetic fixtures', async () => {
    const first = await fsTemp('i0-fixtures-first-');
    const second = await fsTemp('i0-fixtures-second-');
    try {
      const firstResult = await writeSyntheticFixtures(first);
      const secondResult = await writeSyntheticFixtures(second);
      expect(firstResult.files).toEqual(secondResult.files);
      expect(firstResult.manifestSha256).toBe(secondResult.manifestSha256);
      expect(await fixtureContents(firstResult)).toEqual(await fixtureContents(secondResult));
    } finally {
      await rm(first, { recursive: true, force: true });
      await rm(second, { recursive: true, force: true });
    }
  });

  it('keeps fixtures inside the caller-provided directory', async () => {
    const destination = await fsTemp('i0-fixtures-isolated-');
    try {
      const result = await writeSyntheticFixtures(destination);
      expect(path.relative(destination, result.directory).startsWith('..')).toBe(false);
      expect(await readdir(destination)).toEqual(['i0-baseline-fixtures']);
      expect((await readdir(result.directory)).sort()).toEqual(
        result.files.map((file) => file.name).sort(),
      );
      expect(result.files.some((file) => /\.(?:db|sqlite)$/i.test(file.name))).toBe(false);
    } finally {
      await rm(destination, { recursive: true, force: true });
    }
  });

  it('covers all six I0 gates without real paths, credentials, or callable endpoints', async () => {
    const destination = await fsTemp('i0-fixtures-coverage-');
    try {
      const result = await writeSyntheticFixtures(destination);
      const contents = await fixtureContents(result);
      expect(Object.keys(contents)).toEqual([
        'corrupt-drift.json',
        'empty-install.json',
        'missing-media.json',
        'protected-choice.json',
        'provider-unknown.json',
        'representative-legacy-project-canvas.json',
      ]);
      for (const content of Object.values(contents)) {
        expect(content).not.toMatch(/(?:https?:\/\/|file:\/\/|[A-Za-z]:[\\/]|\\\\)/);
        expect(content).not.toMatch(
          /"(?:apiKey|credential|password|secret|accessToken|refreshToken)"/i,
        );
      }

      const fixtures = Object.fromEntries(
        Object.entries(contents).map(([name, content]) => [name, JSON.parse(content) as unknown]),
      );
      expect(
        Object.values(fixtures).map((fixture) => (fixture as { readonly schema?: unknown }).schema),
      ).toEqual(Array.from({ length: 6 }, () => 'lucid-fin.i0-synthetic-fixture/v1'));
      expect(fixtures['representative-legacy-project-canvas.json']).toMatchObject({
        source: {
          databases: {
            main: {
              canvas_nodes: [{ type: 'image' }, { type: 'text' }, { type: 'backdrop' }],
              characters: [{ id: 'character.lead' }],
              commander_sessions: [
                {
                  id: 'chat.demo',
                  messages: [{ role: 'user' }, { role: 'assistant' }],
                },
              ],
              task_lists: [{ status: 'completed' }],
              tasks: [{ status: 'completed' }],
            },
          },
        },
        expected: { projectId: 'canvas.demo', blockingFindings: [] },
      });
      const representative = fixtures['representative-legacy-project-canvas.json'] as {
        source: { cas: { files: Array<{ contentBase64: string; sha256: string }> } };
      };
      const media = representative.source.cas.files[0]!;
      expect(
        createHash('sha256').update(Buffer.from(media.contentBase64, 'base64')).digest('hex'),
      ).toBe(media.sha256);
      expect(fixtures['missing-media.json']).toMatchObject({
        source: { cas: { files: [] } },
        expected: { blockerCode: 'missing_media_blob_bytes', sourceRemainsUnchanged: true },
      });
      expect(fixtures['provider-unknown.json']).toMatchObject({
        source: {
          taskAttempts: [{ status: 'submitting', provider_job_id: null, provider_receipt: null }],
        },
        expected: { operationState: 'unknown', automaticRetryAllowed: false },
      });
      expect(fixtures['protected-choice.json']).toMatchObject({
        source: { userChoice: { actor: 'user' }, protection: { protected: true } },
        expected: { confirmationMode: 'exact_protected', mutationBeforeConfirmation: false },
      });
      expect(fixtures['corrupt-drift.json']).toMatchObject({
        source: {
          schemaDrift: expect.any(Object),
          foreignKeyViolation: expect.any(Object),
          mediaHashMismatch: expect.any(Object),
          sequenceGap: expect.any(Object),
        },
        expected: { stopBeforeWrites: true, sourceRemainsUnchanged: true },
      });
    } finally {
      await rm(destination, { recursive: true, force: true });
    }
  });
});

async function fixtureContents(
  result: Awaited<ReturnType<typeof writeSyntheticFixtures>>,
): Promise<Record<string, string>> {
  return Object.fromEntries(
    await Promise.all(
      result.files.map(async ({ name }) => [
        name,
        await readFile(path.join(result.directory, name), 'utf8'),
      ]),
    ),
  );
}

async function fsTemp(prefix: string): Promise<string> {
  const { mkdtemp } = await import('node:fs/promises');
  return mkdtemp(path.join(os.tmpdir(), prefix));
}
