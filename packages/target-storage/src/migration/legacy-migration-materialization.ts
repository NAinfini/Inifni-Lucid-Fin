import {
  CanvasDocumentSchema,
  ChatSchema,
  GlobalMediaAssetSchema,
  GlobalMediaFolderSchema,
  ImportedHistoryWriteBundleSchema,
  ImportedRunAttachmentRoleSchema,
  MediaBlobSchema,
  ProductionCollectionSchema,
  ProductionObjectSchema,
  ProjectMediaRefSchema,
  ProjectSchema,
  ProjectSettingsSchema,
  canonicalJson,
  importedRunEventHashInput,
  parseCanonical,
  type Chat,
  type CanvasDocument,
  type GlobalMediaAsset,
  type GlobalMediaFolder,
  type ImportedHistoryRecord,
  type ImportedHistoryWriteBundle,
  type ImportedRunAttachmentHistory,
  type ImportedRunEventHistory,
  type ImportedRunHistory,
  type ImportedRunScopeHistory,
  type ImportedTaskItemHistory,
  type ImportedTaskListHistory,
  type JsonValue,
  type MediaBlob,
  type MessageAttachment,
  type MessageBlock,
  type ProductionCollection,
  type ProductionCollectionMember,
  type ProductionObject,
  type Project,
  type ProjectMediaRef,
  type ProjectSettings,
  type SkillDocument,
} from '@lucid-fin/target-contracts';
import { createHash } from 'node:crypto';
import { hashCanonical, hashContentObject } from '../internal/hashes.js';
import {
  legacyClassificationSourceKey,
  type LegacyClassificationTargetRef,
} from './classification-report.js';
import {
  scanLegacyRowsForClassification,
  type LegacyClassificationRow,
} from './classification-subjects.js';
import { I0_LEGACY_SOURCE_SCHEMAS } from './legacy-source-schema.js';
import {
  LEGACY_IMPORTED_HISTORY_SCHEMA_IDS,
  legacyCanvasEvidenceTarget,
  legacyImportedRecordSchemaId,
  legacyProductionCollectionSourceId,
} from './legacy-migration-policy.js';
import { assertLegacyMigrationPlan, type LegacyMigrationPlan } from './legacy-migration-plan.js';
import type { LegacyMediaTechnicalInspection } from './media-technical-inspector.js';
import { legacyCanvasNodeMediaHashes } from './canvas-node-media-preflight.js';
import { legacyCanvasNodeAnnotationSource } from './canvas-node-annotation-policy.js';
import { legacyEntityReferenceImageHashes } from './entity-reference-images-preflight.js';
import {
  legacyTargetInteger as integer,
  legacyTargetIso as iso,
  legacyTargetMessageText as messageText,
  legacyTargetOptionalInteger as optionalInteger,
  legacyTargetOptionalIso as optionalIso,
  legacyTargetOptionalText as optionalText,
  legacyTargetText as text,
} from './legacy-target-values.js';
import {
  validateLegacySkillMigrationPlan,
  type LegacySkillMigrationPlan,
} from './legacy-skill-migration.js';
import type { LegacyPhaseOneClassificationReport } from './phase-one-classification.js';
import {
  LEGACY_IMPORTED_CHAT_PROJECT_POLICY_V1,
  type LegacyProjectOwnershipAssignment,
} from './project-ownership-graph.js';
import type { LegacySourceDatabases } from './source-preflight.js';
import {
  buildLegacyProductionTypedContent,
  type LegacyProductionTable,
} from './legacy-production-content.js';

const ZERO_HASH = '0'.repeat(64);
const EPOCH = '1970-01-01T00:00:00.000Z';
const SAFE_STRUCTURAL_KEYS = new Set([
  'actor',
  'artifact_type',
  'attempt',
  'completed_at',
  'created_at',
  'decided_at',
  'document_type',
  'emitted_at',
  'entity_type',
  'event_timestamp',
  'file_count',
  'kind',
  'media_type',
  'mode',
  'ordinal',
  'phase_key',
  'phase_name',
  'phase_order',
  'progress',
  'purpose',
  'revision',
  'row_version',
  'schema_version',
  'seq',
  'status',
  'step',
  'subject_revision',
  'submitted_at',
  'task_kind',
  'task_list_type',
  'terminal_at',
  'trigger_source',
  'type',
  'updated_at',
  'verdict',
  'work_type',
]);

type JsonObject = { [key: string]: JsonValue };

export interface LegacyImportedMessageSeed {
  readonly projectId: string;
  readonly chatId: string;
  readonly messageId: string;
  readonly sequence: number;
  readonly role: 'user' | 'assistant';
  readonly status: 'accepted' | 'completed' | 'interrupted';
  readonly originatingImportedRunId: string | null;
  readonly blocks: readonly MessageBlock[];
  readonly attachments: readonly MessageAttachment[];
  readonly createdAt: string;
}

export interface LegacyMigrationMaterialization {
  readonly schema: 'lucid-fin.legacy-migration-materialization/v1';
  readonly planFingerprint: string;
  readonly projects: readonly Project[];
  readonly projectSettings: readonly ProjectSettings[];
  readonly mediaBlobs: readonly MediaBlob[];
  readonly globalMediaFolders: readonly GlobalMediaFolder[];
  readonly globalMediaAssets: readonly GlobalMediaAsset[];
  readonly projectMediaRefs: readonly ProjectMediaRef[];
  readonly productionObjects: readonly ProductionObject[];
  readonly chats: readonly Chat[];
  readonly messages: readonly LegacyImportedMessageSeed[];
  readonly canvases: readonly CanvasDocument[];
  readonly skillDocuments: readonly SkillDocument[];
  readonly importedHistory: ImportedHistoryWriteBundle;
  readonly fingerprint: string;
}

export interface BuildLegacyMigrationMaterializationInput {
  readonly databases: LegacySourceDatabases;
  readonly phaseOne: LegacyPhaseOneClassificationReport;
  readonly plan: LegacyMigrationPlan;
  readonly skillPlan: LegacySkillMigrationPlan;
  readonly mediaInspections: Readonly<Record<string, LegacyMediaTechnicalInspection>>;
  readonly offlineEvidenceManifestHash: string | null;
  readonly reconciliationHash: string;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

interface ScannedRows {
  readonly grouped: ReadonlyMap<string, LegacyClassificationRow[]>;
  readonly fingerprint: string;
}

function rowsByTable(databases: LegacySourceDatabases): ScannedRows {
  const grouped = new Map<string, LegacyClassificationRow[]>();
  const inventory = scanLegacyRowsForClassification(databases, I0_LEGACY_SOURCE_SCHEMAS, (row) => {
    const key = `${row.database}\0${row.table}`;
    const rows = grouped.get(key);
    if (rows) rows.push(row);
    else grouped.set(key, [row]);
  });
  for (const rows of grouped.values()) {
    rows.sort((left, right) =>
      compareText(
        legacyClassificationSourceKey(left.subject),
        legacyClassificationSourceKey(right.subject),
      ),
    );
  }
  return Object.freeze({ grouped, fingerprint: inventory.fingerprint });
}

function sourceRows(
  grouped: ReadonlyMap<string, LegacyClassificationRow[]>,
  database: 'main' | 'prompts',
  table: string,
): readonly LegacyClassificationRow[] {
  return grouped.get(`${database}\0${table}`) ?? [];
}

function jsonValue(value: unknown): JsonValue {
  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'string' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    return value;
  }
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Uint8Array) {
    return {
      byteLength: value.byteLength,
      sha256: createHash('sha256').update(value).digest('hex'),
    };
  }
  if (Array.isArray(value)) return value.map(jsonValue);
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => compareText(left, right))
        .map(([key, item]) => [key, jsonValue(item)]),
    );
  }
  throw new TypeError(`Legacy migration cannot normalize ${typeof value}`);
}

function normalizedRow(row: LegacyClassificationRow): Record<string, JsonValue> {
  return jsonValue(row.values) as Record<string, JsonValue>;
}

function structuralPayload(row: LegacyClassificationRow): Record<string, JsonValue> {
  return Object.fromEntries(
    Object.entries(row.values)
      .filter(
        ([key, value]) =>
          value !== null &&
          (SAFE_STRUCTURAL_KEYS.has(key) ||
            key === 'id' ||
            key.endsWith('_id') ||
            key.endsWith('_hash')),
      )
      .sort(([left], [right]) => compareText(left, right))
      .map(([key, value]) => [key, jsonValue(value)]),
  );
}

function jsonDocument(value: unknown, label: string): JsonValue {
  if (typeof value !== 'string') throw new TypeError(`${label} must be JSON text`);
  try {
    return jsonValue(JSON.parse(value));
  } catch (cause) {
    throw new TypeError(`${label} must be valid JSON`, { cause });
  }
}

function optionalJsonDocument(value: unknown, label: string): JsonValue | null {
  return value === null || value === undefined ? null : jsonDocument(value, label);
}

function rowHash(row: LegacyClassificationRow): string {
  return hashCanonical(normalizedRow(row));
}

function evidenceFor(row: LegacyClassificationRow) {
  const payloadHash = rowHash(row);
  return {
    state: 'unavailable' as const,
    payloadHash,
    offlineEvidenceId: `evidence.${hashCanonical({
      schema: 'lucid-fin.legacy-private-evidence-id/v1',
      sourceKey: legacyClassificationSourceKey(row.subject),
      payloadHash,
    })}`,
  };
}

