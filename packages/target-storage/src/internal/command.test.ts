import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import type { WireRequestV1, WireSuccessV1 } from '@lucid-fin/target-contracts';
import { createTargetStore } from '../kernel/store.js';
import { TargetStorageError } from '../kernel/errors.js';
import { withImmediateTransaction } from '../kernel/transaction.js';
import { getTargetStoreDatabase } from './database-access.js';
import { executeWireMutation, type TargetCommandContext } from './command.js';
import { hashProjectEventEnvelope } from './hashes.js';
import { appendProjectEvent } from './project-events.js';

const NOW = '2026-08-15T12:00:00.000Z';
const LATER = '2026-08-15T12:05:00.000Z';
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);
const disposablePaths: string[] = [];

const context: TargetCommandContext = {
  actor: 'user',
  causation: { kind: 'direct_ui', actionId: 'action.project-update' },
  correlationId: 'correlation.project-update',
};

async function openDatabase(): Promise<{ database: DatabaseSync; close(): void }> {
  const directory = await mkdtemp(join(tmpdir(), 'lucid-fin-target-command-'));
  disposablePaths.push(directory);
  const store = await createTargetStore(join(directory, 'project.sqlite'));
  return { database: getTargetStoreDatabase(store), close: () => store.close() };
}

function insertProject(database: DatabaseSync): void {
  database
    .prepare(
      `INSERT INTO projects (
         id, name, lifecycle, schema_revision, revision, content_hash,
         created_by_kind, created_by_id, created_at, updated_at, archived_at, deleted_at
       ) VALUES (?, ?, 'active', 1, 0, ?, 'direct_ui', ?, ?, ?, NULL, NULL)`,
    )
    .run('project.1', 'Demo film', HASH_A, 'action.create', NOW, NOW);
}

function updateRequest(
  name = 'Renamed film',
): Extract<WireRequestV1, { method: 'project.update' }> {
  return {
    wireVersion: 1,
    kind: 'request',
    requestId: 'request.project-update',
    method: 'project.update',
    input: { projectId: 'project.1', expectedRevision: 0, name, lifecycle: null },
  };
}

function updateSuccess(
  request: Extract<WireRequestV1, { method: 'project.update' }>,
): Extract<WireSuccessV1, { method: 'project.update' }> {
  return {
    wireVersion: 1,
    kind: 'success',
    requestId: request.requestId,
    method: request.method,
    result: {
      authority: 'project',
      id: 'project.1',
      name: request.input.name ?? 'Demo film',
      lifecycle: 'active',
      schemaRevision: 1,
      revision: 1,
      contentHash: HASH_B,
      createdBy: { kind: 'direct_ui', actionId: 'action.create' },
      createdAt: NOW,
      updatedAt: LATER,
      archivedAt: null,
      deletedAt: null,
    },
  };
}

