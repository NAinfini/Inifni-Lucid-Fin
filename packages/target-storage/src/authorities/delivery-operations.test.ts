import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import {
  CapabilityCatalogSnapshotV1Schema,
  DeliveryManifestSchema,
  canonicalJson,
  deliveryManifestContentHashInput,
} from '@lucid-fin/target-contracts';
import { describe, expect, it } from 'vitest';
import {
  registerTargetStoreDatabase,
  unregisterTargetStoreDatabase,
} from '../internal/database-access.js';
import { hashCanonical } from '../internal/hashes.js';
import { loadBoundOperation, resolveOperationDispatchKey } from '../internal/operation-dispatch.js';
import { operationRefForOwner } from '../internal/operation-owner-records.js';
import { createTargetDataAccess } from '../kernel/data-access.js';
import {
  assertDeliveryExportModelBoundary,
  deliveryExportConfirmationTargetFor,
  deliveryExportSuccessForDispatch,
} from './delivery-operations.js';
import type {
  DeliveryDestinationGrantResolver,
  LocalDeliveryExporterAdapter,
  ResolveDeliveryDestinationGrantRequest,
} from '../kernel/local-delivery-exporter.js';
import type { LocalReviewRendererAdapter } from '../kernel/local-review-renderer.js';
import type { MediaCas, MediaImportCapabilityResolver } from '../kernel/media-cas.js';
import type { TargetStore } from '../kernel/store.js';

const NOW = '2026-08-16T12:00:00.000Z';
const SECRET = 'raw-local-secret-sentinel';
const rootCatalog = CapabilityCatalogSnapshotV1Schema.parse(
  JSON.parse(
    readFileSync(
      new URL('../../../target-contracts/generated/tool-catalog.v1.json', import.meta.url),
      'utf8',
    ),
  ),
);
const budget = {
  costUsd: { state: 'known' as const, value: '20', currency: 'USD' },
  maxGenerationCount: 12,
  maxInputTokens: 100_000,
  maxOutputTokens: 20_000,
};
const context = {
  actor: 'commander' as const,
  causation: { kind: 'run' as const, runId: '' },
  correlationId: 'correlation.delivery-operations',
};

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function bytes(value: string): AsyncIterable<Uint8Array> {
  return {
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(value);
    },
  };
}

class MemoryCas implements MediaCas {
  readonly objects = new Map<string, Uint8Array>();

  async putVerified(
    expected: { hash: string; byteLength: number },
    source: AsyncIterable<Uint8Array>,
  ) {
    const chunks: Uint8Array[] = [];
    for await (const chunk of source) chunks.push(chunk);
    const value = Buffer.concat(chunks);
    if (sha256(value) !== expected.hash || value.byteLength !== expected.byteLength) {
      throw new Error('CAS object mismatch');
    }
    const existing = this.objects.get(expected.hash);
    if (existing !== undefined && !Buffer.from(existing).equals(value)) {
      throw new Error('CAS collision');
    }
    const disposition = existing === undefined ? 'created' : 'existing';
    this.objects.set(expected.hash, value);
    return { ...expected, disposition } as const;
  }

  async stat(hash: string) {
    const value = this.objects.get(hash);
    return value === undefined ? null : { hash, byteLength: value.byteLength };
  }

  async verify(expected: { hash: string; byteLength: number }) {
    const value = this.objects.get(expected.hash);
    if (
      value === undefined ||
      value.byteLength !== expected.byteLength ||
      sha256(value) !== expected.hash
    ) {
      throw new Error('CAS verification failed');
    }
  }

  openVerified(expected: { hash: string; byteLength: number }) {
    const objects = this.objects;
    const verify = (value: { hash: string; byteLength: number }) => this.verify(value);
    return {
      async *[Symbol.asyncIterator]() {
        await verify(expected);
        yield Uint8Array.from(objects.get(expected.hash)!);
      },
    };
  }
}

