import {
  CanvasMutateDefinition,
  CanvasQueryDefinition,
  CanvasTargetBindingSchema,
  EntityIdSchema,
  IsoTimestampSchema,
  MAX_MUTATION_BATCH,
  RevisionSchema,
  Sha256Schema,
  WireSuccessV1Schema,
  canonicalJson,
  parseCanonical,
  parseRequestV1,
  strictObject,
  z,
  type CanvasDocument,
  type CanvasTarget,
  type CanvasTargetBinding,
  type WireRequestV1,
  type WireSuccessV1,
} from '@lucid-fin/target-contracts';
import type { DatabaseSync } from 'node:sqlite';
import { TargetStorageError } from '../kernel/errors.js';
import type { TargetStore } from '../kernel/store.js';
import { withImmediateTransaction } from '../kernel/transaction.js';
import { finalizeCanvas, loadCanvasByProject, replaceCanvas } from '../internal/canvas-records.js';
import {
  executeWireMutation,
  TargetCommandContextSchema,
  type TargetCommandContext,
} from '../internal/command.js';
import { decodeCursor, encodeCursor } from '../internal/cursor.js';
import { getTargetStoreDatabase } from '../internal/database-access.js';
import { resolveCurrentDomainObject } from '../internal/domain-object-resolver.js';
import type { TargetStorageEnvironment } from '../internal/environment.js';
import { hashCanonical } from '../internal/hashes.js';
import { appendProjectEvent } from '../internal/project-events.js';

type RequestMap = {
  [Method in WireRequestV1['method']]: Extract<WireRequestV1, { method: Method }>;
};
type SuccessMap = {
  [Method in WireSuccessV1['method']]: Extract<WireSuccessV1, { method: Method }>;
};
type Request<Method extends keyof RequestMap> = RequestMap[Method];
type Success<Method extends keyof SuccessMap> = SuccessMap[Method];
type CanvasCommand = Request<'canvas.apply'>['input']['command'];
export type CanvasToolQueryInput = ReturnType<typeof CanvasQueryDefinition.parseInput>;
export type CanvasToolQuerySuccess = ReturnType<typeof CanvasQueryDefinition.parseSuccess>;
export type CanvasToolMutationInput = ReturnType<typeof CanvasMutateDefinition.parseInput>;
export type CanvasToolMutationSuccess = ReturnType<typeof CanvasMutateDefinition.parseSuccess>;
type CanvasToolQueryItem = CanvasToolQuerySuccess['page']['items'][number];
type CanvasToolKind = CanvasToolQueryItem['object']['kind'];
type CanvasToolMutationReceipt = CanvasToolMutationSuccess['receipts'][number];

const CanvasToolCursorSchema = strictObject({
  projectId: EntityIdSchema,
  filterHash: Sha256Schema,
  canvasRevision: RevisionSchema,
  canvasContentHash: Sha256Schema,
  kind: z.enum(['placement', 'group', 'edge', 'annotation', 'saved_view']),
  id: EntityIdSchema,
});
const CANVAS_TOOL_KIND_RANK: Readonly<Record<CanvasToolKind, number>> = Object.freeze({
  placement: 0,
  group: 1,
  edge: 2,
  annotation: 3,
  saved_view: 4,
});

function exactRequest<Method extends WireRequestV1['method']>(
  value: Request<Method>,
  method: Method,
): Request<Method> {
  const request = parseRequestV1(value);
  if (request.method !== method) {
    throw new TargetStorageError('INVALID_REQUEST', `Expected Wire method ${method}`);
  }
  return request as Request<Method>;
}

function success<Method extends WireSuccessV1['method']>(
  request: Request<Method>,
  result: unknown,
): Success<Method> {
  return parseCanonical(WireSuccessV1Schema, {
    wireVersion: 1,
    kind: 'success',
    requestId: request.requestId,
    method: request.method,
    result,
  }) as Success<Method>;
}

function targetAuthority(target: CanvasTarget): CanvasTargetBinding['targetType'] {
  return target.targetType;
}

function bindTarget(
  database: DatabaseSync,
  projectId: string,
  target: CanvasTarget,
): CanvasTargetBinding {
  const authority = targetAuthority(target);
  const resolved = resolveCurrentDomainObject(database, authority, target.targetId);
  if (resolved.projectId !== projectId) {
    throw new TargetStorageError(
      'INVALID_REQUEST',
      `${authority}:${target.targetId} belongs to another Project`,
    );
  }
  return parseCanonical(CanvasTargetBindingSchema, {
    targetType: authority,
    targetId: resolved.ref.id,
    targetRevision: resolved.ref.revision,
    targetContentHash: resolved.ref.contentHash,
  });
}

function placementIndex(canvas: CanvasDocument, placementId: string): number {
  const index = canvas.placements.findIndex((placement) => placement.id === placementId);
  if (index < 0) {
    throw new TargetStorageError('NOT_FOUND', `Canvas placement ${placementId} was not found`);
  }
  return index;
}

type CanvasPlacementRef = Extract<
  CanvasToolMutationInput,
  { action: 'group' }
>['placements'][number];
type CanvasMutationAction = CanvasToolMutationInput['action'];
type CanvasCoreCommand =
  | {
      readonly action: 'place';
      readonly placementId: string;
      readonly target: CanvasTarget;
      readonly position: CanvasDocument['placements'][number]['position'];
      readonly size: CanvasDocument['placements'][number]['size'];
      readonly zIndex: number | null;
    }
  | {
      readonly action: 'move';
      readonly placementId: string;
      readonly position: CanvasDocument['placements'][number]['position'];
    }
  | {
      readonly action: 'resize';
      readonly placementId: string;
      readonly size: CanvasDocument['placements'][number]['size'];
    }
  | { readonly action: 'remove'; readonly placementIds: readonly string[] }
  | {
      readonly action: 'group';
      readonly groupId: string;
      readonly title: string;
      readonly placementIds: readonly string[];
    }
  | { readonly action: 'ungroup'; readonly groupId: string }
  | {
      readonly action: 'connect';
      readonly edgeId: string;
      readonly sourcePlacementId: string;
      readonly targetPlacementId: string;
      readonly label: string;
    }
  | { readonly action: 'disconnect'; readonly edgeId: string }
  | {
      readonly action: 'annotate';
      readonly annotationId: string;
      readonly placementId: string | null;
      readonly text: string;
      readonly geometry: CanvasDocument['annotations'][number]['geometry'];
    }
  | {
      readonly action: 'arrange';
      readonly placementIds: readonly string[];
      readonly layout: Extract<CanvasToolMutationInput, { action: 'arrange' }>['layout'];
      readonly spacing: number;
    }
  | {
      readonly action: 'save_view';
      readonly viewId: string;
      readonly name: string;
      readonly viewport: CanvasDocument['viewport'];
    }
  | { readonly action: 'restore_view'; readonly viewId: string };