afterEach(async () => {
  await Promise.all(
    disposablePaths.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe('receipt-first Wire mutation', () => {
  it('replays one byte-equivalent success without executing the effect twice', async () => {
    const { database, close } = await openDatabase();
    try {
      insertProject(database);
      const request = updateRequest();
      let calls = 0;
      const execute = () => {
        calls += 1;
        return { projectId: 'project.1', response: updateSuccess(request) };
      };

      const first = executeWireMutation(database, request, context, LATER, execute);
      const replay = executeWireMutation(database, request, context, LATER, execute);

      expect(replay).toEqual(first);
      expect(calls).toBe(1);
      expect(database.prepare('SELECT COUNT(*) AS count FROM wire_command_receipts').get()).toEqual(
        {
          count: 1,
        },
      );
    } finally {
      close();
    }
  });

  it('rejects requestId reuse with different semantic input or trusted context', async () => {
    const { database, close } = await openDatabase();
    try {
      insertProject(database);
      const request = updateRequest();
      executeWireMutation(database, request, context, LATER, () => ({
        projectId: 'project.1',
        response: updateSuccess(request),
      }));

      expect(() =>
        executeWireMutation(database, updateRequest('Different'), context, LATER, () => {
          throw new Error('must not execute');
        }),
      ).toThrowError(expect.objectContaining({ code: 'IDEMPOTENCY_CONFLICT' }));
      expect(() =>
        executeWireMutation(
          database,
          request,
          { ...context, correlationId: 'correlation.changed' },
          LATER,
          () => {
            throw new Error('must not execute');
          },
        ),
      ).toThrowError(expect.objectContaining({ code: 'IDEMPOTENCY_CONFLICT' }));
    } finally {
      close();
    }
  });

  it('rejects a tampered receipt and rolls back a failed effect', async () => {
    const { database, close } = await openDatabase();
    try {
      insertProject(database);
      const request = updateRequest();
      executeWireMutation(database, request, context, LATER, () => ({
        projectId: 'project.1',
        response: updateSuccess(request),
      }));
      database
        .prepare('UPDATE wire_command_receipts SET response_v1_json = ? WHERE request_id = ?')
        .run('{}', request.requestId);
      expect(() =>
        executeWireMutation(database, request, context, LATER, () => {
          throw new Error('must not execute');
        }),
      ).toThrowError(expect.objectContaining({ code: 'CORRUPT_DATA' }));

      const failedRequest = { ...updateRequest('Will roll back'), requestId: 'request.rollback' };
      expect(() =>
        executeWireMutation(database, failedRequest, context, LATER, () => {
          database
            .prepare('UPDATE projects SET name = ? WHERE id = ?')
            .run('Transient', 'project.1');
          throw new Error('injected failure');
        }),
      ).toThrow('injected failure');
      expect(database.prepare('SELECT name FROM projects WHERE id = ?').get('project.1')).toEqual({
        name: 'Demo film',
      });
      expect(
        database
          .prepare('SELECT COUNT(*) AS count FROM wire_command_receipts WHERE request_id = ?')
          .get('request.rollback'),
      ).toEqual({ count: 0 });
    } finally {
      close();
    }
  });
});

describe('ProjectEvent appender', () => {
  it('appends a continuous, recomputable immutable hash chain', async () => {
    const { database, close } = await openDatabase();
    try {
      insertProject(database);
      const [created, changed] = withImmediateTransaction(database, () => {
        const first = appendProjectEvent(database, {
          eventId: 'event.1',
          projectId: 'project.1',
          occurredAt: NOW,
          actor: context.actor,
          subject: { authority: 'project', id: 'project.1' },
          causation: context.causation,
          correlationId: context.correlationId,
          idempotencyKey: 'request.events:0',
          payload: { type: 'object_created', revision: 0, contentHash: HASH_A },
        });
        const second = appendProjectEvent(database, {
          eventId: 'event.2',
          projectId: 'project.1',
          occurredAt: LATER,
          actor: context.actor,
          subject: { authority: 'project', id: 'project.1' },
          causation: context.causation,
          correlationId: context.correlationId,
          idempotencyKey: 'request.events:1',
          payload: {
            type: 'object_revision_changed',
            beforeRevision: 0,
            afterRevision: 1,
            beforeHash: HASH_A,
            afterHash: HASH_C,
          },
        });
        return [first, second] as const;
      });

      expect(created.sequence).toBe(1);
      expect(created.previousEventHash).toBeNull();
      expect(changed.sequence).toBe(2);
      expect(changed.previousEventHash).toBe(created.eventHash);
      expect(created.eventHash).toBe(hashProjectEventEnvelope(created));
      expect(changed.eventHash).toBe(hashProjectEventEnvelope(changed));
      expect(
        database.prepare('SELECT COUNT(*) AS count FROM project_event_payloads').get(),
      ).toEqual({ count: 2 });
    } finally {
      close();
    }
  });
});

describe('TargetStorageError', () => {
  it('retains typed codes without exposing internal payloads', () => {
    expect(new TargetStorageError('CORRUPT_DATA', 'bad').code).toBe('CORRUPT_DATA');
  });
});
