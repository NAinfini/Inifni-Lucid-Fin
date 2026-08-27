import { describe, expect, it } from 'vitest';
import {
  HistoryQueryDefinition,
  MemoryQueryDefinition,
  ProjectGetDefinition,
  ProjectSearchDefinition,
} from './context-tools.js';

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
const memoryHead = {
  memoryVersionId: 'memory.1',
  headRevision: 2,
  derivationVersion: 'memory-v1',
  sourceSchemaVersion: 'source-v1',
  historyWatermark: 7,
  sourceSetHash: HASH_A,
  completeness: 'complete',
  createdAt: TIME,
} as const;
const memoryItem = {
  itemId: 'memory-item.1',
  category: 'visual_direction',
  text: 'Use cold moonlight.',
  state: 'current',
  tentative: false,
  sources: [{ kind: 'domain_object', ref: productionRef }],
  contentHash: HASH_B,
} as const;

describe('R2 project.search', () => {
  it('uses one cross-domain current/historical state instead of incompatible lifecycles', () => {
    expect(() =>
      ProjectSearchDefinition.parseInput({
        query: 'moonlit location',
        kinds: ['project_media_ref', 'generated_result'],
        state: 'current',
        page: { cursor: null, limit: 20 },
      }),
    ).not.toThrow();
    expect(() =>
      ProjectSearchDefinition.parseInput({
        query: 'moonlit location',
        kinds: [],
        lifecycle: 'active',
        page: { cursor: null, limit: 20 },
      }),
    ).toThrow();
  });

  it('returns a strict source union without a generic ref or chat label', () => {
    expect(() =>
      ProjectSearchDefinition.parseSuccess({
        items: [
          {
            source: messageSource,
            label: 'Original request',
            excerpt: 'Moonlit harbor.',
            score: 1,
          },
          {
            source: { kind: 'production', ref: productionRef },
            label: 'Moonlit harbor',
            excerpt: 'A quiet harbor.',
            score: 0.9,
          },
        ],
        nextCursor: null,
      }),
    ).not.toThrow();
    expect(() =>
      ProjectSearchDefinition.parseSuccess({
        items: [
          {
            ref: productionRef,
            source: 'chat',
            label: 'Legacy hit',
            excerpt: '',
            score: 0.5,
          },
        ],
        nextCursor: null,
      }),
    ).toThrow();
  });
});

describe('Project capabilities view', () => {
  const capabilities = {
    section: 'capabilities',
    revision: 1,
    contentHash: HASH_A,
    defaultProviderProfileId: null,
    enabledSkills: [{ id: 'skill.continuity', version: '1.0.0' }],
  } as const;

  it('exposes exact enabled skill references without retaining legacy IDs', () => {
    expect(() => ProjectGetDefinition.parseSuccess({ sections: [capabilities] })).not.toThrow();
    expect(() =>
      ProjectGetDefinition.parseSuccess({
        sections: [
          {
            ...capabilities,
            enabledSkillIds: ['skill.continuity'],
          },
        ],
      }),
    ).toThrow();
  });
});

describe('R2 history.query', () => {
  const input = {
    sources: ['project_event'],
    eventTypes: ['object_revision_changed'],
    subjects: [{ authority: 'production', id: 'shot.1' }],
    actors: ['commander'],
    time: { from: TIME, to: '2026-08-15T13:00:00.000Z' },
    page: { cursor: null, limit: 20 },
  } as const;

  it('accepts explicit source, event, subject, actor, time, and page filters', () => {
    expect(() => HistoryQueryDefinition.parseInput(input)).not.toThrow();
    expect(() =>
      HistoryQueryDefinition.parseInput({ ...input, time: { ...input.time, unexpected: true } }),
    ).toThrow();
    expect(() =>
      HistoryQueryDefinition.parseInput({
        ...input,
        time: { from: input.time.to, to: input.time.from },
      }),
    ).toThrow();
  });

  it('returns each of the five strict History entry variants', () => {
    const common = { projectId: 'project.1', occurredAt: TIME, summary: 'Public evidence.' };
    const items = [
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
        eventType: 'choice_recorded',
        actor: 'user',
        subject: { authority: 'generated_result', id: 'result.1' },
        causation: { kind: 'message', messageId: 'message.1' },
        correlationId: 'correlation.1',
        payloadHash: HASH_A,
        payloadState: {
          state: 'available',
          payload: { type: 'choice_recorded', choiceId: 'choice.1' },
        },
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
    expect(() => HistoryQueryDefinition.parseSuccess({ items, nextCursor: null })).not.toThrow();
    expect(() =>
      HistoryQueryDefinition.parseSuccess({
        items: [{ ...items[0], eventId: 'event.1' }],
        nextCursor: null,
      }),
    ).toThrow();
  });
});

describe('R2 memory.query', () => {
  it('preserves the full canonical Memory item text limit without storage-layer truncation', () => {
    expect(() =>
      MemoryQueryDefinition.parseSuccess({
        state: 'ready',
        head: memoryHead,
        activeHistoryWatermark: 7,
        items: [{ ...memoryItem, text: 'x'.repeat(100_000) }],
      }),
    ).not.toThrow();
    expect(() =>
      MemoryQueryDefinition.parseSuccess({
        state: 'ready',
        head: memoryHead,
        activeHistoryWatermark: 7,
        items: [{ ...memoryItem, text: 'x'.repeat(100_001) }],
      }),
    ).toThrow();
  });

  it('returns only strict unavailable, ready, or stale states', () => {
    expect(() =>
      MemoryQueryDefinition.parseSuccess({ state: 'unavailable', reason: 'not_built' }),
    ).not.toThrow();
    expect(() =>
      MemoryQueryDefinition.parseSuccess({
        state: 'ready',
        head: memoryHead,
        activeHistoryWatermark: 7,
        items: [memoryItem],
      }),
    ).not.toThrow();
    expect(() =>
      MemoryQueryDefinition.parseSuccess({
        state: 'stale',
        head: memoryHead,
        activeHistoryWatermark: 8,
        items: [memoryItem],
      }),
    ).not.toThrow();
  });

  it('rejects incomplete heads and impossible or mixed states', () => {
    expect(() =>
      MemoryQueryDefinition.parseSuccess({
        state: 'ready',
        head: { ...memoryHead, completeness: 'partial' },
        activeHistoryWatermark: 7,
        items: [],
      }),
    ).toThrow();
    expect(() =>
      MemoryQueryDefinition.parseSuccess({
        state: 'ready',
        head: memoryHead,
        activeHistoryWatermark: 8,
        items: [],
      }),
    ).toThrow();
    expect(() =>
      MemoryQueryDefinition.parseSuccess({
        state: 'unavailable',
        reason: 'failed',
        head: memoryHead,
      }),
    ).toThrow();
    expect(() =>
      MemoryQueryDefinition.parseSuccess({
        state: 'stale',
        head: memoryHead,
        activeHistoryWatermark: 7,
        items: [],
      }),
    ).toThrow();
  });
});