export interface CanvasMutationPlannedIds {
  readonly tool: 'canvas.mutate';
  readonly projectEventId: string;
  readonly placementId: string | null;
  readonly groupId: string | null;
  readonly edgeId: string | null;
  readonly annotationId: string | null;
  readonly viewId: string | null;
}

export interface PlannedCanvasMutation {
  readonly projectId: string;
  readonly input: CanvasToolMutationInput;
  readonly occurredAt: string;
  readonly before: CanvasDocument;
  readonly after: CanvasDocument;
  readonly ids: CanvasMutationPlannedIds;
  readonly receipts: readonly CanvasToolMutationReceipt[];
}

export interface CommittedCanvasMutation {
  readonly canvas: CanvasDocument;
  readonly receipts: readonly CanvasToolMutationReceipt[];
  readonly projectEventId: string;
}

export interface CanvasToolMutationOptions {
  readonly occurredAt?: string;
  readonly dispatchOperationId: string;
}

const CANVAS_MUTATION_ID_SCHEMA = 'lucid-fin.canvas-mutation-planned-ids/v1';

function invalidCanvasMutation(message: string): TargetStorageError {
  return new TargetStorageError('INVALID_REQUEST', message);
}

function corruptCanvasMutation(message: string): TargetStorageError {
  return new TargetStorageError('CORRUPT_DATA', message);
}

function uniqueIds(ids: readonly string[], label: string): string[] {
  const unique = [...new Set(ids)];
  if (unique.length !== ids.length) {
    throw invalidCanvasMutation(`${label} contains duplicate IDs`);
  }
  return unique;
}

function canonicalIds(ids: readonly string[], label: string): string[] {
  return uniqueIds(ids, label).sort();
}

function canvasMutationId(
  dispatchOperationIdValue: string,
  action: CanvasMutationAction,
  role: 'placement' | 'group' | 'edge' | 'annotation' | 'view' | 'project_event',
): string {
  const dispatchOperationId = parseCanonical(EntityIdSchema, dispatchOperationIdValue);
  const prefix =
    role === 'placement'
      ? 'canvas_placement'
      : role === 'group'
        ? 'canvas_group'
        : role === 'edge'
          ? 'canvas_edge'
          : role === 'annotation'
            ? 'canvas_annotation'
            : role === 'view'
              ? 'canvas_view'
              : 'project_event';
  return parseCanonical(
    EntityIdSchema,
    `${prefix}.${hashCanonical({
      schema: CANVAS_MUTATION_ID_SCHEMA,
      dispatchOperationId,
      tool: 'canvas.mutate',
      action,
      role,
    })}`,
  );
}

export function plannedCanvasMutationIds(
  dispatchOperationId: string,
  inputValue: CanvasToolMutationInput,
): CanvasMutationPlannedIds {
  const input = CanvasMutateDefinition.parseInput(inputValue);
  return Object.freeze({
    tool: 'canvas.mutate',
    projectEventId: canvasMutationId(dispatchOperationId, input.action, 'project_event'),
    placementId:
      input.action === 'place'
        ? canvasMutationId(dispatchOperationId, input.action, 'placement')
        : null,
    groupId:
      input.action === 'group'
        ? canvasMutationId(dispatchOperationId, input.action, 'group')
        : null,
    edgeId:
      input.action === 'connect'
        ? canvasMutationId(dispatchOperationId, input.action, 'edge')
        : null,
    annotationId:
      input.action === 'annotate'
        ? canvasMutationId(dispatchOperationId, input.action, 'annotation')
        : null,
    viewId:
      input.action === 'save_view' && input.viewId === null
        ? canvasMutationId(dispatchOperationId, input.action, 'view')
        : null,
  });
}

function exactCanvasMutationIds(
  idsInput: CanvasMutationPlannedIds,
  input: CanvasToolMutationInput,
): CanvasMutationPlannedIds {
  if (idsInput.tool !== 'canvas.mutate') {
    throw invalidCanvasMutation('Canvas mutation planned IDs must be for canvas.mutate');
  }
  const ids = Object.freeze({
    tool: 'canvas.mutate' as const,
    projectEventId: parseCanonical(EntityIdSchema, idsInput.projectEventId),
    placementId:
      idsInput.placementId === null ? null : parseCanonical(EntityIdSchema, idsInput.placementId),
    groupId: idsInput.groupId === null ? null : parseCanonical(EntityIdSchema, idsInput.groupId),
    edgeId: idsInput.edgeId === null ? null : parseCanonical(EntityIdSchema, idsInput.edgeId),
    annotationId:
      idsInput.annotationId === null ? null : parseCanonical(EntityIdSchema, idsInput.annotationId),
    viewId: idsInput.viewId === null ? null : parseCanonical(EntityIdSchema, idsInput.viewId),
  });
  const expected = {
    placementId: input.action === 'place',
    groupId: input.action === 'group',
    edgeId: input.action === 'connect',
    annotationId: input.action === 'annotate',
    viewId: input.action === 'save_view' && input.viewId === null,
  } as const;
  for (const key of Object.keys(expected) as Array<keyof typeof expected>) {
    if ((ids[key] !== null) !== expected[key]) {
      throw invalidCanvasMutation(`Canvas mutation ${key} does not match its action`);
    }
  }
  const values = Object.values(ids).filter((value): value is string => typeof value === 'string');
  if (new Set(values).size !== values.length) {
    throw invalidCanvasMutation('Canvas mutation planned IDs must be unique');
  }
  return ids;
}

function coreCommandFromLegacy(
  environment: TargetStorageEnvironment,
  command: CanvasCommand,
): CanvasCoreCommand {
  switch (command.action) {
    case 'place':
      return {
        action: 'place',
        placementId: parseCanonical(EntityIdSchema, environment.createId('canvas_placement')),
        target: command.target,
        position: command.position,
        size: command.size,
        zIndex: command.zIndex,
      };
    case 'move':
      return { action: 'move', placementId: command.placementId, position: command.position };
    case 'resize':
      return { action: 'resize', placementId: command.placementId, size: command.size };
    case 'remove':
      return { action: 'remove', placementIds: command.placementIds };
    case 'group':
      return {
        action: 'group',
        groupId: command.groupId,
        title: command.title,
        placementIds: command.placementIds,
      };
    case 'ungroup':
      return { action: 'ungroup', groupId: command.groupId };
    case 'connect':
      return {
        action: 'connect',
        edgeId: command.edgeId,
        sourcePlacementId: command.sourcePlacementId,
        targetPlacementId: command.targetPlacementId,
        label: command.label,
      };
    case 'disconnect':
      return { action: 'disconnect', edgeId: command.edgeId };
    case 'annotate':
      return {
        action: 'annotate',
        annotationId: command.annotationId,
        placementId: command.placementId,
        text: command.text,
        geometry: command.geometry,
      };
    case 'save_view':
      return {
        action: 'save_view',
        viewId: command.viewId,
        name: command.name,
        viewport: command.viewport,
      };
    case 'restore_view':
      return { action: 'restore_view', viewId: command.viewId };
  }
}

