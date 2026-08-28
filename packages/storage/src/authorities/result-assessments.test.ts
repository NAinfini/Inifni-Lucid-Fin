import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import {
  CapabilityCatalogSnapshotV1Schema,
  providerReceiptHashInput,
  type ProviderReceipt,
  type OperationRef,
  type ResourceAmount,
} from '@lucid-fin/contracts';
import { describe, expect, it } from 'vitest';
import { registerStoreDatabase, unregisterStoreDatabase } from '../internal/database-access.js';
import { hashCanonical } from '../internal/hashes.js';
import { createDataAccess } from '../kernel/data-access.js';
import type { GenerationProviderAdapter } from '../kernel/generation-provider.js';
import type { MediaCas, MediaImportCapabilityResolver } from '../kernel/media-cas.js';
import type {
  ResultAssessmentProviderAdapter,
  ResultAssessmentProviderState,
} from '../kernel/result-assessment-provider.js';
import type { Store } from '../kernel/store.js';

const NOW = '2026-08-16T12:00:00.000Z';
const rootCatalog = CapabilityCatalogSnapshotV1Schema.parse(
  JSON.parse(
    readFileSync(
      new URL('../../../contracts/generated/tool-catalog.v1.json', import.meta.url),
      'utf8',
    ),
  ),
);

function receipt(): ProviderReceipt {
  const value = {
    providerOperationId: 'provider.assessment.operation.1',
    submittedAt: NOW,
    reconciledAt: null,
    receiptHash: '',
  };
  return { ...value, receiptHash: hashCanonical(providerReceiptHashInput(value)) };
}

function usage(cost = '1') {
  return {
    inputTokens: { state: 'known' as const, value: 0 },
    outputTokens: { state: 'known' as const, value: 0 },
    generatedUnits: { state: 'known' as const, value: 0 },
    cost: { state: 'known' as const, value: cost, currency: 'USD' },
  };
}

class UnusedGenerationProvider implements GenerationProviderAdapter {
  readonly providerKind = 'openai';
  async quote(): Promise<never> {
    throw new Error('unused');
  }
  async submit(): Promise<never> {
    throw new Error('unused');
  }
  async reconcileByIdempotencyKey(): Promise<never> {
    throw new Error('unused');
  }
  async cancel(): Promise<never> {
    throw new Error('unused');
  }
}

class FakeAssessmentProvider implements ResultAssessmentProviderAdapter {
  readonly providerKind = 'openai';
  quoteCost: ResourceAmount = { state: 'known', value: '1', currency: 'USD' };
  quoteCalls = 0;
  submitCalls = 0;
  reconcileCalls = 0;
  cancelCalls = 0;
  readonly submitStates: ResultAssessmentProviderState[] = [];
  readonly reconcileStates: ResultAssessmentProviderState[] = [];
  readonly cancelStates: ResultAssessmentProviderState[] = [];
  onCancel: () => Promise<void> = async () => {};

  async quote() {
    this.quoteCalls += 1;
    return { cost: this.quoteCost };
  }

  async submit(): Promise<ResultAssessmentProviderState> {
    this.submitCalls += 1;
    return this.submitStates.shift() ?? { state: 'not_submitted' };
  }

  async reconcileByIdempotencyKey(): Promise<ResultAssessmentProviderState> {
    this.reconcileCalls += 1;
    return this.reconcileStates.shift() ?? { state: 'not_submitted' };
  }

  async cancel(): Promise<ResultAssessmentProviderState> {
    this.cancelCalls += 1;
    await this.onCancel();
    return this.cancelStates.shift() ?? { state: 'cancelled', receipt: null, usage: null };
  }
}

const unusedMediaCas: MediaCas = {
  async putVerified() {
    throw new Error('unused');
  },
  async stat() {
    return null;
  },
  async verify() {
    throw new Error('unused');
  },
  openVerified() {
    throw new Error('unused');
  },
};

