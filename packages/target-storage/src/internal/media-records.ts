import {
  ArtifactRefSchema,
  EntityIdSchema,
  GlobalMediaAssetSchema,
  GlobalMediaFolderSchema,
  MediaBlobSchema,
  ProjectMediaRefSchema,
  Sha256Schema,
  canonicalJson,
  parseCanonical,
  type GlobalMediaAsset,
  type GlobalMediaFolder,
  type MediaBlob,
  type MediaKind,
  type MediaTechnicalFacts,
  type ProjectMediaRef,
  type ArtifactRef,
} from '@lucid-fin/target-contracts';
import type { DatabaseSync } from 'node:sqlite';
import { TargetStorageError } from '../kernel/errors.js';
import {
  decodeProjectMediaCollections,
  decodeProjectMediaRoles,
  decodeGlobalMediaTags,
  decodeMediaSource,
  decodeMediaTechnicalFacts,
  encodeGlobalMediaTags,
  encodeMediaTechnicalFacts,
  encodeMediaSource,
  encodeProjectMediaCollections,
  encodeProjectMediaRoles,
} from './canonical-codecs.js';
import { causationColumns, causationFromColumns } from './causation.js';
import { hashContentObject } from './hashes.js';

interface MediaBlobRow {
  hash: string;
  byte_length: number;
  mime_type: string;
  media_kind: MediaKind;
  technical_facts_v1_json: string;
  created_at: string;
}