function contentAddressedId(prefix: string, value: unknown): string {
  return `${prefix}.${hashCanonical(value)}`;
}

function targetFor(
  phaseOne: LegacyPhaseOneClassificationReport,
  row: LegacyClassificationRow,
  authority: string,
): LegacyClassificationTargetRef | null {
  const sourceKey = legacyClassificationSourceKey(row.subject);
  const entry = phaseOne.rootRows.classification.entries.find(
    (candidate) => candidate.sourceKey === sourceKey,
  );
  return entry?.targetRefs.find((ref) => ref.authority === authority) ?? null;
}

function assignmentFor(
  phaseOne: LegacyPhaseOneClassificationReport,
  row: LegacyClassificationRow,
): LegacyProjectOwnershipAssignment | null {
  const sourceKey = legacyClassificationSourceKey(row.subject);
  return (
    phaseOne.ownership.assignments.find((candidate) => candidate.sourceKey === sourceKey) ?? null
  );
}

function finalizeContentObject<SchemaValue extends { readonly contentHash: string }>(
  schema: { parse(value: unknown): SchemaValue },
  value: Omit<SchemaValue, 'contentHash'>,
): SchemaValue {
  const normalized = schema.parse({ ...value, contentHash: ZERO_HASH });
  return schema.parse({ ...normalized, contentHash: hashContentObject(normalized) });
}

function batchCreatedAt(rows: ReadonlyMap<string, LegacyClassificationRow[]>): string {
  let maximum = 0;
  for (const tableRows of rows.values()) {
    for (const row of tableRows) {
      for (const [column, value] of Object.entries(row.values)) {
        if (
          !column.endsWith('_at') &&
          column !== 'timestamp' &&
          column !== 'event_timestamp' &&
          column !== 'emitted_at'
        ) {
          continue;
        }
        try {
          maximum = Math.max(maximum, integer(value, `${row.table}.${column}`));
        } catch {
          // Null and non-integer optional timestamps do not define batch evidence time.
        }
      }
    }
  }
  return maximum === 0 ? EPOCH : new Date(maximum).toISOString();
}

function projectFormatPolicy(row: LegacyClassificationRow): ProjectSettings['formatPolicy'] {
  const aspectRatio = optionalText(row.values.aspect_ratio);
  if (
    aspectRatio !== '16:9' &&
    aspectRatio !== '9:16' &&
    aspectRatio !== '1:1' &&
    aspectRatio !== '4:3' &&
    aspectRatio !== 'custom'
  ) {
    throw new TypeError(`Legacy Canvas ${String(row.values.id)} has an unsupported aspect ratio`);
  }
  const customDimensions =
    aspectRatio === 'custom'
      ? {
          width: integer(row.values.default_width, 'canvases.default_width'),
          height: integer(row.values.default_height, 'canvases.default_height'),
        }
      : null;
  return { aspectRatio, customDimensions, frameRate: 24 };
}

function buildProjects(
  rows: ReadonlyMap<string, LegacyClassificationRow[]>,
  phaseOne: LegacyPhaseOneClassificationReport,
  batchId: string,
): {
  readonly projects: readonly Project[];
  readonly settings: readonly ProjectSettings[];
  readonly canvasRowsByProject: ReadonlyMap<string, LegacyClassificationRow>;
} {
  const canvasRowsByProject = new Map<string, LegacyClassificationRow>();
  const sessionRowsByProject = new Map<string, LegacyClassificationRow>();
  for (const row of sourceRows(rows, 'main', 'canvases')) {
    const target = targetFor(phaseOne, row, 'project');
    if (target !== null && target.projectId !== null) canvasRowsByProject.set(target.id, row);
  }
  for (const row of sourceRows(rows, 'main', 'commander_sessions')) {
    const assignment = assignmentFor(phaseOne, row);
    const target = assignment?.targetRefs.find(({ authority }) => authority === 'project');
    if (target?.projectId !== null && target?.projectId !== undefined) {
      sessionRowsByProject.set(target.projectId, row);
    }
  }
  const projectIds = new Set([
    ...canvasRowsByProject.keys(),
    ...phaseOne.ownership.assignments.flatMap(({ targetRefs }) =>
      targetRefs.flatMap(({ projectId }) => (projectId === null ? [] : [projectId])),
    ),
  ]);
  const projects: Project[] = [];
  const settings: ProjectSettings[] = [];
  for (const projectId of [...projectIds].sort(compareText)) {
    const canvasRow = canvasRowsByProject.get(projectId);
    const sessionRow = sessionRowsByProject.get(projectId);
    if (canvasRow === undefined && sessionRow === undefined) {
      throw new Error(`Target Project ${projectId} has no Legacy root owner`);
    }
    const createdAt = canvasRow
      ? iso(canvasRow.values.created_at, 'canvases.created_at')
      : iso(sessionRow!.values.created_at, 'commander_sessions.created_at');
    const updatedAt = canvasRow
      ? iso(canvasRow.values.updated_at, 'canvases.updated_at')
      : iso(sessionRow!.values.updated_at, 'commander_sessions.updated_at');
    const archivedAt = canvasRow
      ? optionalIso(canvasRow.values.archived_at, 'canvases.archived_at')
      : null;
    const project = finalizeContentObject(ProjectSchema, {
      authority: 'project',
      id: projectId,
      name: canvasRow
        ? text(canvasRow.values.name, 'canvases.name')
        : (optionalText(sessionRow!.values.title) ??
          LEGACY_IMPORTED_CHAT_PROJECT_POLICY_V1.project.fallbackName),
      lifecycle: canvasRow
        ? archivedAt === null
          ? 'active'
          : 'archived'
        : LEGACY_IMPORTED_CHAT_PROJECT_POLICY_V1.project.lifecycle,
      schemaRevision: LEGACY_IMPORTED_CHAT_PROJECT_POLICY_V1.project.schemaRevision,
      revision: LEGACY_IMPORTED_CHAT_PROJECT_POLICY_V1.project.revision,
      createdBy: { kind: 'import', importId: batchId },
      createdAt,
      updatedAt,
      archivedAt,
      deletedAt: null,
    });
    const projectSettings = finalizeContentObject(ProjectSettingsSchema, {
      authority: 'project_settings',
      projectId,
      ...LEGACY_IMPORTED_CHAT_PROJECT_POLICY_V1.projectSettings,
      formatPolicy: canvasRow
        ? projectFormatPolicy(canvasRow)
        : LEGACY_IMPORTED_CHAT_PROJECT_POLICY_V1.projectSettings.formatPolicy,
      enabledSkills: [...LEGACY_IMPORTED_CHAT_PROJECT_POLICY_V1.projectSettings.enabledSkills],
      updatedAt,
    });
    projects.push(project);
    settings.push(projectSettings);
  }
  return { projects, settings, canvasRowsByProject };
}

function mediaKind(value: unknown): MediaBlob['technicalFacts']['kind'] {
  if (value === 'image' || value === 'video' || value === 'audio') return value;
  throw new TypeError(`Unsupported Legacy media type: ${String(value)}`);
}