function coreCommandFromTool(
  input: CanvasToolMutationInput,
  ids: CanvasMutationPlannedIds,
): CanvasCoreCommand {
  switch (input.action) {
    case 'place':
      return {
        action: 'place',
        placementId: ids.placementId!,
        target: input.target,
        position: input.geometry.position,
        size: input.geometry.size,
        zIndex: null,
      };
    case 'move':
      return { action: 'move', placementId: input.placementId, position: input.geometry.position };
    case 'resize':
      return { action: 'resize', placementId: input.placementId, size: input.geometry.size };
    case 'group':
      return {
        action: 'group',
        groupId: ids.groupId!,
        title: input.title,
        placementIds: input.placements.map(({ placementId }) => placementId),
      };
    case 'ungroup':
      return { action: 'ungroup', groupId: input.groupId };
    case 'connect':
      return {
        action: 'connect',
        edgeId: ids.edgeId!,
        sourcePlacementId: input.sourcePlacementId,
        targetPlacementId: input.targetPlacementId,
        label: input.label,
      };
    case 'disconnect':
      return { action: 'disconnect', edgeId: input.edgeId };
    case 'annotate':
      return {
        action: 'annotate',
        annotationId: ids.annotationId!,
        placementId: input.placementId,
        text: input.text,
        geometry: input.geometry,
      };
    case 'arrange':
      return {
        action: 'arrange',
        placementIds: input.placements.map(({ placementId }) => placementId),
        layout: input.layout,
        spacing: input.spacing,
      };
    case 'remove':
      return {
        action: 'remove',
        placementIds: input.placements.map(({ placementId }) => placementId),
      };
    case 'save_view':
      return {
        action: 'save_view',
        viewId: input.viewId ?? ids.viewId!,
        name: input.name,
        viewport: input.viewport,
      };
    case 'restore_view':
      return { action: 'restore_view', viewId: input.viewId };
  }
}

function arrangedPositions(
  canvas: CanvasDocument,
  placementIds: readonly string[],
  layout: Extract<CanvasToolMutationInput, { action: 'arrange' }>['layout'],
  spacing: number,
): ReadonlyMap<string, CanvasDocument['placements'][number]['position']> {
  const placements = placementIds.map(
    (placementId) => canvas.placements[placementIndex(canvas, placementId)]!,
  );
  const anchor = placements[0]!.position;
  const positions = new Map<string, CanvasDocument['placements'][number]['position']>();
  if (layout === 'row' || layout === 'timeline') {
    let x = anchor.x;
    for (const placement of placements) {
      positions.set(placement.id, { x, y: anchor.y });
      x += placement.size.width + spacing;
    }
    return positions;
  }
  if (layout === 'column') {
    let y = anchor.y;
    for (const placement of placements) {
      positions.set(placement.id, { x: anchor.x, y });
      y += placement.size.height + spacing;
    }
    return positions;
  }
  const columns = Math.ceil(Math.sqrt(placements.length));
  const rows = Math.ceil(placements.length / columns);
  const columnWidths = Array.from({ length: columns }, () => 0);
  const rowHeights = Array.from({ length: rows }, () => 0);
  for (const [index, placement] of placements.entries()) {
    const column = index % columns;
    const row = Math.floor(index / columns);
    columnWidths[column] = Math.max(columnWidths[column]!, placement.size.width);
    rowHeights[row] = Math.max(rowHeights[row]!, placement.size.height);
  }
  const columnXs: number[] = [];
  let x = anchor.x;
  for (const width of columnWidths) {
    columnXs.push(x);
    x += width + spacing;
  }
  const rowYs: number[] = [];
  let y = anchor.y;
  for (const height of rowHeights) {
    rowYs.push(y);
    y += height + spacing;
  }
  for (const [index, placement] of placements.entries()) {
    positions.set(placement.id, {
      x: columnXs[index % columns]!,
      y: rowYs[Math.floor(index / columns)]!,
    });
  }
  return positions;
}

