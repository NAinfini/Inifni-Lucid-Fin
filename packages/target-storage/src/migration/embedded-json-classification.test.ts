import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildLegacyClassificationReport,
  legacyClassificationSourceKey,
} from './classification-report.js';
import {
  scanLegacyRowsForClassification,
  type LegacyClassificationRow,
} from './classification-subjects.js';
import {
  classifyLegacyEmbeddedJsonMembers,
  enumerateLegacyEmbeddedJsonClassificationSubjects,
  LEGACY_EMBEDDED_JSON_SOURCES,
  type LegacyEmbeddedJsonSource,
} from './embedded-json-classification.js';
import { I0_LEGACY_SOURCE_SCHEMAS } from './legacy-source-schema.js';
import { resolveLegacyProjectOwnership } from './project-ownership-graph.js';
import type { LegacySourceExpectedSchemas } from './source-preflight.js';

const databases: DatabaseSync[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

function database(schema: string): DatabaseSync {
  const value = new DatabaseSync(':memory:');
  databases.push(value);
  value.exec(schema);
  return value;
}

const COMMANDER_SESSION_MESSAGE_SOURCES = [
  { database: 'main', table: 'commander_sessions', columns: ['messages'] },
] as const satisfies readonly LegacyEmbeddedJsonSource[];

function commanderSessionExpected(): LegacySourceExpectedSchemas {
  return {
    main: {
      tables: [
        {
          name: 'commander_sessions',
          kind: 'table',
          columns: ['default_canvas_id', 'id', 'messages'],
        },
      ],
    },
    prompts: { tables: [] },
  };
}

function importedCommanderSessionContext(
  main: DatabaseSync,
  prompts: DatabaseSync,
  expected: LegacySourceExpectedSchemas,
  blockedSessionId?: string,
) {
  const rows: LegacyClassificationRow[] = [];
  const inventory = scanLegacyRowsForClassification({ main, prompts }, expected, (row) => {
    rows.push(row);
  });
  const ownership = resolveLegacyProjectOwnership(inventory.fingerprint, rows);
  const assignments = new Map(
    ownership.assignments.map((assignment) => [assignment.sourceKey, assignment] as const),
  );
  const rootClassification = buildLegacyClassificationReport({
    sourceFingerprint: inventory.fingerprint,
    subjects: inventory.subjects,
    entries: rows.map((row) => {
      const assignment = assignments.get(legacyClassificationSourceKey(row.subject));
      if (!assignment || assignment.disposition !== 'imported_chat_project') {
        throw new Error('Expected an imported Commander session ownership assignment');
      }
      if (row.values.id === blockedSessionId) {
        return {
          subject: row.subject,
          disposition: 'blocking_error' as const,
          reasonCode: 'legacy_test_session_owner_blocked',
          targetRefs: [],
          exportRef: null,
          blockerCode: 'legacy_test_session_owner_blocked',
        };
      }
      return {
        subject: row.subject,
        disposition: 'migrated_current_state' as const,
        reasonCode: 'legacy_unassigned_chat_imported_project',
        targetRefs: assignment.targetRefs,
        exportRef: null,
        blockerCode: null,
      };
    }),
  });
  return { ownership, rootClassification };
}

function classifyImportedCommanderSessionMessages(
  main: DatabaseSync,
  prompts: DatabaseSync,
  expected: LegacySourceExpectedSchemas,
  blockedSessionId?: string,
) {
  const { ownership, rootClassification } = importedCommanderSessionContext(
    main,
    prompts,
    expected,
    blockedSessionId,
  );
  return classifyLegacyEmbeddedJsonMembers({ main, prompts }, expected, {
    sources: COMMANDER_SESSION_MESSAGE_SOURCES,
    ownership,
    rootClassification,
  });
}

describe('Legacy embedded JSON classification', () => {
  it('registers every frozen JSON-like column without treating opaque strings as JSON', () => {
    const sources = LEGACY_EMBEDDED_JSON_SOURCES.flatMap(({ database, table, columns }) =>
      columns.map((column) => `${database}.${table}.${column}`),
    );

    expect(sources).toHaveLength(66);
    expect(new Set(sources).size).toBe(sources.length);
    expect(sources).toEqual([...sources].sort());
    for (const source of LEGACY_EMBEDDED_JSON_SOURCES) {
      const table = I0_LEGACY_SOURCE_SCHEMAS[source.database].tables.find(
        ({ name }) => name === source.table,
      );
      expect(table, `${source.database}.${source.table}`).toBeDefined();
      expect(source.columns.every((column) => table?.columns.includes(column))).toBe(true);
    }
    expect(sources).toEqual(
      expect.arrayContaining([
        'main.asset_entries.tags',
        'main.canvases.viewport',
        'main.characters.distinct_traits',
        'main.commander_events.payload',
        'main.commander_sessions.messages',
        'main.project_settings.value',
        'main.scripts.parsed_scenes',
        'main.snapshots.data',
      ]),
    );
    expect(sources).not.toEqual(
      expect.arrayContaining([
        'main.canvases.style_plate',
        'main.commander_events.private_payload',
        'main.task_attempts.provider_receipt',
      ]),
    );
  });

  it('enumerates every document and nested member deterministically without leaking values or keys', () => {
    const main = database(`
      CREATE TABLE docs (id TEXT, optional TEXT, payload TEXT);
      INSERT INTO docs VALUES (
        'a-1',
        NULL,
        '{"Private customer name":{"choices":[true,null]},"list":[{"assetHash":"Private hash"}]}'
      );
      INSERT INTO docs VALUES ('a-2', x'00', '{broken');
    `);
    const prompts = database(`
      CREATE TABLE prompt_rows (body TEXT, id TEXT);
      INSERT INTO prompt_rows VALUES ('["Private prompt",{"Private key":"Private value"}]', 'p-1');
    `);
    const expected: LegacySourceExpectedSchemas = {
      main: {
        tables: [{ name: 'docs', kind: 'table', columns: ['id', 'optional', 'payload'] }],
      },
      prompts: {
        tables: [{ name: 'prompt_rows', kind: 'table', columns: ['body', 'id'] }],
      },
    };
    const sources: readonly LegacyEmbeddedJsonSource[] = [
      { database: 'prompts', table: 'prompt_rows', columns: ['body'] },
      { database: 'main', table: 'docs', columns: ['payload', 'optional'] },
    ];
    const before = {
      main: main.prepare('SELECT * FROM docs ORDER BY id').all(),
      prompts: prompts.prepare('SELECT * FROM prompt_rows ORDER BY id').all(),
    };

    const first = enumerateLegacyEmbeddedJsonClassificationSubjects(
      { main, prompts },
      expected,
      sources,
    );
    const second = enumerateLegacyEmbeddedJsonClassificationSubjects(
      { main, prompts },
      expected,
      [...sources].reverse(),
    );

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      sourceCount: 3,
      documentCount: 4,
      subjectCount: 14,
      invalidDocumentCount: 2,
      bySource: [
        {
          database: 'main',
          table: 'docs',
          column: 'optional',
          documentCount: 1,
          subjectCount: 1,
          invalidDocumentCount: 1,
        },
        {
          database: 'main',
          table: 'docs',
          column: 'payload',
          documentCount: 2,
          subjectCount: 9,
          invalidDocumentCount: 1,
        },
        {
          database: 'prompts',
          table: 'prompt_rows',
          column: 'body',
          documentCount: 1,
          subjectCount: 4,
          invalidDocumentCount: 0,
        },
      ],
      issues: [{ reason: 'not_text' }, { reason: 'invalid_json' }],
      ok: false,
    });
    expect(first.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(first.subjects.every(({ path }) => /^\$\.[a-z_]+(?:#[a-f0-9]{64})?$/.test(path))).toBe(
      true,
    );
    const serialized = JSON.stringify(first);
    expect(serialized).not.toContain('Private');
    expect(serialized).not.toContain('assetHash');
    expect(serialized).not.toContain('{broken');
    expect(main.prepare('SELECT * FROM docs ORDER BY id').all()).toEqual(before.main);
    expect(prompts.prepare('SELECT * FROM prompt_rows ORDER BY id').all()).toEqual(before.prompts);
  });

  it('leaves valid members unclassified until an owner maps them and blocks invalid documents', () => {
    const main = database(`
      CREATE TABLE docs (id TEXT, payload TEXT);
      INSERT INTO docs VALUES ('valid', '{"Private key":["Private value"]}');
    `);
    const prompts = database('PRAGMA user_version = 1;');
    const expected: LegacySourceExpectedSchemas = {
      main: { tables: [{ name: 'docs', kind: 'table', columns: ['id', 'payload'] }] },
      prompts: { tables: [] },
    };
    const sources = [{ database: 'main', table: 'docs', columns: ['payload'] }] as const;

    const withoutOwner = classifyLegacyEmbeddedJsonMembers({ main, prompts }, expected, {
      sources,
    });
    expect(withoutOwner).toMatchObject({
      classification: {
        counts: { subjectCount: 3, classifiedCount: 0 },
        blockers: [
          { kind: 'unclassified_subject' },
          { kind: 'unclassified_subject' },
          { kind: 'unclassified_subject' },
        ],
        ok: false,
      },
      ok: false,
    });

    const memberPaths: Array<readonly (string | number)[]> = [];
    const classified = classifyLegacyEmbeddedJsonMembers({ main, prompts }, expected, {
      sources,
      classifyMembers(members) {
        for (const member of members) memberPaths.push(member.memberPath);
        return members.map(({ subject }) => ({
          subject,
          disposition: 'offline_legacy_export',
          reasonCode: 'test_legacy_embedded_json_export',
          targetRefs: [],
          exportRef: `legacy-export/test/${legacyClassificationSourceKey(subject)}`,
          blockerCode: null,
        }));
      },
    });

    expect(memberPaths).toEqual([[], ['Private key'], ['Private key', 0]]);
    expect(classified).toMatchObject({
      inventory: { subjectCount: 3, invalidDocumentCount: 0, ok: true },
      classification: {
        counts: {
          subjectCount: 3,
          classifiedCount: 3,
          byDisposition: { offline_legacy_export: 3 },
        },
        blockers: [],
        ok: true,
      },
      ok: true,
    });
    expect(JSON.stringify(classified)).not.toContain('Private');

    main.prepare('UPDATE docs SET payload = ? WHERE id = ?').run('{broken', 'valid');
    const invalid = classifyLegacyEmbeddedJsonMembers({ main, prompts }, expected, { sources });
    expect(invalid).toMatchObject({
      inventory: {
        subjectCount: 1,
        invalidDocumentCount: 1,
        issues: [{ reason: 'invalid_json' }],
        ok: false,
      },
      classification: {
        counts: { subjectCount: 1, classifiedCount: 1, byDisposition: { blocking_error: 1 } },
        blockers: [
          {
            kind: 'classified_blocking_error',
            blockerCode: 'legacy_embedded_json_document_invalid_json',
          },
        ],
        ok: false,
      },
      ok: false,
    });
  });

  it('keeps Snapshot payloads offline and rebuilds rather than imports session context graphs', () => {
    const main = database(`
      CREATE TABLE commander_sessions (context_graph_json TEXT, id TEXT, messages TEXT);
      CREATE TABLE snapshots (data TEXT, id TEXT);
      INSERT INTO commander_sessions VALUES (
        '{"Private memory":true}',
        'session-1',
        '[]'
      );
      INSERT INTO snapshots VALUES ('{"Private snapshot":1}', 'snapshot-1');
    `);
    const prompts = database('PRAGMA user_version = 1;');
    const expected: LegacySourceExpectedSchemas = {
      main: {
        tables: [
          {
            name: 'commander_sessions',
            kind: 'table',
            columns: ['context_graph_json', 'id', 'messages'],
          },
          { name: 'snapshots', kind: 'table', columns: ['data', 'id'] },
        ],
      },
      prompts: { tables: [] },
    };
    const report = classifyLegacyEmbeddedJsonMembers({ main, prompts }, expected, {
      sources: [
        {
          database: 'main',
          table: 'commander_sessions',
          columns: ['context_graph_json', 'messages'],
        },
        { database: 'main', table: 'snapshots', columns: ['data'] },
      ],
    });

    expect(report).toMatchObject({
      inventory: { documentCount: 3, subjectCount: 5, invalidDocumentCount: 0, ok: true },
      classification: {
        counts: {
          subjectCount: 5,
          classifiedCount: 5,
          byDisposition: { blocking_error: 1, offline_legacy_export: 4 },
        },
        blockers: [
          {
            kind: 'classified_blocking_error',
            blockerCode: 'unresolved_legacy_commander_session_messages_owner',
          },
        ],
        ok: false,
      },
      ok: false,
    });
    expect(new Set(report.classification.entries.map(({ reasonCode }) => reasonCode))).toEqual(
      new Set([
        'legacy_commander_session_messages_owner_unresolved',
        'legacy_context_graph_offline_rebuild',
        'legacy_snapshot_embedded_offline_backup',
      ]),
    );
    expect(JSON.stringify(report)).not.toContain('Private');
  });

  it('enumerates duplicate object members and blocks the whole ambiguous document', () => {
    const main = database(`
      CREATE TABLE docs (id TEXT, payload TEXT);
      INSERT INTO docs VALUES ('duplicate', '{"Private key":1,"Private key":2}');
    `);
    const prompts = database('PRAGMA user_version = 1;');
    const expected: LegacySourceExpectedSchemas = {
      main: { tables: [{ name: 'docs', kind: 'table', columns: ['id', 'payload'] }] },
      prompts: { tables: [] },
    };
    const report = classifyLegacyEmbeddedJsonMembers({ main, prompts }, expected, {
      sources: [{ database: 'main', table: 'docs', columns: ['payload'] }],
    });

    expect(report).toMatchObject({
      inventory: {
        documentCount: 1,
        subjectCount: 3,
        invalidDocumentCount: 1,
        issues: [{ reason: 'duplicate_object_key' }],
        ok: false,
      },
      classification: {
        counts: { subjectCount: 3, classifiedCount: 3, byDisposition: { blocking_error: 3 } },
        blockers: [
          {
            kind: 'classified_blocking_error',
            blockerCode: 'legacy_embedded_json_duplicate_object_key',
          },
          {
            kind: 'classified_blocking_error',
            blockerCode: 'legacy_embedded_json_duplicate_object_key',
          },
          {
            kind: 'classified_blocking_error',
            blockerCode: 'legacy_embedded_json_duplicate_object_key',
          },
        ],
        ok: false,
      },
      ok: false,
    });
    expect(new Set(report.inventory.subjects.map(({ path }) => path)).size).toBe(3);
    expect(JSON.stringify(report)).not.toContain('Private');
  });

  it('turns JSON structures beyond the native inspection boundary into an explicit blocker', () => {
    const main = database('CREATE TABLE docs (id TEXT, payload TEXT);');
    const prompts = database('PRAGMA user_version = 1;');
    const expected: LegacySourceExpectedSchemas = {
      main: { tables: [{ name: 'docs', kind: 'table', columns: ['id', 'payload'] }] },
      prompts: { tables: [] },
    };
    const deeplyNested = `${'['.repeat(1_001)}0${']'.repeat(1_001)}`;
    main.prepare('INSERT INTO docs VALUES (?, ?)').run('deep', deeplyNested);

    const report = classifyLegacyEmbeddedJsonMembers({ main, prompts }, expected, {
      sources: [{ database: 'main', table: 'docs', columns: ['payload'] }],
    });

    expect(report).toMatchObject({
      inventory: {
        documentCount: 1,
        subjectCount: 1,
        invalidDocumentCount: 1,
        issues: [{ reason: 'uninspectable_structure' }],
        ok: false,
      },
      classification: {
        counts: { subjectCount: 1, classifiedCount: 1, byDisposition: { blocking_error: 1 } },
        blockers: [
          {
            kind: 'classified_blocking_error',
            blockerCode: 'legacy_embedded_json_uninspectable_structure',
          },
        ],
        ok: false,
      },
      ok: false,
    });
    expect(JSON.stringify(report)).not.toContain(deeplyNested);
  });

  it('rejects root classifications produced from a different source snapshot', () => {
    const main = database(`
      CREATE TABLE docs (id TEXT, payload TEXT);
      INSERT INTO docs VALUES ('row-1', '{}');
    `);
    const prompts = database('PRAGMA user_version = 1;');
    const expected: LegacySourceExpectedSchemas = {
      main: { tables: [{ name: 'docs', kind: 'table', columns: ['id', 'payload'] }] },
      prompts: { tables: [] },
    };
    const staleRootClassification = buildLegacyClassificationReport({
      sourceFingerprint: '0'.repeat(64),
      subjects: [],
      entries: [],
    });

    expect(() =>
      classifyLegacyEmbeddedJsonMembers({ main, prompts }, expected, {
        sources: [{ database: 'main', table: 'docs', columns: ['payload'] }],
        rootClassification: staleRootClassification,
      }),
    ).toThrow('root classification inspected a different source snapshot');
  });

  it('propagates the Plan root blocker while invalid content JSON keeps priority', () => {
    const main = database(`
      CREATE TABLE plan_documents (content_json TEXT, id TEXT);
      INSERT INTO plan_documents VALUES ('{"Private plan":{"value":1}}', 'document.valid');
      INSERT INTO plan_documents VALUES ('{broken', 'document.invalid');
    `);
    const prompts = database('PRAGMA user_version = 1;');
    const expected: LegacySourceExpectedSchemas = {
      main: {
        tables: [{ name: 'plan_documents', kind: 'table', columns: ['content_json', 'id'] }],
      },
      prompts: { tables: [] },
    };
    const sources = [
      { database: 'main', table: 'plan_documents', columns: ['content_json'] },
    ] as const;
    const inventory = enumerateLegacyEmbeddedJsonClassificationSubjects(
      { main, prompts },
      expected,
      sources,
    );
    const rootSubjects = [...new Set(inventory.subjects.map(({ rowKey }) => rowKey))].map(
      (rowKey) => ({ database: 'main' as const, table: 'plan_documents', rowKey, path: '$' }),
    );
    const rootClassification = buildLegacyClassificationReport({
      sourceFingerprint: inventory.sourceFingerprint,
      subjects: rootSubjects,
      entries: rootSubjects.map((subject) => ({
        subject,
        disposition: 'blocking_error' as const,
        reasonCode: 'legacy_plan_target_mapping_unfrozen',
        targetRefs: [],
        exportRef: null,
        blockerCode: 'legacy_plan_target_mapping_unfrozen',
      })),
    });
    const remainingPaths: Array<readonly (string | number)[]> = [];

    const report = classifyLegacyEmbeddedJsonMembers({ main, prompts }, expected, {
      sources,
      rootClassification,
      classifyMembers(members) {
        remainingPaths.push(...members.map(({ memberPath }) => memberPath));
        return [];
      },
    });

    expect(remainingPaths).toEqual([]);
    expect(report).toMatchObject({
      inventory: { subjectCount: 4, invalidDocumentCount: 1, ok: false },
      classification: {
        counts: { subjectCount: 4, classifiedCount: 4, byDisposition: { blocking_error: 4 } },
        ok: false,
      },
      ok: false,
    });
    expect(
      report.classification.entries.filter(
        ({ blockerCode }) => blockerCode === 'legacy_plan_target_mapping_unfrozen',
      ),
    ).toHaveLength(3);
    expect(report.classification.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'classified_blocking_error',
          blockerCode: 'legacy_embedded_json_document_invalid_json',
        }),
      ]),
    );
    expect(JSON.stringify(report)).not.toContain('Private plan');
  });

  it('propagates frozen Task evidence blockers across every valid JSON column', () => {
    const main = database(`
      CREATE TABLE prompt_assemblies (
        authority_json TEXT,
        conditioning_manifest_json TEXT,
        host_constraints_json TEXT,
        id TEXT,
        input_json TEXT,
        output_json TEXT,
        provider_profile_json TEXT,
        sources_json TEXT
      );
      CREATE TABLE task_artifacts (id TEXT, metadata_json TEXT);
      CREATE TABLE task_attempts (
        generation_spec_json TEXT,
        id TEXT,
        input_json TEXT,
        metadata_json TEXT,
        output_json TEXT,
        repair_delta_json TEXT
      );
      CREATE TABLE task_evaluations (
        evidence_json TEXT,
        frame_evidence_json TEXT,
        id TEXT,
        metadata_json TEXT,
        repair_delta_json TEXT,
        risks_json TEXT,
        scores_json TEXT,
        strengths_json TEXT
      );
      INSERT INTO prompt_assemblies VALUES (
        '{"Private authority":1}',
        '{"Private conditioning":1}',
        '{"Private constraint":1}',
        'assembly.1',
        '{"Private prompt input":1}',
        '{"Private prompt output":1}',
        '{"Private provider":1}',
        '{"Private source":1}'
      );
      INSERT INTO task_artifacts VALUES ('artifact.1', '{"Private artifact":1}');
      INSERT INTO task_attempts VALUES (
        '{"Private spec":1}',
        'attempt.1',
        '{"Private input":1}',
        '{broken',
        '{"Private output":1}',
        '{"Private repair":1}'
      );
      INSERT INTO task_evaluations VALUES (
        '{"Private evidence":1}',
        '[]',
        'evaluation.1',
        '{"Private metadata":1}',
        '{"Private delta":1}',
        '{"Private risk":1}',
        '{"Private score":1}',
        '{"Private strength":1}'
      );
    `);
    const prompts = database('PRAGMA user_version = 1;');
    const expected: LegacySourceExpectedSchemas = {
      main: {
        tables: [
          {
            name: 'prompt_assemblies',
            kind: 'table',
            columns: [
              'authority_json',
              'conditioning_manifest_json',
              'host_constraints_json',
              'id',
              'input_json',
              'output_json',
              'provider_profile_json',
              'sources_json',
            ],
          },
          {
            name: 'task_artifacts',
            kind: 'table',
            columns: ['id', 'metadata_json'],
          },
          {
            name: 'task_attempts',
            kind: 'table',
            columns: [
              'generation_spec_json',
              'id',
              'input_json',
              'metadata_json',
              'output_json',
              'repair_delta_json',
            ],
          },
          {
            name: 'task_evaluations',
            kind: 'table',
            columns: [
              'evidence_json',
              'frame_evidence_json',
              'id',
              'metadata_json',
              'repair_delta_json',
              'risks_json',
              'scores_json',
              'strengths_json',
            ],
          },
        ],
      },
      prompts: { tables: [] },
    };
    const sources = [
      {
        database: 'main',
        table: 'prompt_assemblies',
        columns: [
          'authority_json',
          'conditioning_manifest_json',
          'host_constraints_json',
          'input_json',
          'output_json',
          'provider_profile_json',
          'sources_json',
        ],
      },
      { database: 'main', table: 'task_artifacts', columns: ['metadata_json'] },
      {
        database: 'main',
        table: 'task_attempts',
        columns: [
          'generation_spec_json',
          'input_json',
          'metadata_json',
          'output_json',
          'repair_delta_json',
        ],
      },
      {
        database: 'main',
        table: 'task_evaluations',
        columns: [
          'evidence_json',
          'frame_evidence_json',
          'metadata_json',
          'repair_delta_json',
          'risks_json',
          'scores_json',
          'strengths_json',
        ],
      },
    ] as const;
    const inventory = enumerateLegacyEmbeddedJsonClassificationSubjects(
      { main, prompts },
      expected,
      sources,
    );
    const rootSubjects = [
      ...new Map(
        inventory.subjects.map((subject) => [
          `${subject.table}\u0000${subject.rowKey}`,
          { ...subject, path: '$' },
        ]),
      ).values(),
    ];
    const blockerCodes: Readonly<Record<string, string>> = {
      prompt_assemblies: 'legacy_prompt_assembly_target_mapping_unfrozen',
      task_artifacts: 'legacy_task_artifact_target_mapping_unfrozen',
      task_attempts: 'legacy_task_attempt_target_mapping_unfrozen',
      task_evaluations: 'legacy_task_evaluation_target_mapping_unfrozen',
    };
    const rootClassification = buildLegacyClassificationReport({
      sourceFingerprint: inventory.sourceFingerprint,
      subjects: rootSubjects,
      entries: rootSubjects.map((subject) => {
        const blockerCode = blockerCodes[subject.table];
        if (!blockerCode) throw new Error(`Unexpected Task evidence table: ${subject.table}`);
        return {
          subject,
          disposition: 'blocking_error' as const,
          reasonCode: blockerCode,
          targetRefs: [],
          exportRef: null,
          blockerCode,
        };
      }),
    });
    const remainingPaths: string[] = [];

    const report = classifyLegacyEmbeddedJsonMembers({ main, prompts }, expected, {
      sources,
      rootClassification,
      classifyMembers(members) {
        remainingPaths.push(...members.map(({ subject }) => subject.path));
        return [];
      },
    });

    expect(remainingPaths).toEqual([]);
    expect(report.inventory.invalidDocumentCount).toBe(1);
    expect(report.inventory.bySource).toHaveLength(20);
    expect(report.inventory.bySource.every(({ documentCount }) => documentCount === 1)).toBe(true);
    expect(report.classification.counts.classifiedCount).toBe(report.inventory.subjectCount);
    expect(report.classification.counts.byDisposition).toMatchObject({
      blocking_error: report.inventory.subjectCount,
    });
    expect(
      report.classification.entries.filter(
        ({ blockerCode }) => blockerCode === 'legacy_embedded_json_document_invalid_json',
      ),
    ).toHaveLength(1);
    expect(
      report.classification.entries
        .filter(({ blockerCode }) => blockerCode !== 'legacy_embedded_json_document_invalid_json')
        .every(
          ({ subject, blockerCode, targetRefs, exportRef }) =>
            blockerCode === blockerCodes[subject.table] &&
            targetRefs.length === 0 &&
            exportRef === null,
        ),
    ).toBe(true);
    expect(JSON.stringify(report)).not.toContain('Private');
  });

  it('rejects duplicate or unknown registry entries before reading source values', () => {
    const main = database('CREATE TABLE docs (payload TEXT);');
    const prompts = database('PRAGMA user_version = 1;');
    const expected: LegacySourceExpectedSchemas = {
      main: { tables: [{ name: 'docs', kind: 'table', columns: ['payload'] }] },
      prompts: { tables: [] },
    };

    expect(() =>
      enumerateLegacyEmbeddedJsonClassificationSubjects({ main, prompts }, expected, [
        { database: 'main', table: 'docs', columns: ['payload'] },
        { database: 'main', table: 'docs', columns: ['payload'] },
      ]),
    ).toThrow('Duplicate Legacy embedded JSON source');
    expect(() =>
      enumerateLegacyEmbeddedJsonClassificationSubjects({ main, prompts }, expected, [
        { database: 'main', table: 'docs', columns: ['missing'] },
      ]),
    ).toThrow('Unknown Legacy embedded JSON column');
  });

  it('migrates imported empty and user-only transcripts while keeping assistant provenance blocked', () => {
    const main = database(`
      CREATE TABLE commander_sessions (default_canvas_id TEXT, id TEXT, messages TEXT);
    `);
    const prompts = database('PRAGMA user_version = 1;');
    const insert = main.prepare(
      'INSERT INTO commander_sessions (default_canvas_id, id, messages) VALUES (?, ?, ?)',
    );
    insert.run(null, 'session.empty', '[]');
    insert.run(
      null,
      'session.user',
      '[{"id":"message.user","role":"user","content":"Private user content","timestamp":1700000000000}]',
    );
    insert.run(
      null,
      'session.assistant',
      '[{"id":"message.assistant","role":"assistant","content":"Private assistant content","timestamp":1700000000001,"runMeta":{"runId":"run.provenance"}}]',
    );

    const report = classifyImportedCommanderSessionMessages(
      main,
      prompts,
      commanderSessionExpected(),
    );

    expect(report.classification.counts).toMatchObject({
      subjectCount: 15,
      classifiedCount: 15,
      byDisposition: { migrated_current_state: 7, blocking_error: 8 },
    });
    const emptyRoot = report.classification.entries.find(({ targetRefs }) =>
      targetRefs.some(({ authority, id }) => authority === 'chat' && id === 'session.empty'),
    );
    expect(emptyRoot).toMatchObject({
      disposition: 'migrated_current_state',
      reasonCode: 'legacy_commander_session_public_messages',
      targetRefs: [
        {
          authority: 'chat',
          id: 'session.empty',
          cloneOf: null,
        },
      ],
    });

    const userEntries = report.classification.entries.filter(({ targetRefs }) =>
      targetRefs.some(({ authority, id }) => authority === 'message' && id === 'message.user'),
    );
    expect(userEntries).toHaveLength(6);
    const userRoot = userEntries.find(({ subject }) => subject.path === '$.messages');
    const userProjectId = userRoot?.targetRefs.find(({ authority }) => authority === 'chat')?.projectId;
    expect(userProjectId).toEqual(expect.any(String));
    expect(userRoot).toMatchObject({
      disposition: 'migrated_current_state',
      reasonCode: 'legacy_commander_session_public_messages',
      targetRefs: [
        { authority: 'chat', id: 'session.user', projectId: userProjectId, cloneOf: null },
        { authority: 'message', id: 'message.user', projectId: userProjectId, cloneOf: null },
      ],
    });
    expect(
      userEntries
        .filter(({ subject }) => subject.path !== '$.messages')
        .every(
          ({ targetRefs }) =>
            targetRefs.length === 1 &&
            targetRefs[0]?.authority === 'message' &&
            targetRefs[0]?.id === 'message.user',
        ),
    ).toBe(true);
    expect(
      report.classification.entries.filter(
        ({ blockerCode }) => blockerCode === 'legacy_assistant_message_origin_unresolved',
      ),
    ).toHaveLength(8);
    expect(new Set(report.classification.entries.map(({ reasonCode }) => reasonCode))).toEqual(
      new Set([
        'legacy_commander_session_public_messages',
        'legacy_assistant_message_target_originating_run_provenance_unfrozen',
      ]),
    );
    expect(JSON.stringify(report)).not.toContain('Private');
  });

  it('blocks unmapped user fields and duplicate public Message IDs across importable sessions', () => {
    const extraMain = database(
      'CREATE TABLE commander_sessions (default_canvas_id TEXT, id TEXT, messages TEXT);',
    );
    const extraPrompts = database('PRAGMA user_version = 1;');
    extraMain
      .prepare('INSERT INTO commander_sessions (default_canvas_id, id, messages) VALUES (?, ?, ?)')
      .run(
        null,
        'session.extra',
        '[{"id":"message.extra","role":"user","content":"Private extra field","timestamp":1700000000000,"legacyMeta":true}]',
      );
    const extraReport = classifyImportedCommanderSessionMessages(
      extraMain,
      extraPrompts,
      commanderSessionExpected(),
    );
    expect(
      extraReport.classification.entries.every(
        ({ reasonCode, blockerCode }) =>
          reasonCode === 'legacy_commander_session_user_message_fields_unmapped' &&
          blockerCode === 'legacy_commander_session_user_message_fields_unmapped',
      ),
    ).toBe(true);

    const duplicateMain = database(
      'CREATE TABLE commander_sessions (default_canvas_id TEXT, id TEXT, messages TEXT);',
    );
    const duplicatePrompts = database('PRAGMA user_version = 1;');
    const insert = duplicateMain.prepare(
      'INSERT INTO commander_sessions (default_canvas_id, id, messages) VALUES (?, ?, ?)',
    );
    insert.run(
      null,
      'session.duplicate-a',
      '[{"id":"message.shared","role":"user","content":"Private first session","timestamp":1700000000000}]',
    );
    insert.run(
      null,
      'session.duplicate-b',
      '[{"id":"message.shared","role":"user","content":"Private second session","timestamp":1700000000001}]',
    );
    const duplicateReport = classifyImportedCommanderSessionMessages(
      duplicateMain,
      duplicatePrompts,
      commanderSessionExpected(),
    );
    expect(
      duplicateReport.classification.entries.every(
        ({ reasonCode, blockerCode }) =>
          reasonCode === 'duplicate_legacy_commander_session_message_id' &&
          blockerCode === 'duplicate_legacy_commander_session_message_id',
      ),
    ).toBe(true);
    expect(JSON.stringify(extraReport)).not.toContain('Private');
    expect(JSON.stringify(duplicateReport)).not.toContain('Private');
  });

  it('blocks malformed transcript cores, duplicate message IDs, and blocked owners explicitly', () => {
    const invalidCoreTranscripts = [
      ['not-array', '{"Private unexpected":true}'],
      ['not-member', '[null]'],
      [
        'empty-id',
        '[{"id":"","role":"user","content":"Private empty id","timestamp":1700000000000}]',
      ],
      [
        'bad-id',
        '[{"id":"bad id","role":"user","content":"Private bad id","timestamp":1700000000000}]',
      ],
      [
        'bad-role',
        '[{"id":"message.role","role":"system","content":"Private role","timestamp":1700000000000}]',
      ],
      [
        'empty-content',
        '[{"id":"message.empty","role":"user","content":"","timestamp":1700000000000}]',
      ],
      [
        'oversized-content',
        JSON.stringify([
          {
            id: 'message.oversized',
            role: 'user',
            content: 'x'.repeat(200_001),
            timestamp: 1700000000000,
          },
        ]),
      ],
      [
        'negative-time',
        '[{"id":"message.negative","role":"user","content":"Private negative","timestamp":-1}]',
      ],
      [
        'fractional-time',
        '[{"id":"message.fractional","role":"user","content":"Private fractional","timestamp":1.5}]',
      ],
      [
        'nonfinite-time',
        '[{"id":"message.nonfinite","role":"user","content":"Private nonfinite","timestamp":1e999}]',
      ],
      [
        'too-many-messages',
        JSON.stringify(
          Array.from({ length: 201 }, (_, index) => ({
            id: `message.bound.${index}`,
            role: 'user',
            content: 'Private bounded message',
            timestamp: 1700000000000 + index,
          })),
        ),
      ],
    ] as const;

    for (const [name, messages] of invalidCoreTranscripts) {
      const main = database(
        'CREATE TABLE commander_sessions (default_canvas_id TEXT, id TEXT, messages TEXT);',
      );
      const prompts = database('PRAGMA user_version = 1;');
      main
        .prepare(
          'INSERT INTO commander_sessions (default_canvas_id, id, messages) VALUES (?, ?, ?)',
        )
        .run(null, `session.${name}`, messages);

      const report = classifyImportedCommanderSessionMessages(
        main,
        prompts,
        commanderSessionExpected(),
      );

      expect(report.classification.counts.classifiedCount).toBe(report.inventory.subjectCount);
      expect(
        report.classification.entries.every(
          ({ reasonCode, blockerCode }) =>
            reasonCode === 'invalid_legacy_commander_session_messages_core' &&
            blockerCode === 'invalid_legacy_commander_session_messages_core',
        ),
      ).toBe(true);
      expect(JSON.stringify(report)).not.toContain('Private');
    }

    const duplicateMain = database(
      'CREATE TABLE commander_sessions (default_canvas_id TEXT, id TEXT, messages TEXT);',
    );
    const duplicatePrompts = database('PRAGMA user_version = 1;');
    duplicateMain
      .prepare('INSERT INTO commander_sessions (default_canvas_id, id, messages) VALUES (?, ?, ?)')
      .run(
        null,
        'session.duplicate',
        '[{"id":"message.duplicate","role":"user","content":"Private first","timestamp":1700000000000},{"id":"message.duplicate","role":"user","content":"Private second","timestamp":1700000000001}]',
      );
    const duplicateReport = classifyImportedCommanderSessionMessages(
      duplicateMain,
      duplicatePrompts,
      commanderSessionExpected(),
    );
    expect(
      duplicateReport.classification.entries.every(
        ({ reasonCode, blockerCode }) =>
          reasonCode === 'duplicate_legacy_commander_session_message_id' &&
          blockerCode === 'duplicate_legacy_commander_session_message_id',
      ),
    ).toBe(true);

    const ownerMain = database(
      'CREATE TABLE commander_sessions (default_canvas_id TEXT, id TEXT, messages TEXT);',
    );
    const ownerPrompts = database('PRAGMA user_version = 1;');
    ownerMain
      .prepare('INSERT INTO commander_sessions (default_canvas_id, id, messages) VALUES (?, ?, ?)')
      .run(
        null,
        'session.owner-blocked',
        '[{"id":"message.owner","role":"user","content":"Private owner","timestamp":1700000000000}]',
      );
    const ownerReport = classifyImportedCommanderSessionMessages(
      ownerMain,
      ownerPrompts,
      commanderSessionExpected(),
      'session.owner-blocked',
    );
    expect(
      ownerReport.classification.entries.every(
        ({ reasonCode, blockerCode }) =>
          reasonCode === 'legacy_commander_session_messages_owner_blocked' &&
          blockerCode === 'legacy_test_session_owner_blocked',
      ),
    ).toBe(true);

    const invalidDocumentMain = database(
      'CREATE TABLE commander_sessions (default_canvas_id TEXT, id TEXT, messages TEXT);',
    );
    const invalidDocumentPrompts = database('PRAGMA user_version = 1;');
    invalidDocumentMain
      .prepare('INSERT INTO commander_sessions (default_canvas_id, id, messages) VALUES (?, ?, ?)')
      .run(null, 'session.invalid-document', '{broken');
    const invalidDocumentReport = classifyImportedCommanderSessionMessages(
      invalidDocumentMain,
      invalidDocumentPrompts,
      commanderSessionExpected(),
    );
    expect(invalidDocumentReport.classification.entries).toMatchObject([
      {
        reasonCode: 'invalid_legacy_embedded_json_document',
        blockerCode: 'legacy_embedded_json_document_invalid_json',
      },
    ]);
    expect(JSON.stringify(duplicateReport)).not.toContain('Private');
    expect(JSON.stringify(ownerReport)).not.toContain('Private');
    expect(JSON.stringify(invalidDocumentReport)).not.toContain('{broken');
  });

  it('keeps Commander message classifications deterministic and non-leaking across source row order', () => {
    const firstMain = database(
      'CREATE TABLE commander_sessions (default_canvas_id TEXT, id TEXT, messages TEXT);',
    );
    const secondMain = database(
      'CREATE TABLE commander_sessions (default_canvas_id TEXT, id TEXT, messages TEXT);',
    );
    const firstPrompts = database('PRAGMA user_version = 1;');
    const secondPrompts = database('PRAGMA user_version = 1;');
    const rows = [
      [
        'session.user',
        '[{"id":"message.user","role":"user","content":"Private deterministic user","timestamp":1700000000000}]',
      ],
      [
        'session.assistant',
        '[{"id":"message.assistant","role":"assistant","content":"Private deterministic assistant","timestamp":1700000000001}]',
      ],
    ] as const;
    const firstInsert = firstMain.prepare(
      'INSERT INTO commander_sessions (default_canvas_id, id, messages) VALUES (?, ?, ?)',
    );
    const secondInsert = secondMain.prepare(
      'INSERT INTO commander_sessions (default_canvas_id, id, messages) VALUES (?, ?, ?)',
    );
    for (const [id, messages] of rows) firstInsert.run(null, id, messages);
    for (const [id, messages] of [...rows].reverse()) secondInsert.run(null, id, messages);

    const first = classifyImportedCommanderSessionMessages(
      firstMain,
      firstPrompts,
      commanderSessionExpected(),
    );
    const second = classifyImportedCommanderSessionMessages(
      secondMain,
      secondPrompts,
      commanderSessionExpected(),
    );

    expect(first).toEqual(second);
    expect(JSON.stringify(first)).not.toContain('Private');
  });
});
