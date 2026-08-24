import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import BetterSqlite3 from 'better-sqlite3';
import type { PromptAssemblyInputV1, PromptAssemblyOutputV1 } from '@lucid-fin/contracts';
import { PROMPT_ASSEMBLY_TABLE_SQL, TASK_EXECUTION_TABLES_SQL } from '../schema-sql.js';
import { PromptAssemblyRepository } from './prompt-assembly-repository.js';

function input(id: string, overrides: Partial<PromptAssemblyInputV1> = {}): PromptAssemblyInputV1 {
  return {
    version: 1,
    assemblyId: id,
    canvasId: 'canvas-1',
    nodeId: 'node-1',
    nodeUpdatedAt: 10,
    mediaType: 'image',
    mode: 'text-to-image',
    purpose: 'initial',
    authority: { kind: 'canvas-draft' },
    sources: [
      {
        sourceId: 'user-intent',
        sourceHash: 'source-hash',
        kind: 'user-intent',
        label: 'User intent',
        content: 'A quiet rainy street',
        required: true,
      },
    ],
    conditioningManifest: [],
    providerProfile: { providerId: 'image-provider', capabilities: ['image'] },
    hostConstraints: { immutable: ['providerId'] },
    inputHash: `input-hash-${id}`,
    ...overrides,
  };
}

function output(assemblyId: string, inputHash: string): PromptAssemblyOutputV1 {
  return {
    version: 1,
    assemblyId,
    inputHash,
    finalPrompt: 'A quiet rainy street at night, cinematic reflections',
    negativePrompt: 'watermark',
    sourceDecisions: [
      {
        sourceId: 'user-intent',
        sourceHash: 'source-hash',
        disposition: 'applied',
      },
    ],
    summary: 'Preserved the user intent.',
    warnings: [],
  };
}

describe('PromptAssemblyRepository', () => {
  let db: BetterSqlite3.Database;
  let repo: PromptAssemblyRepository;

  beforeEach(() => {
    db = new BetterSqlite3(':memory:');
    db.exec(`${TASK_EXECUTION_TABLES_SQL}\n${PROMPT_ASSEMBLY_TABLE_SQL}`);
    db.exec(`
      INSERT INTO task_lists (
        id, task_list_type, entity_type, trigger_source, status, created_at, updated_at
      ) VALUES ('task-list-1', 'test', 'canvas', 'test', 'pending', 1, 1);
      INSERT INTO tasks (
        id, task_list_id, phase_key, phase_name, phase_order, task_key, name, kind,
        status, updated_at
      ) VALUES (
        'task-1', 'task-list-1', 'test', 'Test', 0, 'test', 'Test', 'validation',
        'pending', 1
      );
    `);
    repo = new PromptAssemblyRepository(db);
  });

  afterEach(() => db.close());

  it('persists an immutable input snapshot and lists a node newest first', () => {
    repo.prepare(input('parent-1', { nodeId: 'parent-node' }));
    const first = repo.prepare(input('assembly-1'), {
      taskListId: 'task-list-1',
      taskId: 'task-1',
      parentAssemblyId: 'parent-1',
    });
    const second = repo.prepare(input('assembly-2'));

    expect(first).toMatchObject({
      id: 'assembly-1',
      status: 'prepared',
      rowVersion: 0,
      taskListId: 'task-list-1',
      parentAssemblyId: 'parent-1',
      input: { assemblyId: 'assembly-1', inputHash: 'input-hash-assembly-1' },
    });
    expect(repo.get('assembly-1')).toMatchObject(first);
    expect(repo.listByNode('canvas-1', 'node-1').map((entry) => entry.id)).toEqual([
      'assembly-2',
      'assembly-1',
    ]);
    expect(second.createdAt).toBeGreaterThanOrEqual(first.createdAt);
  });

  it('assembles exactly once with matching input identity, then marks submission', () => {
    const prepared = repo.prepare(input('assembly-1'));
    const assembled = repo.assemble({
      id: prepared.id,
      expectedRowVersion: prepared.rowVersion,
      inputHash: prepared.inputHash,
      output: output(prepared.id, prepared.inputHash),
      llmProviderId: 'chatgpt-oauth',
      llmModel: 'gpt-test',
    });

    expect(assembled).toMatchObject({
      status: 'assembled',
      rowVersion: 1,
      llmProviderId: 'chatgpt-oauth',
      llmModel: 'gpt-test',
      output: { finalPrompt: 'A quiet rainy street at night, cinematic reflections' },
    });
    expect(() =>
      repo.assemble({
        id: prepared.id,
        expectedRowVersion: prepared.rowVersion,
        inputHash: prepared.inputHash,
        output: output(prepared.id, prepared.inputHash),
        llmProviderId: 'chatgpt-oauth',
      }),
    ).toThrow(/prompt assembly/i);

    const submitted = repo.markSubmitted({
      id: assembled.id,
      expectedRowVersion: assembled.rowVersion,
    });
    expect(submitted).toMatchObject({ status: 'submitted', rowVersion: 2 });
  });

  it('rejects a mismatched output identity without consuming the prepared row', () => {
    const prepared = repo.prepare(input('assembly-1'));
    expect(() =>
      repo.assemble({
        id: prepared.id,
        expectedRowVersion: prepared.rowVersion,
        inputHash: 'other-input-hash',
        output: output(prepared.id, 'other-input-hash'),
        llmProviderId: 'chatgpt-oauth',
      }),
    ).toThrow(/input hash/i);
    expect(repo.get(prepared.id)).toMatchObject({ status: 'prepared', rowVersion: 0 });
  });

  it('allows terminal failures or cancellation only from monotonic active states', () => {
    const prepared = repo.prepare(input('assembly-1'));
    const cancelled = repo.markCancelled({
      id: prepared.id,
      expectedRowVersion: prepared.rowVersion,
      error: 'User cancelled',
    });
    expect(cancelled).toMatchObject({
      status: 'cancelled',
      rowVersion: 1,
      error: 'User cancelled',
    });
    expect(() =>
      repo.markFailed({
        id: cancelled.id,
        expectedRowVersion: cancelled.rowVersion,
        error: 'late',
      }),
    ).toThrow(/prompt assembly/i);

    const second = repo.prepare(input('assembly-2'));
    const assembled = repo.assemble({
      id: second.id,
      expectedRowVersion: second.rowVersion,
      inputHash: second.inputHash,
      output: output(second.id, second.inputHash),
      llmProviderId: 'chatgpt-oauth',
    });
    const submitted = repo.markSubmitted({
      id: assembled.id,
      expectedRowVersion: assembled.rowVersion,
    });
    expect(
      repo.markFailed({
        id: submitted.id,
        expectedRowVersion: submitted.rowVersion,
        error: 'provider failed',
      }),
    ).toMatchObject({ status: 'failed', rowVersion: 3, error: 'provider failed' });
  });
});