function mutateCanvasCore(
  database: DatabaseSync,
  canvas: CanvasDocument,
  command: CanvasCoreCommand,
  now: string,
): CanvasDocument | null {
  switch (command.action) {
    case 'place': {
      const zIndex = command.zIndex ?? canvas.nextZIndex;
      if (zIndex === Number.MAX_SAFE_INTEGER) {
        throw invalidCanvasMutation('Canvas z-index cannot be MAX_SAFE_INTEGER');
      }
      return {
        ...canvas,
        placements: [
          ...canvas.placements,
          {
            id: command.placementId,
            target: bindTarget(database, canvas.projectId, command.target),
            position: command.position,
            size: command.size,
            zIndex,
            revision: 0,
            createdAt: now,
            updatedAt: now,
          },
        ],
        nextZIndex: Math.max(canvas.nextZIndex, zIndex + 1),
      };
    }
    case 'move': {
      const index = placementIndex(canvas, command.placementId);
      const current = canvas.placements[index]!;
      if (canonicalJson(current.position) === canonicalJson(command.position)) return null;
      const placements = [...canvas.placements];
      placements[index] = {
        ...current,
        position: command.position,
        revision: current.revision + 1,
        updatedAt: now,
      };
      return { ...canvas, placements };
    }
    case 'resize': {
      const index = placementIndex(canvas, command.placementId);
      const current = canvas.placements[index]!;
      if (canonicalJson(current.size) === canonicalJson(command.size)) return null;
      const placements = [...canvas.placements];
      placements[index] = {
        ...current,
        size: command.size,
        revision: current.revision + 1,
        updatedAt: now,
      };
      return { ...canvas, placements };
    }
    case 'remove': {
      const ids = new Set(uniqueIds(command.placementIds, 'Canvas remove command'));
      for (const id of ids) placementIndex(canvas, id);
      return {
        ...canvas,
        placements: canvas.placements.filter((placement) => !ids.has(placement.id)),
        groups: canvas.groups.map((group) => {
          const placementIds = group.placementIds.filter((id) => !ids.has(id));
          return placementIds.length === group.placementIds.length
            ? group
            : {
                ...group,
                placementIds,
                revision: group.revision + 1,
                updatedAt: now,
              };
        }),
        edges: canvas.edges.filter(
          (edge) => !ids.has(edge.sourcePlacementId) && !ids.has(edge.targetPlacementId),
        ),
        annotations: canvas.annotations.map((annotation) =>
          annotation.placementId !== null && ids.has(annotation.placementId)
            ? {
                ...annotation,
                placementId: null,
                revision: annotation.revision + 1,
                updatedAt: now,
              }
            : annotation,
        ),
      };
    }
    case 'group': {
      const placementIds = canonicalIds(command.placementIds, 'Canvas group command');
      for (const id of placementIds) placementIndex(canvas, id);
      for (const group of canvas.groups) {
        if (
          group.id !== command.groupId &&
          group.placementIds.some((placementId) => placementIds.includes(placementId))
        ) {
          throw invalidCanvasMutation('A Canvas placement cannot belong to more than one group');
        }
      }
      const index = canvas.groups.findIndex((group) => group.id === command.groupId);
      if (index < 0) {
        return {
          ...canvas,
          groups: [
            ...canvas.groups,
            {
              id: command.groupId,
              title: command.title,
              placementIds,
              revision: 0,
              createdAt: now,
              updatedAt: now,
            },
          ],
        };
      }
      const current = canvas.groups[index]!;
      if (
        current.title === command.title &&
        canonicalJson(current.placementIds) === canonicalJson(placementIds)
      ) {
        return null;
      }
      const groups = [...canvas.groups];
      groups[index] = {
        ...current,
        title: command.title,
        placementIds,
        revision: current.revision + 1,
        updatedAt: now,
      };
      return { ...canvas, groups };
    }
    case 'ungroup': {
      if (!canvas.groups.some((group) => group.id === command.groupId)) return null;
      return { ...canvas, groups: canvas.groups.filter((group) => group.id !== command.groupId) };
    }
    case 'connect': {
      if (command.sourcePlacementId === command.targetPlacementId) {
        throw invalidCanvasMutation('Canvas edge endpoints must differ');
      }
      placementIndex(canvas, command.sourcePlacementId);
      placementIndex(canvas, command.targetPlacementId);
      const index = canvas.edges.findIndex((edge) => edge.id === command.edgeId);
      if (index < 0) {
        return {
          ...canvas,
          edges: [
            ...canvas.edges,
            {
              id: command.edgeId,
              sourcePlacementId: command.sourcePlacementId,
              targetPlacementId: command.targetPlacementId,
              label: command.label,
              revision: 0,
              createdAt: now,
              updatedAt: now,
            },
          ],
        };
      }
      const current = canvas.edges[index]!;
      if (
        current.sourcePlacementId === command.sourcePlacementId &&
        current.targetPlacementId === command.targetPlacementId &&
        current.label === command.label
      ) {
        return null;
      }
      const edges = [...canvas.edges];
      edges[index] = {
        ...current,
        sourcePlacementId: command.sourcePlacementId,
        targetPlacementId: command.targetPlacementId,
        label: command.label,
        revision: current.revision + 1,
        updatedAt: now,
      };
      return { ...canvas, edges };
    }
    case 'disconnect': {
      if (!canvas.edges.some((edge) => edge.id === command.edgeId)) return null;
      return { ...canvas, edges: canvas.edges.filter((edge) => edge.id !== command.edgeId) };
    }
    case 'annotate': {
      if (command.placementId !== null) placementIndex(canvas, command.placementId);
      const index = canvas.annotations.findIndex(
        (annotation) => annotation.id === command.annotationId,
      );
      if (index < 0) {
        return {
          ...canvas,
          annotations: [
            ...canvas.annotations,
            {
              id: command.annotationId,
              placementId: command.placementId,
              text: command.text,
              geometry: command.geometry,
              revision: 0,
              createdAt: now,
              updatedAt: now,
            },
          ],
        };
      }
      const current = canvas.annotations[index]!;
      if (
        current.placementId === command.placementId &&
        current.text === command.text &&
        canonicalJson(current.geometry) === canonicalJson(command.geometry)
      ) {
        return null;
      }
      const annotations = [...canvas.annotations];
      annotations[index] = {
        ...current,
        placementId: command.placementId,
        text: command.text,
        geometry: command.geometry,
        revision: current.revision + 1,
        updatedAt: now,
      };
      return { ...canvas, annotations };
    }
    case 'arrange': {
      const placementIds = uniqueIds(command.placementIds, 'Canvas arrange command');
      const positions = arrangedPositions(canvas, placementIds, command.layout, command.spacing);
      let changed = false;
      const placements = canvas.placements.map((placement) => {
        const position = positions.get(placement.id);
        if (
          position === undefined ||
          canonicalJson(position) === canonicalJson(placement.position)
        ) {
          return placement;
        }
        changed = true;
        return {
          ...placement,
          position,
          revision: placement.revision + 1,
          updatedAt: now,
        };
      });
      return changed ? { ...canvas, placements } : null;
    }
    case 'save_view': {
      if (
        canvas.savedViews.some((view) => view.id !== command.viewId && view.name === command.name)
      ) {
        throw invalidCanvasMutation(`Canvas view name already exists: ${command.name}`);
      }
      const index = canvas.savedViews.findIndex((view) => view.id === command.viewId);
      if (index < 0) {
        return {
          ...canvas,
          savedViews: [
            ...canvas.savedViews,
            {
              id: command.viewId,
              name: command.name,
              viewport: command.viewport,
              revision: 0,
              createdAt: now,
            },
          ],
        };
      }
      const current = canvas.savedViews[index]!;
      if (
        current.name === command.name &&
        canonicalJson(current.viewport) === canonicalJson(command.viewport)
      ) {
        return null;
      }
      const savedViews = [...canvas.savedViews];
      savedViews[index] = {
        ...current,
        name: command.name,
        viewport: command.viewport,
        revision: current.revision + 1,
      };
      return { ...canvas, savedViews };
    }
    case 'restore_view': {
      const view = canvas.savedViews.find((candidate) => candidate.id === command.viewId);
      if (view === undefined) {
        throw new TargetStorageError(
          'NOT_FOUND',
          `Canvas saved view ${command.viewId} was not found`,
        );
      }
      return canonicalJson(canvas.viewport) === canonicalJson(view.viewport)
        ? null
        : { ...canvas, viewport: view.viewport };
    }
  }
}

function requirePlacementRevision(
  canvas: CanvasDocument,
  ref: CanvasPlacementRef,
): CanvasDocument['placements'][number] {
  const placement = canvas.placements[placementIndex(canvas, ref.placementId)]!;
  if (placement.revision !== ref.revision) {
    throw new TargetStorageError(
      'REVISION_CONFLICT',
      `Canvas placement ${placement.id} revision changed`,
    );
  }
  return placement;
}

function requirePlacementRevisions(
  canvas: CanvasDocument,
  refs: readonly CanvasPlacementRef[],
): void {
  uniqueIds(
    refs.map(({ placementId }) => placementId),
    'Canvas placement revisions',
  );
  for (const ref of refs) requirePlacementRevision(canvas, ref);
}

