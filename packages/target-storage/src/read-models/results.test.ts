import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import {
  CapabilityCatalogSnapshotV1Schema,
  canonicalJson,
  generationPromptAssemblyHashInput,
  generationQuoteHashInput,
  providerReceiptHashInput,
  type GenerationQuote,
  type GenerationSpec,
  type MediaPreviewIssueInputV1,
  type ProviderReceipt,
} from '@lucid-fin/target-contracts';
import { describe, expect, it } from 'vitest';
import {
  registerTargetStoreDatabase,
  unregisterTargetStoreDatabase,
} from '../internal/database-access.js';
import { hashCanonical } from '../internal/hashes.js';
import { createTargetDataAccess } from '../kernel/data-access.js';
import type {
  GenerationProviderAdapter,
  GenerationProviderState,
  GenerationProviderQuoteRequest,
} from '../kernel/generation-provider.js';
import type { MediaCas, MediaCasExpectedObject } from '../kernel/media-cas.js';
import type { TargetStore } from '../kernel/store.js';
import { loadProjectMediaRecord } from '../internal/media-records.js';
import { createTargetMediaPreviewSourceResolver } from './media-preview.js';
import { createProjectResultsReadModel } from './results.js';

const NOW = '2026-08-16T12:00:00.000Z';
const rootCatalog = CapabilityCatalogSnapshotV1Schema.parse(
  JSON.parse(
    readFileSync(
      new URL('../../../target-contracts/generated/tool-catalog.v1.json', import.meta.url),
      'utf8',
    ),
  ),
);

function sha256(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function receipt(): ProviderReceipt {
  const value = {
    providerOperationId: 'private-provider-receipt',
    submittedAt: NOW,
    reconciledAt: null,
    receiptHash: '',
  };
  return { ...value, receiptHash: hashCanonical(providerReceiptHashInput(value)) };
}

class FakeProvider implements GenerationProviderAdapter {
  readonly providerKind = 'openai';
  readonly bytes = [
    Buffer.from('private-provider-body-one'),
    Buffer.from('private-provider-body-two'),
  ];

  async quote(request: GenerationProviderQuoteRequest) {
    const withoutHash: GenerationQuote = {
      state: 'known',
      quoteId: 'quote.results',
      quotedRequestHash: request.requestHash,
      currency: 'USD',
      expiresAt: '2026-08-17T12:00:00.000Z',
      providerId: request.profile.id,
      model: request.profile.model.model,
      amount: '2',
      quoteHash: '',
    };
    return {
      quote: {
        ...withoutHash,
        quoteHash: hashCanonical(generationQuoteHashInput(withoutHash)),
      },
      estimatedDurationMs: 1,
      constraints: [],
    };
  }

  async submit(): Promise<GenerationProviderState> {
    return {
      state: 'succeeded',
      receipt: receipt(),
      usage: {
        inputTokens: { state: 'known', value: 0 },
        outputTokens: { state: 'known', value: 0 },
        generatedUnits: { state: 'known', value: 2 },
        cost: { state: 'known', value: '2', currency: 'USD' },
      },
      outputs: this.bytes.map((bytes, variantIndex) => ({
        variantIndex,
        blob: {
          hash: sha256(bytes),
          byteLength: bytes.byteLength,
          mimeType: 'image/png',
          technicalFacts: { kind: 'image' as const, width: 1280, height: 720 },
          publication: {
            state: 'pending' as const,
            bytes: (async function* () {
              yield bytes;
            })(),
          },
        },
        technicalValidation: {
          state: 'valid' as const,
          mimeTypeValid: true,
          dimensionsValid: true,
          durationValid: null,
          failureCode: null,
        },
      })),
    };
  }

  async reconcileByIdempotencyKey(): Promise<GenerationProviderState> {
    throw new Error('unused');
  }

  async cancel(): Promise<GenerationProviderState> {
    throw new Error('unused');
  }
}

class MemoryCas implements MediaCas {
  readonly objects = new Map<string, Uint8Array>();

  async putVerified(expected: MediaCasExpectedObject, source: AsyncIterable<Uint8Array>) {
    const chunks: Uint8Array[] = [];
    for await (const chunk of source) chunks.push(chunk);
    const bytes = Buffer.concat(chunks);
    expect(sha256(bytes)).toBe(expected.hash);
    this.objects.set(expected.hash, bytes);
    return { ...expected, disposition: 'created' as const };
  }

  async stat(hash: string) {
    const bytes = this.objects.get(hash);
    return bytes === undefined ? null : { hash, byteLength: bytes.byteLength };
  }

  async verify(expected: MediaCasExpectedObject) {
    const bytes = this.objects.get(expected.hash);
    if (
      bytes === undefined ||
      bytes.byteLength !== expected.byteLength ||
      sha256(bytes) !== expected.hash
    ) {
      throw new Error('Memory CAS object does not match its expected bytes');
    }
  }

  async *openVerified(expected: MediaCasExpectedObject) {
    await this.verify(expected);
    const bytes = this.objects.get(expected.hash);
    if (bytes === undefined) throw new Error('Memory CAS object is missing');
    yield Uint8Array.from(bytes);
  }
}

async function collectBytes(bytes: AsyncIterable<Uint8Array>): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of bytes) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function memoryStore(): { store: TargetStore; database: DatabaseSync } {
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys = ON');
  database.exec(
    readFileSync(new URL('../../../target-contracts/ddl/project-v1.sql', import.meta.url), 'utf8'),
  );
  const store: TargetStore = {
    databasePath: ':memory:',
    schemaFingerprint: {} as TargetStore['schemaFingerprint'],
    security: { defensive: true, extensionLoading: false, foreignKeys: true },
    close() {
      unregisterTargetStoreDatabase(store);
      database.close();
    },
  };
  registerTargetStoreDatabase(store, database);
  return { store, database };
}

