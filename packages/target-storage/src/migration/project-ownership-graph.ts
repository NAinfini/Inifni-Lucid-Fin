import { hashCanonical } from '../internal/hashes.js';
import {
  legacyClassificationSourceKey,
  type LegacyClassificationTargetRefInput,
} from './classification-report.js';
import type { LegacyClassificationRow } from './classification-subjects.js';

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const ENTITY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,159}$/;
const NODE_KINDS = new Set(['image', 'video', 'audio', 'text', 'backdrop']);
const ROOT_ENTITY_NODE_KINDS = new Set(['image', 'video']);
const HISTORY_ENTITY_NODE_KINDS = new Set(['image', 'video', 'audio']);

/**
 * The only synthetic state permitted when an unassigned Legacy Chat is
 * imported as its own Project. Initial revisions are fixed; IDs, hashes,
 * timestamps, and import causation remain transformer/source facts.
 */
export const LEGACY_IMPORTED_CHAT_PROJECT_POLICY_V1 = {
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
} as const;

export const LEGACY_PROJECT_OWNERSHIP_TABLES = [
  'canvas_edges',
  'canvas_nodes',
  'canvases',
  'character_folders',
  'characters',
  'commander_run_canvases',
  'commander_runs',
  'commander_sessions',
  'dependencies',
  'equipment_folders',
  'equipment',
  'location_folders',
  'locations',
  'scripts',
  'task_lists',
  'tasks',
] as const;

type LegacyProjectOwnershipTable = (typeof LEGACY_PROJECT_OWNERSHIP_TABLES)[number];
type ProductionTable = 'characters' | 'equipment' | 'locations' | 'scripts';
type ProductionFolderTable = 'character_folders' | 'equipment_folders' | 'location_folders';

export type LegacyProjectOwnershipClaimKind =
  | 'canvas_identity'
  | 'canvas_parent'
  | 'node_entity_ref'
  | 'node_generation_history_entity_ref'
  | 'character_loadout_equipment'
  | 'session_default_canvas'
  | 'run_default_canvas'
  | 'run_canvas_scope'
  | 'run_session'
  | 'task_list_canvas'
  | 'task_list_session'
  | 'task_list_entity'
  | 'task_list_parent';

export type LegacyProjectOwnershipDisposition =
  | 'single_project'
  | 'cloned_per_project'
  | 'imported_chat_project'
  | 'offline_legacy_export'
  | 'blocking_error';

export interface LegacyProjectOwnershipCanvasProject {
  readonly canvasSourceKey: string;
  readonly canvasId: string;
  readonly projectId: string;
  readonly canvasDocumentId: string;
  readonly lifecycle: 'active' | 'archived';
}

export interface LegacyProjectOwnershipEvidenceRef {
  readonly sourceKey: string;
  readonly path: string;
}

export interface LegacyProjectOwnershipClaim {
  /** The row whose Project ownership this claim establishes. */
  readonly sourceKey: string;
  readonly projectId: string;
  readonly kind: LegacyProjectOwnershipClaimKind;
  /** Every source segment required to prove this claim. */
  readonly evidenceRefs: readonly LegacyProjectOwnershipEvidenceRef[];
}

export interface LegacyProjectOwnershipAssignment {
  readonly sourceKey: string;
  readonly table: LegacyProjectOwnershipTable;
  readonly projectIds: readonly string[];
  readonly disposition: LegacyProjectOwnershipDisposition;
  readonly targetRefs: readonly LegacyClassificationTargetRefInput[];
  readonly exportRef: string | null;
  readonly blockerCode: string | null;
}

export interface LegacyProjectOwnershipBlocker {
  readonly sourceKey: string;
  readonly evidenceSourceKey: string;
  readonly evidencePath: string;
  readonly blockerCode: string;
}

export interface LegacyProjectOwnershipGraphReport {
  readonly schema: 'lucid-fin.legacy-project-ownership-graph/v1';
  readonly sourceFingerprint: string;
  readonly canvasProjects: readonly LegacyProjectOwnershipCanvasProject[];
  readonly claims: readonly LegacyProjectOwnershipClaim[];
  readonly assignments: readonly LegacyProjectOwnershipAssignment[];
  readonly blockers: readonly LegacyProjectOwnershipBlocker[];
  readonly fingerprint: string;
  readonly ok: boolean;
}

interface SourceState {
  readonly row: LegacyClassificationRow;
  readonly sourceKey: string;
  readonly table: LegacyProjectOwnershipTable;
  readonly id: string | null;
  readonly projectIds: Set<string>;
  readonly blockerCodes: Set<string>;
}

interface CharacterLoadout {
  readonly id: string;
  readonly index: number;
  readonly equipment: readonly { readonly id: string; readonly index: number }[];
}

interface CharacterOwnershipState {
  readonly source: SourceState;
  readonly defaultLoadoutId: string;
  readonly loadouts: ReadonlyMap<string, CharacterLoadout>;
}

interface EntityEvidence {
  readonly target: SourceState;
  readonly kind:
    'node_entity_ref' | 'node_generation_history_entity_ref' | 'character_loadout_equipment';
  readonly path: string;
  readonly additionalEvidence?: readonly LegacyProjectOwnershipEvidenceRef[];
}

const OWNERSHIP_TABLE_SET = new Set<string>(LEGACY_PROJECT_OWNERSHIP_TABLES);
const PRODUCTION_TABLES = new Set<ProductionTable>([
  'characters',
  'equipment',
  'locations',
  'scripts',
]);
const PRODUCTION_FOLDER_TABLE_SET = new Set<ProductionFolderTable>([
  'character_folders',
  'equipment_folders',
  'location_folders',
]);
const PRODUCTION_FOLDER_SPECS: readonly {
  readonly folderTable: ProductionFolderTable;
  readonly entityTable: Exclude<ProductionTable, 'scripts'>;
  readonly duplicateCode: string;
  readonly invalidCode: string;
}[] = [
  {
    folderTable: 'character_folders',
    entityTable: 'characters',
    duplicateCode: 'duplicate_legacy_character_folder_id',
    invalidCode: 'invalid_legacy_character_folder_id',
  },
  {
    folderTable: 'equipment_folders',
    entityTable: 'equipment',
    duplicateCode: 'duplicate_legacy_equipment_folder_id',
    invalidCode: 'invalid_legacy_equipment_folder_id',
  },
  {
    folderTable: 'location_folders',
    entityTable: 'locations',
    duplicateCode: 'duplicate_legacy_location_folder_id',
    invalidCode: 'invalid_legacy_location_folder_id',
  },
];

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validEntityId(value: unknown): value is string {
  return typeof value === 'string' && ENTITY_ID_PATTERN.test(value);
}

function stateIdentityColumn(table: LegacyProjectOwnershipTable): string | null {
  if (table === 'commander_run_canvases' || table === 'dependencies') return null;
  return 'id';
}

function createState(row: LegacyClassificationRow): SourceState | null {
  if (row.database !== 'main' || row.subject.path !== '$' || !OWNERSHIP_TABLE_SET.has(row.table)) {
    return null;
  }
  const table = row.table as LegacyProjectOwnershipTable;
  const identityColumn = stateIdentityColumn(table);
  const identity = identityColumn === null ? null : row.values[identityColumn];
  return {
    row,
    sourceKey: legacyClassificationSourceKey(row.subject),
    table,
    id: validEntityId(identity) ? identity : null,
    projectIds: new Set<string>(),
    blockerCodes: new Set<string>(),
  };
}

