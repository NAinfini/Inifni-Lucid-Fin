import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { hashCanonical } from '../internal/hashes.js';
import { preflightLegacyPlanHistory } from './plan-history-preflight.js';

const databases: DatabaseSync[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

function database(): DatabaseSync {
  const value = new DatabaseSync(':memory:');
  databases.push(value);
  value.exec(`
    CREATE TABLE plan_documents (
      content_hash TEXT,
      content_json TEXT,
      created_at INTEGER,
      document_type TEXT,
      id TEXT,
      logical_key TEXT,
      revision INTEGER,
      schema_version INTEGER,
      status TEXT,
      task_list_id TEXT,
      updated_at INTEGER
    );
    CREATE TABLE plan_approvals (
      created_at INTEGER,
      decided_at INTEGER,
      gate_key TEXT,
      id TEXT,
      manifest_hash TEXT,
      resume_token_hash TEXT,
      status TEXT,
      subject_hash TEXT,
      subject_logical_key TEXT,
      subject_revision INTEGER,
      task_list_id TEXT,
      updated_at INTEGER
    );
  `);
  return value;
}

interface DocumentInput {
  readonly id: string;
  readonly logicalKey: string;
  readonly revision: number;
  readonly documentType?: string;
  readonly content?: Readonly<Record<string, unknown>>;
  readonly contentJson?: string;
  readonly contentHash?: string;
}

function insertDocument(database: DatabaseSync, input: DocumentInput): string {
  const content = input.content ?? { title: `Private ${input.id}` };
  const contentHash = input.contentHash ?? hashCanonical(content);
  database
    .prepare(`INSERT INTO plan_documents VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      contentHash,
      input.contentJson ?? JSON.stringify(content),
      1_700_000_000_000,
      input.documentType ?? 'production_plan',
      input.id,
      input.logicalKey,
      input.revision,
      1,
      'active',
      'task-list.1',
      1_700_000_000_000,
    );
  return contentHash;
}

interface ApprovalInput {
  readonly id: string;
  readonly logicalKey: string;
  readonly revision: number;
  readonly subjectHash: string;
  readonly status?: 'pending' | 'approved' | 'rejected' | 'invalidated';
}

function insertApproval(database: DatabaseSync, input: ApprovalInput): void {
  const status = input.status ?? 'approved';
  database
    .prepare(`INSERT INTO plan_approvals VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      1_700_000_000_000,
      status === 'pending' ? null : 1_700_000_000_100,
      'production_plan',
      input.id,
      hashCanonical({ manifest: input.id }),
      hashCanonical({ resume: input.id }),
      status,
      input.subjectHash,
      input.logicalKey,
      input.revision,
      'task-list.1',
      1_700_000_000_100,
    );
}

describe('Legacy Plan history preflight', () => {
  it('accepts comparable approved revisions deterministically without exposing private content', () => {
    const main = database();
    const firstHash = insertDocument(main, {
      id: 'document.1',
      logicalKey: 'production-plan',
      revision: 1,
    });
    const secondHash = insertDocument(main, {
      id: 'document.2',
      logicalKey: 'production-plan',
      revision: 2,
    });
    insertApproval(main, {
      id: 'approval.1',
      logicalKey: 'production-plan',
      revision: 1,
      subjectHash: firstHash,
    });
    insertApproval(main, {
      id: 'approval.2',
      logicalKey: 'production-plan',
      revision: 2,
      subjectHash: secondHash,
    });
    const beforeDocuments = main.prepare('SELECT * FROM plan_documents ORDER BY id').all();
    const beforeApprovals = main.prepare('SELECT * FROM plan_approvals ORDER BY id').all();

    const first = preflightLegacyPlanHistory(main);
    const second = preflightLegacyPlanHistory(main);

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      documentCount: 2,
      validDocumentCount: 2,
      approvalCount: 2,
      validApprovalCount: 2,
      approvedApprovalCount: 2,
      approvedGroupCount: 1,
      approvedHeadCount: 1,
      approvedHeads: [
        {
          revision: 2,
        },
      ],
      blockers: [],
      ok: true,
    });
    const approvedHead = first.approvedHeads[0]!;
    expect(approvedHead.groupKey).toMatch(/^[a-f0-9]{64}$/);
    expect(approvedHead.approvalRowKey).toMatch(/^[a-f0-9]{64}$/);
    expect(approvedHead.documentRowKey).toMatch(/^[a-f0-9]{64}$/);
    expect(main.prepare('SELECT * FROM plan_documents ORDER BY id').all()).toEqual(beforeDocuments);
    expect(main.prepare('SELECT * FROM plan_approvals ORDER BY id').all()).toEqual(beforeApprovals);
    const serialized = JSON.stringify(first);
    expect(serialized).not.toContain('Private document');
    expect(serialized).not.toContain(firstHash);
    expect(serialized).not.toContain(secondHash);
    expect(serialized).not.toContain(hashCanonical({ manifest: 'approval.1' }));
    expect(serialized).not.toContain(hashCanonical({ resume: 'approval.1' }));
    expect(first.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(first.sourceFingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it('blocks invalid document JSON and a mismatched canonical content hash', () => {
    const main = database();
    insertDocument(main, {
      id: 'document.invalid-json',
      logicalKey: 'production-plan',
      revision: 1,
      contentJson: '{broken',
      contentHash: hashCanonical({ private: 'invalid' }),
    });
    insertDocument(main, {
      id: 'document.bad-hash',
      logicalKey: 'production-plan',
      revision: 2,
      content: { title: 'Private mismatched content' },
      contentHash: hashCanonical({ different: true }),
    });
    insertDocument(main, {
      id: 'document.invalid-hash',
      logicalKey: 'production-plan',
      revision: 3,
      contentHash: 'not-a-hash',
    });
    insertDocument(main, {
      id: 'document.duplicate-key',
      logicalKey: 'production-plan',
      revision: 4,
      contentJson: '{"safe":1,"safe":2}',
      contentHash: hashCanonical({ safe: 2 }),
    });

    const report = preflightLegacyPlanHistory(main);

    expect(report.validDocumentCount).toBe(0);
    expect(report.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'invalid_plan_document_content',
          reason: 'invalid_json',
        }),
        expect.objectContaining({ kind: 'plan_document_content_hash_mismatch' }),
        expect.objectContaining({
          kind: 'invalid_plan_document_field',
          path: '$.content_hash',
          reason: 'invalid_sha256',
        }),
        expect.objectContaining({
          kind: 'invalid_plan_document_content',
          reason: 'duplicate_object_key',
        }),
      ]),
    );
    expect(report.ok).toBe(false);
    expect(JSON.stringify(report)).not.toContain('Private mismatched content');
  });

  it('blocks document type drift within one logical lineage', () => {
    const main = database();
    const firstHash = insertDocument(main, {
      id: 'document.production',
      logicalKey: 'shared-plan',
      revision: 1,
      documentType: 'production_plan',
    });
    const secondHash = insertDocument(main, {
      id: 'document.visual',
      logicalKey: 'shared-plan',
      revision: 2,
      documentType: 'visual_constitution',
    });
    insertApproval(main, {
      id: 'approval.production',
      logicalKey: 'shared-plan',
      revision: 1,
      subjectHash: firstHash,
    });
    insertApproval(main, {
      id: 'approval.visual',
      logicalKey: 'shared-plan',
      revision: 2,
      subjectHash: secondHash,
    });

    const report = preflightLegacyPlanHistory(main);

    expect(report).toMatchObject({
      validDocumentCount: 0,
      validApprovalCount: 0,
      approvedHeadCount: 0,
      approvedHeads: [],
      ok: false,
    });
    expect(report.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'plan_document_lineage_type_drift',
        }),
      ]),
    );
  });

  it('blocks missing, invalid, and hash-mismatched approval subjects', () => {
    const main = database();
    const subjectHash = insertDocument(main, {
      id: 'document.valid',
      logicalKey: 'production-plan',
      revision: 1,
    });
    insertDocument(main, {
      id: 'document.invalid',
      logicalKey: 'production-plan',
      revision: 2,
      contentJson: '{broken',
    });
    insertApproval(main, {
      id: 'approval.missing',
      logicalKey: 'missing-plan',
      revision: 3,
      subjectHash,
      status: 'rejected',
    });
    insertApproval(main, {
      id: 'approval.invalid',
      logicalKey: 'production-plan',
      revision: 2,
      subjectHash: hashCanonical({ invalid: true }),
      status: 'rejected',
    });
    insertApproval(main, {
      id: 'approval.mismatch',
      logicalKey: 'production-plan',
      revision: 1,
      subjectHash: hashCanonical({ mismatch: true }),
      status: 'rejected',
    });

    const report = preflightLegacyPlanHistory(main);

    expect(report.validApprovalCount).toBe(0);
    expect(report.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'missing_plan_approval_subject' }),
        expect.objectContaining({ kind: 'invalid_plan_approval_subject' }),
        expect.objectContaining({ kind: 'plan_approval_subject_hash_mismatch' }),
      ]),
    );
    expect(report.ok).toBe(false);
  });

  it('blocks approved heads from different logical lineages', () => {
    const main = database();
    const firstHash = insertDocument(main, {
      id: 'document.a',
      logicalKey: 'production-plan-a',
      revision: 1,
    });
    const secondHash = insertDocument(main, {
      id: 'document.b',
      logicalKey: 'production-plan-b',
      revision: 2,
    });
    insertApproval(main, {
      id: 'approval.a',
      logicalKey: 'production-plan-a',
      revision: 1,
      subjectHash: firstHash,
    });
    insertApproval(main, {
      id: 'approval.b',
      logicalKey: 'production-plan-b',
      revision: 2,
      subjectHash: secondHash,
    });

    const report = preflightLegacyPlanHistory(main);

    expect(report).toMatchObject({
      approvedApprovalCount: 2,
      approvedGroupCount: 1,
      approvedHeadCount: 0,
      ok: false,
    });
    expect(report.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'incomparable_approved_plan_heads',
          reason: 'different_logical_keys',
          approvedCount: 2,
        }),
      ]),
    );
  });
});
