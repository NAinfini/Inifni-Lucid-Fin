import {
  CanvasDocumentSchema,
  parseCanonical,
  type CanvasDocument,
} from '@lucid-fin/target-contracts';
import type { DatabaseSync } from 'node:sqlite';
import { TargetStorageError } from '../kernel/errors.js';
import {
  decodeCanvasGeometry,
  decodeCanvasViewport,
  encodeCanvasGeometry,
  encodeCanvasViewport,
} from './canonical-codecs.js';
import { hashContentObject } from './hashes.js';

const ZERO_HASH = '0'.repeat(64);

interface CanvasRow {
  id: string;
  project_id: string;
  revision: number;
  content_hash: string;
  viewport_v1_json: string;
  next_z_index: number;
  created_at: string;
  updated_at: string;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function canonicalizeCanvas(document: CanvasDocument): CanvasDocument {
  return {
    ...document,
    placements: [...document.placements].sort(
      (left, right) => left.zIndex - right.zIndex || compareText(left.id, right.id),
    ),
    groups: document.groups
      .map((group) => ({ ...group, placementIds: [...group.placementIds].sort(compareText) }))
      .sort((left, right) => compareText(left.id, right.id)),
    edges: [...document.edges].sort((left, right) => compareText(left.id, right.id)),
    annotations: [...document.annotations].sort((left, right) => compareText(left.id, right.id)),
    savedViews: [...document.savedViews].sort((left, right) => compareText(left.id, right.id)),
  };
}

export function finalizeCanvas(value: Omit<CanvasDocument, 'contentHash'>): CanvasDocument {
  const normalized = canonicalizeCanvas(
    parseCanonical(CanvasDocumentSchema, { ...value, contentHash: ZERO_HASH }),
  );
  return parseCanonical(CanvasDocumentSchema, {
    ...normalized,
    contentHash: hashContentObject(normalized),
  });
}

export function createEmptyCanvas(
  projectId: string,
  canvasId: string,
  createdAt: string,
): CanvasDocument {
  return finalizeCanvas({
    authority: 'canvas',
    id: canvasId,
    projectId,
    revision: 0,
    placements: [],
    groups: [],
    edges: [],
    annotations: [],
    viewport: { center: { x: 0, y: 0 }, zoom: 1 },
    savedViews: [],
    nextZIndex: 0,
    createdAt,
    updatedAt: createdAt,
  });
}

export function insertCanvas(database: DatabaseSync, canvas: CanvasDocument): void {
  database
    .prepare(
      `INSERT INTO canvas_documents (
         id, project_id, revision, content_hash, viewport_v1_json, next_z_index,
         created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      canvas.id,
      canvas.projectId,
      canvas.revision,
      canvas.contentHash,
      encodeCanvasViewport(canvas.viewport),
      canvas.nextZIndex,
      canvas.createdAt,
      canvas.updatedAt,
    );
  insertCanvasChildren(database, canvas);
}

function insertCanvasChildren(database: DatabaseSync, canvas: CanvasDocument): void {
  const placementStatement = database.prepare(
    `INSERT INTO canvas_placements (
       id, canvas_id, target_authority, target_id, target_revision, target_hash,
       x, y, width, height, z_index, revision, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const placement of canvas.placements) {
    placementStatement.run(
      placement.id,
      canvas.id,
      placement.target.targetType,
      placement.target.targetId,
      placement.target.targetRevision,
      placement.target.targetContentHash,
      placement.position.x,
      placement.position.y,
      placement.size.width,
      placement.size.height,
      placement.zIndex,
      placement.revision,
      placement.createdAt,
      placement.updatedAt,
    );
  }

  const groupStatement = database.prepare(
    `INSERT INTO canvas_groups (id, canvas_id, title, revision, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const memberStatement = database.prepare(
    `INSERT INTO canvas_group_members (group_id, placement_id, ordinal) VALUES (?, ?, ?)`,
  );
  for (const group of canvas.groups) {
    groupStatement.run(
      group.id,
      canvas.id,
      group.title,
      group.revision,
      group.createdAt,
      group.updatedAt,
    );
    group.placementIds.forEach((placementId, ordinal) =>
      memberStatement.run(group.id, placementId, ordinal),
    );
  }

  const edgeStatement = database.prepare(
    `INSERT INTO canvas_edges (
       id, canvas_id, source_placement_id, target_placement_id, label, revision,
       created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const edge of canvas.edges) {
    edgeStatement.run(
      edge.id,
      canvas.id,
      edge.sourcePlacementId,
      edge.targetPlacementId,
      edge.label,
      edge.revision,
      edge.createdAt,
      edge.updatedAt,
    );
  }

  const annotationStatement = database.prepare(
    `INSERT INTO canvas_annotations (
       id, canvas_id, placement_id, text, geometry_v1_json, revision, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const annotation of canvas.annotations) {
    annotationStatement.run(
      annotation.id,
      canvas.id,
      annotation.placementId,
      annotation.text,
      encodeCanvasGeometry(annotation.geometry),
      annotation.revision,
      annotation.createdAt,
      annotation.updatedAt,
    );
  }

  const viewStatement = database.prepare(
    `INSERT INTO canvas_saved_views (
       id, canvas_id, name, viewport_v1_json, revision, created_at
     ) VALUES (?, ?, ?, ?, ?, ?)`,
  );
  for (const view of canvas.savedViews) {
    viewStatement.run(
      view.id,
      canvas.id,
      view.name,
      encodeCanvasViewport(view.viewport),
      view.revision,
      view.createdAt,
    );
  }
}

export function replaceCanvas(
  database: DatabaseSync,
  before: CanvasDocument,
  after: CanvasDocument,
): void {
  const updated = database
    .prepare(
      `UPDATE canvas_documents
       SET revision = ?, content_hash = ?, viewport_v1_json = ?, next_z_index = ?, updated_at = ?
       WHERE id = ? AND revision = ? AND content_hash = ?`,
    )
    .run(
      after.revision,
      after.contentHash,
      encodeCanvasViewport(after.viewport),
      after.nextZIndex,
      after.updatedAt,
      before.id,
      before.revision,
      before.contentHash,
    );
  if (Number(updated.changes) !== 1) {
    throw new TargetStorageError('REVISION_CONFLICT', `Canvas ${before.id} changed concurrently`);
  }
  for (const table of [
    'canvas_group_members',
    'canvas_edges',
    'canvas_annotations',
    'canvas_saved_views',
    'canvas_placements',
    'canvas_groups',
  ]) {
    const ownerColumn = table === 'canvas_group_members' ? null : 'canvas_id';
    if (ownerColumn === null) {
      database
        .prepare(
          `DELETE FROM canvas_group_members
           WHERE group_id IN (SELECT id FROM canvas_groups WHERE canvas_id = ?)`,
        )
        .run(before.id);
    } else {
      database.prepare(`DELETE FROM ${table} WHERE ${ownerColumn} = ?`).run(before.id);
    }
  }
  insertCanvasChildren(database, after);
}

export function loadCanvasByProject(database: DatabaseSync, projectId: string): CanvasDocument {
  const row = database
    .prepare('SELECT * FROM canvas_documents WHERE project_id = ?')
    .get(projectId) as unknown as CanvasRow | undefined;
  if (row === undefined) {
    throw new TargetStorageError('NOT_FOUND', `Canvas for Project ${projectId} was not found`);
  }
  return loadCanvasFromRow(database, row);
}

function loadCanvasFromRow(database: DatabaseSync, row: CanvasRow): CanvasDocument {
  const placements = (
    database
      .prepare(
        `SELECT * FROM canvas_placements
         WHERE canvas_id = ? ORDER BY z_index, id`,
      )
      .all(row.id) as unknown as Array<Record<string, unknown>>
  ).map((placement) => ({
    id: placement.id,
    target: {
      targetType: placement.target_authority,
      targetId: placement.target_id,
      targetRevision: placement.target_revision,
      targetContentHash: placement.target_hash,
    },
    position: { x: placement.x, y: placement.y },
    size: { width: placement.width, height: placement.height },
    zIndex: placement.z_index,
    revision: placement.revision,
    createdAt: placement.created_at,
    updatedAt: placement.updated_at,
  }));
  const groups = (
    database
      .prepare('SELECT * FROM canvas_groups WHERE canvas_id = ? ORDER BY id')
      .all(row.id) as unknown as Array<Record<string, unknown>>
  ).map((group) => ({
    id: group.id,
    title: group.title,
    placementIds: (
      database
        .prepare(
          `SELECT placement_id FROM canvas_group_members
           WHERE group_id = ? ORDER BY ordinal`,
        )
        .all(group.id as string) as unknown as Array<{ placement_id: string }>
    ).map(({ placement_id }) => placement_id),
    revision: group.revision,
    createdAt: group.created_at,
    updatedAt: group.updated_at,
  }));
  const edges = (
    database
      .prepare('SELECT * FROM canvas_edges WHERE canvas_id = ? ORDER BY id')
      .all(row.id) as unknown as Array<Record<string, unknown>>
  ).map((edge) => ({
    id: edge.id,
    sourcePlacementId: edge.source_placement_id,
    targetPlacementId: edge.target_placement_id,
    label: edge.label,
    revision: edge.revision,
    createdAt: edge.created_at,
    updatedAt: edge.updated_at,
  }));
  const annotations = (
    database
      .prepare('SELECT * FROM canvas_annotations WHERE canvas_id = ? ORDER BY id')
      .all(row.id) as unknown as Array<Record<string, unknown>>
  ).map((annotation) => ({
    id: annotation.id,
    placementId: annotation.placement_id,
    text: annotation.text,
    geometry: decodeCanvasGeometry(annotation.geometry_v1_json as string | null),
    revision: annotation.revision,
    createdAt: annotation.created_at,
    updatedAt: annotation.updated_at,
  }));
  const savedViews = (
    database
      .prepare('SELECT * FROM canvas_saved_views WHERE canvas_id = ? ORDER BY id')
      .all(row.id) as unknown as Array<Record<string, unknown>>
  ).map((view) => ({
    id: view.id,
    name: view.name,
    viewport: decodeCanvasViewport(view.viewport_v1_json as string),
    revision: view.revision,
    createdAt: view.created_at,
  }));
  let canvas: CanvasDocument;
  try {
    canvas = canonicalizeCanvas(
      parseCanonical(CanvasDocumentSchema, {
        authority: 'canvas',
        id: row.id,
        projectId: row.project_id,
        revision: row.revision,
        contentHash: row.content_hash,
        placements,
        groups,
        edges,
        annotations,
        viewport: decodeCanvasViewport(row.viewport_v1_json),
        savedViews,
        nextZIndex: row.next_z_index,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }),
    );
  } catch (cause) {
    throw new TargetStorageError('CORRUPT_DATA', `Canvas ${row.id} is invalid`, { cause });
  }
  if (hashContentObject(canvas) !== canvas.contentHash) {
    throw new TargetStorageError('CORRUPT_DATA', `Canvas ${row.id} content hash does not match`);
  }
  return canvas;
}