function localOutput(value: string) {
  const valueBytes = Buffer.from(value);
  return {
    blob: {
      hash: sha256(valueBytes),
      byteLength: valueBytes.byteLength,
      mimeType: 'video/mp4',
      technicalFacts: {
        kind: 'video' as const,
        width: 1_920,
        height: 1_080,
        durationMs: 1_000,
        frameRate: 24,
        hasAudio: true,
      },
      bytes: bytes(value),
    },
  };
}

class FakeReviewRenderer implements LocalReviewRendererAdapter {
  readonly calls: Array<Parameters<LocalReviewRendererAdapter['render']>[0]> = [];
  readonly jobs = new Set<string>();
  cancelCalls = 0;
  fail = false;
  cancelCompletes = false;
  onCall: (() => void) | undefined;

  async render(request: Parameters<LocalReviewRendererAdapter['render']>[0]) {
    this.calls.push(request);
    this.jobs.add(request.idempotencyKey);
    this.onCall?.();
    if (this.fail) throw new Error(`${SECRET}: renderer failed`);
    return localOutput('review-cut-bytes');
  }

  async cancel() {
    this.cancelCalls += 1;
    return this.cancelCompletes
      ? ({ state: 'succeeded', output: localOutput('review-cut-bytes') } as const)
      : ({ state: 'cancelled' } as const);
  }
}

class FakeExporter implements LocalDeliveryExporterAdapter {
  readonly calls: Array<Parameters<LocalDeliveryExporterAdapter['export']>[0]> = [];
  readonly jobs = new Set<string>();
  cancelCalls = 0;
  fail = false;
  onCall: (() => void) | undefined;

  async export(request: Parameters<LocalDeliveryExporterAdapter['export']>[0]) {
    this.calls.push(request);
    this.jobs.add(request.idempotencyKey);
    this.onCall?.();
    if (this.fail) throw new Error(`${SECRET}: export failed`);
    const output = localOutput('delivery-export-bytes');
    return { ...output, outputContentHash: output.blob.hash };
  }

  async cancel() {
    this.cancelCalls += 1;
    return { state: 'cancelled' } as const;
  }
}

class FakeDestinationResolver implements DeliveryDestinationGrantResolver {
  readonly calls: ResolveDeliveryDestinationGrantRequest[] = [];
  onCall: (() => void) | undefined;
  tamper = false;

  async resolve(request: ResolveDeliveryDestinationGrantRequest) {
    this.calls.push(request);
    this.onCall?.();
    return {
      descriptor: this.tamper
        ? { ...request.descriptor, displayLabel: 'different.mp4' }
        : request.descriptor,
      writableGrant: { secret: SECRET },
    };
  }
}

const unusedCapabilities: MediaImportCapabilityResolver = {
  async resolve() {
    throw new Error('unused');
  },
};

function memoryStore(): { store: TargetStore; database: DatabaseSync } {
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys = ON');
  database.exec(
    readFileSync(new URL('../../../target-contracts/ddl/project-v1.sql', import.meta.url), 'utf8'),
  );
  let open = true;
  const store: TargetStore = {
    databasePath: ':memory:',
    schemaFingerprint: {} as TargetStore['schemaFingerprint'],
    security: { defensive: true, extensionLoading: false, foreignKeys: true },
    close() {
      if (!open) return;
      open = false;
      unregisterTargetStoreDatabase(store);
      database.close();
    },
  };
  registerTargetStoreDatabase(store, database);
  return { store, database };
}

function deterministicIds() {
  const counts = new Map<string, number>();
  return (kind: string) => {
    const next = (counts.get(kind) ?? 0) + 1;
    counts.set(kind, next);
    return `${kind}.${next}`;
  };
}