function statesFor(
  statesByTable: ReadonlyMap<LegacyProjectOwnershipTable, readonly SourceState[]>,
  table: LegacyProjectOwnershipTable,
): readonly SourceState[] {
  return statesByTable.get(table) ?? [];
}

function uniqueIdentityMap(
  states: readonly SourceState[],
  duplicateCode: string,
  invalidCode: string,
  addBlocker: (
    state: SourceState,
    blockerCode: string,
    evidence?: SourceState,
    path?: string,
  ) => void,
): ReadonlyMap<string, SourceState> {
  const groups = new Map<string, SourceState[]>();
  for (const state of states) {
    if (state.id === null) {
      addBlocker(state, invalidCode);
      continue;
    }
    const group = groups.get(state.id);
    if (group) group.push(state);
    else groups.set(state.id, [state]);
  }
  const result = new Map<string, SourceState>();
  for (const [id, group] of groups) {
    if (group.length === 1) {
      const state = group[0];
      if (state) result.set(id, state);
      continue;
    }
    for (const state of group) addBlocker(state, duplicateCode);
  }
  return result;
}

function parseJsonObject(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'string') return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function parseCharacterLoadouts(
  state: SourceState,
  addBlocker: (
    state: SourceState,
    blockerCode: string,
    evidence?: SourceState,
    path?: string,
  ) => void,
): CharacterOwnershipState | null {
  const rawDefault = state.row.values.default_loadout_id;
  if (rawDefault !== null && rawDefault !== undefined && typeof rawDefault !== 'string') {
    addBlocker(state, 'invalid_character_default_loadout_id', state, '$.default_loadout_id');
    return null;
  }
  const defaultLoadoutId = typeof rawDefault === 'string' ? rawDefault : '';
  const rawLoadouts = state.row.values.loadouts;
  if (rawLoadouts === null || rawLoadouts === undefined) {
    if (defaultLoadoutId.length > 0) {
      addBlocker(state, 'missing_character_default_loadout', state, '$.default_loadout_id');
      return null;
    }
    return { source: state, defaultLoadoutId, loadouts: new Map() };
  }
  if (typeof rawLoadouts !== 'string') {
    addBlocker(state, 'invalid_character_loadouts', state, '$.loadouts');
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawLoadouts);
  } catch {
    addBlocker(state, 'invalid_character_loadouts', state, '$.loadouts');
    return null;
  }
  if (!Array.isArray(parsed)) {
    addBlocker(state, 'invalid_character_loadouts', state, '$.loadouts');
    return null;
  }
  const loadouts = new Map<string, CharacterLoadout>();
  for (const [index, value] of parsed.entries()) {
    const path = `$.loadouts[${index}]`;
    if (!isPlainObject(value) || !validEntityId(value.id) || !Array.isArray(value.equipmentIds)) {
      addBlocker(state, 'invalid_character_loadout', state, path);
      continue;
    }
    if (loadouts.has(value.id)) {
      addBlocker(state, 'duplicate_character_loadout_id', state, `${path}.id`);
      continue;
    }
    const equipment: Array<{ readonly id: string; readonly index: number }> = [];
    for (const [equipmentIndex, equipmentId] of value.equipmentIds.entries()) {
      if (!validEntityId(equipmentId)) {
        addBlocker(
          state,
          'invalid_character_loadout_equipment_id',
          state,
          `${path}.equipmentIds[${equipmentIndex}]`,
        );
        continue;
      }
      equipment.push({ id: equipmentId, index: equipmentIndex });
    }
    loadouts.set(value.id, { id: value.id, index, equipment });
  }
  if (defaultLoadoutId.length > 0 && !loadouts.has(defaultLoadoutId)) {
    addBlocker(state, 'missing_character_default_loadout', state, '$.default_loadout_id');
  }
  return { source: state, defaultLoadoutId, loadouts };
}

function targetRefsForEntity(
  state: SourceState,
  projectIds: readonly string[],
): readonly LegacyClassificationTargetRefInput[] {
  if (state.id === null || projectIds.length === 0) return [];
  const sourceId = state.id;
  if (projectIds.length === 1) {
    return [{ authority: 'production', id: sourceId, projectId: projectIds[0] ?? null }];
  }
  return projectIds.map((projectId) => ({
    authority: 'production',
    id: `production.import.${hashCanonical({
      schema: 'lucid-fin.legacy-production-clone-id/v1',
      table: state.table,
      sourceId,
      projectId,
    })}`,
    projectId,
    cloneOf: sourceId,
  }));
}