function buildMedia(
  rows: ReadonlyMap<string, LegacyClassificationRow[]>,
  batchId: string,
  inspections: Readonly<Record<string, LegacyMediaTechnicalInspection>>,
): {
  readonly blobs: readonly MediaBlob[];
  readonly folders: readonly GlobalMediaFolder[];
  readonly assets: readonly GlobalMediaAsset[];
  readonly assetByBlobHash: ReadonlyMap<string, GlobalMediaAsset>;
} {
  const blobs: MediaBlob[] = [];
  const contentByHash = new Map<string, LegacyClassificationRow>();
  for (const row of sourceRows(rows, 'main', 'asset_contents')) {
    const hash = text(row.values.hash, 'asset_contents.hash');
    const inspection = inspections[hash];
    if (inspection === undefined) throw new Error(`Media inspection is missing for ${hash}`);
    const kind = mediaKind(row.values.type);
    if (inspection.type !== kind) throw new Error(`Media inspection kind differs for ${hash}`);
    const blob = parseCanonical(MediaBlobSchema, {
      authority: 'media_blob',
      hash,
      byteLength: inspection.byteLength,
      mimeType: inspection.mimeType,
      technicalFacts: inspection.technicalFacts,
      createdAt: iso(row.values.created_at, `asset_contents.${hash}.created_at`),
    });
    blobs.push(blob);
    contentByHash.set(hash, row);
  }

  const folderRows = new Map(
    sourceRows(rows, 'main', 'asset_folders').map((row) => [
      text(row.values.id, 'asset_folders.id'),
      row,
    ]),
  );
  const folders: GlobalMediaFolder[] = [];
  const pending = new Set(folderRows.keys());
  while (pending.size > 0) {
    let progressed = false;
    for (const id of [...pending].sort(compareText)) {
      const row = folderRows.get(id)!;
      const parentId = optionalText(row.values.parent_id);
      if (parentId !== null && pending.has(parentId)) continue;
      if (parentId !== null && !folderRows.has(parentId)) {
        throw new Error(`Global Media Folder ${id} has no source parent ${parentId}`);
      }
      folders.push(
        finalizeContentObject(GlobalMediaFolderSchema, {
          authority: 'global_media_folder',
          id,
          revision: 0,
          parentId,
          name: text(row.values.name, `asset_folders.${id}.name`),
          sortOrder: integer(row.values.sort_order, `asset_folders.${id}.sort_order`),
          createdAt: iso(row.values.created_at, `asset_folders.${id}.created_at`),
          updatedAt: iso(row.values.updated_at, `asset_folders.${id}.updated_at`),
        }),
      );
      pending.delete(id);
      progressed = true;
    }
    if (!progressed) throw new Error('Legacy Global Media Folder hierarchy cycles');
  }

  const assets: GlobalMediaAsset[] = [];
  const assetsByHash = new Map<string, GlobalMediaAsset[]>();
  for (const row of sourceRows(rows, 'main', 'asset_entries')) {
    const id = text(row.values.id, 'asset_entries.id');
    const blobHash = text(row.values.asset_hash, `asset_entries.${id}.asset_hash`);
    const content = contentByHash.get(blobHash);
    if (content === undefined) throw new Error(`Global Media Asset ${id} has no Media Blob`);
    const format = text(content.values.format, `asset_contents.${blobHash}.format`);
    const tagsValue = optionalJsonDocument(row.values.tags, `asset_entries.${id}.tags`) ?? [];
    if (!Array.isArray(tagsValue) || tagsValue.some((tag) => typeof tag !== 'string')) {
      throw new TypeError(`asset_entries.${id}.tags must be a text array`);
    }
    const tags = tagsValue.map((tag) => String(tag));
    const asset = finalizeContentObject(GlobalMediaAssetSchema, {
      authority: 'global_media_asset',
      id,
      revision: 0,
      blobHash,
      kind: mediaKind(content.values.type),
      filename: `${blobHash}.${format}`,
      displayName: text(row.values.display_name, `asset_entries.${id}.display_name`),
      source: {
        kind: 'imported',
        originalFileName: `${blobHash}.${format}`,
        importId: batchId,
      },
      folderId: optionalText(row.values.folder_id),
      tags,
      createdAt: iso(row.values.created_at, `asset_entries.${id}.created_at`),
      updatedAt: iso(row.values.created_at, `asset_entries.${id}.created_at`),
    });
    assets.push(asset);
    const group = assetsByHash.get(blobHash) ?? [];
    group.push(asset);
    assetsByHash.set(blobHash, group);
  }
  for (const [hash, content] of [...contentByHash].sort(([left], [right]) =>
    compareText(left, right),
  )) {
    if ((assetsByHash.get(hash)?.length ?? 0) > 0) continue;
    const format = text(content.values.format, `asset_contents.${hash}.format`);
    const asset = finalizeContentObject(GlobalMediaAssetSchema, {
      authority: 'global_media_asset',
      id: `global.asset.import.${hash}`,
      revision: 0,
      blobHash: hash,
      kind: mediaKind(content.values.type),
      filename: `${hash}.${format}`,
      displayName: `Imported ${mediaKind(content.values.type)} ${hash.slice(0, 12)}`,
      source: { kind: 'imported', originalFileName: `${hash}.${format}`, importId: batchId },
      folderId: null,
      tags: [],
      createdAt: iso(content.values.created_at, `asset_contents.${hash}.created_at`),
      updatedAt: iso(content.values.created_at, `asset_contents.${hash}.created_at`),
    });
    assets.push(asset);
    assetsByHash.set(hash, [asset]);
  }
  assets.sort((left, right) => compareText(left.id, right.id));
  blobs.sort((left, right) => compareText(left.hash, right.hash));
  return {
    blobs,
    folders,
    assets,
    assetByBlobHash: new Map(
      [...assetsByHash].map(([hash, candidates]) => [
        hash,
        [...candidates].sort((left, right) => compareText(left.id, right.id))[0]!,
      ]),
    ),
  };
}

function finalizeProduction(value: Omit<ProductionObject, 'contentHash'>): ProductionObject {
  const normalized = parseCanonical(ProductionObjectSchema, { ...value, contentHash: ZERO_HASH });
  return parseCanonical(ProductionObjectSchema, {
    ...normalized,
    contentHash: hashContentObject(normalized),
  });
}

function buildProduction(
  rows: ReadonlyMap<string, LegacyClassificationRow[]>,
  phaseOne: LegacyPhaseOneClassificationReport,
  batchId: string,
): {
  readonly objects: ProductionObject[];
  readonly byLegacyProject: Map<string, ProductionObject>;
} {
  const objects: ProductionObject[] = [];
  const byLegacyProject = new Map<string, ProductionObject>();
  for (const table of ['characters', 'equipment', 'locations', 'scripts'] as const) {
    for (const row of sourceRows(rows, 'main', table)) {
      const assignment = assignmentFor(phaseOne, row);
      if (assignment === null || assignment.disposition === 'offline_legacy_export') continue;
      const sourceId = text(row.values.id, `${table}.id`);
      const typed = buildLegacyProductionTypedContent(row, table as LegacyProductionTable);
      for (const target of assignment.targetRefs.filter(
        ({ authority }) => authority === 'production',
      )) {
        if (target.projectId === null) throw new Error(`Production ${sourceId} has no Project`);
        const createdAt = iso(row.values.created_at, `${table}.${sourceId}.created_at`);
        const updatedAt = iso(row.values.updated_at, `${table}.${sourceId}.updated_at`);
        const object = finalizeProduction({
          authority: 'production',
          id: target.id,
          projectId: target.projectId,
          revision: 0,
          lifecycle: row.values.deleted_at === null ? 'active' : 'deleted',
          type: typed.type,
          content: typed.content,
          relations: [],
          protections: [],
          createdBy: { kind: 'import', importId: batchId },
          updatedBy: { kind: 'import', importId: batchId },
          createdAt,
          updatedAt,
        } as Omit<ProductionObject, 'contentHash'>);
        objects.push(object);
        byLegacyProject.set(`${table}\0${sourceId}\0${target.projectId}`, object);
      }
    }
  }
  objects.sort((left, right) => compareText(left.id, right.id));
  return { objects, byLegacyProject };
}

interface ProjectMediaUsage {
  readonly projectId: string;
  readonly blobHash: string;
  readonly roles: Set<ProjectMediaRef['roles'][number]>;
  readonly productionLinks: Map<string, ProjectMediaRef['productionLinks'][number]>;
}

function canvasNodeProductionObjects(
  row: LegacyClassificationRow,
  phaseOne: LegacyPhaseOneClassificationReport,
  projectId: string,
  productionById: ReadonlyMap<string, ProductionObject>,
): readonly ProductionObject[] {
  const nodeSourceKey = legacyClassificationSourceKey(row.subject);
  const assignments = new Map(
    phaseOne.ownership.assignments.map((assignment) => [assignment.sourceKey, assignment] as const),
  );
  const objectIds = new Set<string>();
  for (const claim of phaseOne.ownership.claims) {
    if (
      claim.kind !== 'node_entity_ref' &&
      claim.kind !== 'node_generation_history_entity_ref' &&
      claim.kind !== 'character_loadout_equipment'
    ) {
      continue;
    }
    if (!claim.evidenceRefs.some(({ sourceKey }) => sourceKey === nodeSourceKey)) continue;
    for (const target of assignments.get(claim.sourceKey)?.targetRefs ?? []) {
      if (target.authority === 'production' && target.projectId === projectId) {
        objectIds.add(target.id);
      }
    }
  }
  return [...objectIds].sort(compareText).map((id) => {
    const object = productionById.get(id);
    if (!object) throw new Error(`Canvas entity reference ${id} was not materialized`);
    return object;
  });
}

