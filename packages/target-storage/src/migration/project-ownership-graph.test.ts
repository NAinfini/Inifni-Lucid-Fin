import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { hashCanonical } from '../internal/hashes.js';
import { legacyClassificationSourceKey } from './classification-report.js';
import type { LegacyClassificationRow } from './classification-subjects.js';
import { legacyProductionCollectionId } from './legacy-migration-policy.js';
import {
  LEGACY_IMPORTED_CHAT_PROJECT_POLICY_V1,
  resolveLegacyProjectOwnership,
} from './project-ownership-graph.js';

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function row(
  table: string,
  identity: string,
  values: Readonly<Record<string, unknown>>,
): LegacyClassificationRow {
  const columns = Object.keys(values).sort();
  return {
    database: 'main',
    table,
    kind: 'table',
    columns,
    subject: {
      database: 'main',
      table,
      rowKey: digest(`${table}:${identity}`),
      path: '$',
    },
    values,
  };
}

function assignment(
  report: ReturnType<typeof resolveLegacyProjectOwnership>,
  table: string,
  identity: string,
) {
  const sourceKey = ownershipSourceKey(table, identity);
  return report.assignments.find((candidate) => candidate.sourceKey === sourceKey);
}

function ownershipSourceKey(table: string, identity: string): string {
  return legacyClassificationSourceKey({
    database: 'main',
    table,
    rowKey: digest(`${table}:${identity}`),
    path: '$',
  });
}

const SOURCE_FINGERPRINT = digest('project-ownership-fixture');

