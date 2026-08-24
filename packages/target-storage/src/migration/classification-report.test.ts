import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  buildLegacyClassificationReport,
  type LegacyClassificationEntryInput,
  type LegacyClassificationSubject,
} from './classification-report.js';

const SOURCE_FINGERPRINT = createHash('sha256').update('legacy-source').digest('hex');

function subject(
  table: string,
  row: string,
  path = '$',
  database: 'main' | 'prompts' = 'main',
): LegacyClassificationSubject {
  return {
    database,
    table,
    rowKey: createHash('sha256').update(`${database}:${table}:${row}`).digest('hex'),
    path,
  };
}

describe('Legacy classification report', () => {
  it('binds every subject to exactly one frozen disposition and stable mapping', () => {
    const project = subject('canvases', 'canvas-1');
    const history = subject('commander_events', 'event-1');
    const offline = subject('snapshots', 'snapshot-1');
    const blocking = subject('project_settings', 'setting-1');
    const subjects = [project, history, offline, blocking];
    const entries: LegacyClassificationEntryInput[] = [
      {
        subject: offline,
        disposition: 'offline_legacy_export',
        reasonCode: 'snapshot_offline_only',
        targetRefs: [],
        exportRef: 'legacy-export/snapshots/snapshot-1',
        blockerCode: null,
      },
      {
        subject: project,
        disposition: 'migrated_current_state',
        reasonCode: 'canvas_project_identity',
        targetRefs: [
          { authority: 'project', id: 'project.canvas-1', projectId: 'project.canvas-1' },
        ],
        exportRef: null,
        blockerCode: null,
      },
      {
        subject: blocking,
        disposition: 'blocking_error',
        reasonCode: 'unknown_project_setting',
        targetRefs: [],
        exportRef: null,
        blockerCode: 'unknown_project_setting',
      },
      {
        subject: history,
        disposition: 'immutable_provenance_history',
        reasonCode: 'public_run_event',
        targetRefs: [
          { authority: 'run_event', id: 'run-event.1', projectId: 'project.canvas-1' },
          {
            authority: 'project_event',
            id: 'project-event.1',
            projectId: 'project.canvas-1',
            cloneOf: 'run-event.1',
          },
        ],
        exportRef: null,
        blockerCode: null,
      },
    ];

    const first = buildLegacyClassificationReport({
      sourceFingerprint: SOURCE_FINGERPRINT,
      subjects,
      entries,
    });
    const second = buildLegacyClassificationReport({
      sourceFingerprint: SOURCE_FINGERPRINT,
      subjects: [...subjects].reverse(),
      entries: [...entries].reverse(),
    });

    expect(first).toMatchObject({
      schema: 'lucid-fin.legacy-classification-report/v1',
      sourceFingerprint: SOURCE_FINGERPRINT,
      counts: {
        subjectCount: 4,
        classifiedCount: 4,
        targetRefCount: 3,
        cloneRefCount: 1,
        byDisposition: {
          migrated_current_state: 1,
          immutable_provenance_history: 1,
          offline_legacy_export: 1,
          blocking_error: 1,
        },
      },
      blockers: [
        expect.objectContaining({
          kind: 'classified_blocking_error',
          blockerCode: 'unknown_project_setting',
        }),
      ],
      ok: false,
    });
    expect(first.reportHash).toMatch(/^[0-9a-f]{64}$/);
    expect(first).toEqual(second);
    expect(first.entries.map(({ sourceKey }) => sourceKey)).toEqual(
      [...first.entries.map(({ sourceKey }) => sourceKey)].sort(),
    );
  });

  it('blocks missing, unknown, and duplicate classifications without silently dropping subjects', () => {
    const expected = subject('characters', 'character-1');
    const duplicate = subject('equipment', 'equipment-1');
    const unknown = subject('locations', 'location-unknown');
    const duplicateEntry: LegacyClassificationEntryInput = {
      subject: duplicate,
      disposition: 'offline_legacy_export',
      reasonCode: 'unlinked_production_object',
      targetRefs: [],
      exportRef: 'legacy-export/equipment/equipment-1',
      blockerCode: null,
    };

    const input = {
      sourceFingerprint: SOURCE_FINGERPRINT,
      subjects: [expected, duplicate, duplicate],
      entries: [
        duplicateEntry,
        duplicateEntry,
        {
          subject: unknown,
          disposition: 'offline_legacy_export',
          reasonCode: 'unlinked_production_object',
          targetRefs: [],
          exportRef: 'legacy-export/locations/location-unknown',
          blockerCode: null,
        },
      ],
    } as const;
    const report = buildLegacyClassificationReport(input);
    const reordered = buildLegacyClassificationReport({
      ...input,
      subjects: [...input.subjects].reverse(),
      entries: [...input.entries].reverse(),
    });

    expect(report.blockers.map(({ kind }) => kind).sort()).toEqual(
      [
        'duplicate_classification_subject',
        'unclassified_subject',
        'duplicate_classification_entry',
        'unknown_classification_subject',
      ].sort(),
    );
    expect(report.counts).toMatchObject({ subjectCount: 2, classifiedCount: 0 });
    expect(report).toEqual(reordered);
    expect(report.ok).toBe(false);
  });

  it('blocks invalid disposition payloads and never copies their raw values into the report', () => {
    const current = subject('canvases', 'invalid-current');
    const offline = subject('snapshots', 'invalid-export');
    const blocking = subject('project_settings', 'invalid-blocker');
    const secret = 'C:\\Users\\person\\private-project.mov';

    const report = buildLegacyClassificationReport({
      sourceFingerprint: SOURCE_FINGERPRINT,
      subjects: [current, offline, blocking],
      entries: [
        {
          subject: current,
          disposition: 'migrated_current_state',
          reasonCode: '',
          targetRefs: [],
          exportRef: null,
          blockerCode: null,
        },
        {
          subject: offline,
          disposition: 'offline_legacy_export',
          reasonCode: 'offline',
          targetRefs: [],
          exportRef: secret,
          blockerCode: null,
        },
        {
          subject: blocking,
          disposition: 'blocking_error',
          reasonCode: 'bad',
          targetRefs: [],
          exportRef: null,
          blockerCode: '',
        },
      ],
    });

    expect(report.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'invalid_classification_entry',
          reason: 'invalid_reason_code',
        }),
        expect.objectContaining({
          kind: 'invalid_classification_entry',
          reason: 'invalid_export_ref',
        }),
        expect.objectContaining({
          kind: 'invalid_classification_entry',
          reason: 'invalid_blocker_code',
        }),
      ]),
    );
    expect(report.entries).toEqual([]);
    expect(JSON.stringify(report)).not.toContain(secret);
    expect(report.ok).toBe(false);
  });
});
