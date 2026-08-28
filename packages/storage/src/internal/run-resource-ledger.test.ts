import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Run } from '@lucid-fin/contracts';
import { createStore } from '../kernel/store.js';
import { withImmediateTransaction } from '../kernel/transaction.js';
import { getStoreDatabase } from './database-access.js';
import { hashCanonical } from './hashes.js';
import { loadRunBudgetExposure } from './run-budget.js';
import {
  appendRunResourceEntry,
  loadRunResourceEntries,
  type RunResourceEntryInput,
} from './run-resource-ledger.js';

const NOW = '2026-08-15T12:00:00.000Z';
const HASH = 'a'.repeat(64);
const paths: string[] = [];

afterEach(async () => {
  await Promise.all(paths.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

function deterministicIds() {
  let count = 0;
  return () => `run_resource_entry.${++count}`;
}

async function harness() {
  const directory = await mkdtemp(join(tmpdir(), 'lucid-fin-resource-ledger-'));
  paths.push(directory);
  const store = await createStore(join(directory, 'project.sqlite'));
  const database = getStoreDatabase(store);
  withImmediateTransaction(database, () => {
    database.exec('PRAGMA defer_foreign_keys = ON');
    database
      .prepare(
        `INSERT INTO projects (
           id, name, lifecycle, schema_revision, revision, content_hash,
           created_by_kind, created_by_id, created_at, updated_at, archived_at, deleted_at
         ) VALUES ('project.1', 'Film', 'active', 1, 0, ?,
           'direct_ui', 'action.1', ?, ?, NULL, NULL)`,
      )
      .run(HASH, NOW, NOW);
    database
      .prepare(
        `INSERT INTO chats (
           id, project_id, revision, content_hash, title, lifecycle, message_count,
           message_head_sequence, created_at, updated_at, archived_at, deleted_at
         ) VALUES ('chat.1', 'project.1', 0, ?, 'Main', 'active', 1, 1, ?, ?, NULL, NULL)`,
      )
      .run(HASH, NOW, NOW);
    database
      .prepare(
        `INSERT INTO messages (
           id, project_id, chat_id, sequence, role, status, originating_run_id,
           content_hash, supersedes_message_id, created_at
         ) VALUES ('message.1', 'project.1', 'chat.1', 1, 'user', 'accepted', NULL, ?, NULL, ?)`,
      )
      .run(HASH, NOW);
    database
      .prepare(
        `INSERT INTO message_payloads (message_id, blocks_v1_json, payload_hash, erased_at)
         VALUES ('message.1', '[{"text":"Start","type":"text"}]', ?, NULL)`,
      )
      .run(hashCanonical([{ type: 'text', text: 'Start' }]));
    database
      .prepare(
        `INSERT INTO runs (
           id, revision, content_hash, root_run_id, parent_run_id, project_id, chat_id,
           objective_message_id, objective_parent_event_id, objective_hash,
           child_display_name, child_public_summary, status, provider_profile_id, model,
           reasoning_strength, permission_mode, budget_v1_json, context_manifest_id,
           context_manifest_hash, capability_catalog_snapshot_id, capability_catalog_hash,
           accepted_at, finished_at, terminal_summary
         ) VALUES ('run.1', 0, ?, 'run.1', NULL, 'project.1', 'chat.1', 'message.1', NULL, ?,
           NULL, NULL, 'running', NULL, 'model.1', NULL, 'reversible', '{}', 'context.1', ?,
           'catalog.1', ?, ?, NULL, NULL)`,
      )
      .run(HASH, HASH, HASH, HASH, NOW);
    database
      .prepare(
        `INSERT INTO context_manifests (
           id, run_id, project_id, chat_id, user_message_id, parent_event_id,
           manifest_hash, manifest_v1_json, created_at
         ) VALUES ('context.1', 'run.1', 'project.1', 'chat.1', 'message.1', NULL, ?, '{}', ?)`,
      )
      .run(HASH, NOW);
    database
      .prepare(
        `INSERT INTO capability_catalog_snapshots (
           id, run_id, catalog_hash, catalog_v1_json, created_at
         ) VALUES ('catalog.1', 'run.1', ?, '{}', ?)`,
      )
      .run(HASH, NOW);
    database
      .prepare(
        `INSERT INTO run_inbox_messages (
           id, run_id, sequence, actor, source_v1_json, selected_context_v1_json,
           content_hash, state, created_at
         ) VALUES ('inbox.1', 'run.1', 1, 'user',
           '{"contentHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","kind":"message","messageId":"message.1"}',
           '[]', ?, 'delivered', ?)`,
      )
      .run(HASH, NOW);
    database
      .prepare(
        `INSERT INTO run_activations (
           id, run_id, activation_number, trigger_inbox_message_id, trigger_inbox_sequence,
           state, event_start_sequence, event_end_sequence, started_at, ended_at, end_reason
         ) VALUES ('activation.1', 'run.1', 1, 'inbox.1', 1,
           'active', 1, NULL, ?, NULL, NULL)`,
      )
      .run(NOW);
    database
      .prepare(
        `INSERT INTO model_attempts (
           id, run_id, activation_id, attempt_number, provider_v1_json, state,
           request_v1_json, request_hash, response_hash, usage_v1_json, created_at, finished_at
         ) VALUES ('model.attempt.1', 'run.1', 'activation.1', 1,
           '{"model":"model.1","providerId":"provider.1","reasoningStrength":null}',
           'prepared', '{}', ?, NULL, NULL, ?, NULL)`,
      )
      .run(HASH, NOW);
    database
      .prepare(
        `INSERT INTO dispatch_operations (
           id, run_id, tool_id, tool_version, guard_outcome, idempotency_key,
           input_hash, input_v1_json, confirmation_id, operation_kind,
           owner_authority, owner_id, project_event_id, created_at, updated_at
         ) VALUES ('dispatch.1', 'run.1', 'generation.submit', '1.0.0', 'allowed', ?,
           ?, '{}', NULL, NULL, NULL, NULL, NULL, ?, ?)`,
      )
      .run(hashCanonical({ dispatch: 1 }), HASH, NOW, NOW);
  });
  const environment = { now: () => NOW, createId: deterministicIds() };
  const append = (input: RunResourceEntryInput) =>
    withImmediateTransaction(database, () => appendRunResourceEntry(database, environment, input));
  return { store, database, environment, append };
}

function entry(
  suffix: string,
  overrides: Partial<RunResourceEntryInput> = {},
): RunResourceEntryInput {
  return {
    runId: 'run.1',
    source: { kind: 'dispatch_operation', id: 'dispatch.1' },
    phase: 'reserved',
    reservationEntryId: null,
    kind: 'cost',
    amount: { state: 'known', value: '1', currency: 'USD' },
    idempotencyKey: hashCanonical({ ledger: suffix }),
    recordedAt: NOW,
    ...overrides,
  };
}

describe('Run resource ledger', () => {
  it('keeps direct unknown cost consumption exposed as unknown', async () => {
    const fixture = await harness();
    try {
      fixture.append(
        entry('direct-unknown-cost', {
          phase: 'consumed',
          amount: { state: 'unknown', currency: 'USD' },
        }),
      );
      const run = {
        id: 'run.1',
        budget: { costUsd: { state: 'known', value: '10', currency: 'USD' } },
      } as Run;
      expect(loadRunBudgetExposure(fixture.database, run).cost).toBeNull();
    } finally {
      fixture.store.close();
    }
  });

  it('conserves exact decimal reservations and replays only identical semantics', async () => {
    const fixture = await harness();
    try {
      const reservationInput = entry('exact-reservation', {
        amount: { state: 'known', value: '1000000000000000000000000000', currency: 'USD' },
      });
      const reservation = fixture.append(reservationInput);
      fixture.append(
        entry('exact-consumed', {
          phase: 'consumed',
          reservationEntryId: reservation.id,
          amount: { state: 'known', value: '0.1', currency: 'USD' },
        }),
      );
      fixture.append(
        entry('exact-released', {
          phase: 'released',
          reservationEntryId: reservation.id,
          amount: {
            state: 'known',
            value: '999999999999999999999999999.9',
            currency: 'USD',
          },
        }),
      );
      expect(fixture.append(reservationInput)).toEqual(reservation);
      expect(() =>
        fixture.append({
          ...reservationInput,
          amount: { state: 'known', value: '2', currency: 'USD' },
        }),
      ).toThrowError(expect.objectContaining({ code: 'IDEMPOTENCY_CONFLICT' }));

      const small = fixture.append(
        entry('small-reservation', {
          amount: { state: 'known', value: '0.3', currency: 'USD' },
        }),
      );
      fixture.append(
        entry('small-consumed', {
          phase: 'consumed',
          reservationEntryId: small.id,
          amount: { state: 'known', value: '0.1', currency: 'USD' },
        }),
      );
      expect(() =>
        fixture.append(
          entry('small-over-release', {
            phase: 'released',
            reservationEntryId: small.id,
            amount: { state: 'known', value: '0.20000000000000001', currency: 'USD' },
          }),
        ),
      ).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));
      expect(loadRunResourceEntries(fixture.database, 'run.1')).toHaveLength(5);
    } finally {
      fixture.store.close();
    }
  });

  it('keeps unknown reservations unknown, currency-bound, and single-closure', async () => {
    const fixture = await harness();
    try {
      const reservation = fixture.append(
        entry('unknown-reservation', {
          amount: { state: 'unknown', currency: 'USD' },
        }),
      );
      expect(() =>
        fixture.append(
          entry('unknown-wrong-currency', {
            phase: 'consumed',
            reservationEntryId: reservation.id,
            amount: { state: 'unknown', currency: 'EUR' },
          }),
        ),
      ).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));
      fixture.append(
        entry('unknown-consumed', {
          phase: 'consumed',
          reservationEntryId: reservation.id,
          amount: { state: 'unknown', currency: 'USD' },
        }),
      );
      expect(() =>
        fixture.append(
          entry('unknown-second-closure', {
            phase: 'released',
            reservationEntryId: reservation.id,
            amount: { state: 'unknown', currency: 'USD' },
          }),
        ),
      ).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));

      const known = fixture.append(entry('known-reservation'));
      expect(() =>
        fixture.append(
          entry('known-unknown-consumption', {
            phase: 'consumed',
            reservationEntryId: known.id,
            amount: { state: 'unknown', currency: 'USD' },
          }),
        ),
      ).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));
    } finally {
      fixture.store.close();
    }
  });

  it('rejects cross-source parents and count over-consumption, then detects persisted corruption', async () => {
    const fixture = await harness();
    try {
      const reservation = fixture.append(
        entry('count-reservation', {
          kind: 'generation_count',
          amount: { state: 'known', value: 2 },
        }),
      );
      expect(() =>
        fixture.append(
          entry('cross-source', {
            source: { kind: 'model_attempt', id: 'model.attempt.1' },
            phase: 'consumed',
            reservationEntryId: reservation.id,
            kind: 'generation_count',
            amount: { state: 'known', value: 1 },
          }),
        ),
      ).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));
      expect(() =>
        fixture.append(
          entry('count-over', {
            phase: 'consumed',
            reservationEntryId: reservation.id,
            kind: 'generation_count',
            amount: { state: 'known', value: 3 },
          }),
        ),
      ).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));
      fixture.database
        .prepare('UPDATE run_resource_entries SET amount_v1_json = ? WHERE id = ?')
        .run('{"currency":"USD","state":"known","value":"3"}', reservation.id);
      expect(() => loadRunResourceEntries(fixture.database, 'run.1')).toThrowError(
        expect.objectContaining({ code: 'CORRUPT_DATA' }),
      );
    } finally {
      fixture.store.close();
    }
  });
});
