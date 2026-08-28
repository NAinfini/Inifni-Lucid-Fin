import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  UserChoiceSchema,
  canonicalJson,
  parseCanonical,
  userChoiceHashInput,
} from '@lucid-fin/contracts';
import { hashCanonical, hashContentObject } from '../internal/hashes.js';
import { getStoreDatabase } from '../internal/database-access.js';
import { appendRunEventBatch } from '../internal/run-journal.js';
import { insertUserChoiceRecord } from '../internal/user-choice-records.js';
import { createStore } from '../kernel/store.js';
import { createProjectHistoryReadModel } from './history.js';

const NOW = '2026-08-15T12:00:00.000Z';
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);
const paths: string[] = [];

afterEach(async () => {
  await Promise.all(paths.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function harness() {
  const directory = await mkdtemp(join(tmpdir(), 'lucid-fin-history-'));
  paths.push(directory);
  const store = await createStore(join(directory, 'project.sqlite'));
  const database = getStoreDatabase(store);
  const messageBlocks = [{ type: 'text', text: 'Use cold moonlight.' }];
  const publicPayload = { type: 'progress', summary: 'Reviewing references.' };
  const provider = {
    providerId: 'provider.1',
    model: 'model.1',
    reasoningStrength: null,
  };
  const causation = { kind: 'message' as const, messageId: 'message.1' };
  const shotWithoutHash = {
    authority: 'production' as const,
    id: 'shot.1',
    projectId: 'project.1',
    revision: 0,
    contentHash: '',
    lifecycle: 'active' as const,
    type: 'shot' as const,
    content: {
      title: 'Harbor',
      description: 'A cold moonlit harbor.',
      durationMs: null,
      shotSize: null,
      cameraMovement: null,
    },
    relations: [],
    protections: [],
    resultDecisions: [],
    createdBy: causation,
    updatedBy: causation,
    createdAt: NOW,
    updatedAt: NOW,
  };
  const shotBefore = {
    ...shotWithoutHash,
    contentHash: hashContentObject(shotWithoutHash),
  };
  const generationSpec = {
    kind: 'image',
    task: 'create',
    target: {
      authority: 'production',
      id: shotBefore.id,
      revision: shotBefore.revision,
      contentHash: shotBefore.contentHash,
    },
    prompt: 'Use cold moonlight.',
    negativePrompt: null,
    references: [],
    provider: { providerId: provider.providerId, model: provider.model },
    outputCount: 1,
    seed: null,
    width: 1920,
    height: 1080,
    guidanceScale: null,
    sourceMaskRefId: null,
  } as const;
  const generationRequest = {
    id: 'generation-request.1',
    projectId: 'project.1',
    runId: 'run.1',
    spec: generationSpec,
    requestHash: hashCanonical(generationSpec),
    idempotencyKey: hashCanonical({ requestId: 'generation-request.1' }),
    createdAt: NOW,
  };
  const promptProvenance = {
    sourceObjectId: generationSpec.target.id,
    sourceRevision: generationSpec.target.revision,
    sourceHash: generationSpec.target.contentHash,
    assemblyHash: hashCanonical({ prompt: generationSpec.prompt }),
    loadedSkillDigests: [],
  };
  const receiptWithoutHash = {
    providerOperationId: 'provider-operation.history',
    submittedAt: NOW,
  };
  const receipt = {
    ...receiptWithoutHash,
    reconciledAt: NOW,
    receiptHash: hashCanonical(receiptWithoutHash),
  };
  const usage = {
    inputTokens: { state: 'known', value: 10 },
    outputTokens: { state: 'known', value: 5 },
    generatedUnits: { state: 'known', value: 1 },
    cost: { state: 'known', value: '0', currency: 'USD' },
  } as const;
  const generationAttemptWithoutHash = {
    authority: 'generation_attempt' as const,
    id: 'generation-attempt.1',
    requestId: generationRequest.id,
    attemptNumber: 1,
    revision: 0,
    contentHash: '',
    state: 'succeeded' as const,
    provider,
    quote: null,
    receipt,
    usage,
    promptProvenance,
    cancelRequested: false,
    progressPercent: 100,
    publicErrorCode: null,
    createdAt: NOW,
    finishedAt: NOW,
    request: generationRequest,
  };
  const generationAttemptHash = hashContentObject(generationAttemptWithoutHash);
  const technicalValidation = {
    state: 'valid' as const,
    mimeTypeValid: true,
    dimensionsValid: true,
    durationValid: null,
    failureCode: null,
  };
  const generatedResultWithoutHash = {
    authority: 'generated_result' as const,
    id: 'result.1',
    projectId: 'project.1',
    runId: 'run.1',
    revision: 0,
    contentHash: '',
    generationRequestId: generationRequest.id,
    generationAttemptId: generationAttemptWithoutHash.id,
    targetProductionObjectId: generationSpec.target.id,
    globalMediaAssetId: 'asset.1',
    mediaBlobHash: HASH_A,
    projectMediaRefId: 'media-ref.1',
    mediaKind: 'image' as const,
    variantIndex: 0,
    state: 'available' as const,
    submittedPrompt: generationSpec.prompt,
    submittedNegativePrompt: generationSpec.negativePrompt,
    promptProvenance,
    referenceBindings: [],
    provider,
    seed: generationSpec.seed,
    receipt,
    usage,
    technicalValidation,
    createdAt: NOW,
    updatedAt: NOW,
  };
  const generatedResultHash = hashContentObject(generatedResultWithoutHash);
  const generatedResultRef = {
    authority: 'generated_result' as const,
    id: generatedResultWithoutHash.id,
    revision: 0 as const,
    contentHash: generatedResultHash,
  };
  const choiceIntent = { kind: 'select' as const, resultId: 'result.1', feedback: '' };
  const subject = {
    kind: 'result_decision' as const,
    shotId: shotBefore.id,
    resultIds: [generatedResultRef.id],
  };
  const beforeEffect = {
    kind: 'result_decisions' as const,
    shotId: shotBefore.id,
    entries: [{ resultId: generatedResultRef.id, value: null }],
  };
  const afterEffect = {
    kind: 'result_decisions' as const,
    shotId: shotBefore.id,
    entries: [
      {
        resultId: generatedResultRef.id,
        value: { state: 'selected' as const, feedback: '' },
      },
    ],
  };
  const shotAfterWithoutHash = {
    ...shotBefore,
    revision: shotBefore.revision + 1,
    contentHash: '',
    resultDecisions: [
      {
        result: generatedResultRef,
        value: afterEffect.entries[0]!.value,
        currentChoiceId: 'choice.1',
      },
    ],
  };
  const shotAfter = {
    ...shotAfterWithoutHash,
    contentHash: hashContentObject(shotAfterWithoutHash),
  };
  const choiceWithPlaceholderHash = parseCanonical(UserChoiceSchema, {
    authority: 'user_choice',
    id: 'choice.1',
    projectId: shotBefore.projectId,
    actor: 'user',
    authorization: {
      kind: 'direct_user',
      requestId: 'request.choice.history',
      inputHash: hashCanonical(choiceIntent),
    },
    causation,
    subject,
    ownerBefore: {
      authority: 'production',
      id: shotBefore.id,
      revision: shotBefore.revision,
      contentHash: shotBefore.contentHash,
    },
    ownerAfter: {
      authority: 'production',
      id: shotAfter.id,
      revision: shotAfter.revision,
      contentHash: shotAfter.contentHash,
    },
    choice: choiceIntent,
    beforeEffect,
    afterEffect,
    supersedesChoiceIds: [],
    createdAt: NOW,
    choiceHash: HASH_A,
  });
  const userChoice = parseCanonical(UserChoiceSchema, {
    ...choiceWithPlaceholderHash,
    choiceHash: hashCanonical(userChoiceHashInput(choiceWithPlaceholderHash)),
  });
  const eventPayload = { type: 'choice_recorded', choiceId: 'choice.1' };

  database.exec('BEGIN IMMEDIATE');
  try {
    database.exec('PRAGMA defer_foreign_keys = ON');
    database
      .prepare(
        `INSERT INTO provider_profiles (
           id, display_name, provider_kind, model, reasoning_strength, endpoint_origin,
           credential_handle, status, configuration_v1_json, revision, created_at, updated_at
         ) VALUES (?, 'History Provider', 'test', ?, NULL, NULL, NULL, 'ready', '{}', 0, ?, ?)`,
      )
      .run(provider.providerId, provider.model, NOW, NOW);
    database
      .prepare(
        `INSERT INTO projects (
           id, name, lifecycle, schema_revision, revision, content_hash,
           created_by_kind, created_by_id, created_at, updated_at, archived_at, deleted_at
         ) VALUES (?, 'Film', 'active', 1, 0, ?, 'direct_ui', 'action.create', ?, ?, NULL, NULL)`,
      )
      .run('project.1', HASH_A, NOW, NOW);
    database
      .prepare(
        `INSERT INTO projects (
           id, name, lifecycle, schema_revision, revision, content_hash,
           created_by_kind, created_by_id, created_at, updated_at, archived_at, deleted_at
         ) VALUES (?, 'Empty', 'active', 1, 0, ?, 'direct_ui', 'action.create', ?, ?, NULL, NULL)`,
      )
      .run('project.empty', HASH_B, NOW, NOW);
    database
      .prepare(
        `INSERT INTO chats (
           id, project_id, revision, content_hash, title, lifecycle, message_count,
           message_head_sequence, created_at, updated_at, archived_at, deleted_at
         ) VALUES ('chat.1', 'project.1', 0, ?, 'Main', 'active', 1, 1, ?, ?, NULL, NULL)`,
      )
      .run(HASH_A, NOW, NOW);
    database
      .prepare(
        `INSERT INTO messages (
           id, project_id, chat_id, sequence, role, status, originating_run_id,
           content_hash, supersedes_message_id, created_at
         ) VALUES ('message.1', 'project.1', 'chat.1', 1, 'user', 'accepted', NULL, ?, NULL, ?)`,
      )
      .run(HASH_A, NOW);
    database
      .prepare(
        `INSERT INTO message_payloads (message_id, blocks_v1_json, payload_hash, erased_at)
         VALUES ('message.1', ?, ?, NULL)`,
      )
      .run(canonicalJson(messageBlocks), hashCanonical(messageBlocks));
    database
      .prepare(
        `INSERT INTO production_objects (
           id, project_id, object_type, revision, content_hash, lifecycle, content_v1_json,
           created_by_kind, created_by_id, updated_by_kind, updated_by_id, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, 'message', ?, 'message', ?, ?, ?)`,
      )
      .run(
        shotBefore.id,
        shotBefore.projectId,
        shotBefore.type,
        shotBefore.revision,
        shotBefore.contentHash,
        shotBefore.lifecycle,
        canonicalJson(shotBefore.content),
        causation.messageId,
        causation.messageId,
        shotBefore.createdAt,
        shotBefore.updatedAt,
      );
    database
      .prepare(
        `INSERT INTO runs (
           id, revision, content_hash, root_run_id, parent_run_id, project_id, chat_id,
           objective_message_id, objective_hash, status, provider_profile_id, model,
           reasoning_strength, permission_mode, budget_v1_json, context_manifest_id,
           context_manifest_hash, capability_catalog_snapshot_id, capability_catalog_hash,
           accepted_at, finished_at, terminal_summary
         ) VALUES (
           'run.1', 0, ?, 'run.1', NULL, 'project.1', 'chat.1', 'message.1', ?, 'running',
           NULL, 'model.1', NULL, 'reversible', '{}', 'context.1', ?, 'catalog.1', ?, ?, NULL, NULL
         )`,
      )
      .run(HASH_A, HASH_A, HASH_A, HASH_A, NOW);
    database
      .prepare(
        `INSERT INTO context_manifests (
           id, run_id, project_id, chat_id, user_message_id, manifest_hash, manifest_v1_json, created_at
         ) VALUES ('context.1', 'run.1', 'project.1', 'chat.1', 'message.1', ?, '{}', ?)`,
      )
      .run(HASH_A, NOW);
    database
      .prepare(
        `INSERT INTO capability_catalog_snapshots (id, run_id, catalog_hash, catalog_v1_json, created_at)
         VALUES ('catalog.1', 'run.1', ?, '{}', ?)`,
      )
      .run(HASH_A, NOW);
    appendRunEventBatch(database, {
      runId: 'run.1',
      commandId: 'command.history.events',
      events: [
        {
          eventId: 'run-event.public',
          visibility: 'public',
          occurredAt: NOW,
          actor: 'commander',
          causation,
          correlationId: 'correlation.1',
          payload: publicPayload,
        },
        {
          eventId: 'run-event.private',
          visibility: 'model_surface',
          occurredAt: NOW,
          actor: 'system',
          causation,
          correlationId: null,
          payload: {
            type: 'tool_call_ref',
            callId: 'call.private',
            toolName: 'must never be read',
            capabilityCatalogSnapshotId: 'catalog.1',
            inputPayloadId: 'payload.private',
            inputSchemaHash: HASH_B,
            inputHash: HASH_B,
          },
        },
      ],
    });
    database
      .prepare(
        `INSERT INTO media_blobs (
           hash, byte_length, mime_type, media_kind, technical_facts_v1_json, created_at
         ) VALUES (?, 1, 'image/png', 'image', '{}', ?)`,
      )
      .run(HASH_A, NOW);
    database
      .prepare(
        `INSERT INTO global_media_assets (
           id, revision, content_hash, blob_hash, media_kind, filename, display_name,
           source_v1_json, folder_id, tags_v1_json, created_at, updated_at
         ) VALUES ('asset.1', 0, ?, ?, 'image', 'frame.png', 'Frame', '{}', NULL, '[]', ?, ?)`,
      )
      .run(HASH_A, HASH_A, NOW, NOW);
    database
      .prepare(
        `INSERT INTO project_media_refs (
           id, project_id, global_asset_id, revision, content_hash, lifecycle, detached_at,
           label, collections_v1_json, roles_v1_json, notes, created_by_kind, created_by_id,
           created_at, updated_at
         ) VALUES (
           'media-ref.1', 'project.1', 'asset.1', 0, ?, 'active', NULL, 'Frame', '[]',
           '["output"]', '', 'run', 'run.1', ?, ?
         )`,
      )
      .run(HASH_A, NOW, NOW);
    database
      .prepare(
        `INSERT INTO generation_requests (
           id, project_id, run_id, target_authority, target_id, target_revision, target_hash,
           spec_v1_json, request_hash, idempotency_key, created_at
         ) VALUES ('generation-request.1', 'project.1', 'run.1', 'production', 'shot.1', 0, ?,
           ?, ?, ?, ?)`,
      )
      .run(
        generationSpec.target.contentHash,
        canonicalJson(generationSpec),
        generationRequest.requestHash,
        generationRequest.idempotencyKey,
        generationRequest.createdAt,
      );
    database
      .prepare(
        `INSERT INTO generation_attempts (
           id, request_id, attempt_number, revision, content_hash, state, provider_profile_id,
           provider_v1_json, quote_v1_json, provider_operation_id, receipt_v1_json,
           usage_v1_json, prompt_provenance_v1_json, cancel_requested, progress_percent,
           public_error_code, created_at, finished_at
         ) VALUES (
           'generation-attempt.1', 'generation-request.1', 1, 0, ?, 'succeeded', ?,
           ?, NULL, ?, ?, ?, ?, 0, 100, NULL, ?, ?
         )`,
      )
      .run(
        generationAttemptHash,
        provider.providerId,
        canonicalJson(provider),
        receipt.providerOperationId,
        canonicalJson(receipt),
        canonicalJson(usage),
        canonicalJson(promptProvenance),
        NOW,
        NOW,
      );
    database
      .prepare(
        `INSERT INTO generated_results (
           id, project_id, request_id, attempt_id, revision, content_hash, blob_hash,
           global_asset_id, project_media_ref_id, media_kind, variant_index,
           submitted_prompt, submitted_negative_prompt, prompt_provenance_v1_json,
           reference_bindings_v1_json, provider_v1_json, seed, receipt_v1_json,
           usage_v1_json, technical_validation_v1_json, created_at
         ) VALUES (
           'result.1', 'project.1', 'generation-request.1', 'generation-attempt.1', 0, ?, ?,
           'asset.1', 'media-ref.1', 'image', 0, ?, NULL, ?, ?, ?, NULL, ?, ?, ?,
           ?
         )`,
      )
      .run(
        generatedResultHash,
        HASH_A,
        generationSpec.prompt,
        canonicalJson(promptProvenance),
        canonicalJson([]),
        canonicalJson(provider),
        canonicalJson(receipt),
        canonicalJson(usage),
        canonicalJson(technicalValidation),
        NOW,
      );
    insertUserChoiceRecord(database, userChoice);
    database
      .prepare(
        `INSERT INTO production_result_decisions (
           project_id, shot_id, generated_result_id, generated_result_revision,
           generated_result_hash, state, feedback, instruction, current_choice_id
         ) VALUES (?, ?, ?, ?, ?, 'selected', '', NULL, ?)`,
      )
      .run(
        shotBefore.projectId,
        shotBefore.id,
        generatedResultRef.id,
        generatedResultRef.revision,
        generatedResultRef.contentHash,
        userChoice.id,
      );
    database
      .prepare(
        `UPDATE production_objects
         SET revision = ?, content_hash = ?, updated_at = ?
         WHERE id = ? AND revision = ? AND content_hash = ?`,
      )
      .run(
        shotAfter.revision,
        shotAfter.contentHash,
        shotAfter.updatedAt,
        shotBefore.id,
        shotBefore.revision,
        shotBefore.contentHash,
      );
    database
      .prepare(
        `INSERT INTO project_events (
           id, project_id, sequence, event_version, event_type, occurred_at, actor,
           subject_authority, subject_id, causation_kind, causation_id, correlation_id,
           idempotency_key, payload_hash, previous_event_hash, event_hash
         ) VALUES (
           'project-event.1', 'project.1', 1, 1, 'choice_recorded', ?, 'user',
           'user_choice', 'choice.1', 'message', 'message.1', 'correlation.1',
           'project-event.1', ?, NULL, ?
         )`,
      )
      .run(NOW, hashCanonical(eventPayload), HASH_C);
    database
      .prepare(
        `INSERT INTO project_event_payloads (project_event_id, payload_v1_json, erased_at)
         VALUES ('project-event.1', ?, NULL)`,
      )
      .run(canonicalJson(eventPayload));
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
  return { store, database, history: createProjectHistoryReadModel(store) };
}

const allHistory = {
  sources: [],
  eventTypes: [],
  subjects: [],
  actors: [],
  time: { from: null, to: null },
  page: { cursor: null, limit: 100 },
} as const;

describe('Project History read model', () => {
  it('reads exactly five public evidence sources with stable chronological tie ordering', async () => {
    const { store, history } = await harness();
    try {
      const result = history.query('project.1', allHistory);
      expect(result.items.map(({ source }) => source)).toEqual([
        'message',
        'run_event',
        'project_event',
        'generated_result',
        'user_choice',
      ]);
      expect(result.items.every(({ summary }) => summary.length > 0)).toBe(true);
      expect(
        result.items.some((entry) => JSON.stringify(entry).includes('must never be read')),
      ).toBe(false);
      expect(history.getWatermark('project.1')).toBe(1);
      expect(history.getWatermark('project.empty')).toBe(0);
    } finally {
      store.close();
    }
  });

  it('returns latest evidence first with direction-bound stable cursors', async () => {
    const { store, history } = await harness();
    try {
      const first = history.query(
        'project.1',
        { ...allHistory, page: { cursor: null, limit: 2 } },
        'reverse_chronological',
      );
      const second = history.query(
        'project.1',
        { ...allHistory, page: { cursor: first.nextCursor, limit: 100 } },
        'reverse_chronological',
      );
      expect([...first.items, ...second.items].map(({ source }) => source)).toEqual([
        'user_choice',
        'generated_result',
        'project_event',
        'run_event',
        'message',
      ]);
      expect(() =>
        history.query(
          'project.1',
          { ...allHistory, page: { cursor: first.nextCursor, limit: 100 } },
          'chronological',
        ),
      ).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));
    } finally {
      store.close();
    }
  });

  it('uses filter-bound stable cursors and keeps redacted ProjectEvent envelopes visible', async () => {
    const { store, database, history } = await harness();
    try {
      const first = history.query('project.1', {
        ...allHistory,
        page: { cursor: null, limit: 2 },
      });
      const second = history.query('project.1', {
        ...allHistory,
        page: { cursor: first.nextCursor, limit: 100 },
      });
      expect([...first.items, ...second.items]).toHaveLength(5);
      expect(() =>
        history.query('project.1', {
          ...allHistory,
          sources: ['project_event'],
          page: { cursor: first.nextCursor, limit: 10 },
        }),
      ).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));

      database
        .prepare(
          `UPDATE project_event_payloads
           SET payload_v1_json = NULL, erased_at = ?
           WHERE project_event_id = 'project-event.1'`,
        )
        .run(NOW);
      const redacted = history.query('project.1', {
        ...allHistory,
        sources: ['project_event'],
        eventTypes: ['choice_recorded'],
        subjects: [{ authority: 'user_choice', id: 'choice.1' }],
        actors: ['user'],
      });
      expect(redacted.items).toEqual([
        expect.objectContaining({
          source: 'project_event',
          eventId: 'project-event.1',
          payloadHash: hashCanonical({ type: 'choice_recorded', choiceId: 'choice.1' }),
          payloadState: { state: 'redacted', erasedAt: NOW },
        }),
      ]);
    } finally {
      store.close();
    }
  });
});