const unusedCapabilities: MediaImportCapabilityResolver = {
  async resolve() {
    throw new Error('unused');
  },
};

function deterministicIds() {
  const counts = new Map<string, number>();
  return (kind: string) => {
    const count = (counts.get(kind) ?? 0) + 1;
    counts.set(kind, count);
    return `${kind}.${count}`;
  };
}

function memoryStore(): { store: Store; database: DatabaseSync } {
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys = ON');
  database.exec(
    readFileSync(new URL('../../../contracts/ddl/project-v1.sql', import.meta.url), 'utf8'),
  );
  let open = true;
  const store: Store = {
    databasePath: ':memory:',
    schemaFingerprint: {} as Store['schemaFingerprint'],
    security: { defensive: true, extensionLoading: false, foreignKeys: true },
    close() {
      if (!open) return;
      open = false;
      unregisterStoreDatabase(store);
      database.close();
    },
  };
  registerStoreDatabase(store, database);
  return { store, database };
}

function harness(
  options: {
    readonly budgetCost?: string;
    readonly quoteCost?: ResourceAmount;
  } = {},
) {
  const { store, database } = memoryStore();
  const provider = new FakeAssessmentProvider();
  provider.quoteCost = options.quoteCost ?? provider.quoteCost;
  const data = createDataAccess(store, {
    now: () => NOW,
    createId: deterministicIds(),
    mediaCas: unusedMediaCas,
    mediaImportCapabilities: unusedCapabilities,
    generationProvider: new UnusedGenerationProvider(),
    resultAssessmentProvider: provider,
  });
  const userContext = {
    actor: 'user' as const,
    causation: { kind: 'direct_ui' as const, actionId: 'action.assessment.setup' },
    correlationId: 'correlation.assessment.setup',
  };
  const project = data.projects.create(
    {
      wireVersion: 1,
      kind: 'request',
      requestId: 'request.project.assessment',
      method: 'project.create',
      input: {
        name: 'Assessment Film',
        permissionMode: 'reversible',
        budget: {
          costUsd: { state: 'known', value: options.budgetCost ?? '20', currency: 'USD' },
          maxGenerationCount: 12,
          maxInputTokens: 100_000,
          maxOutputTokens: 20_000,
        },
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
       ) VALUES ('provider.1', 'Provider', 'openai', 'vision-model', NULL, NULL,
         NULL, 'ready', '{}', 0, ?, ?)`,
    )
    .run(NOW, NOW);
  const subject = data.production.apply(
    {
      wireVersion: 1,
      kind: 'request',
      requestId: 'request.production.assessment',
      method: 'production.apply',
      input: {
        action: 'create',
        projectId: project.id,
        expectedProjectRevision: project.revision,
        value: {
          objectType: 'shot',
          content: {
            title: 'Opening shot',
            description: 'A moonlit harbor.',
            durationMs: null,
            shotSize: null,
            cameraMovement: null,
          },
        },
        relations: [],
      },
    },
    userContext,
  ).result.object;
  expect(subject.type).toBe('shot');
  if (subject.type === 'shot') expect(subject.resultDecisions).toEqual([]);
  const chat = data.conversations.createChat(
    {
      wireVersion: 1,
      kind: 'request',
      requestId: 'request.chat.assessment',
      method: 'chat.create',
      input: { projectId: project.id, title: 'Main' },
    },
    userContext,
  ).result;
  const run = data.conversations.sendMessage(
    {
      wireVersion: 1,
      kind: 'request',
      requestId: 'request.message.assessment',
      method: 'message.send',
      input: {
        chatId: chat.id,
        blocks: [{ type: 'text', text: 'Assess the opening shot.' }],
        attachments: [],
        selectedContext: [],
        exportDestinationGrant: null,
        supersedesMessageId: null,
      },
    },
    userContext,
    {
      model: { providerId: 'provider.1', model: 'vision-model', reasoningStrength: null },
      locale: 'en-US',
      timeZone: 'America/New_York',
      capabilityCatalog: rootCatalog,
      projectMediaSelections: [],
      citedMemoryEntryIds: [],
    },
  ).result.acceptedRun;
  return {
    store,
    database,
    data,
    provider,
    project,
    run,
    subject,
    context: {
      actor: 'commander' as const,
      causation: { kind: 'run' as const, runId: run.id },
      correlationId: 'correlation.assessment',
    },
  };
}

function subjectRef(fixture: ReturnType<typeof harness>) {
  return {
    authority: 'production' as const,
    id: fixture.subject.id,
    revision: fixture.subject.revision,
    contentHash: fixture.subject.contentHash,
  };
}

function providerRequest(fixture: ReturnType<typeof harness>) {
  const ref = subjectRef(fixture);
  return {
    kind: 'reference_similarity' as const,
    subjects: [ref],
    references: [ref],
    aspects: ['composition' as const],
    provider: { providerId: 'provider.1', model: 'vision-model' },
  };
}

function providerSucceeded(fixture: ReturnType<typeof harness>): ResultAssessmentProviderState {
  const ref = subjectRef(fixture);
  return {
    state: 'succeeded',
    receipt: receipt(),
    usage: usage(),
    assessment: {
      findings: [
        {
          severity: 'info',
          subjectRef: ref,
          criterion: 'composition',
          finding: 'Composition matches the frozen reference.',
          evidenceRefs: [ref],
        },
      ],
      limitations: ['Only the frozen composition evidence was evaluated.'],
      recommendations: ['Review the candidate at full resolution.'],
      artifacts: [],
    },
  };
}

function currentOperation(fixture: ReturnType<typeof harness>, operation: OperationRef) {
  return fixture.data.operations.get({
    wireVersion: 1,
    kind: 'request',
    requestId: `request.operation.${operation.id}`,
    method: 'operation.get',
    input: { operations: [operation] },
  }).result.operations[0]!;
}

describe('I2-F5 Result Assessment authority', () => {
  it('publishes a local assessment without provider calls or resource rows', async () => {
    const fixture = harness();
    try {
      const started = await fixture.data.resultAssessments.start(
        {
          runId: fixture.run.id,
          commandId: 'command.assessment.local.start',
          request: {
            kind: 'technical_integrity',
            subjects: [
              {
                authority: 'production',
                id: fixture.subject.id,
                revision: fixture.subject.revision,
                contentHash: fixture.subject.contentHash,
              },
            ],
            checks: ['readable'],
            provider: null,
          },
        },
        fixture.context,
      );
      const result = await fixture.data.resultAssessments.executeLocal(
        {
          operation: started.operation,
          expectedRevision: started.operation.revision,
          commandId: 'command.assessment.local.execute',
        },
        fixture.context,
      );

      expect(result).toMatchObject({ state: 'succeeded', assessmentId: started.assessmentId });
      expect(result.assessment).not.toBeNull();
      expect(fixture.provider).toMatchObject({
        quoteCalls: 0,
        submitCalls: 0,
        reconcileCalls: 0,
        cancelCalls: 0,
      });
      expect(
        fixture.database.prepare('SELECT COUNT(*) AS count FROM run_resource_entries').get(),
      ).toEqual({ count: 0 });
      expect(
        fixture.database.prepare('SELECT COUNT(*) AS count FROM result_assessments').get(),
      ).toEqual({ count: 1 });
    } finally {
      fixture.store.close();
    }
  });

  it('fails local work without publishing assessment or search evidence', async () => {
    const failedFixture = harness();
    try {
      const started = await failedFixture.data.resultAssessments.start(
        {
          runId: failedFixture.run.id,
          commandId: 'command.assessment.local.failure.start',
          request: {
            kind: 'technical_integrity',
            subjects: [subjectRef(failedFixture)],
            checks: ['readable'],
            provider: null,
          },
        },
        failedFixture.context,
      );
      failedFixture.database
        .prepare('UPDATE production_objects SET revision = revision + 1 WHERE id = ?')
        .run(failedFixture.subject.id);

      const failed = await failedFixture.data.resultAssessments.executeLocal(
        {
          operation: started.operation,
          expectedRevision: started.operation.revision,
          commandId: 'command.assessment.local.failure.execute',
        },
        failedFixture.context,
      );

      expect(failed).toMatchObject({ state: 'failed', assessment: null });
      expect(
        failedFixture.database.prepare('SELECT COUNT(*) AS count FROM result_assessments').get(),
      ).toEqual({ count: 0 });
      expect(
        failedFixture.database
          .prepare(
            "SELECT COUNT(*) AS count FROM project_search_documents WHERE source_kind = 'result_assessment'",
          )
          .get(),
      ).toEqual({ count: 0 });
      expect(
        failedFixture.database.prepare('SELECT COUNT(*) AS count FROM run_resource_entries').get(),
      ).toEqual({ count: 0 });
    } finally {
      failedFixture.store.close();
    }
  });

  it('cancels local work without publishing assessment or resource evidence', async () => {
    const cancelledFixture = harness();
    try {
      const started = await cancelledFixture.data.resultAssessments.start(
        {
          runId: cancelledFixture.run.id,
          commandId: 'command.assessment.local.cancel.start',
          request: {
            kind: 'delivery_readiness',
            subjects: [subjectRef(cancelledFixture)],
            checks: ['all_items_resolve'],
            provider: null,
          },
        },
        cancelledFixture.context,
      );
      const cancellation = cancelledFixture.data.operations.cancel(
        {
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.assessment.local.cancel',
          method: 'operation.cancel',
          input: {
            operations: [
              {
                ref: started.operation,
                expectedRevision: started.operation.revision,
                expectedState: 'running',
              },
            ],
          },
        },
        cancelledFixture.context,
      ).result.operations[0]!;
      const cancelled = await cancelledFixture.data.resultAssessments.acknowledgeCancellation(
        {
          operation: cancellation.ref,
          expectedRevision: cancellation.ref.revision,
          commandId: 'command.assessment.local.cancel.acknowledge',
        },
        cancelledFixture.context,
      );

      expect(cancelled).toMatchObject({ state: 'cancelled', assessment: null });
      expect(
        cancelledFixture.database.prepare('SELECT COUNT(*) AS count FROM result_assessments').get(),
      ).toEqual({ count: 0 });
      expect(
        cancelledFixture.database
          .prepare('SELECT COUNT(*) AS count FROM run_resource_entries')
          .get(),
      ).toEqual({ count: 0 });
    } finally {
      cancelledFixture.store.close();
    }
  });

  it('replays receiptless unknown and only resubmits after authoritative reconciliation', async () => {
    const fixture = harness();
    try {
      const request = providerRequest(fixture);
      const started = await fixture.data.resultAssessments.start(
        {
          runId: fixture.run.id,
          commandId: 'command.assessment.provider.start',
          request,
        },
        fixture.context,
      );
      fixture.provider.submitStates.push({
        state: 'unknown',
        receipt: null,
        usage: null,
      });
      const unknown = await fixture.data.resultAssessments.submitProvider(
        {
          operation: started.operation,
          expectedRevision: started.operation.revision,
          commandId: 'command.assessment.provider.submit',
        },
        fixture.context,
      );
      const committed = {
        attempts: fixture.database
          .prepare('SELECT COUNT(*) AS count FROM result_assessment_attempts')
          .get(),
        subjects: fixture.database
          .prepare('SELECT COUNT(*) AS count FROM result_assessment_subjects')
          .get(),
        resources: fixture.database
          .prepare('SELECT COUNT(*) AS count FROM run_resource_entries')
          .get(),
        events: fixture.database.prepare('SELECT COUNT(*) AS count FROM run_events').get(),
      };
      const replay = await fixture.data.resultAssessments.start(
        {
          runId: fixture.run.id,
          commandId: 'command.assessment.provider.replay',
          request,
        },
        fixture.context,
      );

      expect(unknown).toMatchObject({ state: 'unknown', assessment: null });
      expect(replay).toEqual(unknown);
      expect(fixture.provider).toMatchObject({ quoteCalls: 1, submitCalls: 1, reconcileCalls: 1 });
      expect({
        attempts: fixture.database
          .prepare('SELECT COUNT(*) AS count FROM result_assessment_attempts')
          .get(),
        subjects: fixture.database
          .prepare('SELECT COUNT(*) AS count FROM result_assessment_subjects')
          .get(),
        resources: fixture.database
          .prepare('SELECT COUNT(*) AS count FROM run_resource_entries')
          .get(),
        events: fixture.database.prepare('SELECT COUNT(*) AS count FROM run_events').get(),
      }).toEqual(committed);
      await expect(
        fixture.data.resultAssessments.submitProvider(
          {
            operation: unknown.operation,
            expectedRevision: unknown.operation.revision,
            commandId: 'command.assessment.provider.blind-retry',
          },
          fixture.context,
        ),
      ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });

      fixture.provider.reconcileStates.push({ state: 'not_submitted' });
      fixture.provider.submitStates.push(providerSucceeded(fixture));
      const succeeded = await fixture.data.resultAssessments.reconcileProvider(
        {
          operation: unknown.operation,
          expectedRevision: unknown.operation.revision,
          commandId: 'command.assessment.provider.reconcile',
        },
        fixture.context,
      );

      expect(succeeded).toMatchObject({ state: 'succeeded', assessmentId: started.assessmentId });
      expect(succeeded.assessment).not.toBeNull();
      expect(fixture.provider).toMatchObject({ quoteCalls: 1, submitCalls: 2, reconcileCalls: 2 });
      expect(
        fixture.database.prepare('SELECT COUNT(*) AS count FROM result_assessments').get(),
      ).toEqual({ count: 1 });
      expect(
        fixture.database
          .prepare(
            "SELECT COUNT(*) AS count FROM project_search_documents WHERE source_kind = 'result_assessment'",
          )
          .get(),
      ).toEqual({ count: 1 });
      expect(
        fixture.database
          .prepare(
            "SELECT COUNT(*) AS count FROM project_events WHERE event_type = 'object_created' AND subject_authority = 'result_assessment_attempt'",
          )
          .get(),
      ).toEqual({ count: 1 });
      expect(
        fixture.database.prepare('SELECT COUNT(*) AS count FROM run_resource_entries').get(),
      ).toEqual({ count: 3 });
    } finally {
      fixture.store.close();
    }
  });

  it('blocks unknown, over-cap known, and over-cap estimated cost before persistence or submit', async () => {
    const cases: Array<{ budgetCost: string; quoteCost: ResourceAmount }> = [
      {
        budgetCost: '20',
        quoteCost: { state: 'unknown', currency: 'USD' },
      },
      {
        budgetCost: '1',
        quoteCost: { state: 'known', value: '2', currency: 'USD' },
      },
      {
        budgetCost: '1',
        quoteCost: { state: 'estimated', value: '2', currency: 'USD' },
      },
    ];
    for (const [index, options] of cases.entries()) {
      const fixture = harness(options);
      try {
        await expect(
          fixture.data.resultAssessments.start(
            {
              runId: fixture.run.id,
              commandId: `command.assessment.budget.${index}`,
              request: providerRequest(fixture),
            },
            fixture.context,
          ),
        ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
        expect(fixture.provider).toMatchObject({ quoteCalls: 1, submitCalls: 0 });
        expect(
          fixture.database
            .prepare('SELECT COUNT(*) AS count FROM result_assessment_attempts')
            .get(),
        ).toEqual({ count: 0 });
        expect(
          fixture.database.prepare('SELECT COUNT(*) AS count FROM dispatch_operations').get(),
        ).toEqual({ count: 0 });
        expect(
          fixture.database.prepare('SELECT COUNT(*) AS count FROM run_resource_entries').get(),
        ).toEqual({ count: 0 });
      } finally {
        fixture.store.close();
      }
    }
  });

  it('publishes receipt-first atomically and replays a lost successful response', async () => {
    const fixture = harness();
    try {
      const request = providerRequest(fixture);
      const started = await fixture.data.resultAssessments.start(
        {
          runId: fixture.run.id,
          commandId: 'command.assessment.atomic.start',
          request,
        },
        fixture.context,
      );
      fixture.database.exec(
        `CREATE TRIGGER fail_result_assessment
         BEFORE INSERT ON result_assessments
         BEGIN SELECT RAISE(ABORT, 'injected assessment publication failure'); END`,
      );
      fixture.provider.submitStates.push(providerSucceeded(fixture));
      await expect(
        fixture.data.resultAssessments.submitProvider(
          {
            operation: started.operation,
            expectedRevision: started.operation.revision,
            commandId: 'command.assessment.atomic.submit',
          },
          fixture.context,
        ),
      ).rejects.toThrow('injected assessment publication failure');

      expect(
        fixture.database
          .prepare('SELECT state, receipt_v1_json FROM result_assessment_attempts')
          .get(),
      ).toMatchObject({ state: 'submitted' });
      expect(
        fixture.database.prepare('SELECT COUNT(*) AS count FROM result_assessments').get(),
      ).toEqual({ count: 0 });
      expect(
        fixture.database
          .prepare(
            "SELECT COUNT(*) AS count FROM project_search_documents WHERE source_kind = 'result_assessment'",
          )
          .get(),
      ).toEqual({ count: 0 });
      expect(
        fixture.database.prepare('SELECT COUNT(*) AS count FROM run_resource_entries').get(),
      ).toEqual({ count: 1 });

      fixture.database.exec('DROP TRIGGER fail_result_assessment');
      const current = currentOperation(fixture, started.operation);
      fixture.provider.reconcileStates.push(providerSucceeded(fixture));
      const succeeded = await fixture.data.resultAssessments.reconcileProvider(
        {
          operation: current.ref,
          expectedRevision: current.ref.revision,
          commandId: 'command.assessment.atomic.reconcile',
        },
        fixture.context,
      );
      const counts = () => ({
        attempts: fixture.database
          .prepare('SELECT COUNT(*) AS count FROM result_assessment_attempts')
          .get(),
        assessments: fixture.database
          .prepare('SELECT COUNT(*) AS count FROM result_assessments')
          .get(),
        search: fixture.database
          .prepare(
            "SELECT COUNT(*) AS count FROM project_search_documents WHERE source_kind = 'result_assessment'",
          )
          .get(),
        objectEvents: fixture.database
          .prepare(
            "SELECT COUNT(*) AS count FROM project_events WHERE event_type = 'object_created' AND subject_authority = 'result_assessment_attempt'",
          )
          .get(),
        resources: fixture.database
          .prepare('SELECT COUNT(*) AS count FROM run_resource_entries')
          .get(),
      });
      const committed = counts();
      const calls = { ...fixture.provider };

      const replay = await fixture.data.resultAssessments.start(
        {
          runId: fixture.run.id,
          commandId: 'command.assessment.atomic.replay',
          request,
        },
        fixture.context,
      );

      expect(replay).toEqual(succeeded);
      expect(counts()).toEqual(committed);
      expect(committed).toMatchObject({
        attempts: { count: 1 },
        assessments: { count: 1 },
        search: { count: 1 },
        objectEvents: { count: 1 },
        resources: { count: 3 },
      });
      expect(fixture.provider.quoteCalls).toBe(calls.quoteCalls);
      expect(fixture.provider.submitCalls).toBe(calls.submitCalls);
      expect(fixture.provider.reconcileCalls).toBe(calls.reconcileCalls);
    } finally {
      fixture.store.close();
    }
  });

  it('lets one cancellation claimant preserve a provider race that actually succeeded', async () => {
    const fixture = harness();
    try {
      const started = await fixture.data.resultAssessments.start(
        {
          runId: fixture.run.id,
          commandId: 'command.assessment.cancel.start',
          request: providerRequest(fixture),
        },
        fixture.context,
      );
      fixture.provider.submitStates.push({ state: 'submitted', receipt: receipt(), usage: null });
      const submitted = await fixture.data.resultAssessments.submitProvider(
        {
          operation: started.operation,
          expectedRevision: started.operation.revision,
          commandId: 'command.assessment.cancel.submit',
        },
        fixture.context,
      );
      const cancellation = fixture.data.operations.cancel(
        {
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.assessment.provider.cancel',
          method: 'operation.cancel',
          input: {
            operations: [
              {
                ref: submitted.operation,
                expectedRevision: submitted.operation.revision,
                expectedState: 'submitted',
              },
            ],
          },
        },
        fixture.context,
      ).result.operations[0]!;
      let announceCancel!: () => void;
      let releaseCancel!: () => void;
      const cancelStarted = new Promise<void>((resolve) => (announceCancel = resolve));
      const cancelGate = new Promise<void>((resolve) => (releaseCancel = resolve));
      fixture.provider.onCancel = async () => {
        announceCancel();
        await cancelGate;
      };
      fixture.provider.reconcileStates.push({
        state: 'submitted',
        receipt: receipt(),
        usage: null,
      });
      fixture.provider.cancelStates.push(providerSucceeded(fixture));
      const input = {
        operation: cancellation.ref,
        expectedRevision: cancellation.ref.revision,
        commandId: 'command.assessment.cancel.acknowledge',
      };
      const first = fixture.data.resultAssessments.acknowledgeCancellation(input, fixture.context);
      await cancelStarted;
      const second = fixture.data.resultAssessments.acknowledgeCancellation(input, fixture.context);
      releaseCancel();
      const settled = await Promise.allSettled([first, second]);

      expect(settled.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
      expect(settled.filter(({ status }) => status === 'rejected')).toHaveLength(1);
      expect(fixture.provider.cancelCalls).toBe(1);
      expect(settled.find(({ status }) => status === 'fulfilled')).toMatchObject({
        status: 'fulfilled',
        value: { state: 'succeeded' },
      });
      expect(
        fixture.database
          .prepare('SELECT state, usage_v1_json, public_error_code FROM result_assessment_attempts')
          .get(),
      ).toMatchObject({ state: 'succeeded', public_error_code: null });
      expect(
        fixture.database.prepare('SELECT COUNT(*) AS count FROM result_assessments').get(),
      ).toEqual({ count: 1 });
      expect(
        fixture.database.prepare('SELECT COUNT(*) AS count FROM run_resource_entries').get(),
      ).toEqual({ count: 3 });
    } finally {
      fixture.store.close();
    }
  });

  it('rejects raw provider fields without leaking them to public or persisted state', async () => {
    const fixture = harness();
    const sentinel = 'RAW_ASSESSMENT_PROVIDER_SECRET_4e9f';
    try {
      const started = await fixture.data.resultAssessments.start(
        {
          runId: fixture.run.id,
          commandId: 'command.assessment.privacy.start',
          request: providerRequest(fixture),
        },
        fixture.context,
      );
      fixture.provider.submitStates.push({
        state: 'unknown',
        receipt: null,
        usage: null,
        secret: sentinel,
      } as unknown as ResultAssessmentProviderState);
      const unknown = await fixture.data.resultAssessments.submitProvider(
        {
          operation: started.operation,
          expectedRevision: started.operation.revision,
          commandId: 'command.assessment.privacy.submit',
        },
        fixture.context,
      );
      const publicView = currentOperation(fixture, unknown.operation);
      const persisted = JSON.stringify({
        attempts: fixture.database.prepare('SELECT * FROM result_assessment_attempts').all(),
        subjects: fixture.database.prepare('SELECT * FROM result_assessment_subjects').all(),
        assessments: fixture.database.prepare('SELECT * FROM result_assessments').all(),
        dispatches: fixture.database.prepare('SELECT * FROM dispatch_operations').all(),
        resources: fixture.database.prepare('SELECT * FROM run_resource_entries').all(),
        runEvents: fixture.database.prepare('SELECT * FROM run_events').all(),
        projectEvents: fixture.database.prepare('SELECT * FROM project_events').all(),
        search: fixture.database.prepare('SELECT * FROM project_search_documents').all(),
      });

      expect(unknown.state).toBe('unknown');
      expect(JSON.stringify(unknown)).not.toContain(sentinel);
      expect(JSON.stringify(publicView)).not.toContain(sentinel);
      expect(persisted).not.toContain(sentinel);
    } finally {
      fixture.store.close();
    }
  });

  it('ignores blocked TaskList state and fails closed on owner and search tampering', async () => {
    const fixture = harness();
    try {
      const currentRun = fixture.data.runs.get({
        wireVersion: 1,
        kind: 'request',
        requestId: 'request.run.assessment.task-list',
        method: 'run.get',
        input: { runId: fixture.run.id },
      }).result;
      const created = fixture.data.taskLists.manage(
        fixture.run.id,
        {
          action: 'create',
          expectedRunRevision: currentRun.revision,
          title: 'Assessment progress',
          tasks: [
            {
              draftId: 'draft.assessment',
              title: 'Unrelated decision',
              parentDraftId: null,
              order: 0,
            },
          ],
          publicSummary: 'Track assessment progress.',
        },
        { commandId: 'command.assessment.task-list.create', context: fixture.context },
      ).taskList!;
      const blocked = fixture.data.taskLists.manage(
        fixture.run.id,
        {
          action: 'update',
          expectedRevision: created.revision,
          taskId: created.items[0]!.id,
          title: null,
          state: 'blocked',
          resultSummary: 'Waiting for an unrelated choice.',
          childRunId: null,
          publicSummary: 'Marked unrelated work blocked.',
        },
        { commandId: 'command.assessment.task-list.block', context: fixture.context },
      ).taskList!;
      const started = await fixture.data.resultAssessments.start(
        {
          runId: fixture.run.id,
          commandId: 'command.assessment.blocked.start',
          request: {
            kind: 'technical_integrity',
            subjects: [subjectRef(fixture)],
            checks: ['readable'],
            provider: null,
          },
        },
        fixture.context,
      );
      const succeeded = await fixture.data.resultAssessments.executeLocal(
        {
          operation: started.operation,
          expectedRevision: started.operation.revision,
          commandId: 'command.assessment.blocked.execute',
        },
        fixture.context,
      );

      expect(blocked.items[0]!.state).toBe('blocked');
      expect(succeeded.state).toBe('succeeded');
      const search = fixture.data.search.query(fixture.project.id, {
        query: 'technical_integrity',
        kinds: ['result_assessment'],
        state: 'current',
        page: { cursor: null, limit: 10 },
      });
      expect(search.items).toHaveLength(1);
      fixture.database
        .prepare(
          "UPDATE project_search_documents SET source_hash = ? WHERE source_kind = 'result_assessment'",
        )
        .run('b'.repeat(64));
      expect(() =>
        fixture.data.search.query(fixture.project.id, {
          query: 'technical_integrity',
          kinds: ['result_assessment'],
          state: 'current',
          page: { cursor: null, limit: 10 },
        }),
      ).toThrowError(expect.objectContaining({ code: 'CORRUPT_DATA' }));

      fixture.database
        .prepare('UPDATE result_assessment_attempts SET content_hash = ? WHERE id = ?')
        .run('c'.repeat(64), succeeded.assessmentId);
      expect(() => currentOperation(fixture, succeeded.operation)).toThrowError(
        expect.objectContaining({ code: 'CORRUPT_DATA' }),
      );
    } finally {
      fixture.store.close();
    }
  });
});