function ids() {
  const values = new Map<string, number>();
  return (kind: string) => {
    const value = (values.get(kind) ?? 0) + 1;
    values.set(kind, value);
    return `${kind}.${value}`;
  };
}

async function harness() {
  const { store, database } = memoryStore();
  const provider = new FakeProvider();
  const mediaCas = new MemoryCas();
  const data = createTargetDataAccess(store, {
    now: () => NOW,
    createId: ids(),
    mediaCas,
    mediaImportCapabilities: {
      async resolve() {
        throw new Error('unused');
      },
    },
    generationProvider: provider,
  });
  const context = {
    actor: 'user' as const,
    causation: { kind: 'direct_ui' as const, actionId: 'action.results.setup' },
    correlationId: 'correlation.results.setup',
  };
  const project = data.projects.create(
    {
      wireVersion: 1,
      kind: 'request',
      requestId: 'request.project.results',
      method: 'project.create',
      input: {
        name: 'Results Film',
        permissionMode: 'reversible',
        budget: {
          costUsd: { state: 'known', value: '20', currency: 'USD' },
          maxGenerationCount: 12,
          maxInputTokens: 100_000,
          maxOutputTokens: 20_000,
        },
        formatPolicy: { aspectRatio: '16:9', customDimensions: null, frameRate: 24 },
      },
    },
    context,
  ).result.project;
  database
    .prepare(
      `INSERT INTO provider_profiles (
         id, display_name, provider_kind, model, reasoning_strength, endpoint_origin,
         credential_handle, status, configuration_v1_json, revision, created_at, updated_at
       ) VALUES ('provider.results', 'Results Provider', 'openai', 'image-model', NULL, NULL,
         NULL, 'ready', '{}', 0, ?, ?)`,
    )
    .run(NOW, NOW);
  const target = data.production.apply(
    {
      wireVersion: 1,
      kind: 'request',
      requestId: 'request.production.results',
      method: 'production.apply',
      input: {
        action: 'create',
        projectId: project.id,
        expectedProjectRevision: project.revision,
        value: {
          objectType: 'shot',
          content: {
            title: 'Opening',
            description: 'Moonlit harbor',
            durationMs: null,
            shotSize: null,
            cameraMovement: null,
          },
        },
        relations: [],
      },
    },
    context,
  ).result.object;
  const chat = data.conversations.createChat(
    {
      wireVersion: 1,
      kind: 'request',
      requestId: 'request.chat.results',
      method: 'chat.create',
      input: { projectId: project.id, title: 'Main' },
    },
    context,
  ).result;
  const run = data.conversations.sendMessage(
    {
      wireVersion: 1,
      kind: 'request',
      requestId: 'request.message.results',
      method: 'message.send',
      input: {
        chatId: chat.id,
        blocks: [{ type: 'text', text: 'Generate two candidates.' }],
        attachments: [],
        selectedContext: [],
        exportDestinationGrant: null,
        supersedesMessageId: null,
      },
    },
    context,
    {
      model: { providerId: 'provider.results', model: 'image-model', reasoningStrength: null },
      locale: 'en-US',
      timeZone: 'America/New_York',
      capabilityCatalog: rootCatalog,
      projectMediaSelections: [],
      citedMemoryEntryIds: [],
    },
  ).result.acceptedRun;
  const spec: GenerationSpec = {
    kind: 'image',
    task: 'create',
    target: {
      authority: 'production',
      id: target.id,
      revision: target.revision,
      contentHash: target.contentHash,
    },
    prompt: 'A cinematic moonlit harbor.',
    negativePrompt: null,
    references: [],
    provider: { providerId: 'provider.results', model: 'image-model' },
    outputCount: 2,
    seed: 7,
    width: 1280,
    height: 720,
    guidanceScale: null,
    sourceMaskRefId: null,
  };
  const quote = await data.generation.quote({ runId: run.id, request: { spec } });
  const commanderContext = {
    actor: 'commander' as const,
    causation: { kind: 'run' as const, runId: run.id },
    correlationId: 'correlation.results',
  };
  const submitted = await data.generation.submit(
    {
      runId: run.id,
      commandId: 'command.results.generate',
      request: {
        spec,
        quote: quote.quote,
        expectedProjectRevision: project.revision,
        promptProvenance: {
          sourceObjectId: target.id,
          sourceRevision: target.revision,
          sourceHash: target.contentHash,
          assemblyHash: hashCanonical(
            generationPromptAssemblyHashInput({
              target: spec.target,
              prompt: spec.prompt,
              negativePrompt: spec.negativePrompt,
              references: spec.references,
              loadedSkillDigests: [],
            }),
          ),
          loadedSkillDigests: [],
        },
        outputIntents: [0, 1].map((variantIndex) => ({
          variantIndex,
          globalAsset: {
            filename: `candidate-${variantIndex}.png`,
            displayName: `Candidate ${variantIndex}`,
            folderId: null,
            tags: [],
          },
          projectMediaRef: {
            label: `Candidate ${variantIndex}`,
            collections: [],
            roles: ['generated_candidate' as const],
            notes: '',
          },
        })),
      },
    },
    commanderContext,
  );
  expect(submitted.state).toBe('succeeded');
  const resultIds = submitted.immediateResults.map(({ resultId }) => resultId);
  const firstRow = database
    .prepare('SELECT content_hash FROM generated_results WHERE id = ?')
    .get(resultIds[0]) as { content_hash: string };
  const assessment = await data.resultAssessments.start(
    {
      runId: run.id,
      commandId: 'command.results.assessment.start',
      request: {
        kind: 'technical_integrity',
        subjects: [
          {
            authority: 'generated_result',
            id: resultIds[0]!,
            revision: 0,
            contentHash: firstRow.content_hash,
          },
        ],
        checks: ['readable'],
        provider: null,
      },
    },
    commanderContext,
  );
  await data.resultAssessments.executeLocal(
    {
      operation: assessment.operation,
      expectedRevision: assessment.operation.revision,
      commandId: 'command.results.assessment.execute',
    },
    commanderContext,
  );
  return {
    store,
    database,
    data,
    project,
    target,
    run,
    resultIds,
    assessmentId: assessment.assessmentId,
    mediaCas,
  };
}