function buildProjectMediaRefs(
  rows: ReadonlyMap<string, LegacyClassificationRow[]>,
  phaseOne: LegacyPhaseOneClassificationReport,
  batchId: string,
  projects: readonly Project[],
  assetByBlobHash: ReadonlyMap<string, GlobalMediaAsset>,
  productionByLegacyProject: ReadonlyMap<string, ProductionObject>,
): {
  readonly refs: readonly ProjectMediaRef[];
  readonly byProjectBlob: ReadonlyMap<string, ProjectMediaRef>;
} {
  const usages = new Map<string, ProjectMediaUsage>();
  const productionById = new Map(
    [...productionByLegacyProject.values()].map((object) => [object.id, object] as const),
  );
  const recordUsage = (
    projectId: string,
    blobHash: string,
    role: ProjectMediaRef['roles'][number],
    productionObject?: ProductionObject,
  ): void => {
    if (!assetByBlobHash.has(blobHash)) throw new Error(`Project media ${blobHash} has no asset`);
    const key = `${projectId}\0${blobHash}`;
    const usage = usages.get(key) ?? {
      projectId,
      blobHash,
      roles: new Set<ProjectMediaRef['roles'][number]>(),
      productionLinks: new Map<string, ProjectMediaRef['productionLinks'][number]>(),
    };
    usage.roles.add(role);
    if (productionObject) {
      usage.productionLinks.set(productionObject.id, {
        productionObjectId: productionObject.id,
        relation: 'references',
      });
    }
    usages.set(key, usage);
  };

  for (const row of sourceRows(rows, 'main', 'commander_run_attachments')) {
    const projectId = assignmentFor(phaseOne, row)?.projectIds[0];
    if (projectId)
      recordUsage(projectId, text(row.values.content_hash, 'run attachment hash'), 'reference');
  }
  for (const row of sourceRows(rows, 'main', 'canvas_nodes')) {
    const projectId = assignmentFor(phaseOne, row)?.projectIds[0];
    if (!projectId) continue;
    const data = jsonDocument(row.values.data_json, 'canvas_nodes.data_json');
    const hashes = legacyCanvasNodeMediaHashes(row.values.type, data);
    const productionObjects = canvasNodeProductionObjects(row, phaseOne, projectId, productionById);
    for (const hash of hashes) {
      if (productionObjects.length === 0) recordUsage(projectId, hash, 'reference');
      else {
        for (const productionObject of productionObjects) {
          recordUsage(projectId, hash, 'reference', productionObject);
        }
      }
    }
  }
  for (const row of sourceRows(rows, 'main', 'delivery_asset_refs')) {
    const projectId = assignmentFor(phaseOne, row)?.projectIds[0];
    if (projectId)
      recordUsage(
        projectId,
        text(row.values.asset_hash, 'delivery_asset_refs.asset_hash'),
        'delivery_source',
      );
  }
  for (const table of ['characters', 'locations', 'equipment'] as const) {
    const role =
      table === 'characters' ? 'character' : table === 'locations' ? 'location' : 'equipment';
    for (const row of sourceRows(rows, 'main', table)) {
      const assignment = assignmentFor(phaseOne, row);
      if (!assignment) continue;
      const sourceId = text(row.values.id, `${table}.id`);
      const hashes = new Set(
        legacyEntityReferenceImageHashes(
          optionalJsonDocument(
            row.values.reference_images,
            `${table}.${sourceId}.reference_images`,
          ),
        ),
      );
      if (table === 'characters') {
        const direct = optionalText(row.values.ref_image);
        if (direct && /^[a-f0-9]{64}$/.test(direct)) hashes.add(direct);
      }
      for (const projectId of assignment.projectIds) {
        const object = productionByLegacyProject.get(`${table}\0${sourceId}\0${projectId}`);
        for (const hash of hashes) recordUsage(projectId, hash, role, object);
      }
    }
  }

  const projectsById = new Map(projects.map((project) => [project.id, project]));
  const refs: ProjectMediaRef[] = [];
  const byProjectBlob = new Map<string, ProjectMediaRef>();
  for (const usage of [...usages.values()].sort(
    (left, right) =>
      compareText(left.projectId, right.projectId) || compareText(left.blobHash, right.blobHash),
  )) {
    const project = projectsById.get(usage.projectId);
    if (!project) throw new Error(`Project media owner ${usage.projectId} was not materialized`);
    const asset = assetByBlobHash.get(usage.blobHash)!;
    const id = contentAddressedId('project.media.import', {
      schema: 'lucid-fin.legacy-project-media-ref-id/v1',
      projectId: usage.projectId,
      globalAssetId: asset.id,
    });
    const ref = finalizeContentObject(ProjectMediaRefSchema, {
      authority: 'project_media_ref',
      id,
      projectId: usage.projectId,
      globalAssetId: asset.id,
      revision: 0,
      lifecycle: 'active',
      detachedAt: null,
      label: asset.displayName,
      collections: [],
      roles: [...usage.roles].sort(compareText),
      notes: '',
      productionLinks: [...usage.productionLinks.values()].sort((left, right) =>
        compareText(left.productionObjectId, right.productionObjectId),
      ),
      createdBy: { kind: 'import', importId: batchId },
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    });
    refs.push(ref);
    byProjectBlob.set(`${usage.projectId}\0${usage.blobHash}`, ref);
  }
  return { refs, byProjectBlob };
}

function plainObject(value: JsonValue | null): JsonObject | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function nodeBinding(
  row: LegacyClassificationRow,
  phaseOne: LegacyPhaseOneClassificationReport,
  projectId: string,
  byProjectBlob: ReadonlyMap<string, ProjectMediaRef>,
  productionByLegacyProject: ReadonlyMap<string, ProductionObject>,
): CanvasDocument['placements'][number]['target'] | null {
  const data = plainObject(jsonDocument(row.values.data_json, 'canvas_nodes.data_json'));
  if (data === null) return null;
  const assetHash = typeof data.assetHash === 'string' ? data.assetHash : null;
  if (assetHash !== null) {
    const ref = byProjectBlob.get(`${projectId}\0${assetHash}`);
    if (ref !== undefined) {
      return {
        targetType: 'project_media_ref',
        targetId: ref.id,
        targetRevision: ref.revision,
        targetContentHash: ref.contentHash,
      };
    }
  }
  const productionById = new Map(
    [...productionByLegacyProject.values()].map((object) => [object.id, object] as const),
  );
  const production = canvasNodeProductionObjects(row, phaseOne, projectId, productionById)[0];
  if (production !== undefined) {
    return {
      targetType: 'production',
      targetId: production.id,
      targetRevision: production.revision,
      targetContentHash: production.contentHash,
    };
  }
  return null;
}

function importedNodeAnnotationText(row: LegacyClassificationRow): string {
  const data = plainObject(jsonDocument(row.values.data_json, 'canvas_nodes.data_json'));
  const source = data === null ? null : legacyCanvasNodeAnnotationSource(data);
  if (source !== null) return source.text;
  return `Imported Legacy ${text(row.values.type, 'canvas_nodes.type')} node ${text(
    row.values.id,
    'canvas_nodes.id',
  )}`;
}

function importedAnnotationId(
  projectId: string,
  kind: 'node' | 'edge' | 'note',
  sourceId: string,
): string {
  return `legacy-${kind}:${hashCanonical({ projectId, sourceId })}`;
}

function buildCanvases(
  rows: ReadonlyMap<string, LegacyClassificationRow[]>,
  phaseOne: LegacyPhaseOneClassificationReport,
  projects: readonly Project[],
  canvasRowsByProject: ReadonlyMap<string, LegacyClassificationRow>,
  byProjectBlob: ReadonlyMap<string, ProjectMediaRef>,
  productionByLegacyProject: ReadonlyMap<string, ProductionObject>,
): readonly CanvasDocument[] {
  const canvases: CanvasDocument[] = [];
  for (const project of projects) {
    const canvasRow = canvasRowsByProject.get(project.id);
    if (canvasRow === undefined) {
      canvases.push(
        finalizeContentObject(CanvasDocumentSchema, {
          authority: 'canvas',
          id: project.id,
          projectId: project.id,
          ...LEGACY_IMPORTED_CHAT_PROJECT_POLICY_V1.emptyCanvas,
          placements: [...LEGACY_IMPORTED_CHAT_PROJECT_POLICY_V1.emptyCanvas.placements],
          groups: [...LEGACY_IMPORTED_CHAT_PROJECT_POLICY_V1.emptyCanvas.groups],
          edges: [...LEGACY_IMPORTED_CHAT_PROJECT_POLICY_V1.emptyCanvas.edges],
          annotations: [...LEGACY_IMPORTED_CHAT_PROJECT_POLICY_V1.emptyCanvas.annotations],
          viewport: {
            center: { ...LEGACY_IMPORTED_CHAT_PROJECT_POLICY_V1.emptyCanvas.viewport.center },
            zoom: LEGACY_IMPORTED_CHAT_PROJECT_POLICY_V1.emptyCanvas.viewport.zoom,
          },
          savedViews: [...LEGACY_IMPORTED_CHAT_PROJECT_POLICY_V1.emptyCanvas.savedViews],
          createdAt: project.createdAt,
          updatedAt: project.updatedAt,
        }),
      );
      continue;
    }

    const nodeRows = sourceRows(rows, 'main', 'canvas_nodes').filter(
      (row) => row.values.canvas_id === canvasRow.values.id,
    );
    const placements: CanvasDocument['placements'][number][] = [];
    const annotations: CanvasDocument['annotations'][number][] = [];
    for (const row of nodeRows) {
      const id = text(row.values.id, 'canvas_nodes.id');
      const position = {
        x: Number(row.values.position_x),
        y: Number(row.values.position_y),
      };
      const size = { width: Number(row.values.width), height: Number(row.values.height) };
      const createdAt = iso(row.values.created_at, `canvas_nodes.${id}.created_at`);
      const updatedAt = iso(row.values.updated_at, `canvas_nodes.${id}.updated_at`);
      const target = nodeBinding(
        row,
        phaseOne,
        project.id,
        byProjectBlob,
        productionByLegacyProject,
      );
      if (target === null) {
        annotations.push({
          id: importedAnnotationId(project.id, 'node', id),
          placementId: null,
          text: importedNodeAnnotationText(row),
          geometry: { position, size },
          revision: 0,
          createdAt,
          updatedAt,
        });
      } else {
        placements.push({
          id,
          target,
          position,
          size,
          zIndex: integer(row.values.z_index, `canvas_nodes.${id}.z_index`),
          revision: 0,
          createdAt,
          updatedAt,
        });
      }
    }
    const placementIds = new Set(placements.map(({ id }) => id));
    const edges: CanvasDocument['edges'][number][] = [];
    for (const row of sourceRows(rows, 'main', 'canvas_edges').filter(
      (candidate) => candidate.values.canvas_id === canvasRow.values.id,
    )) {
      const id = text(row.values.id, 'canvas_edges.id');
      const sourcePlacementId = text(row.values.source, `canvas_edges.${id}.source`);
      const targetPlacementId = text(row.values.target, `canvas_edges.${id}.target`);
      const createdAt = iso(row.values.created_at, `canvas_edges.${id}.created_at`);
      const updatedAt = iso(row.values.updated_at, `canvas_edges.${id}.updated_at`);
      if (placementIds.has(sourcePlacementId) && placementIds.has(targetPlacementId)) {
        edges.push({
          id,
          sourcePlacementId,
          targetPlacementId,
          label: optionalText(row.values.label) ?? '',
          revision: 0,
          createdAt,
          updatedAt,
        });
      } else {
        annotations.push({
          id: importedAnnotationId(project.id, 'edge', id),
          placementId: null,
          text: `Imported Legacy edge ${sourcePlacementId} → ${targetPlacementId}${
            optionalText(row.values.label) ? `: ${optionalText(row.values.label)}` : ''
          }`,
          geometry: null,
          revision: 0,
          createdAt,
          updatedAt,
        });
      }
    }
    const notes = optionalJsonDocument(canvasRow.values.notes, 'canvases.notes') ?? [];
    if (!Array.isArray(notes)) throw new TypeError('canvases.notes must be an array');
    for (const candidate of notes) {
      const note = plainObject(candidate);
      if (note === null) throw new TypeError('canvases.notes must contain objects');
      const sourceId = text(note.id, 'canvases.notes.id');
      annotations.push({
        id: importedAnnotationId(project.id, 'note', sourceId),
        placementId: null,
        text: text(note.content, 'canvases.notes.content'),
        geometry: null,
        revision: 0,
        createdAt: iso(note.createdAt, 'canvases.notes.createdAt'),
        updatedAt: iso(note.updatedAt, 'canvases.notes.updatedAt'),
      });
    }
    const nextZIndex = placements.reduce(
      (maximum, placement) => Math.max(maximum, placement.zIndex + 1),
      0,
    );
    canvases.push(
      finalizeContentObject(CanvasDocumentSchema, {
        authority: 'canvas',
        id: text(canvasRow.values.id, 'canvases.id'),
        projectId: project.id,
        revision: 0,
        placements: placements.sort((left, right) => compareText(left.id, right.id)),
        groups: [],
        edges: edges.sort((left, right) => compareText(left.id, right.id)),
        annotations: annotations.sort((left, right) => compareText(left.id, right.id)),
        viewport: { center: { x: 0, y: 0 }, zoom: 1 },
        savedViews: [],
        nextZIndex,
        createdAt: iso(canvasRow.values.created_at, 'canvases.created_at'),
        updatedAt: iso(canvasRow.values.updated_at, 'canvases.updated_at'),
      }),
    );
  }
  return canvases.sort((left, right) => compareText(left.id, right.id));
}