function requireGroupRevision(
  canvas: CanvasDocument,
  groupId: string,
  expectedRevision: number,
): CanvasDocument['groups'][number] {
  const group = canvas.groups.find((candidate) => candidate.id === groupId);
  if (group === undefined)
    throw new TargetStorageError('NOT_FOUND', `Canvas group ${groupId} was not found`);
  if (group.revision !== expectedRevision) {
    throw new TargetStorageError('REVISION_CONFLICT', `Canvas group ${groupId} revision changed`);
  }
  return group;
}

function requireEdgeRevision(
  canvas: CanvasDocument,
  edgeId: string,
  expectedRevision: number,
): CanvasDocument['edges'][number] {
  const edge = canvas.edges.find((candidate) => candidate.id === edgeId);
  if (edge === undefined)
    throw new TargetStorageError('NOT_FOUND', `Canvas edge ${edgeId} was not found`);
  if (edge.revision !== expectedRevision) {
    throw new TargetStorageError('REVISION_CONFLICT', `Canvas edge ${edgeId} revision changed`);
  }
  return edge;
}

function requireViewRevision(
  canvas: CanvasDocument,
  viewId: string,
  expectedRevision: number,
): CanvasDocument['savedViews'][number] {
  const view = canvas.savedViews.find((candidate) => candidate.id === viewId);
  if (view === undefined) {
    throw new TargetStorageError('NOT_FOUND', `Canvas saved view ${viewId} was not found`);
  }
  if (view.revision !== expectedRevision) {
    throw new TargetStorageError(
      'REVISION_CONFLICT',
      `Canvas saved view ${viewId} revision changed`,
    );
  }
  return view;
}

function assertCanvasToolInputCurrent(
  canvas: CanvasDocument,
  input: CanvasToolMutationInput,
): void {
  if (canvas.revision !== input.expectedCanvasRevision) {
    throw new TargetStorageError('REVISION_CONFLICT', `Canvas ${canvas.id} revision changed`);
  }
  switch (input.action) {
    case 'place':
    case 'save_view':
      return;
    case 'move':
    case 'resize':
      requirePlacementRevision(canvas, {
        placementId: input.placementId,
        revision: input.expectedPlacementRevision,
      });
      return;
    case 'group':
    case 'arrange':
    case 'remove':
      requirePlacementRevisions(canvas, input.placements);
      return;
    case 'ungroup':
      requireGroupRevision(canvas, input.groupId, input.expectedGroupRevision);
      return;
    case 'connect':
      if (input.sourcePlacementId === input.targetPlacementId) {
        throw invalidCanvasMutation('Canvas edge endpoints must differ');
      }
      placementIndex(canvas, input.sourcePlacementId);
      placementIndex(canvas, input.targetPlacementId);
      return;
    case 'disconnect':
      requireEdgeRevision(canvas, input.edgeId, input.expectedEdgeRevision);
      return;
    case 'annotate':
      if (input.placementId !== null) placementIndex(canvas, input.placementId);
      return;
    case 'restore_view':
      requireViewRevision(canvas, input.viewId, input.expectedViewRevision);
      return;
  }
}

function canvasReceipt(
  kind: CanvasToolKind,
  id: string,
  revision: number,
  previousRevision: number | null,
  eventId: string,
  changedPaths: readonly string[],
): CanvasToolMutationReceipt {
  return {
    object: { kind, id, revision },
    previousRevision,
    eventId,
    changedPaths: [...changedPaths],
    undoRef: null,
  } as CanvasToolMutationReceipt;
}

function afterCanvasObject<
  Key extends 'placements' | 'groups' | 'edges' | 'annotations' | 'savedViews',
>(canvas: CanvasDocument, key: Key, id: string): CanvasDocument[Key][number] {
  const value = canvas[key].find((candidate) => candidate.id === id);
  if (value === undefined)
    throw corruptCanvasMutation(`Canvas ${key}:${id} is missing from its plan`);
  return value;
}