interface GlobalMediaFolderRow {
  id: string;
  revision: number;
  content_hash: string;
  parent_id: string | null;
  name: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface MediaBlobDescriptor {
  readonly hash: string;
  readonly byteLength: number;
  readonly mimeType: string;
  readonly technicalFacts: MediaTechnicalFacts;
}

interface GlobalMediaAssetRow {
  id: string;
  revision: number;
  content_hash: string;
  blob_hash: string;
  media_kind: MediaKind;
  filename: string;
  display_name: string;
  source_v1_json: string;
  folder_id: string | null;
  tags_v1_json: string;
  created_at: string;
  updated_at: string;
}

interface ProjectMediaRefRow {
  id: string;
  project_id: string;
  global_asset_id: string;
  revision: number;
  content_hash: string;
  lifecycle: ProjectMediaRef['lifecycle'];
  detached_at: string | null;
  label: string;
  collections_v1_json: string;
  roles_v1_json: string;
  notes: string;
  created_by_kind: ProjectMediaRef['createdBy']['kind'];
  created_by_id: string;
  created_at: string;
  updated_at: string;
}

function corrupt(message: string): TargetStorageError {
  return new TargetStorageError('CORRUPT_DATA', message);
}

export function mediaBlobFromRow(row: MediaBlobRow): MediaBlob {
  const blob = parseCanonical(MediaBlobSchema, {
    authority: 'media_blob',
    hash: row.hash,
    byteLength: row.byte_length,
    mimeType: row.mime_type,
    technicalFacts: decodeMediaTechnicalFacts(row.technical_facts_v1_json),
    createdAt: row.created_at,
  });
  if (blob.technicalFacts.kind !== row.media_kind) {
    throw corrupt(`Media Blob ${blob.hash} kind does not match its technical facts`);
  }
  return blob;
}

export function findMediaBlob(database: DatabaseSync, hashInput: string): MediaBlob | undefined {
  const hash = parseCanonical(Sha256Schema, hashInput);
  const row = database.prepare('SELECT * FROM media_blobs WHERE hash = ?').get(hash) as unknown as
    MediaBlobRow | undefined;
  return row === undefined ? undefined : mediaBlobFromRow(row);
}

export function loadMediaBlob(database: DatabaseSync, hash: string): MediaBlob {
  const blob = findMediaBlob(database, hash);
  if (blob === undefined)
    throw new TargetStorageError('NOT_FOUND', `Media Blob was not found: ${hash}`);
  return blob;
}

export function insertOrValidateMediaBlob(
  database: DatabaseSync,
  descriptor: MediaBlobDescriptor,
  createdAt: string,
): MediaBlob {
  const existing = findMediaBlob(database, descriptor.hash);
  if (existing !== undefined) {
    if (
      existing.byteLength !== descriptor.byteLength ||
      existing.mimeType !== descriptor.mimeType ||
      canonicalJson(existing.technicalFacts) !== canonicalJson(descriptor.technicalFacts)
    ) {
      throw corrupt(`Media Blob ${descriptor.hash} metadata conflicts with its bytes`);
    }
    return existing;
  }
  database
    .prepare(
      `INSERT INTO media_blobs (
         hash, byte_length, mime_type, media_kind, technical_facts_v1_json, created_at
       ) VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      descriptor.hash,
      descriptor.byteLength,
      descriptor.mimeType,
      descriptor.technicalFacts.kind,
      encodeMediaTechnicalFacts(descriptor.technicalFacts),
      createdAt,
    );
  return loadMediaBlob(database, descriptor.hash);
}

export function globalMediaFolderFromRow(row: GlobalMediaFolderRow): GlobalMediaFolder {
  const folder = parseCanonical(GlobalMediaFolderSchema, {
    authority: 'global_media_folder',
    id: row.id,
    revision: row.revision,
    contentHash: row.content_hash,
    parentId: row.parent_id,
    name: row.name,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
  if (hashContentObject(folder) !== folder.contentHash) {
    throw corrupt(`Global Media Folder ${folder.id} content hash does not match`);
  }
  return folder;
}

export function findGlobalMediaFolder(
  database: DatabaseSync,
  idInput: string,
): GlobalMediaFolder | undefined {
  const id = parseCanonical(EntityIdSchema, idInput);
  const row = database
    .prepare('SELECT * FROM global_media_folders WHERE id = ?')
    .get(id) as unknown as GlobalMediaFolderRow | undefined;
  if (row === undefined) return undefined;
  const folder = globalMediaFolderFromRow(row);
  if (
    folder.parentId !== null &&
    database.prepare('SELECT 1 FROM global_media_folders WHERE id = ?').get(folder.parentId) ===
      undefined
  ) {
    throw corrupt(`Global Media Folder ${folder.id} parent does not exist`);
  }
  return folder;
}

export function loadGlobalMediaFolder(database: DatabaseSync, id: string): GlobalMediaFolder {
  const folder = findGlobalMediaFolder(database, id);
  if (folder === undefined) {
    throw new TargetStorageError('NOT_FOUND', `Global Media Folder was not found: ${id}`);
  }
  return folder;
}

export function listGlobalMediaFolders(database: DatabaseSync): readonly GlobalMediaFolder[] {
  const folders = (
    database
      .prepare(
        `SELECT * FROM global_media_folders
         ORDER BY parent_id, sort_order, name, id`,
      )
      .all() as unknown as GlobalMediaFolderRow[]
  ).map(globalMediaFolderFromRow);
  const ids = new Set(folders.map(({ id }) => id));
  for (const folder of folders) {
    if (folder.parentId !== null && !ids.has(folder.parentId)) {
      throw corrupt(`Global Media Folder ${folder.id} parent does not exist`);
    }
  }
  return folders;
}

export function insertGlobalMediaFolder(
  database: DatabaseSync,
  folderInput: GlobalMediaFolder,
): GlobalMediaFolder {
  const folder = parseCanonical(GlobalMediaFolderSchema, folderInput);
  if (hashContentObject(folder) !== folder.contentHash) {
    throw corrupt(`Global Media Folder ${folder.id} content hash does not match`);
  }
  if (folder.parentId !== null) loadGlobalMediaFolder(database, folder.parentId);
  database
    .prepare(
      `INSERT INTO global_media_folders (
         id, revision, content_hash, parent_id, name, sort_order, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      folder.id,
      folder.revision,
      folder.contentHash,
      folder.parentId,
      folder.name,
      folder.sortOrder,
      folder.createdAt,
      folder.updatedAt,
    );
  return loadGlobalMediaFolder(database, folder.id);
}

export function globalMediaAssetFromRow(row: GlobalMediaAssetRow): GlobalMediaAsset {
  const asset = parseCanonical(GlobalMediaAssetSchema, {
    authority: 'global_media_asset',
    id: row.id,
    revision: row.revision,
    contentHash: row.content_hash,
    blobHash: row.blob_hash,
    kind: row.media_kind,
    filename: row.filename,
    displayName: row.display_name,
    source: decodeMediaSource(row.source_v1_json),
    folderId: row.folder_id,
    tags: decodeGlobalMediaTags(row.tags_v1_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
  if (hashContentObject(asset) !== asset.contentHash) {
    throw corrupt(`Global Media Asset ${asset.id} content hash does not match`);
  }
  return asset;
}

export function findGlobalMediaAsset(
  database: DatabaseSync,
  idInput: string,
): GlobalMediaAsset | undefined {
  const id = parseCanonical(EntityIdSchema, idInput);
  const row = database
    .prepare('SELECT * FROM global_media_assets WHERE id = ?')
    .get(id) as unknown as GlobalMediaAssetRow | undefined;
  if (row === undefined) return undefined;
  const asset = globalMediaAssetFromRow(row);
  const blob = loadMediaBlob(database, asset.blobHash);
  if (asset.kind !== blob.technicalFacts.kind) {
    throw corrupt(`Global Media Asset ${asset.id} kind does not match its Media Blob`);
  }
  if (asset.folderId !== null && findGlobalMediaFolder(database, asset.folderId) === undefined) {
    throw corrupt(`Global Media Asset ${asset.id} folder does not exist`);
  }
  return asset;
}

export function loadGlobalMediaAsset(database: DatabaseSync, id: string): GlobalMediaAsset {
  const asset = findGlobalMediaAsset(database, id);
  if (asset === undefined) {
    throw new TargetStorageError('NOT_FOUND', `Global Media Asset was not found: ${id}`);
  }
  return asset;
}

export function insertGlobalMediaAsset(
  database: DatabaseSync,
  assetInput: GlobalMediaAsset,
): GlobalMediaAsset {
  const asset = parseCanonical(GlobalMediaAssetSchema, assetInput);
  if (hashContentObject(asset) !== asset.contentHash) {
    throw corrupt(`Global Media Asset ${asset.id} content hash does not match`);
  }
  if (asset.folderId !== null) loadGlobalMediaFolder(database, asset.folderId);
  const blob = loadMediaBlob(database, asset.blobHash);
  if (blob.technicalFacts.kind !== asset.kind) {
    throw corrupt(`Global Media Asset ${asset.id} kind does not match its Media Blob`);
  }
  database
    .prepare(
      `INSERT INTO global_media_assets (
         id, revision, content_hash, blob_hash, media_kind, filename, display_name,
         source_v1_json, folder_id, tags_v1_json, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      asset.id,
      asset.revision,
      asset.contentHash,
      asset.blobHash,
      asset.kind,
      asset.filename,
      asset.displayName,
      encodeMediaSource(asset.source),
      asset.folderId,
      encodeGlobalMediaTags(asset.tags),
      asset.createdAt,
      asset.updatedAt,
    );
  return loadGlobalMediaAsset(database, asset.id);
}

export function loadProjectMediaRecord(
  database: DatabaseSync,
  projectMediaRefId: string,
): ProjectMediaRef {
  const id = parseCanonical(EntityIdSchema, projectMediaRefId);
  const row = database
    .prepare('SELECT * FROM project_media_refs WHERE id = ?')
    .get(id) as unknown as ProjectMediaRefRow | undefined;
  if (row === undefined) {
    throw new TargetStorageError('NOT_FOUND', `Project Media reference was not found: ${id}`);
  }
  const links = database
    .prepare(
      `SELECT production_object_id, relation
       FROM project_media_links
       WHERE project_media_ref_id = ?
       ORDER BY production_object_id, relation`,
    )
    .all(id) as unknown as Array<{
    production_object_id: string;
    relation: ProjectMediaRef['productionLinks'][number]['relation'];
  }>;
  const ref = parseCanonical(ProjectMediaRefSchema, {
    authority: 'project_media_ref',
    id: row.id,
    projectId: row.project_id,
    globalAssetId: row.global_asset_id,
    revision: row.revision,
    contentHash: row.content_hash,
    lifecycle: row.lifecycle,
    detachedAt: row.detached_at,
    label: row.label,
    collections: decodeProjectMediaCollections(row.collections_v1_json),
    roles: decodeProjectMediaRoles(row.roles_v1_json),
    notes: row.notes,
    productionLinks: links.map((link) => ({
      productionObjectId: link.production_object_id,
      relation: link.relation,
    })),
    createdBy: causationFromColumns(row.created_by_kind, row.created_by_id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
  if (hashContentObject(ref) !== ref.contentHash) {
    throw corrupt(`Project Media reference ${ref.id} content hash does not match`);
  }
  return ref;
}

export function findProjectMediaRecordByAsset(
  database: DatabaseSync,
  projectIdInput: string,
  globalAssetIdInput: string,
): ProjectMediaRef | undefined {
  const projectId = parseCanonical(EntityIdSchema, projectIdInput);
  const globalAssetId = parseCanonical(EntityIdSchema, globalAssetIdInput);
  const row = database
    .prepare(
      `SELECT id FROM project_media_refs
       WHERE project_id = ? AND global_asset_id = ?`,
    )
    .get(projectId, globalAssetId) as unknown as { readonly id: string } | undefined;
  return row === undefined ? undefined : loadProjectMediaRecord(database, row.id);
}

export function insertProjectMediaRecord(
  database: DatabaseSync,
  refInput: ProjectMediaRef,
): ProjectMediaRef {
  const ref = parseCanonical(ProjectMediaRefSchema, refInput);
  if (hashContentObject(ref) !== ref.contentHash) {
    throw corrupt(`Project Media reference ${ref.id} content hash does not match`);
  }
  if (ref.productionLinks.length !== 0) {
    throw new TargetStorageError(
      'INVALID_REQUEST',
      'New Project Media references cannot contain Production links',
    );
  }
  insertProjectMediaRows(database, ref);
  return loadProjectMediaRecord(database, ref.id);
}

function insertProjectMediaRows(database: DatabaseSync, ref: ProjectMediaRef): void {
  const asset = loadGlobalMediaAsset(database, ref.globalAssetId);
  const createdBy = causationColumns(ref.createdBy);
  database
    .prepare(
      `INSERT INTO project_media_refs (
         id, project_id, global_asset_id, revision, content_hash, lifecycle, detached_at,
         label, collections_v1_json, roles_v1_json, notes, created_by_kind, created_by_id,
         created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      ref.id,
      ref.projectId,
      asset.id,
      ref.revision,
      ref.contentHash,
      ref.lifecycle,
      ref.detachedAt,
      ref.label,
      encodeProjectMediaCollections(ref.collections),
      encodeProjectMediaRoles(ref.roles),
      ref.notes,
      createdBy[0],
      createdBy[1],
      ref.createdAt,
      ref.updatedAt,
    );
}

export interface InsertGeneratedProjectMediaRecordInput {
  readonly ref: Omit<ProjectMediaRef, 'contentHash' | 'productionLinks'>;
  readonly productionObjectId: string;
  readonly linkId: string;
}

export function insertGeneratedProjectMediaRecord(
  database: DatabaseSync,
  input: InsertGeneratedProjectMediaRecordInput,
): ProjectMediaRef {
  if (!database.isTransaction) {
    throw new TargetStorageError(
      'INVALID_REQUEST',
      'Generated Project Media insertion requires a transaction',
    );
  }
  const productionObjectId = parseCanonical(EntityIdSchema, input.productionObjectId);
  const linkId = parseCanonical(EntityIdSchema, input.linkId);
  const target = database
    .prepare('SELECT project_id, lifecycle FROM production_objects WHERE id = ?')
    .get(productionObjectId) as unknown as
    { project_id: string; lifecycle: 'active' | 'archived' } | undefined;
  if (target === undefined) {
    throw new TargetStorageError(
      'NOT_FOUND',
      `Production object ${productionObjectId} was not found`,
    );
  }
  if (target.project_id !== input.ref.projectId || target.lifecycle !== 'active') {
    throw new TargetStorageError(
      'INVALID_REQUEST',
      `Production object ${productionObjectId} cannot receive generated Project Media`,
    );
  }
  const withoutHash = {
    ...input.ref,
    contentHash: '',
    productionLinks: [{ productionObjectId, relation: 'generated_for' as const }],
  };
  const ref = parseCanonical(ProjectMediaRefSchema, {
    ...withoutHash,
    contentHash: hashContentObject(withoutHash),
  });
  insertProjectMediaRows(database, ref);
  database
    .prepare(
      `INSERT INTO project_media_links (
         id, project_media_ref_id, production_object_id, relation, created_at
       ) VALUES (?, ?, ?, 'generated_for', ?)`,
    )
    .run(linkId, ref.id, productionObjectId, ref.createdAt);
  const persisted = loadProjectMediaRecord(database, ref.id);
  if (canonicalJson(persisted) !== canonicalJson(ref)) {
    throw corrupt(`Generated Project Media reference ${ref.id} did not persist exactly`);
  }
  return persisted;
}

export function artifactForMediaBlob(
  database: DatabaseSync,
  idInput: string,
  blobHash: string,
  kindInput?: ArtifactRef['kind'],
): ArtifactRef {
  const id = parseCanonical(EntityIdSchema, idInput);
  const blob = loadMediaBlob(database, blobHash);
  const facts = blob.technicalFacts;
  const kind = kindInput ?? facts.kind;
  if (
    (kind === 'image' || kind === 'video' || kind === 'audio' || kind === 'document') &&
    kind !== facts.kind
  ) {
    throw corrupt(`Artifact ${id} kind does not match Media Blob ${blob.hash}`);
  }
  return parseCanonical(ArtifactRefSchema, {
    kind,
    id,
    contentHash: blob.hash,
    mimeType: blob.mimeType,
    width: facts.kind === 'image' || facts.kind === 'video' ? facts.width : null,
    height: facts.kind === 'image' || facts.kind === 'video' ? facts.height : null,
    durationMs: facts.kind === 'video' || facts.kind === 'audio' ? facts.durationMs : null,
  });
}