function buildChatsAndMessages(
  rows: ReadonlyMap<string, LegacyClassificationRow[]>,
  phaseOne: LegacyPhaseOneClassificationReport,
): { readonly chats: readonly Chat[]; readonly messages: readonly LegacyImportedMessageSeed[] } {
  const origins = new Map(
    (phaseOne.embeddedJson.conversationPreflight?.assistantOrigins ?? []).map((origin) => [
      `${origin.sessionId}\0${origin.messageId}`,
      origin,
    ]),
  );
  const chats: Chat[] = [];
  const messages: LegacyImportedMessageSeed[] = [];
  for (const row of sourceRows(rows, 'main', 'commander_sessions')) {
    const assignment = assignmentFor(phaseOne, row);
    const target = assignment?.targetRefs.find(({ authority }) => authority === 'chat');
    if (target?.projectId === null || target?.projectId === undefined) continue;
    const sessionId = text(row.values.id, 'commander_sessions.id');
    const createdAt = iso(row.values.created_at, `commander_sessions.${sessionId}.created_at`);
    chats.push(
      finalizeContentObject(ChatSchema, {
        authority: 'chat',
        id: target.id,
        projectId: target.projectId,
        revision: 0,
        title: text(row.values.title, `commander_sessions.${sessionId}.title`),
        lifecycle: 'active',
        messageCount: 0,
        messageHeadSequence: null,
        createdAt,
        updatedAt: createdAt,
        archivedAt: null,
        deletedAt: null,
      }),
    );
    const transcript = jsonDocument(
      row.values.messages,
      `commander_sessions.${sessionId}.messages`,
    );
    if (!Array.isArray(transcript))
      throw new TypeError('Commander session messages must be an array');
    for (const [index, candidate] of transcript.entries()) {
      const message = plainObject(candidate);
      if (message === null) throw new TypeError('Commander session message must be an object');
      const id = text(message.id, 'commander message id');
      const role = message.role;
      const content = messageText(message.content, `commander message ${id} content`);
      const messageCreatedAt = iso(message.timestamp, `commander message ${id} timestamp`);
      if (role === 'user') {
        messages.push({
          projectId: target.projectId,
          chatId: target.id,
          messageId: id,
          sequence: index + 1,
          role: 'user',
          status: 'accepted',
          originatingImportedRunId: null,
          blocks: [{ type: 'text', text: content }],
          attachments: [],
          createdAt: messageCreatedAt,
        });
      } else if (role === 'assistant') {
        const origin = origins.get(`${sessionId}\0${id}`);
        if (origin === undefined)
          throw new Error(`Assistant Message ${id} has no proven Run origin`);
        messages.push({
          projectId: target.projectId,
          chatId: target.id,
          messageId: id,
          sequence: index + 1,
          role: 'assistant',
          status: origin.status,
          originatingImportedRunId: origin.runId,
          blocks: [{ type: 'text', text: content }],
          attachments: [],
          createdAt: messageCreatedAt,
        });
      } else {
        throw new TypeError(`Commander Message ${id} has unsupported role`);
      }
    }
  }
  messages.sort(
    (left, right) =>
      compareText(left.chatId, right.chatId) ||
      left.sequence - right.sequence ||
      compareText(left.messageId, right.messageId),
  );
  return { chats: chats.sort((left, right) => compareText(left.id, right.id)), messages };
}

function privateEvidence(value: unknown, identity: unknown) {
  if (value === null || value === undefined) return { state: 'none' as const };
  const payloadHash = hashCanonical(jsonValue(value));
  return {
    state: 'unavailable' as const,
    payloadHash,
    offlineEvidenceId: contentAddressedId('evidence', {
      schema: 'lucid-fin.legacy-private-evidence-id/v1',
      identity,
      payloadHash,
    }),
  };
}

function importedRunStatus(value: unknown): ImportedRunHistory['status'] {
  if (
    value === 'completed' ||
    value === 'failed' ||
    value === 'blocked' ||
    value === 'cancelled' ||
    value === 'max_steps'
  ) {
    return value;
  }
  throw new TypeError(`Unsupported terminal Legacy Run status: ${String(value)}`);
}

function importedRunWorkType(value: unknown): ImportedRunHistory['workType'] {
  if (value === 'agent' || value === 'subagent' || value === 'tool_program') return value;
  throw new TypeError(`Unsupported Legacy Run work type: ${String(value)}`);
}

