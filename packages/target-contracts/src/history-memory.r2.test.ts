import { describe, expect, it } from 'vitest';
import {
  MemorySourceSchema,
  ProjectEventSchema,
  ProjectEventViewSchema,
  ProjectHistoryEntryViewSchema,
  ProjectMemoryIndexEntrySchema,
  ProjectMemorySummaryViewSchema,
  ProjectSearchSourceV1Schema,
} from './history-memory.js';
import { AuthoritySchema, DomainObjectAuthoritySchema } from './primitives.js';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const TIME = '2026-08-15T12:00:00.000Z';

const productionRef = {
  authority: 'production',
  id: 'shot.1',
  revision: 2,
  contentHash: HASH_A,
} as const;

const messageSource = {
  kind: 'message',
  messageId: 'message.1',
  chatId: 'chat.1',
  sequence: 3,
  contentHash: HASH_A,
} as const;

const availableProjectEvent = {
  authority: 'project_event',
  id: 'event.1',
  projectId: 'project.1',
  sequence: 7,
  eventVersion: 1,
  eventType: 'object_revision_changed',
  occurredAt: TIME,
  actor: 'commander',
  subject: { authority: 'production', id: 'shot.1' },
  causation: { kind: 'run', runId: 'run.1' },
  correlationId: 'correlation.1',
  idempotencyKey: 'idempotency.1',
  payloadHash: HASH_A,
  payloadState: {
    state: 'available',
    payload: {
      type: 'object_revision_changed',
      beforeRevision: 1,
      afterRevision: 2,
      beforeHash: HASH_A,
      afterHash: HASH_B,
    },
  },
  previousEventHash: HASH_A,
  eventHash: HASH_B,
} as const;

describe('R2 Project search sources', () => {
  it('accepts exact revision-bound sources and an immutable Message source', () => {
    for (const [kind, authority] of [
      ['production', 'production'],
      ['project_media_ref', 'project_media_ref'],
      ['delivery', 'delivery'],
      ['generated_result', 'generated_result'],
    ] as const) {
      expect(
        ProjectSearchSourceV1Schema.safeParse({
          kind,
          ref: { ...productionRef, authority },
        }).success,
      ).toBe(true);
    }
    expect(ProjectSearchSourceV1Schema.safeParse(messageSource).success).toBe(true);
  });

  it('rejects authority mismatches, legacy chat labels, generic refs, and unknown fields', () => {
    expect(
      ProjectSearchSourceV1Schema.safeParse({
        kind: 'delivery',
        ref: productionRef,
      }).success,
    ).toBe(false);
    expect(
      ProjectSearchSourceV1Schema.safeParse({
        source: 'chat',
        ref: productionRef,
      }).success,
    ).toBe(false);
    expect(
      ProjectSearchSourceV1Schema.safeParse({ ...messageSource, unexpected: true }).success,
    ).toBe(false);
  });
});

describe('R2 Project Event and History views', () => {
  it('allows non-Domain authorities to be event subjects without making them Domain Objects', () => {
    expect(AuthoritySchema.safeParse('project_settings').success).toBe(true);
    expect(DomainObjectAuthoritySchema.safeParse('project_settings').success).toBe(false);
    expect(AuthoritySchema.safeParse('skill').success).toBe(true);
    expect(DomainObjectAuthoritySchema.safeParse('skill').success).toBe(false);
    expect(AuthoritySchema.safeParse('global_media_folder').success).toBe(true);
    expect(DomainObjectAuthoritySchema.safeParse('global_media_folder').success).toBe(false);
    expect(
      ProjectEventSchema.safeParse({
        ...availableProjectEvent,
        subject: { authority: 'project_settings', id: 'project.1' },
      }).success,
    ).toBe(true);
  });

  it('accepts available and redacted ProjectEvent payload states', () => {
    expect(ProjectEventSchema.safeParse(availableProjectEvent).success).toBe(true);
    expect(
      ProjectEventSchema.safeParse({
        ...availableProjectEvent,
        payloadState: { state: 'redacted', erasedAt: TIME },
      }).success,
    ).toBe(true);
    expect(
      ProjectEventViewSchema.safeParse({
        eventId: availableProjectEvent.id,
        projectId: availableProjectEvent.projectId,
        sequence: availableProjectEvent.sequence,
        eventVersion: availableProjectEvent.eventVersion,
        eventType: availableProjectEvent.eventType,
        occurredAt: availableProjectEvent.occurredAt,
        actor: availableProjectEvent.actor,
        subject: availableProjectEvent.subject,
        causation: availableProjectEvent.causation,
        correlationId: availableProjectEvent.correlationId,
        payloadHash: availableProjectEvent.payloadHash,
        payloadState: availableProjectEvent.payloadState,
        previousEventHash: availableProjectEvent.previousEventHash,
        eventHash: availableProjectEvent.eventHash,
      }).success,
    ).toBe(true);
  });

  it('rejects mismatched event types, mixed payload states, and unknown envelope fields', () => {
    expect(
      ProjectEventSchema.safeParse({
        ...availableProjectEvent,
        eventType: 'choice_recorded',
      }).success,
    ).toBe(false);
    expect(
      ProjectEventSchema.safeParse({
        ...availableProjectEvent,
        payloadState: {
          state: 'redacted',
          erasedAt: TIME,
          payload: availableProjectEvent.payloadState.payload,
        },
      }).success,
    ).toBe(false);
    expect(
      ProjectEventSchema.safeParse({ ...availableProjectEvent, unexpected: true }).success,
    ).toBe(false);
  });

  it('accepts exactly five explicit Project History source variants', () => {
    const common = { projectId: 'project.1', occurredAt: TIME, summary: 'Public evidence.' };
    const entries = [
      {
        ...common,
        source: 'message',
        messageId: 'message.1',
        chatId: 'chat.1',
        sequence: 3,
        role: 'user',
        contentHash: HASH_A,
      },
      {
        ...common,
        source: 'run_event',
        runId: 'run.1',
        eventId: 'run-event.1',
        sequence: 4,
        actor: 'commander',
        causation: { kind: 'message', messageId: 'message.1' },
        eventHash: HASH_A,
      },
      {
        ...common,
        source: 'project_event',
        eventId: 'event.1',
        sequence: 7,
        eventVersion: 1,
        eventType: 'object_revision_changed',
        actor: 'commander',
        subject: { authority: 'production', id: 'shot.1' },
        causation: { kind: 'run', runId: 'run.1' },
        correlationId: 'correlation.1',
        payloadHash: HASH_A,
        payloadState: availableProjectEvent.payloadState,
        previousEventHash: HASH_A,
        eventHash: HASH_B,
      },
      {
        ...common,
        source: 'generated_result',
        resultId: 'result.1',
        runId: 'run.1',
        revision: 0,
        contentHash: HASH_A,
      },
      {
        ...common,
        source: 'user_choice',
        choiceId: 'choice.1',
        actor: 'user',
        subject: { kind: 'result_decision', shotId: 'shot.1', resultIds: ['result.1'] },
        causation: { kind: 'message', messageId: 'message.1' },
      },
    ];

    for (const entry of entries) {
      expect(ProjectHistoryEntryViewSchema.safeParse(entry).success).toBe(true);
    }
    expect(ProjectHistoryEntryViewSchema.safeParse({ ...entries[0], runId: 'run.1' }).success).toBe(
      false,
    );
    expect(ProjectHistoryEntryViewSchema.safeParse({ ...entries[1], sequence: 0 }).success).toBe(
      false,
    );
  });
});