function importedChatProjectId(sessionId: string): string {
  return `project.imported-chat.${hashCanonical({
    schema: 'lucid-fin.legacy-imported-chat-project-id/v1',
    sessionId,
  })}`;
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sortedProjects(state: SourceState): readonly string[] {
  return [...state.projectIds].sort(compareText);
}

function rootEntityRefSpecs(): readonly {
  readonly key: 'characterRefs' | 'equipmentRefs' | 'locationRefs';
  readonly idKey: 'characterId' | 'equipmentId' | 'locationId';
  readonly table: 'characters' | 'equipment' | 'locations';
}[] {
  return [
    { key: 'characterRefs', idKey: 'characterId', table: 'characters' },
    { key: 'equipmentRefs', idKey: 'equipmentId', table: 'equipment' },
    { key: 'locationRefs', idKey: 'locationId', table: 'locations' },
  ];
}

function historyEntityRefSpecs(): readonly {
  readonly key: 'characterRefs' | 'equipmentRefs' | 'locationRefs';
  readonly table: 'characters' | 'equipment' | 'locations';
}[] {
  return [
    { key: 'characterRefs', table: 'characters' },
    { key: 'equipmentRefs', table: 'equipment' },
    { key: 'locationRefs', table: 'locations' },
  ];
}

/**
 * Resolves the frozen Legacy Canvas-to-Project ownership graph without
 * writing either source or target storage. Only explicit typed references
 * establish ownership; text and arbitrary JSON never do.
 */
export function resolveLegacyProjectOwnership(
  sourceFingerprint: string,
  rows: readonly LegacyClassificationRow[],
): LegacyProjectOwnershipGraphReport {
  if (!SHA256_PATTERN.test(sourceFingerprint)) {
    throw new TypeError('Legacy Project ownership sourceFingerprint must be lowercase SHA-256');
  }

  const states = rows.flatMap((row) => {
    const state = createState(row);
    return state === null ? [] : [state];
  });
  const sourceKeys = new Set<string>();
  for (const state of states) {
    if (sourceKeys.has(state.sourceKey)) {
      throw new TypeError(`Duplicate Legacy Project ownership source: ${state.sourceKey}`);
    }
    sourceKeys.add(state.sourceKey);
  }
  const statesByTable = new Map<LegacyProjectOwnershipTable, SourceState[]>();
  for (const state of states) {
    const group = statesByTable.get(state.table);
    if (group) group.push(state);
    else statesByTable.set(state.table, [state]);
  }

  const blockerMap = new Map<string, LegacyProjectOwnershipBlocker>();
  const addBlocker = (
    state: SourceState,
    blockerCode: string,
    evidence: SourceState = state,
    evidencePath = '$',
  ): void => {
    state.blockerCodes.add(blockerCode);
    const blocker: LegacyProjectOwnershipBlocker = {
      sourceKey: state.sourceKey,
      evidenceSourceKey: evidence.sourceKey,
      evidencePath,
      blockerCode,
    };
    blockerMap.set(hashCanonical(blocker), blocker);
  };

  const claims = new Map<string, LegacyProjectOwnershipClaim>();
  const addClaim = (
    target: SourceState,
    projectId: string,
    kind: LegacyProjectOwnershipClaimKind,
    evidence: SourceState,
    evidencePath: string,
    additionalEvidence: readonly LegacyProjectOwnershipEvidenceRef[] = [],
  ): void => {
    target.projectIds.add(projectId);
    const evidenceRefs = [
      { sourceKey: evidence.sourceKey, path: evidencePath },
      ...additionalEvidence,
    ].sort(
      (left, right) =>
        compareText(left.sourceKey, right.sourceKey) || compareText(left.path, right.path),
    );
    const claim: LegacyProjectOwnershipClaim = {
      sourceKey: target.sourceKey,
      projectId,
      kind,
      evidenceRefs,
    };
    claims.set(hashCanonical(claim), claim);
  };

  const canvases = uniqueIdentityMap(
    statesFor(statesByTable, 'canvases'),
    'duplicate_legacy_canvas_id',
    'invalid_legacy_canvas_id',
    addBlocker,
  );
  const nodes = uniqueIdentityMap(
    statesFor(statesByTable, 'canvas_nodes'),
    'duplicate_legacy_canvas_node_id',
    'invalid_legacy_canvas_node_id',
    addBlocker,
  );
  const edges = uniqueIdentityMap(
    statesFor(statesByTable, 'canvas_edges'),
    'duplicate_legacy_canvas_edge_id',
    'invalid_legacy_canvas_edge_id',
    addBlocker,
  );
  const characters = uniqueIdentityMap(
    statesFor(statesByTable, 'characters'),
    'duplicate_legacy_character_id',
    'invalid_legacy_character_id',
    addBlocker,
  );
  const equipment = uniqueIdentityMap(
    statesFor(statesByTable, 'equipment'),
    'duplicate_legacy_equipment_id',
    'invalid_legacy_equipment_id',
    addBlocker,
  );
  const locations = uniqueIdentityMap(
    statesFor(statesByTable, 'locations'),
    'duplicate_legacy_location_id',
    'invalid_legacy_location_id',
    addBlocker,
  );
  const productionFolderMaps = new Map<ProductionFolderTable, ReadonlyMap<string, SourceState>>(
    PRODUCTION_FOLDER_SPECS.map(
      ({
        folderTable,
        duplicateCode,
        invalidCode,
      }): readonly [ProductionFolderTable, ReadonlyMap<string, SourceState>] => [
        folderTable,
        uniqueIdentityMap(
          statesFor(statesByTable, folderTable),
          duplicateCode,
          invalidCode,
          addBlocker,
        ),
      ],
    ),
  );
  const scripts = uniqueIdentityMap(
    statesFor(statesByTable, 'scripts'),
    'duplicate_legacy_script_id',
    'invalid_legacy_script_id',
    addBlocker,
  );
  const sessions = uniqueIdentityMap(
    statesFor(statesByTable, 'commander_sessions'),
    'duplicate_legacy_session_id',
    'invalid_legacy_session_id',
    addBlocker,
  );
  const runs = uniqueIdentityMap(
    statesFor(statesByTable, 'commander_runs'),
    'duplicate_legacy_run_id',
    'invalid_legacy_run_id',
    addBlocker,
  );
  const taskLists = uniqueIdentityMap(
    statesFor(statesByTable, 'task_lists'),
    'duplicate_legacy_task_list_id',
    'invalid_legacy_task_list_id',
    addBlocker,
  );
  const tasks = uniqueIdentityMap(
    statesFor(statesByTable, 'tasks'),
    'duplicate_legacy_task_id',
    'invalid_legacy_task_id',
    addBlocker,
  );

  const productionMaps = new Map<ProductionTable, ReadonlyMap<string, SourceState>>([
    ['characters', characters],
    ['equipment', equipment],
    ['locations', locations],
    ['scripts', scripts],
  ]);
  const productionIdentityGroups = new Map<string, SourceState[]>();
  for (const table of PRODUCTION_TABLES) {
    for (const state of productionMaps.get(table)?.values() ?? []) {
      if (state.id === null) continue;
      const group = productionIdentityGroups.get(state.id);
      if (group) group.push(state);
      else productionIdentityGroups.set(state.id, [state]);
    }
  }
  for (const group of productionIdentityGroups.values()) {
    if (group.length < 2) continue;
    for (const state of group) addBlocker(state, 'cross_type_legacy_production_id');
  }

  for (const { folderTable, entityTable } of PRODUCTION_FOLDER_SPECS) {
    const folders = productionFolderMaps.get(folderTable);
    if (!folders) throw new Error(`Missing Production folder map: ${folderTable}`);

    const folderBySourceKey = new Map(
      [...folders.values()].map((folder) => [folder.sourceKey, folder] as const),
    );
    const neighbors = new Map(
      [...folders.values()].map((folder) => [folder.sourceKey, new Set<string>()] as const),
    );
    const structuralIssues: Array<{
      readonly state: SourceState;
      readonly blockerCode: string;
      readonly evidence: SourceState;
      readonly evidencePath: string;
    }> = [];
    const addStructuralIssue = (
      state: SourceState,
      blockerCode: string,
      evidence: SourceState = state,
      evidencePath = '$.parent_id',
    ): void => {
      addBlocker(state, blockerCode, evidence, evidencePath);
      structuralIssues.push({ state, blockerCode, evidence, evidencePath });
    };

    for (const folder of folders.values()) {
      const parentId = folder.row.values.parent_id;
      if (parentId === null || parentId === undefined) continue;
      if (!validEntityId(parentId)) {
        addStructuralIssue(folder, 'invalid_legacy_production_folder_parent_id');
        continue;
      }
      if (parentId === folder.id) {
        addStructuralIssue(folder, 'self_referencing_legacy_production_folder');
        continue;
      }
      const parent = folders.get(parentId);
      if (!parent) {
        addStructuralIssue(folder, 'missing_legacy_production_folder_parent');
        continue;
      }
      neighbors.get(folder.sourceKey)?.add(parent.sourceKey);
      neighbors.get(parent.sourceKey)?.add(folder.sourceKey);
    }

    const completed = new Set<string>();
    for (const start of [...folders.values()].sort((left, right) =>
      compareText(left.sourceKey, right.sourceKey),
    )) {
      if (completed.has(start.sourceKey)) continue;
      const path: SourceState[] = [];
      const positions = new Map<string, number>();
      let current: SourceState | undefined = start;
      while (current && !completed.has(current.sourceKey)) {
        const cycleStart = positions.get(current.sourceKey);
        if (cycleStart !== undefined) {
          for (const member of path.slice(cycleStart)) {
            addStructuralIssue(member, 'cyclic_legacy_production_folder_hierarchy');
          }
          break;
        }
        positions.set(current.sourceKey, path.length);
        path.push(current);
        const parentId: unknown = current.row.values.parent_id;
        current =
          validEntityId(parentId) && parentId !== current.id ? folders.get(parentId) : undefined;
      }
      for (const member of path) completed.add(member.sourceKey);
    }

    const componentBySourceKey = new Map<string, readonly SourceState[]>();
    const visited = new Set<string>();
    for (const start of [...folders.values()].sort((left, right) =>
      compareText(left.sourceKey, right.sourceKey),
    )) {
      if (visited.has(start.sourceKey)) continue;
      const stack = [start.sourceKey];
      const members: SourceState[] = [];
      visited.add(start.sourceKey);
      while (stack.length > 0) {
        const sourceKey = stack.pop();
        if (!sourceKey) continue;
        const member = folderBySourceKey.get(sourceKey);
        if (member) members.push(member);
        for (const neighbor of neighbors.get(sourceKey) ?? []) {
          if (visited.has(neighbor)) continue;
          visited.add(neighbor);
          stack.push(neighbor);
        }
      }
      members.sort((left, right) => compareText(left.sourceKey, right.sourceKey));
      for (const member of members) componentBySourceKey.set(member.sourceKey, members);
    }

    for (const issue of structuralIssues) {
      for (const member of componentBySourceKey.get(issue.state.sourceKey) ?? [issue.state]) {
        addBlocker(member, issue.blockerCode, issue.evidence, issue.evidencePath);
      }
    }

    for (const entity of statesFor(statesByTable, entityTable)) {
      const folderId = entity.row.values.folder_id;
      if (folderId === null || folderId === undefined || folderId === '') continue;
      if (!validEntityId(folderId)) {
        addBlocker(entity, 'invalid_legacy_production_folder_id', entity, '$.folder_id');
        continue;
      }
      const folder = folders.get(folderId);
      if (!folder) {
        addBlocker(entity, 'missing_legacy_production_folder', entity, '$.folder_id');
        continue;
      }
      for (const member of componentBySourceKey.get(folder.sourceKey) ?? [folder]) {
        addBlocker(member, 'unresolved_legacy_production_collection_target', entity, '$.folder_id');
      }
    }
  }

  const canvasProjects: LegacyProjectOwnershipCanvasProject[] = [];
  for (const state of canvases.values()) {
    if (state.id === null) continue;
    const archivedAt = state.row.values.archived_at;
    if (
      archivedAt !== null &&
      archivedAt !== undefined &&
      (typeof archivedAt !== 'bigint' || archivedAt < 0n)
    ) {
      addBlocker(state, 'invalid_legacy_canvas_lifecycle', state, '$.archived_at');
      continue;
    }
    addClaim(state, state.id, 'canvas_identity', state, '$.id');
    if (state.blockerCodes.size === 0) {
      canvasProjects.push({
        canvasSourceKey: state.sourceKey,
        canvasId: state.id,
        projectId: state.id,
        canvasDocumentId: state.id,
        lifecycle: archivedAt === null || archivedAt === undefined ? 'active' : 'archived',
      });
    }
  }

  const canvasFor = (
    state: SourceState,
    value: unknown,
    invalidCode: string,
    missingCode: string,
    path: string,
  ): SourceState | null => {
    if (!validEntityId(value)) {
      addBlocker(state, invalidCode, state, path);
      return null;
    }
    const canvas = canvases.get(value);
    if (!canvas) {
      addBlocker(state, missingCode, state, path);
      return null;
    }
    if (canvas.blockerCodes.size > 0) {
      addBlocker(state, 'unmigratable_legacy_canvas_parent', canvas, '$.id');
      return null;
    }
    return canvas;
  };

  const characterOwnership = new Map<string, CharacterOwnershipState>();
  for (const state of characters.values()) {
    if (state.id === null) continue;
    const parsed = parseCharacterLoadouts(state, addBlocker);
    if (parsed) characterOwnership.set(state.id, parsed);
  }

  for (const node of nodes.values()) {
    const canvas = canvasFor(
      node,
      node.row.values.canvas_id,
      'invalid_legacy_canvas_node_canvas_id',
      'missing_legacy_canvas_node_canvas',
      '$.canvas_id',
    );
    if (canvas?.id) addClaim(node, canvas.id, 'canvas_parent', canvas, '$.id');
    const nodeType = node.row.values.type;
    if (typeof nodeType !== 'string' || !NODE_KINDS.has(nodeType)) {
      addBlocker(node, 'unknown_legacy_canvas_node_kind', node, '$.type');
      continue;
    }
    const data = parseJsonObject(node.row.values.data_json);
    if (!data) {
      addBlocker(node, 'invalid_legacy_canvas_node_data', node, '$.data_json');
      continue;
    }
    const provisional: EntityEvidence[] = [];
    for (const spec of rootEntityRefSpecs()) {
      if (!Object.hasOwn(data, spec.key)) continue;
      if (!ROOT_ENTITY_NODE_KINDS.has(nodeType)) {
        addBlocker(
          node,
          'root_entity_refs_not_allowed_for_node_kind',
          node,
          `$.data_json.${spec.key}`,
        );
        continue;
      }
      const values = data[spec.key];
      if (!Array.isArray(values)) {
        addBlocker(node, 'invalid_root_entity_ref_collection', node, `$.data_json.${spec.key}`);
        continue;
      }
      for (const [index, value] of values.entries()) {
        const path = `$.data_json.${spec.key}[${index}].${spec.idKey}`;
        if (!isPlainObject(value)) {
          addBlocker(node, 'invalid_root_entity_ref', node, path);
          continue;
        }
        const entityId = value[spec.idKey];
        if (!validEntityId(entityId)) {
          addBlocker(node, 'invalid_root_entity_ref', node, path);
          continue;
        }
        const loadoutId = value.loadoutId;
        if (spec.key === 'characterRefs' && typeof loadoutId !== 'string') {
          addBlocker(
            node,
            'invalid_character_loadout_ref',
            node,
            `$.data_json.${spec.key}[${index}].loadoutId`,
          );
          continue;
        }
        const target = productionMaps.get(spec.table)?.get(entityId);
        if (!target) {
          addBlocker(node, `missing_${spec.table.slice(0, -1)}_ref`, node, path);
          continue;
        }
        if (target.blockerCodes.size > 0) {
          addBlocker(node, `unmigratable_${spec.table.slice(0, -1)}_ref`, target, '$.id');
          continue;
        }
        provisional.push({ target, kind: 'node_entity_ref', path });

        if (spec.key !== 'characterRefs' || canvas?.id === null || canvas?.id === undefined) {
          continue;
        }
        const character = characterOwnership.get(entityId);
        if (!character || character.source.blockerCodes.size > 0) {
          addBlocker(node, 'unmigratable_character_loadouts', target, '$.loadouts');
          continue;
        }
        const requestedLoadoutId = typeof loadoutId === 'string' ? loadoutId : '';
        const loadout =
          (requestedLoadoutId.length > 0
            ? character.loadouts.get(requestedLoadoutId)
            : undefined) ??
          (character.defaultLoadoutId.length > 0
            ? character.loadouts.get(character.defaultLoadoutId)
            : undefined);
        if (!loadout && (requestedLoadoutId.length > 0 || character.defaultLoadoutId.length > 0)) {
          addBlocker(node, 'missing_character_loadout', target, '$.loadouts');
          continue;
        }
        for (const loadoutEquipment of loadout?.equipment ?? []) {
          const equipmentTarget = equipment.get(loadoutEquipment.id);
          const equipmentPath = `$.loadouts[${loadout!.index}].equipmentIds[${loadoutEquipment.index}]`;
          if (!equipmentTarget) {
            addBlocker(node, 'missing_character_loadout_equipment', target, equipmentPath);
            continue;
          }
          if (equipmentTarget.blockerCodes.size > 0) {
            addBlocker(node, 'unmigratable_character_loadout_equipment', equipmentTarget, '$.id');
            continue;
          }
          provisional.push({
            target: equipmentTarget,
            kind: 'character_loadout_equipment',
            path: `$.data_json.${spec.key}[${index}].${spec.idKey}`,
            additionalEvidence: [
              {
                sourceKey: character.source.sourceKey,
                path: `$.loadouts[${loadout!.index}].id`,
              },
              { sourceKey: character.source.sourceKey, path: equipmentPath },
              ...(character.loadouts.get(requestedLoadoutId) === loadout
                ? []
                : [
                    {
                      sourceKey: character.source.sourceKey,
                      path: '$.default_loadout_id',
                    },
                  ]),
              {
                sourceKey: node.sourceKey,
                path: `$.data_json.${spec.key}[${index}].loadoutId`,
              },
            ],
          });
        }
      }
    }

    if (Object.hasOwn(data, 'generationHistory')) {
      if (!HISTORY_ENTITY_NODE_KINDS.has(nodeType)) {
        addBlocker(
          node,
          'generation_history_not_allowed_for_node_kind',
          node,
          '$.data_json.generationHistory',
        );
      } else if (!Array.isArray(data.generationHistory)) {
        addBlocker(
          node,
          'invalid_generation_history_collection',
          node,
          '$.data_json.generationHistory',
        );
      } else {
        for (const [historyIndex, history] of data.generationHistory.entries()) {
          if (!isPlainObject(history)) {
            addBlocker(
              node,
              'invalid_generation_history_entry',
              node,
              `$.data_json.generationHistory[${historyIndex}]`,
            );
            continue;
          }
          for (const spec of historyEntityRefSpecs()) {
            if (!Object.hasOwn(history, spec.key)) continue;
            const values = history[spec.key];
            if (!Array.isArray(values)) {
              addBlocker(
                node,
                'invalid_generation_history_entity_ref_collection',
                node,
                `$.data_json.generationHistory[${historyIndex}].${spec.key}`,
              );
              continue;
            }
            for (const [index, value] of values.entries()) {
              const path = `$.data_json.generationHistory[${historyIndex}].${spec.key}[${index}].entityId`;
              if (!isPlainObject(value) || !validEntityId(value.entityId)) {
                addBlocker(node, 'invalid_generation_history_entity_ref', node, path);
                continue;
              }
              const target = productionMaps.get(spec.table)?.get(value.entityId);
              if (!target) {
                addBlocker(node, `missing_${spec.table.slice(0, -1)}_history_ref`, node, path);
                continue;
              }
              if (target.blockerCodes.size > 0) {
                addBlocker(
                  node,
                  `unmigratable_${spec.table.slice(0, -1)}_history_ref`,
                  target,
                  '$.id',
                );
                continue;
              }
              provisional.push({
                target,
                kind: 'node_generation_history_entity_ref',
                path,
              });
            }
          }
        }
      }
    }
    if (node.blockerCodes.size === 0 && canvas?.id) {
      for (const evidence of provisional) {
        addClaim(
          evidence.target,
          canvas.id,
          evidence.kind,
          node,
          evidence.path,
          evidence.additionalEvidence ?? [],
        );
      }
    }
  }

  for (const edge of edges.values()) {
    const canvas = canvasFor(
      edge,
      edge.row.values.canvas_id,
      'invalid_legacy_canvas_edge_canvas_id',
      'missing_legacy_canvas_edge_canvas',
      '$.canvas_id',
    );
    if (canvas?.id) addClaim(edge, canvas.id, 'canvas_parent', canvas, '$.id');
    const sourceId = edge.row.values.source;
    const targetId = edge.row.values.target;
    const sourceIdIsValid = validEntityId(sourceId);
    const targetIdIsValid = validEntityId(targetId);
    if (!sourceIdIsValid) {
      addBlocker(edge, 'invalid_legacy_canvas_edge_endpoint', edge, '$.source');
    }
    if (!targetIdIsValid) {
      addBlocker(edge, 'invalid_legacy_canvas_edge_endpoint', edge, '$.target');
    }
    if (!sourceIdIsValid || !targetIdIsValid) {
      continue;
    }
    if (sourceId === targetId) {
      addBlocker(edge, 'self_referencing_legacy_canvas_edge', edge, '$.target');
      continue;
    }
    const source = nodes.get(sourceId);
    const target = nodes.get(targetId);
    if (!source) {
      addBlocker(edge, 'missing_legacy_canvas_edge_endpoint', edge, '$.source');
    }
    if (!target) {
      addBlocker(edge, 'missing_legacy_canvas_edge_endpoint', edge, '$.target');
    }
    if (!source || !target) {
      continue;
    }
    if (source.blockerCodes.size > 0) {
      addBlocker(edge, 'unmigratable_legacy_canvas_edge_endpoint', edge, '$.source');
    }
    if (target.blockerCodes.size > 0) {
      addBlocker(edge, 'unmigratable_legacy_canvas_edge_endpoint', edge, '$.target');
    }
    if (source.blockerCodes.size > 0 || target.blockerCodes.size > 0) {
      continue;
    }
    const sourceCanvas = sortedProjects(source);
    const targetCanvas = sortedProjects(target);
    const edgeCanvas = sortedProjects(edge);
    if (!sameStrings(sourceCanvas, edgeCanvas))
      addBlocker(edge, 'cross_canvas_legacy_canvas_edge', edge, '$.source');
    if (!sameStrings(targetCanvas, edgeCanvas))
      addBlocker(edge, 'cross_canvas_legacy_canvas_edge', edge, '$.target');
  }

  const taskListSessionIds = new Map<string, string>();
  const taskListCanvasClaims = new Map<string, string>();
  for (const taskList of taskLists.values()) {
    const metadata = parseJsonObject(taskList.row.values.metadata_json);
    if (!metadata) {
      addBlocker(taskList, 'invalid_task_list_metadata', taskList, '$.metadata_json');
    } else if (Object.hasOwn(metadata, 'commanderSessionId')) {
      const value = metadata.commanderSessionId;
      if (typeof value !== 'string' || value.trim().length === 0) {
        addBlocker(
          taskList,
          'invalid_task_list_session_claim',
          taskList,
          '$.metadata_json.commanderSessionId',
        );
      } else {
        taskListSessionIds.set(taskList.sourceKey, value.trim());
      }
    }
    if (taskList.row.values.entity_type !== 'canvas') continue;
    const canvas = canvasFor(
      taskList,
      taskList.row.values.entity_id,
      'invalid_task_list_canvas_id',
      'missing_task_list_canvas',
      '$.entity_id',
    );
    if (!canvas?.id) continue;
    taskListCanvasClaims.set(taskList.sourceKey, canvas.id);
    const sessionId = taskListSessionIds.get(taskList.sourceKey);
    const session = sessionId ? sessions.get(sessionId) : undefined;
    if (session) {
      addClaim(session, canvas.id, 'task_list_canvas', taskList, '$.entity_id');
    } else if (sessionId) {
      addBlocker(
        taskList,
        'missing_task_list_session',
        taskList,
        '$.metadata_json.commanderSessionId',
      );
    }
  }

  for (const session of sessions.values()) {
    const defaultCanvasId = session.row.values.default_canvas_id;
    if (defaultCanvasId === null || defaultCanvasId === undefined) continue;
    const canvas = canvasFor(
      session,
      defaultCanvasId,
      'invalid_session_default_canvas_id',
      'missing_session_default_canvas',
      '$.default_canvas_id',
    );
    if (canvas?.id)
      addClaim(session, canvas.id, 'session_default_canvas', session, '$.default_canvas_id');
  }

  const runSessions = new Map<string, SourceState>();
  const runDirectProjects = new Map<string, Set<string>>();
  const addRunDirectProject = (
    run: SourceState,
    projectId: string,
    kind: 'run_default_canvas' | 'run_canvas_scope',
    evidence: SourceState,
    path: string,
  ): void => {
    const direct = runDirectProjects.get(run.sourceKey) ?? new Set<string>();
    direct.add(projectId);
    runDirectProjects.set(run.sourceKey, direct);
    addClaim(run, projectId, kind, evidence, path);
    const session = runSessions.get(run.sourceKey);
    if (session) addClaim(session, projectId, kind, evidence, path);
  };

  for (const run of runs.values()) {
    const sessionId = run.row.values.session_id;
    if (!validEntityId(sessionId)) {
      addBlocker(run, 'invalid_run_session_id', run, '$.session_id');
      continue;
    }
    const session = sessions.get(sessionId);
    if (!session) {
      addBlocker(run, 'missing_run_session', run, '$.session_id');
      continue;
    }
    runSessions.set(run.sourceKey, session);
    const defaultCanvasId = run.row.values.default_canvas_id;
    if (defaultCanvasId === null || defaultCanvasId === undefined) continue;
    const canvas = canvasFor(
      run,
      defaultCanvasId,
      'invalid_run_default_canvas_id',
      'missing_run_default_canvas',
      '$.default_canvas_id',
    );
    if (canvas?.id)
      addRunDirectProject(run, canvas.id, 'run_default_canvas', run, '$.default_canvas_id');
  }

  const runCanvasGroups = new Map<string, SourceState[]>();
  for (const runCanvas of statesFor(statesByTable, 'commander_run_canvases')) {
    const runId = runCanvas.row.values.run_id;
    const canvasId = runCanvas.row.values.canvas_id;
    if (!validEntityId(runId)) {
      addBlocker(runCanvas, 'invalid_run_canvas_run_id', runCanvas, '$.run_id');
      continue;
    }
    if (!validEntityId(canvasId)) {
      addBlocker(runCanvas, 'invalid_run_canvas_canvas_id', runCanvas, '$.canvas_id');
      continue;
    }
    const composite = `${runId}\u0000${canvasId}`;
    const group = runCanvasGroups.get(composite) ?? [];
    group.push(runCanvas);
    runCanvasGroups.set(composite, group);
  }

  for (const group of runCanvasGroups.values()) {
    if (group.length > 1) {
      for (const runCanvas of group) {
        addBlocker(runCanvas, 'duplicate_legacy_run_canvas_scope', runCanvas, '$');
      }
      continue;
    }
    const runCanvas = group[0]!;
    const runId = runCanvas.row.values.run_id as string;
    const canvasId = runCanvas.row.values.canvas_id as string;
    const run = runs.get(runId);
    const canvas = canvases.get(canvasId);
    if (!run) {
      addBlocker(runCanvas, 'missing_run_canvas_run', runCanvas, '$.run_id');
      continue;
    }
    if (!canvas) {
      addBlocker(runCanvas, 'missing_run_canvas_canvas', runCanvas, '$.canvas_id');
      addBlocker(run, 'missing_run_canvas_canvas', runCanvas, '$.canvas_id');
      continue;
    }
    if (canvas.blockerCodes.size > 0) {
      addBlocker(runCanvas, 'unmigratable_run_canvas_canvas', canvas, '$.id');
      addBlocker(run, 'unmigratable_run_canvas_canvas', canvas, '$.id');
      continue;
    }
    if (!runSessions.has(run.sourceKey)) {
      addBlocker(runCanvas, 'unmigratable_run_canvas_run', run, '$.id');
      continue;
    }
    addRunDirectProject(run, canvasId, 'run_canvas_scope', runCanvas, '$.canvas_id');
    addClaim(runCanvas, canvasId, 'run_canvas_scope', runCanvas, '$.canvas_id');
  }

  for (const run of runs.values()) {
    const direct = [...(runDirectProjects.get(run.sourceKey) ?? [])].sort(compareText);
    if (direct.length > 1) {
      addBlocker(run, 'run_project_conflict', run, '$');
      const session = runSessions.get(run.sourceKey);
      if (session) addBlocker(session, 'session_project_conflict', run, '$');
    }
  }
  const importedChatProjects = new Map<string, string>();
  for (const session of sessions.values()) {
    const projects = sortedProjects(session);
    if (projects.length > 1) addBlocker(session, 'session_project_conflict', session, '$');
    if (projects.length === 0 && session.id !== null && session.blockerCodes.size === 0) {
      const projectId = importedChatProjectId(session.id);
      importedChatProjects.set(session.sourceKey, projectId);
      addClaim(session, projectId, 'canvas_identity', session, '$.id');
    }
  }
  const projectIdentityOwners = new Map<string, SourceState[]>();
  for (const canvas of canvases.values()) {
    if (canvas.id === null || canvas.blockerCodes.size > 0) continue;
    projectIdentityOwners.set(canvas.id, [canvas]);
  }
  for (const session of sessions.values()) {
    if (session.blockerCodes.size > 0) continue;
    const projectId = importedChatProjects.get(session.sourceKey);
    if (!projectId) continue;
    const owners = projectIdentityOwners.get(projectId);
    if (owners) owners.push(session);
    else projectIdentityOwners.set(projectId, [session]);
  }
  for (const owners of projectIdentityOwners.values()) {
    if (owners.length < 2) continue;
    for (const owner of owners) addBlocker(owner, 'legacy_project_target_id_collision');
  }
  for (const run of runs.values()) {
    const session = runSessions.get(run.sourceKey);
    if (!session || session.blockerCodes.size > 0) {
      if (session) addBlocker(run, 'unmigratable_run_session', session, '$.id');
      continue;
    }
    const sessionProjects = sortedProjects(session);
    if (sessionProjects.length !== 1) {
      addBlocker(run, 'unresolved_run_session_project', session, '$');
      continue;
    }
    const direct = [...(runDirectProjects.get(run.sourceKey) ?? [])].sort(compareText);
    if (direct.length === 0) {
      addClaim(run, sessionProjects[0]!, 'run_session', session, '$.id');
    } else if (direct.length !== 1 || direct[0] !== sessionProjects[0]) {
      addBlocker(run, 'run_session_project_conflict', session, '$');
    }
  }

  for (const run of runs.values()) {
    for (const [column, code] of [
      ['parent_run_id', 'invalid_parent_run_scope'],
      ['retry_of_run_id', 'invalid_retry_run_scope'],
    ] as const) {
      const relatedId = run.row.values[column];
      if (relatedId === null || relatedId === undefined) continue;
      if (!validEntityId(relatedId)) {
        addBlocker(run, code, run, `$.${column}`);
        continue;
      }
      const related = runs.get(relatedId);
      if (!related) {
        addBlocker(run, code, run, `$.${column}`);
        continue;
      }
      if (related === run) {
        addBlocker(
          run,
          column === 'parent_run_id' ? 'self_referencing_parent_run' : 'self_referencing_retry_run',
          run,
          `$.${column}`,
        );
        continue;
      }
      const runSession = runSessions.get(run.sourceKey);
      const relatedSession = runSessions.get(related.sourceKey);
      if (
        !runSession ||
        !relatedSession ||
        runSession.id !== relatedSession.id ||
        !sameStrings(sortedProjects(run), sortedProjects(related))
      ) {
        addBlocker(run, code, related, '$.id');
      }
    }
  }
  const markRunReferenceCycles = (
    column: 'parent_run_id' | 'retry_of_run_id',
    blockerCode: 'cyclic_parent_run_scope' | 'cyclic_retry_run_scope',
  ): void => {
    const complete = new Set<string>();
    for (const start of runs.values()) {
      if (start.id === null || complete.has(start.id)) continue;
      const path: SourceState[] = [];
      const positions = new Map<string, number>();
      let current: SourceState | undefined = start;
      while (current?.id && !complete.has(current.id)) {
        const cycleStart = positions.get(current.id);
        if (cycleStart !== undefined) {
          for (const member of path.slice(cycleStart)) {
            addBlocker(member, blockerCode, member, `$.${column}`);
          }
          break;
        }
        positions.set(current.id, path.length);
        path.push(current);
        const relatedId: unknown = current.row.values[column];
        current = validEntityId(relatedId) ? runs.get(relatedId) : undefined;
      }
      for (const member of path) {
        if (member.id) complete.add(member.id);
      }
    }
  };
  markRunReferenceCycles('parent_run_id', 'cyclic_parent_run_scope');
  markRunReferenceCycles('retry_of_run_id', 'cyclic_retry_run_scope');

  let propagatedRunBlocker = true;
  while (propagatedRunBlocker) {
    propagatedRunBlocker = false;
    for (const run of runs.values()) {
      for (const [column, code] of [
        ['parent_run_id', 'invalid_parent_run_scope'],
        ['retry_of_run_id', 'invalid_retry_run_scope'],
      ] as const) {
        const relatedId = run.row.values[column];
        const related = validEntityId(relatedId) ? runs.get(relatedId) : undefined;
        if (!related || related.blockerCodes.size === 0 || run.blockerCodes.has(code)) continue;
        addBlocker(run, code, related, '$.id');
        propagatedRunBlocker = true;
      }
    }
  }
  for (const runCanvas of statesFor(statesByTable, 'commander_run_canvases')) {
    if (runCanvas.blockerCodes.size > 0) continue;
    const runId = runCanvas.row.values.run_id;
    const run = validEntityId(runId) ? runs.get(runId) : undefined;
    if (
      !run ||
      run.blockerCodes.size > 0 ||
      !sameStrings(sortedProjects(runCanvas), sortedProjects(run))
    ) {
      addBlocker(
        runCanvas,
        'unmigratable_run_canvas_run',
        run ?? runCanvas,
        run ? '$.id' : '$.run_id',
      );
    }
  }

  for (const taskList of taskLists.values()) {
    const explicitProjects = new Set<string>();
    const entityType = taskList.row.values.entity_type;
    const entityId = taskList.row.values.entity_id;
    const canvasProject = taskListCanvasClaims.get(taskList.sourceKey);
    if (canvasProject) explicitProjects.add(canvasProject);
    else if (
      entityType === 'character' ||
      entityType === 'equipment' ||
      entityType === 'location' ||
      entityType === 'script'
    ) {
      const table = `${entityType}${entityType === 'equipment' ? '' : 's'}` as ProductionTable;
      if (!validEntityId(entityId)) {
        addBlocker(taskList, 'invalid_task_list_entity_id', taskList, '$.entity_id');
      } else {
        const entity = productionMaps.get(table)?.get(entityId);
        if (!entity) {
          addBlocker(taskList, 'missing_task_list_entity', taskList, '$.entity_id');
        } else if (entity.blockerCodes.size > 0) {
          addBlocker(taskList, 'unmigratable_task_list_entity', entity, '$.id');
        } else {
          const entityProjects = sortedProjects(entity);
          if (entityProjects.length !== 1) {
            addBlocker(taskList, 'ambiguous_task_list_entity_project', entity, '$');
          } else {
            explicitProjects.add(entityProjects[0]!);
            addClaim(taskList, entityProjects[0]!, 'task_list_entity', entity, '$.id');
          }
        }
      }
    } else if (typeof entityType !== 'string') {
      addBlocker(taskList, 'invalid_task_list_entity_type', taskList, '$.entity_type');
    } else if (entityId !== null && entityId !== undefined) {
      addBlocker(taskList, 'unsupported_task_list_entity_type', taskList, '$.entity_type');
    }
    if (canvasProject)
      addClaim(taskList, canvasProject, 'task_list_canvas', taskList, '$.entity_id');

    const sessionId = taskListSessionIds.get(taskList.sourceKey);
    if (sessionId) {
      const session = sessions.get(sessionId);
      if (!session) {
        addBlocker(
          taskList,
          'missing_task_list_session',
          taskList,
          '$.metadata_json.commanderSessionId',
        );
      } else if (session.blockerCodes.size > 0 || sortedProjects(session).length !== 1) {
        addBlocker(taskList, 'unmigratable_task_list_session', session, '$');
      } else {
        const projectId = sortedProjects(session)[0]!;
        addClaim(taskList, projectId, 'task_list_session', session, '$.id');
      }
    }
    const projects = sortedProjects(taskList);
    if (projects.length === 0) addBlocker(taskList, 'unresolved_task_list_project', taskList, '$');
    else if (projects.length > 1 || explicitProjects.size > 1) {
      addBlocker(taskList, 'task_list_project_conflict', taskList, '$');
    }
  }

  for (const task of tasks.values()) {
    const taskListId = task.row.values.task_list_id;
    if (!validEntityId(taskListId)) {
      addBlocker(task, 'invalid_task_parent_list_id', task, '$.task_list_id');
      continue;
    }
    const taskList = taskLists.get(taskListId);
    if (!taskList) {
      addBlocker(task, 'missing_task_parent_list', task, '$.task_list_id');
      continue;
    }
    const projects = sortedProjects(taskList);
    if (taskList.blockerCodes.size > 0 || projects.length !== 1) {
      addBlocker(task, 'unmigratable_task_parent_list', taskList, '$.id');
      continue;
    }
    addClaim(task, projects[0]!, 'task_list_parent', taskList, '$.id');
  }

  const dependencyEndpoint = (type: unknown, id: unknown): SourceState | null => {
    if (typeof type !== 'string' || !validEntityId(id)) return null;
    const table =
      type === 'character'
        ? 'characters'
        : type === 'equipment'
          ? 'equipment'
          : type === 'location'
            ? 'locations'
            : type === 'script'
              ? 'scripts'
              : null;
    return table === null ? null : (productionMaps.get(table)?.get(id) ?? null);
  };
  for (const dependency of statesFor(statesByTable, 'dependencies')) {
    const source = dependencyEndpoint(
      dependency.row.values.source_type,
      dependency.row.values.source_id,
    );
    const target = dependencyEndpoint(
      dependency.row.values.target_type,
      dependency.row.values.target_id,
    );
    if (!source || !target) {
      addBlocker(dependency, 'missing_legacy_dependency_endpoint', dependency, '$');
      continue;
    }
    if (source.blockerCodes.size > 0 || target.blockerCodes.size > 0) {
      addBlocker(dependency, 'unmigratable_legacy_dependency_endpoint', dependency, '$');
      continue;
    }
    const sourceProjects = sortedProjects(source);
    const targetProjects = sortedProjects(target);
    if (
      sourceProjects.length === 0 ||
      targetProjects.length === 0 ||
      !sameStrings(sourceProjects, targetProjects)
    ) {
      addBlocker(dependency, 'legacy_dependency_project_ownership_mismatch', dependency, '$');
    } else {
      addBlocker(dependency, 'ambiguous_legacy_dependency_relation', dependency, '$');
    }
  }

  const entityTargetRefs = new Map<string, readonly LegacyClassificationTargetRefInput[]>();
  const targetOwners = new Map<string, SourceState[]>();
  for (const table of PRODUCTION_TABLES) {
    for (const state of productionMaps.get(table)?.values() ?? []) {
      if (state.blockerCodes.size > 0) continue;
      const refs = targetRefsForEntity(state, sortedProjects(state));
      entityTargetRefs.set(state.sourceKey, refs);
      for (const ref of refs) {
        const group = targetOwners.get(ref.id);
        if (group) group.push(state);
        else targetOwners.set(ref.id, [state]);
      }
    }
  }
  for (const group of targetOwners.values()) {
    const distinct = new Map(group.map((state) => [state.sourceKey, state]));
    if (distinct.size < 2) continue;
    for (const state of distinct.values())
      addBlocker(state, 'legacy_production_target_id_collision');
  }

  const targetRefsForState = (
    state: SourceState,
  ): readonly LegacyClassificationTargetRefInput[] => {
    if (state.blockerCodes.size > 0) return [];
    const projectIds = sortedProjects(state);
    if (PRODUCTION_TABLES.has(state.table as ProductionTable)) {
      return entityTargetRefs.get(state.sourceKey) ?? [];
    }
    if (projectIds.length !== 1) return [];
    const projectId = projectIds[0]!;
    if (state.table === 'commander_run_canvases') {
      const runId = state.row.values.run_id;
      return validEntityId(runId) ? [{ authority: 'run', id: runId, projectId }] : [];
    }
    if (state.id === null) return [];
    if (state.table === 'canvases') {
      return [
        { authority: 'project', id: state.id, projectId },
        { authority: 'canvas', id: state.id, projectId },
      ];
    }
    if (state.table === 'canvas_nodes' || state.table === 'canvas_edges') {
      return [{ authority: 'canvas', id: state.id, projectId }];
    }
    if (state.table === 'commander_sessions') {
      const imported = importedChatProjects.get(state.sourceKey) === projectId;
      return imported
        ? [
            { authority: 'project', id: projectId, projectId },
            { authority: 'project_settings', id: projectId, projectId },
            { authority: 'canvas', id: projectId, projectId },
            { authority: 'chat', id: state.id, projectId },
          ]
        : [{ authority: 'chat', id: state.id, projectId }];
    }
    if (state.table === 'commander_runs') {
      return [{ authority: 'run', id: state.id, projectId }];
    }
    if (state.table === 'task_lists') {
      return [{ authority: 'task_list', id: state.id, projectId }];
    }
    if (state.table === 'tasks') {
      const taskListId = state.row.values.task_list_id;
      return validEntityId(taskListId)
        ? [{ authority: 'task_list', id: taskListId, projectId }]
        : [];
    }
    return [];
  };

  const assignments = states
    .map((state): LegacyProjectOwnershipAssignment => {
      const projectIds = sortedProjects(state);
      const blockerCode = [...state.blockerCodes].sort(compareText)[0] ?? null;
      if (blockerCode) {
        return {
          sourceKey: state.sourceKey,
          table: state.table,
          projectIds,
          disposition: 'blocking_error',
          targetRefs: [],
          exportRef: null,
          blockerCode,
        };
      }
      if (
        (PRODUCTION_TABLES.has(state.table as ProductionTable) ||
          PRODUCTION_FOLDER_TABLE_SET.has(state.table as ProductionFolderTable)) &&
        projectIds.length === 0
      ) {
        return {
          sourceKey: state.sourceKey,
          table: state.table,
          projectIds,
          disposition: 'offline_legacy_export',
          targetRefs: [],
          exportRef: `legacy-export/main/${state.table}/${state.sourceKey}`,
          blockerCode: null,
        };
      }
      const importedChat =
        state.table === 'commander_sessions' &&
        projectIds.length === 1 &&
        importedChatProjects.get(state.sourceKey) === projectIds[0];
      return {
        sourceKey: state.sourceKey,
        table: state.table,
        projectIds,
        disposition: importedChat
          ? 'imported_chat_project'
          : PRODUCTION_TABLES.has(state.table as ProductionTable) && projectIds.length > 1
            ? 'cloned_per_project'
            : 'single_project',
        targetRefs: targetRefsForState(state),
        exportRef: null,
        blockerCode: null,
      };
    })
    .sort((left, right) => compareText(left.sourceKey, right.sourceKey));
  const normalizedClaims = [...claims.values()].sort(
    (left, right) =>
      compareText(left.sourceKey, right.sourceKey) ||
      compareText(left.projectId, right.projectId) ||
      compareText(left.kind, right.kind) ||
      compareText(hashCanonical(left.evidenceRefs), hashCanonical(right.evidenceRefs)),
  );
  const blockers = [...blockerMap.values()].sort(
    (left, right) =>
      compareText(left.sourceKey, right.sourceKey) ||
      compareText(left.blockerCode, right.blockerCode) ||
      compareText(left.evidenceSourceKey, right.evidenceSourceKey) ||
      compareText(left.evidencePath, right.evidencePath),
  );
  const blockedSourceKeys = new Set(
    states.filter(({ blockerCodes }) => blockerCodes.size > 0).map(({ sourceKey }) => sourceKey),
  );
  const validCanvasProjects = canvasProjects
    .filter(({ canvasSourceKey }) => !blockedSourceKeys.has(canvasSourceKey))
    .sort((left, right) => compareText(left.canvasSourceKey, right.canvasSourceKey));
  const withoutFingerprint = {
    schema: 'lucid-fin.legacy-project-ownership-graph/v1' as const,
    sourceFingerprint,
    canvasProjects: validCanvasProjects,
    claims: normalizedClaims,
    assignments,
    blockers,
  };
  return {
    ...withoutFingerprint,
    fingerprint: hashCanonical(withoutFingerprint),
    ok: blockers.length === 0,
  };
}