function buildImportedRuns(
  rows: ReadonlyMap<string, LegacyClassificationRow[]>,
  phaseOne: LegacyPhaseOneClassificationReport,
  batchId: string,
  assetByBlobHash: ReadonlyMap<string, GlobalMediaAsset>,
  projectMediaByBlob: ReadonlyMap<string, ProjectMediaRef>,
): Pick<ImportedHistoryWriteBundle, 'runs' | 'runEvents' | 'runScopes' | 'runAttachments'> {
  const runRows = new Map(
    sourceRows(rows, 'main', 'commander_runs').map((row) => [
      text(row.values.id, 'commander_runs.id'),
      row,
    ]),
  );
  const rootId = (runId: string): string => {
    let cursor = runRows.get(runId);
    if (cursor === undefined) throw new Error(`Legacy Run ${runId} disappeared`);
    const seen = new Set<string>();
    while (cursor.values.parent_run_id !== null) {
      if (seen.has(runId)) throw new Error(`Legacy Run ${runId} parent lineage cycles`);
      seen.add(runId);
      const parentId = text(cursor.values.parent_run_id, `commander_runs.${runId}.parent_run_id`);
      const parent = runRows.get(parentId);
      if (parent === undefined) throw new Error(`Legacy Run ${runId} parent is missing`);
      cursor = parent;
      runId = parentId;
    }
    return runId;
  };
  const runs: ImportedRunHistory[] = [];
  for (const [runId, row] of [...runRows].sort(([left], [right]) => compareText(left, right))) {
    const assignment = assignmentFor(phaseOne, row);
    const target = assignment?.targetRefs.find(
      ({ authority }) => authority === 'imported_run_history',
    );
    if (target?.projectId === null || target?.projectId === undefined) {
      throw new Error(`Legacy Run ${runId} has no imported history target`);
    }
    const sessionId = text(row.values.session_id, `commander_runs.${runId}.session_id`);
    const sessionRow = sourceRows(rows, 'main', 'commander_sessions').find(
      (candidate) => candidate.values.id === sessionId,
    );
    const chatTarget = sessionRow
      ? assignmentFor(phaseOne, sessionRow)?.targetRefs.find(
          ({ authority }) => authority === 'chat',
        )
      : undefined;
    const sourcePayload = structuralPayload(row);
    const imported: ImportedRunHistory = {
      authority: 'imported_run_history',
      historical: true,
      readOnly: true,
      id: target.id,
      batchId,
      legacyRunId: runId,
      projectId: target.projectId,
      chatId: chatTarget?.id ?? null,
      legacySessionId: sessionId,
      rootRunId: rootId(runId),
      parentRunId: optionalText(row.values.parent_run_id),
      retryOfRunId: optionalText(row.values.retry_of_run_id),
      workType: importedRunWorkType(row.values.work_type),
      displayName: optionalText(row.values.display_name),
      intent: text(row.values.intent, `commander_runs.${runId}.intent`),
      objective: optionalText(row.values.objective),
      status: importedRunStatus(row.values.status),
      acceptedAt: iso(row.values.accepted_at, `commander_runs.${runId}.accepted_at`),
      startedAt: optionalIso(row.values.started_at, `commander_runs.${runId}.started_at`),
      finishedAt: optionalIso(row.values.completed_at, `commander_runs.${runId}.completed_at`),
      lastSequence: optionalInteger(row.values.last_seq, `commander_runs.${runId}.last_seq`),
      sourcePayload,
      sourcePayloadHash: hashCanonical(sourcePayload),
      createdAt: iso(row.values.accepted_at, `commander_runs.${runId}.accepted_at`),
    };
    runs.push(imported);
  }

  const runEvents: ImportedRunEventHistory[] = [];
  for (const run of runs) {
    const eventRows = sourceRows(rows, 'main', 'commander_events')
      .filter((row) => row.values.run_id === run.legacyRunId)
      .sort(
        (left, right) =>
          integer(left.values.seq, 'commander_events.seq') -
          integer(right.values.seq, 'commander_events.seq'),
      );
    let previousEventHash: string | null = null;
    for (const row of eventRows) {
      const sequence = integer(row.values.seq, 'commander_events.seq');
      const target = targetFor(phaseOne, row, 'imported_run_event_history');
      if (target === null) throw new Error(`Legacy Run event ${run.id}:${sequence} has no target`);
      const publicPayload = jsonDocument(row.values.payload, 'commander_events.payload');
      const withoutEventHash: Omit<ImportedRunEventHistory, 'eventHash'> = {
        authority: 'imported_run_event_history',
        historical: true,
        readOnly: true,
        id: target.id,
        batchId,
        runId: run.id,
        sequence,
        kind: text(row.values.kind, 'commander_events.kind'),
        step: integer(row.values.step, 'commander_events.step'),
        occurredAt: iso(row.values.emitted_at, 'commander_events.emitted_at'),
        publicPayload,
        publicPayloadHash: hashCanonical(publicPayload),
        privateEvidence: privateEvidence(row.values.private_payload, {
          table: 'commander_events',
          runId: run.id,
          sequence,
        }),
        previousEventHash,
      };
      const event: ImportedRunEventHistory = {
        ...withoutEventHash,
        eventHash: hashCanonical(importedRunEventHashInput(withoutEventHash)),
      };
      runEvents.push(event);
      previousEventHash = event.eventHash;
    }
  }

  const runScopes: ImportedRunScopeHistory[] = sourceRows(
    rows,
    'main',
    'commander_run_canvases',
  ).map((row) => {
    const legacyRunId = text(row.values.run_id, 'commander_run_canvases.run_id');
    const run = runs.find((candidate) => candidate.legacyRunId === legacyRunId);
    if (run === undefined) throw new Error(`Legacy Run scope ${legacyRunId} has no Run`);
    if (targetFor(phaseOne, row, 'imported_run_scope_history') === null) {
      throw new Error(`Legacy Run scope ${legacyRunId} has no classified target`);
    }
    const payload = {
      canvasId: text(row.values.canvas_id, 'commander_run_canvases.canvas_id'),
      releasedAt: optionalIso(row.values.released_at, 'commander_run_canvases.released_at'),
    };
    return {
      authority: 'imported_run_scope_history' as const,
      historical: true as const,
      readOnly: true as const,
      batchId,
      runId: run.id,
      ordinal: integer(row.values.ordinal, 'commander_run_canvases.ordinal'),
      kind: 'canvas',
      payload,
      payloadHash: hashCanonical(payload),
      createdAt: payload.releasedAt ?? run.acceptedAt,
    };
  });

  const runAttachments: ImportedRunAttachmentHistory[] = sourceRows(
    rows,
    'main',
    'commander_run_attachments',
  ).map((row) => {
    const legacyRunId = text(row.values.run_id, 'commander_run_attachments.run_id');
    const run = runs.find((candidate) => candidate.legacyRunId === legacyRunId);
    if (run === undefined) throw new Error(`Legacy Run attachment ${legacyRunId} has no Run`);
    if (targetFor(phaseOne, row, 'imported_run_attachment_history') === null) {
      throw new Error(`Legacy Run attachment ${legacyRunId} has no classified target`);
    }
    const blobHash = text(row.values.content_hash, 'commander_run_attachments.content_hash');
    const asset = assetByBlobHash.get(blobHash);
    const ref = projectMediaByBlob.get(`${run.projectId}\0${blobHash}`);
    if (asset === undefined || ref === undefined) {
      throw new Error(`Legacy Run attachment ${blobHash} has no Project Media reference`);
    }
    const role = ImportedRunAttachmentRoleSchema.parse(
      text(row.values.role, 'commander_run_attachments.role'),
    );
    return {
      authority: 'imported_run_attachment_history' as const,
      historical: true as const,
      readOnly: true as const,
      batchId,
      runId: run.id,
      ordinal: integer(row.values.ordinal, 'commander_run_attachments.ordinal'),
      projectMediaRefId: ref.id,
      globalAssetId: asset.id,
      blobHash,
      role,
      sourcePayloadHash: rowHash(row),
      createdAt: run.acceptedAt,
    };
  });

  return {
    runs: runs.sort((left, right) => compareText(left.id, right.id)),
    runEvents: runEvents.sort(
      (left, right) => compareText(left.runId, right.runId) || left.sequence - right.sequence,
    ),
    runScopes: runScopes.sort(
      (left, right) => compareText(left.runId, right.runId) || left.ordinal - right.ordinal,
    ),
    runAttachments: runAttachments.sort(
      (left, right) => compareText(left.runId, right.runId) || left.ordinal - right.ordinal,
    ),
  };
}

function ownerChatId(row: LegacyClassificationRow): string | null {
  const metadata = optionalJsonDocument(row.values.metadata_json, `${row.table}.metadata_json`);
  const object = plainObject(metadata);
  return object === null ? null : optionalText(object.commanderSessionId);
}

function buildImportedTasks(
  rows: ReadonlyMap<string, LegacyClassificationRow[]>,
  phaseOne: LegacyPhaseOneClassificationReport,
  batchId: string,
  runs: readonly ImportedRunHistory[],
): Pick<ImportedHistoryWriteBundle, 'taskLists' | 'taskItems'> {
  const importedRuns = new Map(runs.map((run) => [run.legacyRunId, run]));
  const taskLists: ImportedTaskListHistory[] = [];
  const listRows = new Map<string, LegacyClassificationRow>();
  for (const row of sourceRows(rows, 'main', 'task_lists')) {
    const legacyId = text(row.values.id, 'task_lists.id');
    const target = targetFor(phaseOne, row, 'imported_task_list_history');
    if (target?.projectId === null || target?.projectId === undefined) {
      throw new Error(`Legacy Task List ${legacyId} has no imported target`);
    }
    const chatId = ownerChatId(row);
    const metadata = plainObject(
      optionalJsonDocument(row.values.metadata_json, 'task_lists.metadata_json'),
    );
    const legacyRunId = metadata === null ? null : optionalText(metadata.commanderRunId);
    const importedRun = legacyRunId === null ? undefined : importedRuns.get(legacyRunId);
    if (importedRun !== undefined && importedRun.projectId !== target.projectId) {
      throw new Error(`Legacy Task List ${legacyId} Run crosses Project`);
    }
    const sourcePayload = structuralPayload(row);
    taskLists.push({
      authority: 'imported_task_list_history',
      historical: true,
      readOnly: true,
      id: target.id,
      batchId,
      legacyTaskListId: legacyId,
      projectId: target.projectId,
      chatId,
      importedRunId: importedRun?.id ?? null,
      taskListType: text(row.values.task_list_type, `task_lists.${legacyId}.task_list_type`),
      triggerSource: text(row.values.trigger_source, `task_lists.${legacyId}.trigger_source`),
      status: text(row.values.status, `task_lists.${legacyId}.status`),
      summary: optionalText(row.values.summary) ?? '',
      sourcePayload,
      sourcePayloadHash: hashCanonical(sourcePayload),
      createdAt: iso(row.values.created_at, `task_lists.${legacyId}.created_at`),
      updatedAt: iso(row.values.updated_at, `task_lists.${legacyId}.updated_at`),
      completedAt: optionalIso(row.values.completed_at, `task_lists.${legacyId}.completed_at`),
    });
    listRows.set(legacyId, row);
  }
  const listsByLegacyId = new Map(taskLists.map((list) => [list.legacyTaskListId, list]));
  const taskItems: ImportedTaskItemHistory[] = [];
  for (const row of sourceRows(rows, 'main', 'tasks')) {
    const legacyId = text(row.values.id, 'tasks.id');
    const legacyListId = text(row.values.task_list_id, `tasks.${legacyId}.task_list_id`);
    const list = listsByLegacyId.get(legacyListId);
    const listRow = listRows.get(legacyListId);
    if (list === undefined || listRow === undefined) {
      throw new Error(`Legacy Task ${legacyId} has no Task List`);
    }
    const target = targetFor(phaseOne, row, 'imported_task_item_history');
    if (target?.projectId !== list.projectId)
      throw new Error(`Legacy Task ${legacyId} target differs`);
    const sourcePayload = structuralPayload(row);
    taskItems.push({
      authority: 'imported_task_item_history',
      historical: true,
      readOnly: true,
      id: target.id,
      batchId,
      projectId: list.projectId,
      taskListId: list.id,
      legacyTaskId: legacyId,
      parentItemId: null,
      phaseKey: text(row.values.phase_key, `tasks.${legacyId}.phase_key`),
      phaseName: text(row.values.phase_name, `tasks.${legacyId}.phase_name`),
      phaseOrder: integer(row.values.phase_order, `tasks.${legacyId}.phase_order`),
      taskKey: text(row.values.task_key, `tasks.${legacyId}.task_key`),
      title: text(row.values.name, `tasks.${legacyId}.name`),
      kind: text(row.values.kind, `tasks.${legacyId}.kind`),
      status: text(row.values.status, `tasks.${legacyId}.status`),
      sourcePayload,
      sourcePayloadHash: hashCanonical(sourcePayload),
      createdAt: iso(listRow.values.created_at, `task_lists.${legacyListId}.created_at`),
      updatedAt: iso(row.values.updated_at, `tasks.${legacyId}.updated_at`),
    });
  }
  return {
    taskLists: taskLists.sort((left, right) => compareText(left.id, right.id)),
    taskItems: taskItems.sort((left, right) => compareText(left.id, right.id)),
  };
}