describe('Legacy Project ownership graph', () => {
  it('derives typed entity ownership, deterministic clones, Canvas inheritance, and offline rows', () => {
    const rows = [
      row('canvases', 'canvas.1', { id: 'canvas.1', archived_at: null }),
      row('canvases', 'canvas.2', { id: 'canvas.2', archived_at: 1n }),
      row('characters', 'character.shared', {
        id: 'character.shared',
        default_loadout_id: 'loadout.default',
        loadouts: JSON.stringify([
          { id: 'loadout.default', name: 'Private kit', equipmentIds: ['equipment.loadout'] },
        ]),
        name: 'Private character name',
      }),
      row('characters', 'character.history', {
        id: 'character.history',
        default_loadout_id: '',
        loadouts: '[]',
      }),
      row('equipment', 'equipment.loadout', { id: 'equipment.loadout' }),
      row('equipment', 'equipment.direct', { id: 'equipment.direct' }),
      row('locations', 'location.1', { id: 'location.1' }),
      row('scripts', 'script.offline', {
        id: 'script.offline',
        content: 'Private screenplay content',
      }),
      row('canvas_nodes', 'node.image', {
        id: 'node.image',
        canvas_id: 'canvas.1',
        type: 'image',
        data_json: JSON.stringify({
          assetHash: digest('node-image-media'),
          prompt: 'Private prompt',
          characterRefs: [{ characterId: 'character.shared', loadoutId: 'loadout.default' }],
          equipmentRefs: [{ equipmentId: 'equipment.direct' }],
          locationRefs: [{ locationId: 'location.1' }],
          generationHistory: [
            {
              characterRefs: [{ entityId: 'character.history', imageHashes: [] }],
              equipmentRefs: [{ entityId: 'equipment.direct', imageHashes: [] }],
              locationRefs: [{ entityId: 'location.1', imageHashes: [] }],
            },
          ],
        }),
      }),
      row('canvas_nodes', 'node.audio', {
        id: 'node.audio',
        canvas_id: 'canvas.1',
        type: 'audio',
        data_json: JSON.stringify({
          generationHistory: [
            { characterRefs: [{ entityId: 'character.history', imageHashes: [] }] },
          ],
        }),
      }),
      row('canvas_nodes', 'node.text', {
        id: 'node.text',
        canvas_id: 'canvas.1',
        type: 'text',
        data_json: JSON.stringify({
          content: 'character.shared is only free text',
          metadata: { entityId: 'character.shared' },
        }),
      }),
      row('canvas_nodes', 'node.video', {
        id: 'node.video',
        canvas_id: 'canvas.2',
        type: 'video',
        data_json: JSON.stringify({
          assetHash: digest('node-video-media'),
          characterRefs: [{ characterId: 'character.shared', loadoutId: 'loadout.default' }],
        }),
      }),
      row('canvas_edges', 'edge.1', {
        id: 'edge.1',
        canvas_id: 'canvas.1',
        source: 'node.image',
        target: 'node.audio',
      }),
    ];

    const first = resolveLegacyProjectOwnership(SOURCE_FINGERPRINT, rows);
    const second = resolveLegacyProjectOwnership(SOURCE_FINGERPRINT, [...rows].reverse());

    expect(first).toEqual(second);
    expect(first.ok).toBe(true);
    expect(first.canvasProjects).toMatchObject([
      { canvasId: 'canvas.1', projectId: 'canvas.1', lifecycle: 'active' },
      { canvasId: 'canvas.2', projectId: 'canvas.2', lifecycle: 'archived' },
    ]);
    const character = assignment(first, 'characters', 'character.shared');
    expect(character).toMatchObject({
      projectIds: ['canvas.1', 'canvas.2'],
      disposition: 'cloned_per_project',
    });
    const expectedCloneIds = ['canvas.1', 'canvas.2'].map(
      (projectId) =>
        `production.import.${hashCanonical({
          schema: 'lucid-fin.legacy-production-clone-id/v1',
          table: 'characters',
          sourceId: 'character.shared',
          projectId,
        })}`,
    );
    expect(character?.targetRefs).toEqual([
      {
        authority: 'production',
        id: expectedCloneIds[0],
        projectId: 'canvas.1',
        cloneOf: 'character.shared',
      },
      {
        authority: 'production',
        id: expectedCloneIds[1],
        projectId: 'canvas.2',
        cloneOf: 'character.shared',
      },
    ]);
    expect(assignment(first, 'equipment', 'equipment.loadout')).toMatchObject({
      projectIds: ['canvas.1', 'canvas.2'],
      disposition: 'cloned_per_project',
    });
    expect(assignment(first, 'characters', 'character.history')).toMatchObject({
      projectIds: ['canvas.1'],
      disposition: 'single_project',
    });
    expect(assignment(first, 'scripts', 'script.offline')).toMatchObject({
      disposition: 'offline_legacy_export',
      targetRefs: [],
      blockerCode: null,
    });
    expect(first.claims.map(({ kind }) => kind)).toEqual(
      expect.arrayContaining([
        'canvas_identity',
        'canvas_parent',
        'node_entity_ref',
        'node_generation_history_entity_ref',
        'character_loadout_equipment',
      ]),
    );
    const loadoutClaim = first.claims.find(
      ({ kind, projectId }) => kind === 'character_loadout_equipment' && projectId === 'canvas.1',
    );
    const expectedLoadoutEvidence = [
      {
        sourceKey: ownershipSourceKey('canvas_nodes', 'node.image'),
        path: '$.data_json.characterRefs[0].characterId',
      },
      {
        sourceKey: ownershipSourceKey('canvas_nodes', 'node.image'),
        path: '$.data_json.characterRefs[0].loadoutId',
      },
      {
        sourceKey: ownershipSourceKey('characters', 'character.shared'),
        path: '$.loadouts[0].id',
      },
      {
        sourceKey: ownershipSourceKey('characters', 'character.shared'),
        path: '$.loadouts[0].equipmentIds[0]',
      },
    ].sort(
      (left, right) =>
        left.sourceKey.localeCompare(right.sourceKey) || left.path.localeCompare(right.path),
    );
    expect(loadoutClaim?.evidenceRefs).toEqual(expectedLoadoutEvidence);
    expect(
      first.claims.flatMap(({ evidenceRefs }) => evidenceRefs.map(({ path }) => path)),
    ).not.toContain('$.data_json.characterRefs[0].loadout.equipmentIds[0]');
    expect(first.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(first)).not.toContain('Private');
    expect(JSON.stringify(first)).not.toContain('screenplay');
  });

  it('exports every unreferenced Production folder tree without inventing target folders', () => {
    const rows = [
      row('character_folders', 'character-folder.root', {
        id: 'character-folder.root',
        parent_id: null,
        name: 'Private character root',
      }),
      row('character_folders', 'character-folder.child', {
        id: 'character-folder.child',
        parent_id: 'character-folder.root',
        name: 'Private character child',
      }),
      row('equipment_folders', 'equipment-folder.root', {
        id: 'equipment-folder.root',
        parent_id: null,
        name: 'Private equipment root',
      }),
      row('location_folders', 'location-folder.root', {
        id: 'location-folder.root',
        parent_id: null,
        name: 'Private location root',
      }),
      row('location_folders', 'location-folder.child', {
        id: 'location-folder.child',
        parent_id: 'location-folder.root',
        name: 'Private location child',
      }),
    ];

    const first = resolveLegacyProjectOwnership(SOURCE_FINGERPRINT, rows);
    const second = resolveLegacyProjectOwnership(SOURCE_FINGERPRINT, [...rows].reverse());

    expect(first).toEqual(second);
    expect(first.ok).toBe(true);
    expect(first.assignments).toHaveLength(rows.length);
    expect(
      first.assignments.every(
        ({ disposition, projectIds, targetRefs, exportRef }) =>
          disposition === 'offline_legacy_export' &&
          projectIds.length === 0 &&
          targetRefs.length === 0 &&
          exportRef?.startsWith('legacy-export/main/') === true,
      ),
    ).toBe(true);
    expect(JSON.stringify(first)).not.toContain('Private');
  });

  it('maps referenced folder components to Production Collections and blocks dangling links', () => {
    const report = resolveLegacyProjectOwnership(SOURCE_FINGERPRINT, [
      row('canvases', 'canvas.1', { id: 'canvas.1', archived_at: null }),
      row('characters', 'character.foldered', {
        id: 'character.foldered',
        default_loadout_id: '',
        folder_id: 'character-folder.child',
        loadouts: '[]',
      }),
      row('equipment', 'equipment.dangling', {
        id: 'equipment.dangling',
        folder_id: 'equipment-folder.missing',
      }),
      row('character_folders', 'character-folder.root', {
        id: 'character-folder.root',
        parent_id: null,
        name: 'Private linked root',
      }),
      row('character_folders', 'character-folder.child', {
        id: 'character-folder.child',
        parent_id: 'character-folder.root',
        name: 'Private linked child',
      }),
      row('canvas_nodes', 'node.1', {
        id: 'node.1',
        canvas_id: 'canvas.1',
        type: 'image',
        data_json: JSON.stringify({
          characterRefs: [{ characterId: 'character.foldered', loadoutId: '' }],
        }),
      }),
    ]);

    expect(report.ok).toBe(false);
    expect(assignment(report, 'characters', 'character.foldered')).toMatchObject({
      disposition: 'single_project',
      projectIds: ['canvas.1'],
      targetRefs: [{ authority: 'production', id: 'character.foldered', projectId: 'canvas.1' }],
    });
    expect(assignment(report, 'equipment', 'equipment.dangling')).toMatchObject({
      disposition: 'blocking_error',
      blockerCode: 'missing_legacy_production_folder',
      targetRefs: [],
    });
    for (const id of ['character-folder.root', 'character-folder.child']) {
      expect(assignment(report, 'character_folders', id)).toMatchObject({
        disposition: 'single_project',
        blockerCode: null,
        projectIds: ['canvas.1'],
        targetRefs: [
          {
            authority: 'production_collection',
            id: legacyProductionCollectionId('character_folders', id, 'canvas.1'),
            projectId: 'canvas.1',
          },
        ],
      });
    }
    expect(
      report.blockers.filter(
        ({ blockerCode }) => blockerCode === 'unresolved_legacy_production_collection_target',
      ),
    ).toEqual([]);
    expect(report.claims.filter(({ kind }) => kind === 'production_folder_member')).toHaveLength(2);
    expect(JSON.stringify(report)).not.toContain('Private');
  });

  it('gives same-named folders from different Legacy tables distinct Collection identities', () => {
    const report = resolveLegacyProjectOwnership(SOURCE_FINGERPRINT, [
      row('canvases', 'canvas.1', { id: 'canvas.1', archived_at: null }),
      row('character_folders', 'folder.shared', {
        id: 'folder.shared',
        parent_id: null,
        name: 'Characters',
      }),
      row('equipment_folders', 'folder.shared', {
        id: 'folder.shared',
        parent_id: null,
        name: 'Equipment',
      }),
      row('characters', 'character.1', {
        id: 'character.1',
        default_loadout_id: '',
        folder_id: 'folder.shared',
        loadouts: '[]',
      }),
      row('equipment', 'equipment.1', { id: 'equipment.1', folder_id: 'folder.shared' }),
      row('canvas_nodes', 'node.1', {
        id: 'node.1',
        canvas_id: 'canvas.1',
        type: 'image',
        data_json: JSON.stringify({
          assetHash: digest('folder-cross-table-media'),
          characterRefs: [{ characterId: 'character.1', loadoutId: '' }],
          equipmentRefs: [{ equipmentId: 'equipment.1' }],
        }),
      }),
    ]);

    expect(report.ok).toBe(true);
    const characterTarget = assignment(report, 'character_folders', 'folder.shared').targetRefs[0];
    const equipmentTarget = assignment(report, 'equipment_folders', 'folder.shared').targetRefs[0];
    expect(characterTarget?.id).toBe(
      legacyProductionCollectionId('character_folders', 'folder.shared', 'canvas.1'),
    );
    expect(equipmentTarget?.id).toBe(
      legacyProductionCollectionId('equipment_folders', 'folder.shared', 'canvas.1'),
    );
    expect(characterTarget?.id).not.toBe(equipmentTarget?.id);
  });

  it('blocks Canvas geometry and custom dimensions that Target cannot represent', () => {
    const report = resolveLegacyProjectOwnership(SOURCE_FINGERPRINT, [
      row('canvases', 'canvas.custom', {
        id: 'canvas.custom',
        archived_at: null,
        aspect_ratio: 'custom',
        default_width: null,
        default_height: 1080n,
      }),
      row('canvases', 'canvas.geometry', {
        id: 'canvas.geometry',
        archived_at: null,
        aspect_ratio: '16:9',
        default_width: null,
        default_height: null,
      }),
      row('canvas_nodes', 'node.invalid-size', {
        id: 'node.invalid-size',
        canvas_id: 'canvas.geometry',
        type: 'text',
        position_x: 0,
        position_y: 0,
        width: null,
        height: 100,
        data_json: '{}',
      }),
    ]);

    expect(assignment(report, 'canvases', 'canvas.custom')).toMatchObject({
      disposition: 'blocking_error',
      blockerCode: 'invalid_legacy_canvas_custom_dimensions',
    });
    expect(assignment(report, 'canvas_nodes', 'node.invalid-size')).toMatchObject({
      disposition: 'blocking_error',
      blockerCode: 'invalid_legacy_canvas_node_size',
    });
  });

  it('blocks Canvas, Chat, placement, and edge scalars outside Target contracts', () => {
    const report = resolveLegacyProjectOwnership(SOURCE_FINGERPRINT, [
      row('canvases', 'canvas.long-name', {
        id: 'canvas.long-name',
        name: 'N'.repeat(241),
        archived_at: null,
      }),
      row('canvases', 'canvas.valid', {
        id: 'canvas.valid',
        name: 'Valid Canvas',
        archived_at: null,
      }),
      row('commander_sessions', 'session.long-title', {
        id: 'session.long-title',
        title: 'T'.repeat(241),
      }),
      row('canvas_nodes', 'node.invalid-z', {
        id: 'node.invalid-z',
        canvas_id: 'canvas.valid',
        type: 'text',
        position_x: 0,
        position_y: 0,
        width: 100,
        height: 100,
        z_index: 1.5,
        data_json: '{}',
      }),
      row('canvas_nodes', 'node.source', {
        id: 'node.source',
        canvas_id: 'canvas.valid',
        type: 'text',
        position_x: 0,
        position_y: 0,
        width: 100,
        height: 100,
        z_index: 0,
        data_json: '{}',
      }),
      row('canvas_nodes', 'node.target', {
        id: 'node.target',
        canvas_id: 'canvas.valid',
        type: 'text',
        position_x: 100,
        position_y: 0,
        width: 100,
        height: 100,
        z_index: 1,
        data_json: '{}',
      }),
      row('canvas_edges', 'edge.long-label', {
        id: 'edge.long-label',
        canvas_id: 'canvas.valid',
        source: 'node.source',
        target: 'node.target',
        label: 'L'.repeat(241),
      }),
    ]);

    expect(assignment(report, 'canvases', 'canvas.long-name')).toMatchObject({
      disposition: 'blocking_error',
      blockerCode: 'legacy_canvas_project_target_contract_incompatible',
    });
    expect(assignment(report, 'commander_sessions', 'session.long-title')).toMatchObject({
      disposition: 'blocking_error',
      blockerCode: 'legacy_chat_target_contract_incompatible',
    });
    expect(assignment(report, 'canvas_nodes', 'node.invalid-z')).toMatchObject({
      disposition: 'blocking_error',
      blockerCode: 'invalid_legacy_canvas_node_z_index',
    });
    expect(assignment(report, 'canvas_edges', 'edge.long-label')).toMatchObject({
      disposition: 'blocking_error',
      blockerCode: 'legacy_canvas_edge_target_contract_incompatible',
    });
  });

  it('blocks Production content that exceeds Target name and trait limits', () => {
    const character = (id: string, name: string, tags: readonly string[]) =>
      row('characters', id, {
        id,
        name,
        tags: JSON.stringify(tags),
        distinct_traits: '[]',
        loadouts: '[]',
        default_loadout_id: '',
        folder_id: null,
      });
    const report = resolveLegacyProjectOwnership(SOURCE_FINGERPRINT, [
      character('character.long-name', 'N'.repeat(241), []),
      character(
        'character.too-many-traits',
        'Many traits',
        Array.from({ length: 101 }, (_, index) => `trait-${index}`),
      ),
      character('character.long-trait', 'Long trait', ['T'.repeat(1_001)]),
    ]);

    for (const id of ['character.long-name', 'character.too-many-traits', 'character.long-trait']) {
      expect(assignment(report, 'characters', id)).toMatchObject({
        disposition: 'blocking_error',
        blockerCode: 'legacy_production_target_contract_incompatible',
      });
    }
  });

  it('blocks a referenced folder component even when the referring entity identity is invalid', () => {
    const report = resolveLegacyProjectOwnership(SOURCE_FINGERPRINT, [
      row('locations', 'invalid-location-source', {
        id: 'invalid location id',
        folder_id: 'location-folder.child',
      }),
      row('location_folders', 'location-folder.root', {
        id: 'location-folder.root',
        parent_id: null,
      }),
      row('location_folders', 'location-folder.child', {
        id: 'location-folder.child',
        parent_id: 'location-folder.root',
      }),
    ]);

    expect(assignment(report, 'locations', 'invalid-location-source')).toMatchObject({
      disposition: 'blocking_error',
      blockerCode: 'invalid_legacy_location_id',
    });
    for (const id of ['location-folder.root', 'location-folder.child']) {
      expect(assignment(report, 'location_folders', id)).toMatchObject({
        disposition: 'blocking_error',
        blockerCode: 'unresolved_legacy_production_collection_target',
      });
    }
    const entitySourceKey = ownershipSourceKey('locations', 'invalid-location-source');
    expect(
      report.blockers
        .filter(
          ({ blockerCode }) => blockerCode === 'unresolved_legacy_production_collection_target',
        )
        .every(
          ({ evidenceSourceKey, evidencePath }) =>
            evidenceSourceKey === entitySourceKey && evidencePath === '$.folder_id',
        ),
    ).toBe(true);
  });

  it('blocks every member of malformed Production folder components', () => {
    const rows = [
      row('character_folders', 'folder.orphan', {
        id: 'folder.orphan',
        parent_id: 'folder.missing',
      }),
      row('character_folders', 'folder.orphan-child', {
        id: 'folder.orphan-child',
        parent_id: 'folder.orphan',
      }),
      row('equipment_folders', 'folder.self', {
        id: 'folder.self',
        parent_id: 'folder.self',
      }),
      row('equipment_folders', 'folder.self-child', {
        id: 'folder.self-child',
        parent_id: 'folder.self',
      }),
      row('location_folders', 'folder.cycle-a', {
        id: 'folder.cycle-a',
        parent_id: 'folder.cycle-b',
      }),
      row('location_folders', 'folder.cycle-b', {
        id: 'folder.cycle-b',
        parent_id: 'folder.cycle-a',
      }),
      row('location_folders', 'folder.cycle-child', {
        id: 'folder.cycle-child',
        parent_id: 'folder.cycle-a',
      }),
    ];
    const report = resolveLegacyProjectOwnership(SOURCE_FINGERPRINT, rows);

    expect(report).toEqual(resolveLegacyProjectOwnership(SOURCE_FINGERPRINT, [...rows].reverse()));
    expect(report.ok).toBe(false);
    expect(report.assignments).toHaveLength(7);
    expect(report.assignments.every(({ disposition }) => disposition === 'blocking_error')).toBe(
      true,
    );
    expect(report.blockers.map(({ blockerCode }) => blockerCode)).toEqual(
      expect.arrayContaining([
        'missing_legacy_production_folder_parent',
        'self_referencing_legacy_production_folder',
        'cyclic_legacy_production_folder_hierarchy',
      ]),
    );
    expect(assignment(report, 'character_folders', 'folder.orphan-child')?.blockerCode).toBe(
      'missing_legacy_production_folder_parent',
    );
    expect(assignment(report, 'equipment_folders', 'folder.self-child')?.blockerCode).toBe(
      'self_referencing_legacy_production_folder',
    );
    expect(assignment(report, 'location_folders', 'folder.cycle-child')?.blockerCode).toBe(
      'cyclic_legacy_production_folder_hierarchy',
    );
  });

  it('blocks malformed or type-forbidden typed paths without treating arbitrary nested keys as claims', () => {
    const report = resolveLegacyProjectOwnership(SOURCE_FINGERPRINT, [
      row('canvases', 'canvas.1', { id: 'canvas.1', archived_at: null }),
      row('characters', 'character.1', {
        id: 'character.1',
        default_loadout_id: '',
        loadouts: '[]',
      }),
      row('canvas_nodes', 'node.audio', {
        id: 'node.audio',
        canvas_id: 'canvas.1',
        type: 'audio',
        data_json: JSON.stringify({ characterRefs: [{ characterId: 'character.1' }] }),
      }),
      row('canvas_nodes', 'node.text', {
        id: 'node.text',
        canvas_id: 'canvas.1',
        type: 'text',
        data_json: JSON.stringify({ generationHistory: [] }),
      }),
      row('canvas_nodes', 'node.image', {
        id: 'node.image',
        canvas_id: 'canvas.1',
        type: 'image',
        data_json: JSON.stringify({ characterRefs: { characterId: 'character.1' } }),
      }),
      row('canvas_nodes', 'node.backdrop', {
        id: 'node.backdrop',
        canvas_id: 'canvas.1',
        type: 'backdrop',
        data_json: JSON.stringify({
          nested: { characterId: 'character.1', entityId: 'character.1' },
        }),
      }),
      row('canvas_edges', 'edge.self', {
        id: 'edge.self',
        canvas_id: 'canvas.1',
        source: 'node.backdrop',
        target: 'node.backdrop',
      }),
    ]);

    expect(report.ok).toBe(false);
    expect(report.blockers.map(({ blockerCode }) => blockerCode)).toEqual(
      expect.arrayContaining([
        'root_entity_refs_not_allowed_for_node_kind',
        'generation_history_not_allowed_for_node_kind',
        'invalid_root_entity_ref_collection',
        'self_referencing_legacy_canvas_edge',
      ]),
    );
    expect(assignment(report, 'characters', 'character.1')).toMatchObject({
      projectIds: [],
      disposition: 'offline_legacy_export',
    });
    expect(assignment(report, 'canvas_nodes', 'node.backdrop')).toMatchObject({
      disposition: 'single_project',
      blockerCode: null,
    });
  });

  it('resolves Session and Run scopes and creates one deterministic Project for an unassigned Chat', () => {
    const report = resolveLegacyProjectOwnership(SOURCE_FINGERPRINT, [
      row('canvases', 'canvas.1', { id: 'canvas.1', archived_at: null }),
      row('canvases', 'canvas.2', { id: 'canvas.2', archived_at: null }),
      row('commander_sessions', 'session.assigned', {
        id: 'session.assigned',
        default_canvas_id: 'canvas.1',
      }),
      row('commander_sessions', 'session.imported', {
        id: 'session.imported',
        default_canvas_id: null,
      }),
      row('commander_sessions', 'session.conflict', {
        id: 'session.conflict',
        default_canvas_id: null,
      }),
      row('commander_runs', 'run.inherited', {
        id: 'run.inherited',
        session_id: 'session.assigned',
        default_canvas_id: null,
        parent_run_id: null,
        retry_of_run_id: null,
      }),
      row('commander_runs', 'run.imported', {
        id: 'run.imported',
        session_id: 'session.imported',
        default_canvas_id: null,
        parent_run_id: null,
        retry_of_run_id: null,
      }),
      row('commander_runs', 'run.conflict', {
        id: 'run.conflict',
        session_id: 'session.conflict',
        default_canvas_id: 'canvas.1',
        parent_run_id: null,
        retry_of_run_id: null,
      }),
      row('commander_run_canvases', 'run.conflict:canvas.2', {
        run_id: 'run.conflict',
        canvas_id: 'canvas.2',
        released_at: 10n,
      }),
    ]);

    const imported = assignment(report, 'commander_sessions', 'session.imported');
    const importedProjectId = `project.imported-chat.${hashCanonical({
      schema: 'lucid-fin.legacy-imported-chat-project-id/v1',
      sessionId: 'session.imported',
    })}`;
    expect(imported).toMatchObject({
      projectIds: [importedProjectId],
      disposition: 'imported_chat_project',
      blockerCode: null,
    });
    expect(imported?.targetRefs.map(({ authority, id }) => ({ authority, id }))).toEqual([
      { authority: 'project', id: importedProjectId },
      { authority: 'project_settings', id: importedProjectId },
      { authority: 'canvas', id: importedProjectId },
      { authority: 'chat', id: 'session.imported' },
    ]);
    expect(LEGACY_IMPORTED_CHAT_PROJECT_POLICY_V1).toEqual({
      schema: 'lucid-fin.legacy-imported-chat-project-policy/v1',
      project: {
        lifecycle: 'active',
        schemaRevision: 1,
        revision: 0,
        fallbackName: 'Imported chat',
      },
      projectSettings: {
        revision: 0,
        defaultProviderProfileId: null,
        formatPolicy: { aspectRatio: '16:9', customDimensions: null, frameRate: 24 },
        permission: 'read_only',
        budget: {
          costUsd: { state: 'known', value: '0', currency: 'USD' },
          maxGenerationCount: 0,
          maxInputTokens: 0,
          maxOutputTokens: 0,
        },
        enabledSkills: [],
      },
      emptyCanvas: {
        revision: 0,
        placements: [],
        groups: [],
        edges: [],
        annotations: [],
        viewport: { center: { x: 0, y: 0 }, zoom: 1 },
        savedViews: [],
        nextZIndex: 0,
      },
    });
    expect(assignment(report, 'commander_runs', 'run.imported')).toMatchObject({
      projectIds: [importedProjectId],
      disposition: 'single_project',
    });
    expect(assignment(report, 'commander_runs', 'run.inherited')).toMatchObject({
      projectIds: ['canvas.1'],
      disposition: 'single_project',
    });
    expect(report.blockers.map(({ blockerCode }) => blockerCode)).toEqual(
      expect.arrayContaining(['run_project_conflict', 'session_project_conflict']),
    );
    expect(assignment(report, 'commander_run_canvases', 'run.conflict:canvas.2')).toMatchObject({
      disposition: 'blocking_error',
      blockerCode: 'unmigratable_run_canvas_run',
    });
  });

  it('detects imported Project collisions without treating a preserved prefix as synthetic', () => {
    const collisionProjectId = `project.imported-chat.${hashCanonical({
      schema: 'lucid-fin.legacy-imported-chat-project-id/v1',
      sessionId: 'session.collision',
    })}`;
    const preservedProjectId = 'project.imported-chat.preserved-canvas';
    const report = resolveLegacyProjectOwnership(SOURCE_FINGERPRINT, [
      row('canvases', 'collision-project', { id: collisionProjectId, archived_at: null }),
      row('canvases', 'preserved-project', { id: preservedProjectId, archived_at: null }),
      row('commander_sessions', 'session.collision', {
        id: 'session.collision',
        default_canvas_id: null,
      }),
      row('commander_sessions', 'session.preserved', {
        id: 'session.preserved',
        default_canvas_id: preservedProjectId,
      }),
    ]);

    expect(assignment(report, 'canvases', 'collision-project')).toMatchObject({
      disposition: 'blocking_error',
      blockerCode: 'legacy_project_target_id_collision',
    });
    expect(assignment(report, 'commander_sessions', 'session.collision')).toMatchObject({
      disposition: 'blocking_error',
      blockerCode: 'legacy_project_target_id_collision',
    });
    expect(assignment(report, 'commander_sessions', 'session.preserved')).toMatchObject({
      projectIds: [preservedProjectId],
      disposition: 'single_project',
      targetRefs: [{ authority: 'chat', id: 'session.preserved', projectId: preservedProjectId }],
      blockerCode: null,
    });
    expect(
      report.blockers.some(
        ({ sourceKey, blockerCode }) =>
          sourceKey === ownershipSourceKey('commander_sessions', 'session.preserved') &&
          blockerCode === 'legacy_project_target_id_collision',
      ),
    ).toBe(false);
  });

  it('blocks self-referencing and cyclic Run lineage', () => {
    const rows = [
      row('canvases', 'canvas.1', { id: 'canvas.1', archived_at: null }),
      row('commander_sessions', 'session.1', {
        id: 'session.1',
        default_canvas_id: 'canvas.1',
      }),
      row('commander_runs', 'run.self', {
        id: 'run.self',
        session_id: 'session.1',
        default_canvas_id: null,
        parent_run_id: 'run.self',
        retry_of_run_id: 'run.self',
      }),
      row('commander_runs', 'run.a', {
        id: 'run.a',
        session_id: 'session.1',
        default_canvas_id: null,
        parent_run_id: 'run.b',
        retry_of_run_id: null,
      }),
      row('commander_runs', 'run.b', {
        id: 'run.b',
        session_id: 'session.1',
        default_canvas_id: null,
        parent_run_id: 'run.a',
        retry_of_run_id: null,
      }),
    ];

    const report = resolveLegacyProjectOwnership(SOURCE_FINGERPRINT, rows);
    expect(report).toEqual(resolveLegacyProjectOwnership(SOURCE_FINGERPRINT, [...rows].reverse()));
    expect(report.blockers.map(({ blockerCode }) => blockerCode)).toEqual(
      expect.arrayContaining([
        'self_referencing_parent_run',
        'self_referencing_retry_run',
        'cyclic_parent_run_scope',
      ]),
    );
    for (const identity of ['run.self', 'run.a', 'run.b']) {
      expect(assignment(report, 'commander_runs', identity)).toMatchObject({
        disposition: 'blocking_error',
        targetRefs: [],
      });
    }
  });

  it('blocks every duplicate Run-Canvas row without input-order-dependent claims', () => {
    const rows = [
      row('canvases', 'canvas.1', { id: 'canvas.1', archived_at: null }),
      row('commander_sessions', 'session.1', {
        id: 'session.1',
        default_canvas_id: 'canvas.1',
      }),
      row('commander_runs', 'run.1', {
        id: 'run.1',
        session_id: 'session.1',
        default_canvas_id: null,
        parent_run_id: null,
        retry_of_run_id: null,
      }),
      row('commander_run_canvases', 'duplicate.a', {
        run_id: 'run.1',
        canvas_id: 'canvas.1',
        released_at: null,
      }),
      row('commander_run_canvases', 'duplicate.b', {
        run_id: 'run.1',
        canvas_id: 'canvas.1',
        released_at: 10n,
      }),
    ];

    const report = resolveLegacyProjectOwnership(SOURCE_FINGERPRINT, rows);
    expect(report).toEqual(resolveLegacyProjectOwnership(SOURCE_FINGERPRINT, [...rows].reverse()));
    for (const identity of ['duplicate.a', 'duplicate.b']) {
      expect(assignment(report, 'commander_run_canvases', identity)).toMatchObject({
        disposition: 'blocking_error',
        blockerCode: 'duplicate_legacy_run_canvas_scope',
        targetRefs: [],
      });
    }
    const duplicateSourceKeys = new Set([
      ownershipSourceKey('commander_run_canvases', 'duplicate.a'),
      ownershipSourceKey('commander_run_canvases', 'duplicate.b'),
    ]);
    expect(
      report.claims.some(
        ({ kind, evidenceRefs }) =>
          kind === 'run_canvas_scope' &&
          evidenceRefs.some(({ sourceKey }) => duplicateSourceKeys.has(sourceKey)),
      ),
    ).toBe(false);
  });

  it('binds Task Lists from matching Canvas, Session, or entity evidence and makes Tasks inherit', () => {
    const report = resolveLegacyProjectOwnership(SOURCE_FINGERPRINT, [
      row('canvases', 'canvas.1', { id: 'canvas.1', archived_at: null }),
      row('canvases', 'canvas.2', { id: 'canvas.2', archived_at: null }),
      row('characters', 'character.1', {
        id: 'character.1',
        default_loadout_id: '',
        loadouts: '[]',
      }),
      row('canvas_nodes', 'node.1', {
        id: 'node.1',
        canvas_id: 'canvas.1',
        type: 'image',
        data_json: JSON.stringify({
          assetHash: digest('dependency-node-media'),
          characterRefs: [{ characterId: 'character.1', loadoutId: '' }],
        }),
      }),
      row('commander_sessions', 'session.1', {
        id: 'session.1',
        default_canvas_id: 'canvas.1',
      }),
      row('commander_sessions', 'session.2', {
        id: 'session.2',
        default_canvas_id: 'canvas.2',
      }),
      row('task_lists', 'task-list.canvas', {
        id: 'task-list.canvas',
        entity_type: 'canvas',
        entity_id: 'canvas.1',
        metadata_json: JSON.stringify({ commanderSessionId: 'session.1' }),
      }),
      row('task_lists', 'task-list.entity', {
        id: 'task-list.entity',
        entity_type: 'character',
        entity_id: 'character.1',
        metadata_json: JSON.stringify({ commanderSessionId: 'session.1' }),
      }),
      row('task_lists', 'task-list.conflict', {
        id: 'task-list.conflict',
        entity_type: 'canvas',
        entity_id: 'canvas.1',
        metadata_json: JSON.stringify({ commanderSessionId: 'session.2' }),
      }),
      row('tasks', 'task.1', { id: 'task.1', task_list_id: 'task-list.canvas' }),
      row('tasks', 'task.orphan', { id: 'task.orphan', task_list_id: 'task-list.missing' }),
    ]);

    expect(assignment(report, 'task_lists', 'task-list.canvas')).toMatchObject({
      projectIds: ['canvas.1'],
      disposition: 'single_project',
      blockerCode: null,
    });
    expect(assignment(report, 'task_lists', 'task-list.entity')).toMatchObject({
      projectIds: ['canvas.1'],
      disposition: 'single_project',
      blockerCode: null,
    });
    expect(assignment(report, 'tasks', 'task.1')).toMatchObject({
      projectIds: ['canvas.1'],
      disposition: 'single_project',
      targetRefs: [
        { authority: 'imported_task_item_history', id: 'task.1', projectId: 'canvas.1' },
      ],
      blockerCode: null,
    });
    expect(assignment(report, 'task_lists', 'task-list.conflict')).toMatchObject({
      disposition: 'blocking_error',
    });
    expect(assignment(report, 'tasks', 'task.orphan')).toMatchObject({
      disposition: 'blocking_error',
      blockerCode: 'missing_task_parent_list',
    });
  });

  it('keeps every Legacy dependency blocked until an exact relation registry exists', () => {
    const report = resolveLegacyProjectOwnership(SOURCE_FINGERPRINT, [
      row('canvases', 'canvas.1', { id: 'canvas.1', archived_at: null }),
      row('canvases', 'canvas.2', { id: 'canvas.2', archived_at: null }),
      row('characters', 'character.1', {
        id: 'character.1',
        default_loadout_id: '',
        loadouts: '[]',
      }),
      row('equipment', 'equipment.same', { id: 'equipment.same' }),
      row('equipment', 'equipment.other', { id: 'equipment.other' }),
      row('canvas_nodes', 'node.1', {
        id: 'node.1',
        canvas_id: 'canvas.1',
        type: 'image',
        data_json: JSON.stringify({
          assetHash: digest('dependency-node-media'),
          characterRefs: [{ characterId: 'character.1', loadoutId: '' }],
          equipmentRefs: [{ equipmentId: 'equipment.same' }],
        }),
      }),
      row('canvas_nodes', 'node.2', {
        id: 'node.2',
        canvas_id: 'canvas.2',
        type: 'image',
        data_json: JSON.stringify({ equipmentRefs: [{ equipmentId: 'equipment.other' }] }),
      }),
      row('dependencies', 'same-project', {
        source_type: 'character',
        source_id: 'character.1',
        target_type: 'equipment',
        target_id: 'equipment.same',
      }),
      row('dependencies', 'cross-project', {
        source_type: 'character',
        source_id: 'character.1',
        target_type: 'equipment',
        target_id: 'equipment.other',
      }),
      row('dependencies', 'missing', {
        source_type: 'character',
        source_id: 'character.missing',
        target_type: 'equipment',
        target_id: 'equipment.same',
      }),
    ]);

    expect(report.ok).toBe(false);
    expect(report.blockers.map(({ blockerCode }) => blockerCode)).toEqual(
      expect.arrayContaining([
        'ambiguous_legacy_dependency_relation',
        'legacy_dependency_project_ownership_mismatch',
        'missing_legacy_dependency_endpoint',
      ]),
    );
    expect(
      report.assignments
        .filter(({ table }) => table === 'dependencies')
        .every(
          ({ disposition, projectIds, targetRefs }) =>
            disposition === 'blocking_error' && projectIds.length === 0 && targetRefs.length === 0,
        ),
    ).toBe(true);
  });

  it('blocks invalid identities, cross-type Production collisions, and broken graph links', () => {
    const report = resolveLegacyProjectOwnership(SOURCE_FINGERPRINT, [
      row('canvases', 'invalid', { id: 'invalid canvas id', archived_at: null }),
      row('canvases', 'canvas.1', { id: 'canvas.1', archived_at: null }),
      row('characters', 'shared', {
        id: 'production.same',
        default_loadout_id: '',
        loadouts: '[]',
      }),
      row('equipment', 'shared', { id: 'production.same' }),
      row('canvas_nodes', 'node.missing-canvas', {
        id: 'node.missing-canvas',
        canvas_id: 'canvas.missing',
        type: 'image',
        data_json: '{}',
      }),
      row('canvas_nodes', 'node.valid', {
        id: 'node.valid',
        canvas_id: 'canvas.1',
        type: 'text',
        data_json: '{}',
      }),
      row('canvas_edges', 'edge.missing-node', {
        id: 'edge.missing-node',
        canvas_id: 'canvas.1',
        source: 'node.missing',
        target: 'node.other',
      }),
      row('canvas_edges', 'edge.invalid-target', {
        id: 'edge.invalid-target',
        canvas_id: 'canvas.1',
        source: 'node.valid',
        target: 'invalid target',
      }),
      row('canvas_edges', 'edge.invalid-both', {
        id: 'edge.invalid-both',
        canvas_id: 'canvas.1',
        source: 'invalid source',
        target: 'invalid target',
      }),
    ]);

    expect(report.blockers.map(({ blockerCode }) => blockerCode)).toEqual(
      expect.arrayContaining([
        'invalid_legacy_canvas_id',
        'cross_type_legacy_production_id',
        'missing_legacy_canvas_node_canvas',
        'missing_legacy_canvas_edge_endpoint',
      ]),
    );
    expect(report.assignments.every(({ sourceKey }) => /^[a-f0-9]{64}$/.test(sourceKey))).toBe(
      true,
    );
    const invalidTargetKey = ownershipSourceKey('canvas_edges', 'edge.invalid-target');
    expect(
      report.blockers
        .filter(({ sourceKey }) => sourceKey === invalidTargetKey)
        .map(({ blockerCode, evidencePath }) => ({ blockerCode, evidencePath })),
    ).toEqual([{ blockerCode: 'invalid_legacy_canvas_edge_endpoint', evidencePath: '$.target' }]);
    const invalidBothKey = ownershipSourceKey('canvas_edges', 'edge.invalid-both');
    expect(
      report.blockers
        .filter(({ sourceKey }) => sourceKey === invalidBothKey)
        .map(({ evidencePath }) => evidencePath),
    ).toEqual(['$.source', '$.target']);
  });

  it('rejects an unbound source fingerprint before inspecting rows', () => {
    expect(() => resolveLegacyProjectOwnership('not-a-hash', [])).toThrow(/sourceFingerprint/);
  });
});