async function harness() {
  const { store, database } = memoryStore();
  const mediaCas = new MemoryCas();
  const reviewRenderer = new FakeReviewRenderer();
  const deliveryExporter = new FakeExporter();
  const destinationGrants = new FakeDestinationResolver();
  const data = createTargetDataAccess(store, {
    now: () => NOW,
    createId: deterministicIds(),
    mediaCas,
    mediaImportCapabilities: unusedCapabilities,
    generationProvider: {} as never,
    resultAssessmentProvider: {} as never,
    reviewRenderer,
    deliveryExporter,
    deliveryDestinationGrants: destinationGrants,
  });
  const userContext = {
    actor: 'user' as const,
    causation: { kind: 'direct_ui' as const, actionId: 'action.delivery-operations' },
    correlationId: 'correlation.delivery-operations.setup',
  };
  const project = data.projects.create(
    {
      wireVersion: 1,
      kind: 'request',
      requestId: 'request.project.delivery-operations',
      method: 'project.create',
      input: {
        name: 'Local Delivery Film',
        permissionMode: 'reversible',
        budget,
        formatPolicy: { aspectRatio: '16:9', customDimensions: null, frameRate: 24 },
      },
    },
    userContext,
  ).result.project;
  database
    .prepare(
      `INSERT INTO provider_profiles (
         id, display_name, provider_kind, model, reasoning_strength, endpoint_origin,
         credential_handle, status, configuration_v1_json, revision, created_at, updated_at
       ) VALUES ('provider.delivery-operations', 'Provider', 'openai', 'video-model', NULL,
         NULL, NULL, 'ready', '{}', 0, ?, ?)`,
    )
    .run(NOW, NOW);
  const chat = data.conversations.createChat(
    {
      wireVersion: 1,
      kind: 'request',
      requestId: 'request.chat.delivery-operations',
      method: 'chat.create',
      input: { projectId: project.id, title: 'Main' },
    },
    userContext,
  ).result;
  const run = data.conversations.sendMessage(
    {
      wireVersion: 1,
      kind: 'request',
      requestId: 'request.message.delivery-operations',
      method: 'message.send',
      input: {
        chatId: chat.id,
        blocks: [{ type: 'text', text: 'Render and export this cut.' }],
        attachments: [],
        selectedContext: [],
        exportDestinationGrant: null,
        supersedesMessageId: null,
      },
    },
    userContext,
    {
      model: {
        providerId: 'provider.delivery-operations',
        model: 'video-model',
        reasoningStrength: null,
      },
      locale: 'en-US',
      timeZone: 'America/New_York',
      capabilityCatalog: rootCatalog,
      projectMediaSelections: [],
      citedMemoryEntryIds: [],
    },
  ).result.acceptedRun;
  const formatIntent = {
    container: 'mp4' as const,
    videoCodec: 'h264' as const,
    audioCodec: 'aac' as const,
    width: 1_920,
    height: 1_080,
    frameRate: 24,
    quality: 'review' as const,
  };
  const plan = {
    authority: 'delivery' as const,
    id: 'delivery.local.1',
    revision: 4,
    contentHash: hashCanonical({ delivery: 'delivery.local.1', revision: 4 }),
  };
  const withoutHash = {
    authority: 'delivery_manifest' as const,
    id: 'delivery.manifest.local.1',
    projectId: project.id,
    revision: 0 as const,
    contentHash: '',
    sourcePlan: plan,
    formatIntent,
    items: [],
    currentChoices: [],
    protections: [],
    createdBy: { kind: 'run' as const, runId: run.id },
    frozenAt: NOW,
  };
  const manifest = DeliveryManifestSchema.parse({
    ...withoutHash,
    contentHash: hashCanonical(deliveryManifestContentHashInput(withoutHash)),
  });
  database
    .prepare(
      `INSERT INTO delivery_plans (
         id, project_id, revision, content_hash, name, lifecycle,
         format_intent_v1_json, created_at, updated_at
       ) VALUES (?, ?, ?, ?, 'Local cut', 'active', ?, ?, ?)`,
    )
    .run(
      plan.id,
      project.id,
      plan.revision,
      plan.contentHash,
      canonicalJson(formatIntent),
      NOW,
      NOW,
    );
  database
    .prepare(
      `INSERT INTO delivery_manifests (
         id, project_id, delivery_plan_id, delivery_revision, delivery_content_hash,
         revision, content_hash, format_intent_v1_json, created_by_v1_json, frozen_at
       ) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
    )
    .run(
      manifest.id,
      manifest.projectId,
      plan.id,
      plan.revision,
      plan.contentHash,
      manifest.contentHash,
      canonicalJson(formatIntent),
      canonicalJson(manifest.createdBy),
      NOW,
    );
  return {
    store,
    database,
    data,
    project,
    run,
    plan,
    manifest,
    mediaCas,
    reviewRenderer,
    deliveryExporter,
    destinationGrants,
    context: { ...context, causation: { kind: 'run' as const, runId: run.id } },
  };
}

type Fixture = Awaited<ReturnType<typeof harness>>;

function previewInput(fixture: Fixture) {
  return {
    runId: fixture.run.id,
    commandId: 'command.delivery.preview',
    request: { plan: fixture.plan, range: { startItem: 0, endItem: 0 } },
  };
}

function exportRequest(fixture: Fixture) {
  return {
    manifest: {
      authority: 'delivery_manifest' as const,
      id: fixture.manifest.id,
      revision: 0 as const,
      contentHash: fixture.manifest.contentHash,
    },
    destination: {
      kind: 'user_selected_file' as const,
      grantId: 'destination.grant.1',
      grantHash: hashCanonical({ destination: 'destination.grant.1' }),
      displayLabel: 'final-review.mp4',
    },
    overwriteExisting: false,
  };
}

function approveExport(
  fixture: Fixture,
  request: ReturnType<typeof exportRequest>,
  suffix = 'default',
): string {
  const key = resolveOperationDispatchKey(fixture.database, {
    runId: fixture.run.id,
    toolId: 'delivery.export',
    input: request,
  });
  const confirmationId = `confirmation.delivery.export.${suffix}`;
  const interactionId = `interaction.delivery.export.${suffix}`;
  const objectiveMessageId = (
    fixture.database
      .prepare('SELECT objective_message_id FROM runs WHERE id = ?')
      .get(fixture.run.id) as { objective_message_id: string }
  ).objective_message_id;
  fixture.database
    .prepare(
      `INSERT INTO run_interactions (
         id, run_id, kind, prompt, options_v1_json, context_refs_v1_json,
         allow_free_text, state, answer_message_id, created_at, resolved_at
       ) VALUES (?, ?, 'confirmation', 'Approve export?', '[]', '[]', 0,
         'answered', ?, ?, ?)`,
    )
    .run(interactionId, fixture.run.id, objectiveMessageId, NOW, NOW);
  fixture.database
    .prepare(
      `INSERT INTO run_confirmations (
         id, run_id, interaction_id, target_v1_json, immutable_input_hash,
         decision, decided_by_message_id, requested_at, decided_at
       ) VALUES (?, ?, ?, ?, ?, 'approved', ?, ?, ?)`,
    )
    .run(
      confirmationId,
      fixture.run.id,
      interactionId,
      canonicalJson(deliveryExportConfirmationTargetFor(fixture.manifest, request)),
      key.inputHash,
      objectiveMessageId,
      NOW,
      NOW,
    );
  return confirmationId;
}

function prepareUnboundExportDispatch(
  fixture: Fixture,
  request: ReturnType<typeof exportRequest>,
  confirmationId: string,
  id = 'dispatch.delivery.export',
) {
  const key = resolveOperationDispatchKey(fixture.database, {
    runId: fixture.run.id,
    toolId: 'delivery.export',
    input: request,
  });
  fixture.database
    .prepare(
      `INSERT INTO dispatch_operations (
         id, run_id, tool_id, tool_version, guard_outcome, idempotency_key,
         input_hash, input_v1_json, confirmation_id, operation_kind,
         owner_authority, owner_id, project_event_id, created_at, updated_at
       ) VALUES (?, ?, ?, ?, 'allowed', ?, ?, ?, ?, NULL, NULL, NULL, NULL, ?, ?)`,
    )
    .run(
      id,
      fixture.run.id,
      key.toolId,
      key.toolVersion,
      key.fingerprint,
      key.inputHash,
      key.inputJson,
      confirmationId,
      NOW,
      NOW,
    );
  return { id, key };
}

function operationRef(fixture: Fixture, authority: 'review_cut_attempt' | 'delivery_export') {
  const row = fixture.database
    .prepare('SELECT id FROM dispatch_operations WHERE owner_authority = ?')
    .get(authority) as { id: string };
  const bound = loadBoundOperation(fixture.database, row.id);
  return operationRefForOwner(bound.dispatch.id, bound.owner);
}

function count(database: DatabaseSync, sql: string): number {
  return (database.prepare(sql).get() as { count: number }).count;
}

describe('I2-G3a local Delivery operations', () => {
  it('freezes the exact plan, commits running state before rendering, publishes CAS atomically, and replays', async () => {
    const fixture = await harness();
    try {
      let adapterObservation:
        | {
            readonly isTransaction: boolean;
            readonly attempts: number;
            readonly events: number;
            readonly state: unknown;
          }
        | undefined;
      fixture.reviewRenderer.onCall = () => {
        adapterObservation = {
          isTransaction: fixture.database.isTransaction,
          attempts: count(fixture.database, 'SELECT COUNT(*) AS count FROM review_cut_attempts'),
          events: count(
            fixture.database,
            `SELECT COUNT(*) AS count
             FROM run_event_payloads
             WHERE json_extract(payload_v1_json, '$.type') = 'operation_state_changed'`,
          ),
          state: fixture.database.prepare('SELECT state FROM review_cut_attempts').get(),
        };
      };
      const input = previewInput(fixture);
      const completed = await fixture.data.deliveryOperations.preview(input, fixture.context);
      expect(completed).toMatchObject({ state: 'succeeded', attemptId: expect.any(String) });
      expect(adapterObservation).toEqual({
        isTransaction: false,
        attempts: 1,
        events: 2,
        state: { state: 'running' },
      });
      expect(completed.artifact?.kind).toBe('review_cut');
      expect(fixture.reviewRenderer.calls[0]).toMatchObject({
        manifest: fixture.manifest,
        range: input.request.range,
      });
      expect(fixture.reviewRenderer.jobs.size).toBe(1);
      expect(
        fixture.database.prepare('SELECT COUNT(*) AS count FROM run_resource_entries').get(),
      ).toEqual({ count: 0 });
      expect(
        fixture.database
          .prepare(
            "SELECT source_kind, search_text FROM project_search_documents WHERE source_kind = 'review_cut'",
          )
          .get(),
      ).toEqual({ source_kind: 'review_cut', search_text: 'Review Cut\nmp4 · 1920×1080 · 24 fps' });
      expect(await fixture.data.deliveryOperations.preview(input, fixture.context)).toEqual(
        completed,
      );
      expect(fixture.reviewRenderer.calls).toHaveLength(1);
    } finally {
      fixture.store.close();
    }
  });

  it('recovers Review Cut publication rollback with the same local idempotency job and fails closed on tamper', async () => {
    const fixture = await harness();
    try {
      fixture.database.exec(
        `CREATE TRIGGER fail_review_publication BEFORE UPDATE ON review_cut_attempts
         WHEN NEW.state = 'succeeded' BEGIN SELECT RAISE(ABORT, 'review publication rollback'); END`,
      );
      await expect(
        fixture.data.deliveryOperations.preview(previewInput(fixture), fixture.context),
      ).rejects.toThrow('review publication rollback');
      const outputHash = localOutput('review-cut-bytes').blob.hash;
      expect(fixture.mediaCas.objects.has(outputHash)).toBe(true);
      expect(
        fixture.database.prepare('SELECT state, output_blob_hash FROM review_cut_attempts').get(),
      ).toEqual({ state: 'running', output_blob_hash: null });
      expect(
        fixture.database
          .prepare('SELECT COUNT(*) AS count FROM media_blobs WHERE hash = ?')
          .get(outputHash),
      ).toEqual({ count: 0 });
      fixture.database.exec('DROP TRIGGER fail_review_publication');
      const recovered = await fixture.data.deliveryOperations.preview(
        previewInput(fixture),
        fixture.context,
      );
      expect(recovered.state).toBe('succeeded');
      expect(fixture.reviewRenderer.jobs.size).toBe(1);
      expect(fixture.reviewRenderer.calls).toHaveLength(2);
      fixture.database
        .prepare(
          "UPDATE project_search_documents SET search_text = 'tampered' WHERE source_kind = 'review_cut'",
        )
        .run();
      await expect(
        fixture.data.deliveryOperations.preview(previewInput(fixture), fixture.context),
      ).rejects.toMatchObject({ code: 'CORRUPT_DATA' });
    } finally {
      fixture.store.close();
    }
  });

  it('exports only through an exact confirmed opaque grant, after commit, without persisting secrets or format overrides', async () => {
    const fixture = await harness();
    try {
      const request = exportRequest(fixture);
      fixture.database
        .prepare('UPDATE delivery_plans SET revision = ?, content_hash = ? WHERE id = ?')
        .run(
          fixture.plan.revision + 1,
          hashCanonical({ delivery: fixture.plan.id, revision: fixture.plan.revision + 1 }),
          fixture.plan.id,
        );
      const confirmationId = approveExport(fixture, request);
      const preparedDispatch = prepareUnboundExportDispatch(fixture, request, confirmationId);
      expect(() =>
        assertDeliveryExportModelBoundary(fixture.database, fixture.run, request),
      ).not.toThrow();
      fixture.destinationGrants.onCall = fixture.deliveryExporter.onCall = () => {
        expect(fixture.database.isTransaction).toBe(false);
        expect(fixture.database.prepare('SELECT state FROM delivery_exports').get()).toEqual({
          state: 'running',
        });
      };
      const input = {
        runId: fixture.run.id,
        commandId: 'command.delivery.export',
        confirmationId,
        request,
        dispatchOperationId: preparedDispatch.id,
      };
      const completed = await fixture.data.deliveryOperations.export(input, fixture.context);
      expect(completed).toMatchObject({
        state: 'succeeded',
        operation: { id: preparedDispatch.id, kind: 'delivery_export' },
        destinationLabel: request.destination.displayLabel,
        contentHash: localOutput('delivery-export-bytes').blob.hash,
      });
      expect(loadBoundOperation(fixture.database, preparedDispatch.id).dispatch.id).toBe(
        preparedDispatch.id,
      );
      expect(deliveryExportSuccessForDispatch(fixture.database, preparedDispatch.id)).toEqual(
        completed,
      );
      expect(fixture.deliveryExporter.calls[0]).toMatchObject({
        manifest: fixture.manifest,
        overwriteExisting: false,
      });
      expect(fixture.deliveryExporter.calls[0]).not.toHaveProperty('format');
      expect(fixture.deliveryExporter.jobs.size).toBe(1);
      const beforeTerminalReplay = canonicalJson({
        dispatches: fixture.database.prepare('SELECT * FROM dispatch_operations').all(),
        exports: fixture.database.prepare('SELECT * FROM delivery_exports').all(),
        events: fixture.database.prepare('SELECT * FROM run_events').all(),
        search: fixture.database.prepare('SELECT * FROM project_search_documents').all(),
      });
      expect(await fixture.data.deliveryOperations.export(input, fixture.context)).toEqual(
        completed,
      );
      expect(
        canonicalJson({
          dispatches: fixture.database.prepare('SELECT * FROM dispatch_operations').all(),
          exports: fixture.database.prepare('SELECT * FROM delivery_exports').all(),
          events: fixture.database.prepare('SELECT * FROM run_events').all(),
          search: fixture.database.prepare('SELECT * FROM project_search_documents').all(),
        }),
      ).toBe(beforeTerminalReplay);
      expect(fixture.destinationGrants.calls).toHaveLength(1);
      expect(fixture.destinationGrants.calls[0]).toEqual({
        descriptor: request.destination,
        projectId: fixture.project.id,
        chatId: fixture.run.chatId,
        runId: fixture.run.id,
        deliveryPlan: fixture.plan,
        requiredExtension: 'mp4',
        operationFingerprint: preparedDispatch.key.fingerprint,
      });
      expect(fixture.deliveryExporter.calls).toHaveLength(1);
      const publicAndStored = canonicalJson({
        completed,
        exports: fixture.database.prepare('SELECT * FROM delivery_exports').all(),
        events: fixture.database.prepare('SELECT * FROM run_events').all(),
        search: fixture.database.prepare('SELECT * FROM project_search_documents').all(),
      });
      expect(publicAndStored).not.toContain(SECRET);
      expect(publicAndStored).not.toMatch(/(?:[A-Za-z]:\\|\/Users\/|capabilityToken|localPath)/);
      expect(
        fixture.database.prepare('SELECT COUNT(*) AS count FROM run_resource_entries').get(),
      ).toEqual({ count: 0 });
    } finally {
      fixture.store.close();
    }
  });

  it('rejects mismatched prepared export Dispatches, confirmations, and manifest CAS without writes', async () => {
    const fixture = await harness();
    try {
      const request = exportRequest(fixture);
      const confirmationId = approveExport(fixture, request, 'correct');
      const differentRequest = {
        ...request,
        destination: { ...request.destination, displayLabel: 'different-review.mp4' },
      };
      const differentConfirmationId = approveExport(fixture, differentRequest, 'different');
      const differentDispatch = prepareUnboundExportDispatch(
        fixture,
        differentRequest,
        differentConfirmationId,
        'dispatch.delivery.export.different',
      );
      const writes = () => ({
        exports: count(fixture.database, 'SELECT COUNT(*) AS count FROM delivery_exports'),
        events: count(fixture.database, 'SELECT COUNT(*) AS count FROM run_events'),
      });
      const beforeWrongDispatch = writes();
      await expect(
        fixture.data.deliveryOperations.export(
          {
            runId: fixture.run.id,
            commandId: 'command.delivery.export.wrong-dispatch',
            confirmationId,
            request,
            dispatchOperationId: differentDispatch.id,
          },
          fixture.context,
        ),
      ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
      expect(writes()).toEqual(beforeWrongDispatch);
      expect(fixture.deliveryExporter.calls).toHaveLength(0);

      const preparedDispatch = prepareUnboundExportDispatch(
        fixture,
        request,
        confirmationId,
        'dispatch.delivery.export.correct',
      );
      const otherConfirmationId = approveExport(fixture, request, 'other');
      const beforeWrongConfirmation = writes();
      await expect(
        fixture.data.deliveryOperations.export(
          {
            runId: fixture.run.id,
            commandId: 'command.delivery.export.wrong-confirmation',
            confirmationId: otherConfirmationId,
            request,
            dispatchOperationId: preparedDispatch.id,
          },
          fixture.context,
        ),
      ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
      expect(writes()).toEqual(beforeWrongConfirmation);
      expect(fixture.deliveryExporter.calls).toHaveLength(0);

      const staleRequest = {
        ...request,
        manifest: {
          ...request.manifest,
          contentHash: hashCanonical({ manifest: 'stale-delivery-export' }),
        },
      };
      expect(() =>
        assertDeliveryExportModelBoundary(fixture.database, fixture.run, staleRequest),
      ).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));
      const staleConfirmationId = approveExport(fixture, staleRequest, 'stale');
      const beforeStaleManifest = writes();
      await expect(
        fixture.data.deliveryOperations.export(
          {
            runId: fixture.run.id,
            commandId: 'command.delivery.export.stale-manifest',
            confirmationId: staleConfirmationId,
            request: staleRequest,
          },
          fixture.context,
        ),
      ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
      expect(writes()).toEqual(beforeStaleManifest);
      expect(fixture.deliveryExporter.calls).toHaveLength(0);
    } finally {
      fixture.store.close();
    }
  });

  it('rejects grant mismatch and cross-Project manifests, maps local failure, and preserves a real completion during cancel race', async () => {
    const fixture = await harness();
    try {
      const other = fixture.data.projects.create(
        {
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.project.delivery-operations.other',
          method: 'project.create',
          input: {
            name: 'Other Film',
            permissionMode: 'reversible',
            budget,
            formatPolicy: { aspectRatio: '16:9', customDimensions: null, frameRate: 24 },
          },
        },
        {
          actor: 'user',
          causation: { kind: 'direct_ui', actionId: 'action.delivery-operations.other' },
          correlationId: 'correlation.delivery-operations.other',
        },
      ).result.project;
      const otherPlan = {
        authority: 'delivery' as const,
        id: 'delivery.other.1',
        revision: 0,
        contentHash: hashCanonical({ delivery: 'delivery.other.1' }),
      };
      fixture.database
        .prepare(
          `INSERT INTO delivery_plans (
             id, project_id, revision, content_hash, name, lifecycle,
             format_intent_v1_json, created_at, updated_at
           ) SELECT ?, ?, ?, ?, 'Other cut', 'active', format_intent_v1_json, ?, ?
             FROM delivery_plans WHERE id = ?`,
        )
        .run(
          otherPlan.id,
          other.id,
          otherPlan.revision,
          otherPlan.contentHash,
          NOW,
          NOW,
          fixture.plan.id,
        );
      await expect(
        fixture.data.deliveryOperations.preview(
          {
            runId: fixture.run.id,
            commandId: 'command.delivery.preview.cross-project',
            request: { plan: otherPlan, range: null },
          },
          fixture.context,
        ),
      ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
      expect(fixture.reviewRenderer.calls).toHaveLength(0);

      const request = exportRequest(fixture);
      fixture.destinationGrants.tamper = true;
      const failed = await fixture.data.deliveryOperations.export(
        {
          runId: fixture.run.id,
          commandId: 'command.delivery.export.mismatch',
          confirmationId: approveExport(fixture, request),
          request,
        },
        fixture.context,
      );
      expect(failed).toMatchObject({ state: 'failed', contentHash: null });
      expect(fixture.deliveryExporter.calls).toHaveLength(0);
      expect(canonicalJson(failed)).not.toContain(SECRET);

      fixture.database.exec(
        `CREATE TRIGGER fail_review_publication BEFORE UPDATE ON review_cut_attempts
         WHEN NEW.state = 'succeeded' BEGIN SELECT RAISE(ABORT, 'leave running'); END`,
      );
      await expect(
        fixture.data.deliveryOperations.preview(previewInput(fixture), fixture.context),
      ).rejects.toThrow('leave running');
      fixture.database.exec('DROP TRIGGER fail_review_publication');
      const ref = operationRef(fixture, 'review_cut_attempt');
      const cancelled = fixture.data.operations.cancel(
        {
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.cancel.review-cut',
          method: 'operation.cancel',
          input: {
            operations: [
              { ref, expectedRevision: ref.revision, expectedState: 'running' as const },
            ],
          },
        },
        fixture.context,
      ).result.operations[0]!;
      fixture.reviewRenderer.cancelCompletes = true;
      const raced = await fixture.data.deliveryOperations.acknowledgeCancellation(
        {
          operation: cancelled.ref,
          expectedRevision: cancelled.ref.revision,
          commandId: 'command.ack.review-cut',
        },
        fixture.context,
      );
      expect(raced).toMatchObject({ state: 'succeeded' });
      expect(fixture.reviewRenderer.cancelCalls).toBe(1);
      expect(
        await fixture.data.deliveryOperations.acknowledgeCancellation(
          {
            operation: raced.operation,
            expectedRevision: raced.operation.revision,
            commandId: 'command.ack.review-cut.replay',
          },
          fixture.context,
        ),
      ).toEqual(raced);
      expect(fixture.reviewRenderer.cancelCalls).toBe(1);
    } finally {
      fixture.store.close();
    }
  });
});