function buildProductionCollections(
  rows: ReadonlyMap<string, LegacyClassificationRow[]>,
  phaseOne: LegacyPhaseOneClassificationReport,
  batchId: string,
  productionByLegacyProject: ReadonlyMap<string, ProductionObject>,
): Pick<ImportedHistoryWriteBundle, 'productionCollections' | 'productionCollectionMembers'> {
  const folderTables = [
    ['character_folders', 'characters'],
    ['equipment_folders', 'equipment'],
    ['location_folders', 'locations'],
  ] as const;
  const collectionRows: Array<{
    readonly row: LegacyClassificationRow;
    readonly folderTable: (typeof folderTables)[number][0];
    readonly entityTable: (typeof folderTables)[number][1];
    readonly target: LegacyClassificationTargetRef;
  }> = [];
  for (const [folderTable, entityTable] of folderTables) {
    for (const row of sourceRows(rows, 'main', folderTable)) {
      const assignment = assignmentFor(phaseOne, row);
      for (const target of assignment?.targetRefs.filter(
        ({ authority }) => authority === 'production_collection',
      ) ?? []) {
        if (target.projectId === null)
          throw new Error(`Production Collection ${target.id} has no Project`);
        collectionRows.push({
          row,
          folderTable,
          entityTable,
          target: { ...target, cloneOf: target.cloneOf ?? null },
        });
      }
    }
  }
  const collectionSourceKey = (
    folderTable: (typeof folderTables)[number][0],
    sourceId: string,
  ): string => `${folderTable}\0${sourceId}`;
  const collectionRowsBySource = new Map<string, typeof collectionRows>();
  for (const collectionRow of collectionRows) {
    const sourceId = text(collectionRow.row.values.id, `${collectionRow.folderTable}.id`);
    const key = collectionSourceKey(collectionRow.folderTable, sourceId);
    const group = collectionRowsBySource.get(key) ?? [];
    group.push(collectionRow);
    collectionRowsBySource.set(key, group);
  }
  const canonicalCloneTargetBySource = new Map<string, string>();
  for (const [key, group] of collectionRowsBySource) {
    const sourceId = text(group[0]!.row.values.id, `${group[0]!.folderTable}.id`);
    const cloned = group.filter(({ target }) => target.cloneOf !== null);
    if (cloned.length === 0) continue;
    if (group.length < 2 || cloned.some(({ target }) => target.cloneOf !== sourceId)) {
      throw new Error(`Production Collection ${sourceId} has an invalid clone plan`);
    }
    const direct = group.filter(({ target }) => target.cloneOf === null);
    if (direct.length > 1) {
      throw new Error(`Production Collection ${sourceId} has ambiguous canonical targets`);
    }
    canonicalCloneTargetBySource.set(
      key,
      direct[0]?.target.id ??
        [...group].sort((left, right) => compareText(left.target.id, right.target.id))[0]!.target
          .id,
    );
  }
  const targetForFolder = (table: string, sourceId: string, projectId: string): string | null => {
    const row = sourceRows(rows, 'main', table).find(
      (candidate) => candidate.values.id === sourceId,
    );
    if (row === undefined) return null;
    return (
      assignmentFor(phaseOne, row)?.targetRefs.find(
        ({ authority, projectId: owner }) =>
          authority === 'production_collection' && owner === projectId,
      )?.id ?? null
    );
  };
  const productionCollections: ProductionCollection[] = [];
  for (const { row, folderTable, target } of collectionRows.sort((left, right) =>
    compareText(left.target.id, right.target.id),
  )) {
    const sourceId = text(row.values.id, `${row.table}.id`);
    const sourceParentId = optionalText(row.values.parent_id);
    const parentCollectionId =
      sourceParentId === null
        ? null
        : targetForFolder(row.table, sourceParentId, target.projectId!);
    if (sourceParentId !== null && parentCollectionId === null) {
      throw new Error(`Production Collection ${sourceId} has no target parent`);
    }
    const canonicalCloneTargetId = canonicalCloneTargetBySource.get(
      collectionSourceKey(folderTable, sourceId),
    );
    productionCollections.push(
      finalizeContentObject(ProductionCollectionSchema, {
        authority: 'production_collection',
        id: target.id,
        projectId: target.projectId!,
        revision: 0,
        parentCollectionId,
        cloneOfCollectionId:
          canonicalCloneTargetId === undefined || canonicalCloneTargetId === target.id
            ? null
            : canonicalCloneTargetId,
        sourceCollectionId: legacyProductionCollectionSourceId(folderTable, sourceId),
        importBatchId: batchId,
        sourcePayloadHash: rowHash(row),
        name: text(row.values.name, `${row.table}.${sourceId}.name`),
        sortOrder: integer(row.values.sort_order, `${row.table}.${sourceId}.sort_order`),
        createdAt: iso(row.values.created_at, `${row.table}.${sourceId}.created_at`),
        updatedAt: iso(row.values.updated_at, `${row.table}.${sourceId}.updated_at`),
      }),
    );
  }

  const members: ProductionCollectionMember[] = [];
  const ordinals = new Map<string, number>();
  for (const { row: folderRow, entityTable, target } of collectionRows.sort((left, right) =>
    compareText(left.target.id, right.target.id),
  )) {
    const sourceFolderId = text(folderRow.values.id, `${folderRow.table}.id`);
    const entityRows = sourceRows(rows, 'main', entityTable)
      .filter((row) => row.values.folder_id === sourceFolderId)
      .sort((left, right) =>
        compareText(
          text(left.values.id, `${entityTable}.id`),
          text(right.values.id, `${entityTable}.id`),
        ),
      );
    for (const entityRow of entityRows) {
      const sourceId = text(entityRow.values.id, `${entityTable}.id`);
      const production = productionByLegacyProject.get(
        `${entityTable}\0${sourceId}\0${target.projectId}`,
      );
      if (production === undefined) continue;
      const ordinal = ordinals.get(target.id) ?? 0;
      members.push({
        collectionId: target.id,
        productionObjectId: production.id,
        ordinal,
        importBatchId: batchId,
        sourcePayloadHash: rowHash(entityRow),
        createdAt: production.createdAt,
      });
      ordinals.set(target.id, ordinal + 1);
    }
  }
  return {
    productionCollections: productionCollections.sort((left, right) =>
      compareText(left.id, right.id),
    ),
    productionCollectionMembers: members.sort(
      (left, right) =>
        compareText(left.collectionId, right.collectionId) || left.ordinal - right.ordinal,
    ),
  };
}

function recordTimestamp(row: LegacyClassificationRow, fallback: string): string {
  for (const column of [
    'event_timestamp',
    'emitted_at',
    'created_at',
    'assembled_at',
    'submitted_at',
    'decided_at',
    'updated_at',
    'completed_at',
  ]) {
    const value = row.values[column];
    if (value === null || value === undefined) continue;
    return iso(value, `${row.table}.${column}`);
  }
  return fallback;
}

function sourceRecordId(row: LegacyClassificationRow, fallback: string): string {
  for (const column of ['id', 'event_id', 'decision_key', 'logical_key']) {
    const value = optionalText(row.values[column]);
    if (value !== null) return value;
  }
  return fallback;
}