function canvasToolMutationReceipts(
  before: CanvasDocument,
  after: CanvasDocument,
  input: CanvasToolMutationInput,
  eventId: string,
): readonly CanvasToolMutationReceipt[] {
  let receipts: CanvasToolMutationReceipt[];
  switch (input.action) {
    case 'place': {
      const placement = afterCanvasObject(after, 'placements', after.placements.at(-1)?.id ?? '');
      receipts = [
        canvasReceipt('placement', placement.id, placement.revision, null, eventId, [
          'target',
          'position',
          'size',
          'zIndex',
        ]),
      ];
      break;
    }
    case 'move': {
      const placement = afterCanvasObject(after, 'placements', input.placementId);
      receipts = [
        canvasReceipt(
          'placement',
          placement.id,
          placement.revision,
          placement.revision - 1,
          eventId,
          ['position'],
        ),
      ];
      break;
    }
    case 'resize': {
      const placement = afterCanvasObject(after, 'placements', input.placementId);
      receipts = [
        canvasReceipt(
          'placement',
          placement.id,
          placement.revision,
          placement.revision - 1,
          eventId,
          ['size'],
        ),
      ];
      break;
    }
    case 'group': {
      const group = after.groups.find(
        (candidate) => !before.groups.some((beforeGroup) => beforeGroup.id === candidate.id),
      );
      if (group === undefined)
        throw corruptCanvasMutation('Canvas group plan has no created group');
      receipts = [
        canvasReceipt('group', group.id, group.revision, null, eventId, ['title', 'placementIds']),
      ];
      break;
    }
    case 'ungroup': {
      const group = before.groups.find((candidate) => candidate.id === input.groupId);
      if (group === undefined)
        throw corruptCanvasMutation(`Canvas group ${input.groupId} is missing`);
      receipts = [
        canvasReceipt('group', group.id, group.revision + 1, group.revision, eventId, [
          'deleted',
          'placementIds',
        ]),
      ];
      break;
    }
    case 'connect': {
      const edge = after.edges.find(
        (candidate) => !before.edges.some((beforeEdge) => beforeEdge.id === candidate.id),
      );
      if (edge === undefined) throw corruptCanvasMutation('Canvas edge plan has no created edge');
      receipts = [
        canvasReceipt('edge', edge.id, edge.revision, null, eventId, [
          'sourcePlacementId',
          'targetPlacementId',
          'label',
        ]),
      ];
      break;
    }
    case 'disconnect': {
      const edge = before.edges.find((candidate) => candidate.id === input.edgeId);
      if (edge === undefined) throw corruptCanvasMutation(`Canvas edge ${input.edgeId} is missing`);
      receipts = [
        canvasReceipt('edge', edge.id, edge.revision + 1, edge.revision, eventId, [
          'deleted',
          'sourcePlacementId',
          'targetPlacementId',
        ]),
      ];
      break;
    }
    case 'annotate': {
      const annotation = after.annotations.find(
        (candidate) =>
          !before.annotations.some((beforeAnnotation) => beforeAnnotation.id === candidate.id),
      );
      if (annotation === undefined)
        throw corruptCanvasMutation('Canvas annotation plan has no created annotation');
      receipts = [
        canvasReceipt('annotation', annotation.id, annotation.revision, null, eventId, [
          'placementId',
          'text',
          'geometry',
        ]),
      ];
      break;
    }
    case 'arrange':
      receipts = input.placements.flatMap(({ placementId }) => {
        const beforePlacement = before.placements.find((candidate) => candidate.id === placementId);
        const afterPlacement = after.placements.find((candidate) => candidate.id === placementId);
        if (beforePlacement === undefined || afterPlacement === undefined) {
          throw corruptCanvasMutation(
            `Canvas placement ${placementId} is missing from arrange plan`,
          );
        }
        return beforePlacement.revision === afterPlacement.revision
          ? []
          : [
              canvasReceipt(
                'placement',
                afterPlacement.id,
                afterPlacement.revision,
                beforePlacement.revision,
                eventId,
                ['position'],
              ),
            ];
      });
      break;
    case 'remove': {
      const removedIds = new Set(input.placements.map(({ placementId }) => placementId));
      const removedPlacements = input.placements.map(({ placementId }) => {
        const placement = before.placements.find((candidate) => candidate.id === placementId);
        if (placement === undefined)
          throw corruptCanvasMutation(`Canvas placement ${placementId} is missing`);
        return canvasReceipt(
          'placement',
          placement.id,
          placement.revision + 1,
          placement.revision,
          eventId,
          ['deleted'],
        );
      });
      const changedGroups = before.groups
        .filter((group) => group.placementIds.some((placementId) => removedIds.has(placementId)))
        .map((group) => {
          const persisted = afterCanvasObject(after, 'groups', group.id);
          return canvasReceipt('group', persisted.id, persisted.revision, group.revision, eventId, [
            'placementIds',
          ]);
        });
      const removedEdges = before.edges
        .filter(
          (edge) =>
            removedIds.has(edge.sourcePlacementId) || removedIds.has(edge.targetPlacementId),
        )
        .map((edge) =>
          canvasReceipt('edge', edge.id, edge.revision + 1, edge.revision, eventId, [
            'deleted',
            'sourcePlacementId',
            'targetPlacementId',
          ]),
        );
      const detachedAnnotations = before.annotations
        .filter(
          (annotation) => annotation.placementId !== null && removedIds.has(annotation.placementId),
        )
        .map((annotation) => {
          const persisted = afterCanvasObject(after, 'annotations', annotation.id);
          return canvasReceipt(
            'annotation',
            persisted.id,
            persisted.revision,
            annotation.revision,
            eventId,
            ['placementId'],
          );
        });
      receipts = [...removedPlacements, ...changedGroups, ...removedEdges, ...detachedAnnotations];
      break;
    }
    case 'save_view': {
      const view =
        input.viewId === null
          ? after.savedViews.find(
              (candidate) =>
                !before.savedViews.some((beforeView) => beforeView.id === candidate.id),
            )
          : after.savedViews.find((candidate) => candidate.id === input.viewId);
      if (view === undefined)
        throw corruptCanvasMutation('Canvas saved-view plan has no saved view');
      const beforeView = before.savedViews.find((candidate) => candidate.id === view.id);
      receipts = [
        canvasReceipt('saved_view', view.id, view.revision, beforeView?.revision ?? null, eventId, [
          'name',
          'viewport',
        ]),
      ];
      break;
    }
    case 'restore_view': {
      const view = before.savedViews.find((candidate) => candidate.id === input.viewId);
      if (view === undefined)
        throw corruptCanvasMutation(`Canvas saved view ${input.viewId} is missing`);
      receipts = [
        canvasReceipt('saved_view', view.id, view.revision, view.revision, eventId, ['viewport']),
      ];
      break;
    }
  }
  if (receipts.length === 0) throw invalidCanvasMutation('Canvas mutation has no semantic changes');
  if (receipts.length > MAX_MUTATION_BATCH) {
    throw invalidCanvasMutation('Canvas mutation affects more objects than its receipt limit');
  }
  return CanvasMutateDefinition.parseSuccess({
    canvasRevision: after.revision,
    canvasContentHash: after.contentHash,
    receipts,
  }).receipts;
}

export function planCanvasMutationInTransaction(
  database: DatabaseSync,
  environment: TargetStorageEnvironment,
  projectIdValue: string,
  inputValue: CanvasToolMutationInput,
  occurredAtInput: string,
  plannedIdsInput: CanvasMutationPlannedIds,
): PlannedCanvasMutation {
  if (!database.isTransaction) {
    throw invalidCanvasMutation('Canvas mutation planning requires an active transaction');
  }
  const projectId = parseCanonical(EntityIdSchema, projectIdValue);
  const input = CanvasMutateDefinition.parseInput(inputValue);
  const occurredAt = parseCanonical(IsoTimestampSchema, occurredAtInput);
  const ids = exactCanvasMutationIds(plannedIdsInput, input);
  const before = loadCanvasByProject(database, projectId);
  assertCanvasToolInputCurrent(before, input);
  const changed = mutateCanvasCore(database, before, coreCommandFromTool(input, ids), occurredAt);
  if (changed === null) throw invalidCanvasMutation('Canvas mutation has no semantic changes');
  const { contentHash: _contentHash, ...value } = changed;
  const after = finalizeCanvas({
    ...value,
    revision: before.revision + 1,
    updatedAt: occurredAt,
  });
  return Object.freeze({
    projectId,
    input,
    occurredAt,
    before,
    after,
    ids,
    receipts: canvasToolMutationReceipts(before, after, input, ids.projectEventId),
  });
}

function assertCanvasMutationPlanCurrent(
  database: DatabaseSync,
  environment: TargetStorageEnvironment,
  planned: PlannedCanvasMutation,
): void {
  let current: PlannedCanvasMutation;
  try {
    current = planCanvasMutationInTransaction(
      database,
      environment,
      planned.projectId,
      planned.input,
      planned.occurredAt,
      planned.ids,
    );
  } catch (cause) {
    if (cause instanceof TargetStorageError && cause.code === 'CORRUPT_DATA') throw cause;
    throw new TargetStorageError('REVISION_CONFLICT', 'Canvas mutation changed before commit', {
      cause,
    });
  }
  if (canonicalJson(current) !== canonicalJson(planned)) {
    throw new TargetStorageError('REVISION_CONFLICT', 'Canvas mutation changed before commit');
  }
}