const allIncludes = ['artifact', 'prompt', 'references', 'provider', 'assessments'] as const;

describe('I2-H0 Project results read model', () => {
  it('uses project-scoped filters, stable filter-bound cursors, and byte-equivalent reopen reads', async () => {
    const fixture = await harness();
    try {
      const results = createProjectResultsReadModel(fixture.store);
      const first = results.query(fixture.project.id, {
        resultIds: [],
        requestIds: [],
        targetRefs: [],
        include: [...allIncludes],
        page: { cursor: null, limit: 1 },
      });
      expect(first.items).toHaveLength(1);
      expect(first.nextCursor).not.toBeNull();
      expect(first.items[0]).toMatchObject({
        targetRef: {
          authority: 'production',
          id: fixture.target.id,
          revision: fixture.target.revision,
          contentHash: fixture.target.contentHash,
        },
        assessmentIds: [fixture.assessmentId],
      });
      const second = results.query(fixture.project.id, {
        resultIds: [],
        requestIds: [],
        targetRefs: [],
        include: [...allIncludes],
        page: { cursor: first.nextCursor, limit: 1 },
      });
      expect(second.items).toHaveLength(1);
      expect(second.items[0]!.resultRef.id).not.toBe(first.items[0]!.resultRef.id);
      expect(second.nextCursor).toBeNull();

      const filtered = results.query(fixture.project.id, {
        resultIds: [second.items[0]!.resultRef.id],
        requestIds: [second.items[0]!.requestId],
        targetRefs: [second.items[0]!.targetRef],
        include: [],
        page: { cursor: null, limit: 10 },
      });
      expect(filtered.items).toHaveLength(1);
      expect(filtered.items[0]).toMatchObject({
        artifact: null,
        submittedPrompt: null,
        referenceBindings: null,
        provider: null,
        assessmentIds: null,
      });
      expect(() =>
        results.query(fixture.project.id, {
          resultIds: [second.items[0]!.resultRef.id],
          requestIds: [],
          targetRefs: [],
          include: [...allIncludes],
          page: { cursor: first.nextCursor, limit: 1 },
        }),
      ).toThrow(/cursor belongs to another query/i);

      const reopened = createProjectResultsReadModel(fixture.store).query(fixture.project.id, {
        resultIds: [],
        requestIds: [],
        targetRefs: [],
        include: [...allIncludes],
        page: { cursor: null, limit: 100 },
      });
      const complete = { items: [...first.items, ...second.items], nextCursor: null };
      expect(canonicalJson(reopened)).toBe(canonicalJson(complete));
    } finally {
      fixture.store.close();
    }
  });

  it('fails closed on result, request-target, and search association tampering', async () => {
    const fixture = await harness();
    try {
      const results = createProjectResultsReadModel(fixture.store);
      const query = () =>
        results.query(fixture.project.id, {
          resultIds: [],
          requestIds: [],
          targetRefs: [],
          include: [...allIncludes],
          page: { cursor: null, limit: 100 },
        });
      const tamper = (sql: string) => {
        fixture.database.exec('BEGIN');
        try {
          fixture.database.exec(sql);
          expect(query).toThrow();
        } finally {
          fixture.database.exec('ROLLBACK');
        }
      };
      tamper(
        `UPDATE generated_results SET content_hash = '${'f'.repeat(64)}' WHERE id = '${fixture.resultIds[0]}'`,
      );
      tamper(`UPDATE generation_requests SET target_hash = '${'e'.repeat(64)}'`);
      tamper(
        `UPDATE project_search_documents SET source_hash = '${'d'.repeat(64)}' WHERE source_kind = 'generated_result'`,
      );
    } finally {
      fixture.store.close();
    }
  });

  it('returns only the frozen safe projection and no receipt, body, path, bytes, or SQL row fields', async () => {
    const fixture = await harness();
    try {
      const result = fixture.data.results.query(fixture.project.id, {
        resultIds: [],
        requestIds: [],
        targetRefs: [],
        include: [...allIncludes],
        page: { cursor: null, limit: 100 },
      });
      const publicJson = canonicalJson(result);
      expect(publicJson).not.toContain('private-provider-receipt');
      expect(publicJson).not.toContain('private-provider-body');
      expect(publicJson).not.toMatch(
        /databasePath|receipt|blobHash|_v1_json|content_text|credential/i,
      );
    } finally {
      fixture.store.close();
    }
  });

  it('resolves only current project-bound Project Media and generated artifact references', async () => {
    const fixture = await harness();
    try {
      const result = fixture.data.results.query(fixture.project.id, {
        resultIds: [],
        requestIds: [],
        targetRefs: [],
        include: ['artifact'],
        page: { cursor: null, limit: 1 },
      }).items[0]!;
      expect(result.artifact).not.toBeNull();
      const generatedInput = {
        projectId: fixture.project.id,
        source: {
          kind: 'generated_result' as const,
          result: result.resultRef,
          artifact: result.artifact!,
        },
      } satisfies MediaPreviewIssueInputV1;
      const projectMediaRow = fixture.database
        .prepare('SELECT project_media_ref_id FROM generated_results WHERE id = ?')
        .get(result.resultRef.id) as { project_media_ref_id: string };
      const projectMedia = loadProjectMediaRecord(
        fixture.database,
        projectMediaRow.project_media_ref_id,
      );
      const projectMediaInput = {
        projectId: fixture.project.id,
        source: {
          kind: 'project_media_ref' as const,
          ref: {
            authority: 'project_media_ref' as const,
            id: projectMedia.id,
            revision: projectMedia.revision,
            contentHash: projectMedia.contentHash,
          },
        },
      } satisfies MediaPreviewIssueInputV1;
      const resolver = createTargetMediaPreviewSourceResolver(fixture.store, fixture.mediaCas);
      const generated = resolver.resolve(generatedInput);
      const projectSource = resolver.resolve(projectMediaInput);
      const expected = fixture.mediaCas.objects.get(result.artifact!.contentHash)!;

      expect(Object.keys(generated).sort()).toEqual([
        'byteLength',
        'kind',
        'mimeType',
        'open',
        'verify',
      ]);
      expect(generated).toMatchObject({
        kind: 'image',
        mimeType: 'image/png',
        byteLength: expected.byteLength,
      });
      await expect(collectBytes(generated.open({ start: 1, end: 4 }))).resolves.toEqual(
        expected.subarray(1, 5),
      );
      await expect(collectBytes(projectSource.open({ start: 1, end: 4 }))).resolves.toEqual(
        expected.subarray(1, 5),
      );

      fixture.database
        .prepare(
          `INSERT INTO projects (
             id, name, lifecycle, schema_revision, revision, content_hash, created_by_kind,
             created_by_id, created_at, updated_at, archived_at, deleted_at
           ) VALUES ('project.results.other', 'Other', 'active', 0, 0, ?, 'direct_ui', ?, ?, ?, NULL, NULL)`,
        )
        .run('b'.repeat(64), 'action.results.other', NOW, NOW);
      expect(() =>
        resolver.resolve({ ...projectMediaInput, projectId: 'project.results.other' }),
      ).toThrow(/not found/i);
      expect(() =>
        resolver.resolve({
          ...projectMediaInput,
          source: {
            ...projectMediaInput.source,
            ref: { ...projectMediaInput.source.ref, contentHash: 'c'.repeat(64) },
          },
        }),
      ).toThrow(/not found/i);
      expect(() =>
        resolver.resolve({ ...generatedInput, projectId: 'project.results.other' }),
      ).toThrow(/not found/i);
      expect(() =>
        resolver.resolve({
          ...generatedInput,
          source: {
            ...generatedInput.source,
            result: { ...generatedInput.source.result, contentHash: 'c'.repeat(64) },
          },
        }),
      ).toThrow(/not found/i);
      expect(() =>
        resolver.resolve({
          ...generatedInput,
          source: {
            ...generatedInput.source,
            artifact: { ...generatedInput.source.artifact, contentHash: 'd'.repeat(64) },
          },
        }),
      ).toThrow(/not found/i);

      fixture.mediaCas.objects.set(result.artifact!.contentHash, Buffer.from('corrupt bytes'));
      await expect(collectBytes(generated.open({ start: 0, end: 3 }))).rejects.toThrow(
        /does not match/i,
      );
    } finally {
      fixture.store.close();
    }
  });
});