function buildImportedRecords(
  rows: ReadonlyMap<string, LegacyClassificationRow[]>,
  phaseOne: LegacyPhaseOneClassificationReport,
  batchId: string,
  batchTime: string,
  taskLists: readonly ImportedTaskListHistory[],
  taskItems: readonly ImportedTaskItemHistory[],
  projectMediaByBlob: ReadonlyMap<string, ProjectMediaRef>,
): readonly ImportedHistoryRecord[] {
  const lists = new Map(taskLists.map((list) => [list.legacyTaskListId, list]));
  const items = new Map(taskItems.map((item) => [item.legacyTaskId, item]));
  const recordTables = [
    'delivery_asset_refs',
    'plan_approvals',
    'plan_documents',
    'prompt_assemblies',
    'task_artifacts',
    'task_attempts',
    'task_decisions',
    'task_dependencies',
    'task_evaluations',
    'task_events',
  ] as const;
  const targetsBySourceId = new Map<string, string>();
  for (const table of recordTables) {
    for (const row of sourceRows(rows, 'main', table)) {
      const target = targetFor(phaseOne, row, 'imported_history_record');
      if (target !== null)
        targetsBySourceId.set(`${table}\0${sourceRecordId(row, target.id)}`, target.id);
    }
  }
  const records: ImportedHistoryRecord[] = [];
  for (const table of recordTables) {
    for (const row of sourceRows(rows, 'main', table)) {
      const schemaId = legacyImportedRecordSchemaId(table);
      const target = targetFor(phaseOne, row, 'imported_history_record');
      if (schemaId === null || target?.projectId === null || target?.projectId === undefined) {
        throw new Error(`Legacy imported record ${table} has no target`);
      }
      const legacyTaskId = optionalText(row.values.task_id);
      const legacyListId = optionalText(row.values.task_list_id);
      const item = legacyTaskId === null ? undefined : items.get(legacyTaskId);
      const list = legacyListId === null ? undefined : lists.get(legacyListId);
      let owner: ImportedHistoryRecord['owner'];
      if (item !== undefined) owner = { kind: 'imported_task_item', taskItemId: item.id };
      else if (list !== undefined) owner = { kind: 'imported_task_list', taskListId: list.id };
      else if (table === 'delivery_asset_refs') {
        const hash = text(row.values.asset_hash, 'delivery_asset_refs.asset_hash');
        const ref = projectMediaByBlob.get(`${target.projectId}\0${hash}`);
        owner = ref
          ? { kind: 'project_media_ref', projectMediaRefId: ref.id }
          : { kind: 'project' };
      } else owner = { kind: 'project' };
      const publicPayload = structuralPayload(row);
      const recordId = target.id;
      const parentSourceId =
        table === 'prompt_assemblies' ? optionalText(row.values.parent_assembly_id) : null;
      records.push({
        authority: 'imported_history_record',
        historical: true,
        readOnly: true,
        id: recordId,
        batchId,
        projectId: target.projectId,
        schemaId,
        sourceRecordId: sourceRecordId(row, recordId),
        owner,
        parentRecordId:
          parentSourceId === null
            ? null
            : (targetsBySourceId.get(`prompt_assemblies\0${parentSourceId}`) ?? null),
        sequence:
          table === 'task_events' ? optionalInteger(row.values.seq, 'task_events.seq') : null,
        occurredAt: recordTimestamp(row, batchTime),
        publicPayload,
        publicPayloadHash: hashCanonical(publicPayload),
        privateEvidence: evidenceFor(row),
        createdAt: recordTimestamp(row, batchTime),
      });
    }
  }
  for (const row of sourceRows(rows, 'main', 'canvases')) {
    const projectTarget = targetFor(phaseOne, row, 'project');
    if (projectTarget?.projectId === null || projectTarget?.projectId === undefined) continue;
    const viewport = optionalJsonDocument(row.values.viewport, 'canvases.viewport');
    if (viewport === null) continue;
    const target = legacyCanvasEvidenceTarget(row.subject, projectTarget.projectId);
    const isPlanned = phaseOne.embeddedJson.classification.entries.some((entry) =>
      entry.targetRefs.some(
        (ref) =>
          ref.authority === target.authority &&
          ref.id === target.id &&
          ref.projectId === target.projectId,
      ),
    );
    if (!isPlanned)
      throw new Error(`Legacy Canvas viewport ${String(row.values.id)} has no evidence target`);
    const publicPayload = { kind: 'legacy_canvas_viewport', viewport };
    records.push({
      authority: 'imported_history_record',
      historical: true,
      readOnly: true,
      id: target.id,
      batchId,
      projectId: projectTarget.projectId,
      schemaId: LEGACY_IMPORTED_HISTORY_SCHEMA_IDS.unmigratedPayload,
      sourceRecordId: text(row.values.id, 'canvases.id'),
      owner: { kind: 'project' },
      parentRecordId: null,
      sequence: null,
      occurredAt: iso(row.values.updated_at, 'canvases.updated_at'),
      publicPayload,
      publicPayloadHash: hashCanonical(publicPayload),
      privateEvidence: { state: 'none' },
      createdAt: iso(row.values.updated_at, 'canvases.updated_at'),
    });
  }
  return records.sort((left, right) => compareText(left.id, right.id));
}

export function buildLegacyMigrationMaterialization(
  input: BuildLegacyMigrationMaterializationInput,
): LegacyMigrationMaterialization {
  assertLegacyMigrationPlan(input.plan);
  const skillPlan = validateLegacySkillMigrationPlan(input.skillPlan);
  if (
    !input.phaseOne.ok ||
    input.plan.source.phaseOneFingerprint !== input.phaseOne.fingerprint ||
    input.plan.source.contentFingerprint !== input.phaseOne.sourceContentFingerprint ||
    input.plan.source.classificationFingerprint !== input.phaseOne.sourceFingerprint
  ) {
    throw new TypeError('Legacy migration materialization input does not match its frozen plan');
  }
  const classifiedSkillIds = [
    ...new Set(
      input.plan.operations.flatMap(({ targetRefs }) =>
        targetRefs.flatMap(({ authority, id }) => (authority === 'skill' ? [id] : [])),
      ),
    ),
  ].sort(compareText);
  const plannedSkillIds = [...new Set(skillPlan.rows.map(({ skillId }) => skillId))].sort(
    compareText,
  );
  if (canonicalJson(classifiedSkillIds) !== canonicalJson(plannedSkillIds)) {
    throw new TypeError('Legacy Skill plan targets differ from the frozen migration plan');
  }
  const scanned = rowsByTable(input.databases);
  if (scanned.fingerprint !== input.phaseOne.sourceFingerprint) {
    throw new TypeError('Legacy migration source changed after planning');
  }
  const createdAt = batchCreatedAt(scanned.grouped);
  const {
    projects,
    settings: projectSettings,
    canvasRowsByProject,
  } = buildProjects(scanned.grouped, input.phaseOne, input.plan.batchId);
  const media = buildMedia(scanned.grouped, input.plan.batchId, input.mediaInspections);
  const production = buildProduction(scanned.grouped, input.phaseOne, input.plan.batchId);
  const projectMedia = buildProjectMediaRefs(
    scanned.grouped,
    input.phaseOne,
    input.plan.batchId,
    projects,
    media.assetByBlobHash,
    production.byLegacyProject,
  );
  const canvases = buildCanvases(
    scanned.grouped,
    input.phaseOne,
    projects,
    canvasRowsByProject,
    projectMedia.byProjectBlob,
    production.byLegacyProject,
  );
  const conversation = buildChatsAndMessages(scanned.grouped, input.phaseOne);
  const runHistory = buildImportedRuns(
    scanned.grouped,
    input.phaseOne,
    input.plan.batchId,
    media.assetByBlobHash,
    projectMedia.byProjectBlob,
  );
  const taskHistory = buildImportedTasks(
    scanned.grouped,
    input.phaseOne,
    input.plan.batchId,
    runHistory.runs,
  );
  const collections = buildProductionCollections(
    scanned.grouped,
    input.phaseOne,
    input.plan.batchId,
    production.byLegacyProject,
  );
  const records = buildImportedRecords(
    scanned.grouped,
    input.phaseOne,
    input.plan.batchId,
    createdAt,
    taskHistory.taskLists,
    taskHistory.taskItems,
    projectMedia.byProjectBlob,
  );
  const importedHistory = parseCanonical(ImportedHistoryWriteBundleSchema, {
    batch: {
      authority: 'imported_history_batch',
      id: input.plan.batchId,
      sourceSchemaId: 'lucid-fin.legacy-source-i0/v1',
      sourceSnapshotHash: input.phaseOne.sourceContentFingerprint,
      classificationHash: input.phaseOne.fingerprint,
      planHash: input.plan.fingerprint,
      offlineEvidenceManifestHash: input.offlineEvidenceManifestHash,
      reconciliationHash: input.reconciliationHash,
      createdAt,
    },
    ...runHistory,
    ...taskHistory,
    records,
    ...collections,
  });
  const withoutFingerprint = {
    schema: 'lucid-fin.legacy-migration-materialization/v1' as const,
    planFingerprint: input.plan.fingerprint,
    projects,
    projectSettings,
    mediaBlobs: media.blobs,
    globalMediaFolders: media.folders,
    globalMediaAssets: media.assets,
    projectMediaRefs: projectMedia.refs,
    productionObjects: production.objects,
    chats: conversation.chats,
    messages: conversation.messages,
    canvases,
    skillDocuments: skillPlan.documents,
    importedHistory,
  };
  return Object.freeze({
    ...withoutFingerprint,
    fingerprint: hashCanonical(withoutFingerprint),
  });
}