export function commitPlannedCanvasMutationInTransaction(
  database: DatabaseSync,
  environment: TargetStorageEnvironment,
  planned: PlannedCanvasMutation,
  contextInput: TargetCommandContext,
): CommittedCanvasMutation {
  if (!database.isTransaction) {
    throw invalidCanvasMutation('Canvas mutation commit requires an active transaction');
  }
  const context = parseCanonical(TargetCommandContextSchema, contextInput);
  assertCanvasMutationPlanCurrent(database, environment, planned);
  replaceCanvas(database, planned.before, planned.after);
  const canvas = loadCanvasByProject(database, planned.projectId);
  if (canonicalJson(canvas) !== canonicalJson(planned.after)) {
    throw corruptCanvasMutation(`Canvas ${planned.after.id} persisted outside its mutation plan`);
  }
  appendProjectEvent(database, {
    eventId: planned.ids.projectEventId,
    projectId: canvas.projectId,
    occurredAt: planned.occurredAt,
    actor: context.actor,
    subject: { authority: 'canvas', id: canvas.id },
    causation: context.causation,
    correlationId: context.correlationId,
    idempotencyKey: planned.ids.projectEventId,
    payload: {
      type: 'object_revision_changed',
      beforeRevision: planned.before.revision,
      afterRevision: canvas.revision,
      beforeHash: planned.before.contentHash,
      afterHash: canvas.contentHash,
    },
  });
  return Object.freeze({
    canvas,
    receipts: planned.receipts,
    projectEventId: planned.ids.projectEventId,
  });
}

export function canvasMutationToolSuccess(
  committed: CommittedCanvasMutation,
): CanvasToolMutationSuccess {
  return CanvasMutateDefinition.parseSuccess({
    canvasRevision: committed.canvas.revision,
    canvasContentHash: committed.canvas.contentHash,
    receipts: committed.receipts,
  });
}

function decodeCanvasToolCursor(cursor: string | null) {
  if (cursor === null) return null;
  try {
    const encoded = decodeCursor(cursor, CanvasQueryDefinition.id);
    if (encoded === null) throw new Error('Missing cursor payload');
    return parseCanonical(CanvasToolCursorSchema, JSON.parse(encoded) as unknown);
  } catch (cause) {
    throw new TargetStorageError('INVALID_REQUEST', 'Canvas tool query cursor is invalid', {
      cause,
    });
  }
}

function encodeCanvasToolCursor(value: unknown): string {
  return encodeCursor(
    CanvasQueryDefinition.id,
    canonicalJson(parseCanonical(CanvasToolCursorSchema, value)),
  );
}