describe('R2 Project Memory sources and derived summary', () => {
  const sources = [
    { kind: 'domain_object', ref: productionRef },
    messageSource,
    { kind: 'user_choice', choiceId: 'choice.1' },
    {
      kind: 'committed_run_change',
      runId: 'run.1',
      projectEventId: 'event.1',
      projectEventSequence: 7,
      projectEventHash: HASH_B,
    },
    {
      kind: 'generated_result',
      ref: {
        authority: 'generated_result',
        id: 'result.1',
        revision: 0,
        contentHash: HASH_A,
      },
    },
  ] as const;

  it('accepts all typed sources and requires at least one source per Memory item', () => {
    for (const source of sources) {
      expect(MemorySourceSchema.safeParse(source).success).toBe(true);
    }
    expect(
      ProjectMemoryIndexEntrySchema.safeParse({
        id: 'memory-item.1',
        category: 'visual_direction',
        sources,
        state: 'current',
        tentative: false,
        topics: ['visual direction'],
        searchableText: 'Cold moonlight.',
        contentHash: HASH_A,
      }).success,
    ).toBe(true);
    expect(
      ProjectMemoryIndexEntrySchema.safeParse({
        id: 'memory-item.1',
        category: 'visual_direction',
        sources: [],
        state: 'current',
        tentative: false,
        topics: [],
        searchableText: 'Cold moonlight.',
        contentHash: HASH_A,
      }).success,
    ).toBe(false);
    expect(
      ProjectMemoryIndexEntrySchema.safeParse({
        id: 'memory-item.legacy',
        sources,
        state: 'active',
        tentative: false,
        topics: ['visual_direction'],
        searchableText: 'Legacy inferred category.',
        contentHash: HASH_A,
      }).success,
    ).toBe(false);
  });

  it('accepts every frozen ProjectEvent payload type without weakening the envelope', () => {
    const payloads = [
      { type: 'object_created', revision: 0, contentHash: HASH_A },
      {
        type: 'message_appended',
        messageId: 'message.1',
        chatId: 'chat.1',
        sequence: 1,
        contentHash: HASH_A,
      },
      {
        type: 'media_detached',
        projectMediaRefId: 'media.1',
        globalAssetId: 'asset.1',
        revision: 2,
        contentHash: HASH_B,
      },
      { type: 'generated_result_recorded', resultId: 'result.1', revision: 0, contentHash: HASH_A },
    ] as const;
    for (const payload of payloads) {
      expect(
        ProjectEventSchema.safeParse({
          ...availableProjectEvent,
          eventType: payload.type,
          payloadState: { state: 'available', payload },
        }).success,
      ).toBe(true);
    }
  });

  it('rejects invalid source combinations and unknown fields', () => {
    expect(
      MemorySourceSchema.safeParse({
        kind: 'generated_result',
        ref: productionRef,
      }).success,
    ).toBe(false);
    expect(MemorySourceSchema.safeParse({ ...messageSource, revision: 1 }).success).toBe(false);
  });

  it('models the optional narration as a derived view rather than a persisted authority', () => {
    const summary = {
      view: 'project_memory_summary',
      projectId: 'project.1',
      memoryVersionId: 'memory.1',
      derivationVersion: 'memory-v1',
      sourceSchemaVersion: 'source-v1',
      historyWatermark: 7,
      sourceSetHash: HASH_A,
      completeness: 'complete',
      statements: [{ text: 'Use cold moonlight.', citedEntryIds: ['memory-item.1'] }],
      derivedAt: TIME,
    };
    expect(ProjectMemorySummaryViewSchema.safeParse(summary).success).toBe(true);
    expect(
      ProjectMemorySummaryViewSchema.safeParse({
        ...summary,
        authority: 'project_memory',
        id: 'summary.1',
      }).success,
    ).toBe(false);
  });
});