function compareCanvasToolOrder(
  left: { readonly kind: CanvasToolKind; readonly id: string },
  right: { readonly kind: CanvasToolKind; readonly id: string },
): number {
  const kindDifference = CANVAS_TOOL_KIND_RANK[left.kind] - CANVAS_TOOL_KIND_RANK[right.kind];
  if (kindDifference !== 0) return kindDifference;
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

function intersectsCanvasGeometry(
  left: {
    readonly position: { readonly x: number; readonly y: number };
    readonly size: { readonly width: number; readonly height: number };
  },
  right: {
    readonly position: { readonly x: number; readonly y: number };
    readonly size: { readonly width: number; readonly height: number };
  },
): boolean {
  return (
    left.position.x <= right.position.x + right.size.width &&
    left.position.x + left.size.width >= right.position.x &&
    left.position.y <= right.position.y + right.size.height &&
    left.position.y + left.size.height >= right.position.y
  );
}

function sameCanvasTarget(
  placement: CanvasDocument['placements'][number],
  target: CanvasToolQueryInput['targetRefs'][number],
): boolean {
  return (
    placement.target.targetType === target.authority &&
    placement.target.targetId === target.id &&
    placement.target.targetRevision === target.revision &&
    placement.target.targetContentHash === target.contentHash
  );
}

function canvasPlacementToolItem(
  placement: CanvasDocument['placements'][number],
): CanvasToolQueryItem {
  return {
    object: { kind: 'placement', id: placement.id, revision: placement.revision },
    target: placement.target,
    position: placement.position,
    size: placement.size,
    zIndex: placement.zIndex,
  };
}

function canvasGroupToolItem(group: CanvasDocument['groups'][number]): CanvasToolQueryItem {
  return {
    object: { kind: 'group', id: group.id, revision: group.revision },
    title: group.title,
    placementIds: group.placementIds,
  };
}

function canvasEdgeToolItem(edge: CanvasDocument['edges'][number]): CanvasToolQueryItem {
  return {
    object: { kind: 'edge', id: edge.id, revision: edge.revision },
    sourcePlacementId: edge.sourcePlacementId,
    targetPlacementId: edge.targetPlacementId,
    label: edge.label,
  };
}

function canvasAnnotationToolItem(
  annotation: CanvasDocument['annotations'][number],
): CanvasToolQueryItem {
  return {
    object: { kind: 'annotation', id: annotation.id, revision: annotation.revision },
    placementId: annotation.placementId,
    text: annotation.text,
    geometry: annotation.geometry,
  };
}

function canvasSavedViewToolItem(view: CanvasDocument['savedViews'][number]): CanvasToolQueryItem {
  return {
    object: { kind: 'saved_view', id: view.id, revision: view.revision },
    name: view.name,
    viewport: view.viewport,
  };
}

function queryCanvasTool(
  database: DatabaseSync,
  projectIdValue: string,
  inputValue: CanvasToolQueryInput,
): CanvasToolQuerySuccess {
  const projectId = parseCanonical(EntityIdSchema, projectIdValue);
  const input = CanvasQueryDefinition.parseInput(inputValue);
  const canvas = loadCanvasByProject(database, projectId);
  const targetRefs = [...input.targetRefs].sort((left, right) => {
    const leftValue = canonicalJson(left);
    const rightValue = canonicalJson(right);
    return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
  });
  const filterHash = hashCanonical({
    projectId,
    bounds: input.bounds,
    targetRefs,
    groupIds: [...input.groupIds].sort(),
    edgeIds: [...input.edgeIds].sort(),
    include: input.include,
  });
  const cursor = decodeCanvasToolCursor(input.page.cursor);
  if (
    cursor !== null &&
    (cursor.projectId !== projectId ||
      cursor.filterHash !== filterHash ||
      cursor.canvasRevision !== canvas.revision ||
      cursor.canvasContentHash !== canvas.contentHash)
  ) {
    throw new TargetStorageError('INVALID_REQUEST', 'Canvas tool query cursor is stale');
  }

  const hasPlacementGraphFilters =
    input.targetRefs.length > 0 || input.groupIds.length > 0 || input.edgeIds.length > 0;
  const hasPlacementSelection = hasPlacementGraphFilters || input.bounds !== null;
  const groupIds = new Set(input.groupIds);
  const edgeIds = new Set(input.edgeIds);
  const groupMemberIds = new Set(
    canvas.groups.filter((group) => groupIds.has(group.id)).flatMap((group) => group.placementIds),
  );
  const edgeEndpointIds = new Set(
    canvas.edges
      .filter((edge) => edgeIds.has(edge.id))
      .flatMap((edge) => [edge.sourcePlacementId, edge.targetPlacementId]),
  );
  const selectedPlacementIds = new Set(
    canvas.placements
      .filter(
        (placement) =>
          (input.targetRefs.length === 0 ||
            input.targetRefs.some((target) => sameCanvasTarget(placement, target))) &&
          (input.groupIds.length === 0 || groupMemberIds.has(placement.id)) &&
          (input.edgeIds.length === 0 || edgeEndpointIds.has(placement.id)) &&
          (input.bounds === null || intersectsCanvasGeometry(placement, input.bounds)),
      )
      .map((placement) => placement.id),
  );

  const items: CanvasToolQueryItem[] = [];
  if (input.include.includes('placements')) {
    items.push(
      ...canvas.placements
        .filter((placement) => selectedPlacementIds.has(placement.id))
        .map(canvasPlacementToolItem),
    );
  }
  if (input.include.includes('groups')) {
    items.push(
      ...canvas.groups
        .filter(
          (group) =>
            (input.groupIds.length === 0 || groupIds.has(group.id)) &&
            (!hasPlacementSelection ||
              group.placementIds.some((placementId) => selectedPlacementIds.has(placementId))),
        )
        .map(canvasGroupToolItem),
    );
  }
  if (input.include.includes('edges')) {
    items.push(
      ...canvas.edges
        .filter(
          (edge) =>
            (input.edgeIds.length === 0 || edgeIds.has(edge.id)) &&
            selectedPlacementIds.has(edge.sourcePlacementId) &&
            selectedPlacementIds.has(edge.targetPlacementId),
        )
        .map(canvasEdgeToolItem),
    );
  }
  if (input.include.includes('annotations')) {
    items.push(
      ...canvas.annotations
        .filter((annotation) => {
          if (annotation.placementId !== null) {
            return selectedPlacementIds.has(annotation.placementId);
          }
          return (
            !hasPlacementGraphFilters &&
            (input.bounds === null ||
              (annotation.geometry !== null &&
                intersectsCanvasGeometry(annotation.geometry, input.bounds)))
          );
        })
        .map(canvasAnnotationToolItem),
    );
  }
  if (input.include.includes('saved_views') && !hasPlacementGraphFilters) {
    items.push(...canvas.savedViews.map(canvasSavedViewToolItem));
  }
  items.sort((left, right) => compareCanvasToolOrder(left.object, right.object));
  const afterCursor =
    cursor === null
      ? items
      : items.filter((item) => compareCanvasToolOrder(item.object, cursor) > 0);
  const pageItems = afterCursor.slice(0, input.page.limit);
  const last = pageItems.at(-1);
  return CanvasQueryDefinition.parseSuccess({
    canvasRevision: canvas.revision,
    canvasContentHash: canvas.contentHash,
    page: {
      items: pageItems,
      nextCursor:
        afterCursor.length > pageItems.length && last !== undefined
          ? encodeCanvasToolCursor({
              projectId,
              filterHash,
              canvasRevision: canvas.revision,
              canvasContentHash: canvas.contentHash,
              kind: last.object.kind,
              id: last.object.id,
            })
          : null,
    },
  });
}

function applyCanvas(
  database: DatabaseSync,
  environment: TargetStorageEnvironment,
  request: Request<'canvas.apply'>,
  context: TargetCommandContext,
): Success<'canvas.apply'> {
  const now = environment.now();
  return executeWireMutation(database, request, context, now, () => {
    const before = loadCanvasByProject(database, request.input.projectId);
    if (before.revision !== request.input.expectedCanvasRevision) {
      throw new TargetStorageError('REVISION_CONFLICT', `Canvas ${before.id} revision changed`);
    }
    const changed = mutateCanvasCore(
      database,
      before,
      coreCommandFromLegacy(environment, request.input.command),
      now,
    );
    if (changed === null) {
      return { projectId: before.projectId, response: success<'canvas.apply'>(request, before) };
    }
    const { contentHash: _contentHash, ...value } = changed;
    const after = finalizeCanvas({
      ...value,
      revision: before.revision + 1,
      updatedAt: now,
    });
    replaceCanvas(database, before, after);
    appendProjectEvent(database, {
      eventId: environment.createId('project_event'),
      projectId: after.projectId,
      occurredAt: now,
      actor: context.actor,
      subject: { authority: 'canvas', id: after.id },
      causation: context.causation,
      correlationId: context.correlationId,
      idempotencyKey: request.requestId,
      payload: {
        type: 'object_revision_changed',
        beforeRevision: before.revision,
        afterRevision: after.revision,
        beforeHash: before.contentHash,
        afterHash: after.contentHash,
      },
    });
    return { projectId: after.projectId, response: success<'canvas.apply'>(request, after) };
  });
}

function mutateCanvasTool(
  database: DatabaseSync,
  environment: TargetStorageEnvironment,
  projectId: string,
  input: CanvasToolMutationInput,
  context: TargetCommandContext,
  options: CanvasToolMutationOptions,
): CanvasToolMutationSuccess {
  const occurredAt = options?.occurredAt ?? environment.now();
  return withImmediateTransaction(database, () =>
    canvasMutationToolSuccess(
      commitPlannedCanvasMutationInTransaction(
        database,
        environment,
        planCanvasMutationInTransaction(
          database,
          environment,
          projectId,
          input,
          occurredAt,
          plannedCanvasMutationIds(options.dispatchOperationId, input),
        ),
        context,
      ),
    ),
  );
}

export interface CanvasAuthority {
  readonly apply: (
    request: Request<'canvas.apply'>,
    context: TargetCommandContext,
  ) => Success<'canvas.apply'>;
  readonly get: (request: Request<'canvas.get'>) => Success<'canvas.get'>;
  readonly queryTool: (projectId: string, input: CanvasToolQueryInput) => CanvasToolQuerySuccess;
  readonly mutateTool: (
    projectId: string,
    input: CanvasToolMutationInput,
    context: TargetCommandContext,
    options: CanvasToolMutationOptions,
  ) => CanvasToolMutationSuccess;
}

export function createCanvasAuthority(
  store: TargetStore,
  environment: TargetStorageEnvironment,
): CanvasAuthority {
  const authority: CanvasAuthority = {
    apply(request, context) {
      return applyCanvas(
        getTargetStoreDatabase(store),
        environment,
        exactRequest(request, 'canvas.apply'),
        context,
      );
    },
    get(request) {
      const parsed = exactRequest(request, 'canvas.get');
      return success<'canvas.get'>(
        parsed,
        loadCanvasByProject(getTargetStoreDatabase(store), parsed.input.projectId),
      );
    },
    queryTool(projectId, input) {
      return queryCanvasTool(getTargetStoreDatabase(store), projectId, input);
    },
    mutateTool(projectId, input, context, options) {
      return mutateCanvasTool(
        getTargetStoreDatabase(store),
        environment,
        projectId,
        input,
        context,
        options,
      );
    },
  };
  return Object.freeze(authority);
}
