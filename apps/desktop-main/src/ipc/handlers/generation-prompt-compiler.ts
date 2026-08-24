import { randomUUID } from 'node:crypto';
import type {
  Canvas,
  CanvasEdge,
  CanvasNode,
  Equipment,
  EquipmentRef,
  GenerationEntityRef,
  ImageNodeData,
  Location,
  LocationRef,
  PresetCategory,
  PresetDefinition,
  PresetTrack,
  PresetTrackSet,
  StyleGuide,
  VideoNodeData,
} from '@lucid-fin/contracts';
import {
  createEmptyPresetTrackSet,
  normalizeCharacterRefSlot,
  normalizeLocationRefSlot,
} from '@lucid-fin/contracts';
import type { ResolvedCharacter } from '@lucid-fin/application';
import type { SqliteIndex } from '@lucid-fin/storage';
import { tryCharacterId, tryEquipmentId, tryLocationId } from '@lucid-fin/contracts-parse';
import {
  STYLE_GUIDE_LIGHTING_PRESET_NAMES,
  normalizeOptionalString,
  normalizePresetLookupValue,
} from './generation-helpers.js';
import { loadStyleGuide } from './style.handlers.js';

// ---------------------------------------------------------------------------
// Style guide loading
// ---------------------------------------------------------------------------

export function loadCurrentProjectStyleGuide(db: SqliteIndex): StyleGuide {
  return loadStyleGuide(db);
}

// ---------------------------------------------------------------------------
// Preset track / style guide defaults
// ---------------------------------------------------------------------------

type TrackMap = Record<PresetCategory, PresetTrack>;

export function applyStyleGuideDefaultsToEmptyTracks(
  tracks: PresetTrackSet | undefined,
  styleGuide: StyleGuide,
  presetLibrary: PresetDefinition[],
): PresetTrackSet {
  const next = structuredClone(tracks ?? createEmptyPresetTrackSet()) as TrackMap;
  const lookPresetId = findStyleGuidePresetId('look', styleGuide.global.artStyle, presetLibrary);
  const scenePresetId = findStyleGuidePresetId(
    'scene',
    STYLE_GUIDE_LIGHTING_PRESET_NAMES[styleGuide.global.lighting],
    presetLibrary,
  );

  maybeFillTrack(next, 'look', lookPresetId);
  maybeFillTrack(next, 'scene', scenePresetId);

  return next as PresetTrackSet;
}

function maybeFillTrack(
  tracks: TrackMap,
  category: PresetCategory,
  presetId: string | undefined,
): void {
  if (!presetId) return;
  const current = tracks[category];
  if (current?.entries.length) return;
  tracks[category] = {
    category,
    entries: [
      {
        id: randomUUID(),
        category,
        presetId,
        params: {},
        order: 0,
      },
    ],
  };
}

function findStyleGuidePresetId(
  category: PresetCategory,
  rawValue: string | undefined,
  presetLibrary: PresetDefinition[],
): string | undefined {
  const normalizedValue = normalizePresetLookupValue(rawValue);
  if (!normalizedValue) return undefined;

  const candidates = presetLibrary.filter((preset) => preset.category === category);
  const exactMatch = candidates.find((preset) => {
    return [
      normalizePresetLookupValue(preset.name),
      normalizePresetLookupValue(getPresetSemanticName(preset)),
    ].includes(normalizedValue);
  });
  if (exactMatch) return exactMatch.id;

  const fuzzyMatches = candidates.filter((preset) => {
    const presetKeys = [
      normalizePresetLookupValue(preset.name),
      normalizePresetLookupValue(getPresetSemanticName(preset)),
    ].filter(Boolean);
    return presetKeys.some((key) => key.includes(normalizedValue) || normalizedValue.includes(key));
  });
  return fuzzyMatches.length === 1 ? fuzzyMatches[0]?.id : undefined;
}

function getPresetSemanticName(preset: PresetDefinition): string {
  const builtInPrefix = `builtin-${preset.category}-`;
  if (preset.id.startsWith(builtInPrefix)) return preset.id.slice(builtInPrefix.length);
  const separator = preset.id.indexOf(':');
  return separator >= 0 ? preset.id.slice(separator + 1) : preset.id;
}

// ---------------------------------------------------------------------------
// Node data type guards
// ---------------------------------------------------------------------------

export function hasPresetTracks(data: unknown): data is { presetTracks?: PresetTrackSet } {
  return typeof data === 'object' && data !== null && 'presetTracks' in data;
}

export function hasCharacterRefs(
  data: unknown,
): data is { characterRefs?: ImageNodeData['characterRefs'] } {
  return typeof data === 'object' && data !== null && 'characterRefs' in data;
}

export function hasEquipmentRefs(
  data: unknown,
): data is { equipmentRefs?: ImageNodeData['equipmentRefs'] } {
  return typeof data === 'object' && data !== null && 'equipmentRefs' in data;
}

export function hasLocationRefs(data: unknown): data is { locationRefs?: LocationRef[] } {
  return typeof data === 'object' && data !== null && 'locationRefs' in data;
}

// ---------------------------------------------------------------------------
// Reference image resolution
// ---------------------------------------------------------------------------

export interface ResolvedEntityRefsAndImages {
  referenceImages: string[];
  referenceBindings: Array<{
    entityType: 'character' | 'equipment' | 'location';
    entityId: string;
    imageHash: string;
  }>;
  characterRefs?: GenerationEntityRef[];
  equipmentRefs?: GenerationEntityRef[];
  locationRefs?: GenerationEntityRef[];
}

export class EntityReferenceResolutionError extends Error {
  readonly code = 'ENTITY_REFERENCE_INVALID';

  constructor(
    readonly details: {
      nodeId: string;
      entityType: 'character' | 'equipment' | 'location';
      entityId: string;
      selector?: string;
      reason: 'invalid-id' | 'entity-not-found' | 'no-images' | 'ambiguous' | 'selector-not-found';
    },
    message: string,
  ) {
    super(message);
    this.name = 'EntityReferenceResolutionError';
  }
}

type EntityReferenceImage = {
  slot?: string;
  assetHash?: string;
  variants?: string[];
};

type EntityReferenceContext = {
  nodeId: string;
  entityType: 'character' | 'equipment' | 'location';
  entityId: string;
};

function normalizeReferenceSlot(slot: string | undefined): string {
  return (slot ?? '')
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, '-')
    .replace(/-+/g, '-');
}

function referenceError(
  context: EntityReferenceContext,
  reason: EntityReferenceResolutionError['details']['reason'],
  message: string,
  selector?: string,
): EntityReferenceResolutionError {
  return new EntityReferenceResolutionError(
    { ...context, ...(selector ? { selector } : {}), reason },
    `Node "${context.nodeId}" ${context.entityType} reference "${context.entityId}": ${message}`,
  );
}

function resolveRefImageHashes(
  entity: { referenceImages?: EntityReferenceImage[] },
  ref: { angleSlot?: string; referenceImageHash?: string },
  context: EntityReferenceContext,
  normalizeSlot?: (s: string | undefined) => string | undefined,
): string[] {
  const images = entity.referenceImages ?? [];
  const activeImages = images.flatMap((image) => {
    const assetHash = normalizeOptionalString(image.assetHash);
    return assetHash ? [{ image, assetHash }] : [];
  });
  const explicitHash = normalizeOptionalString(ref.referenceImageHash);
  if (explicitHash) {
    const belongsToEntity = images.some(
      (image) =>
        normalizeOptionalString(image.assetHash) === explicitHash ||
        (image.variants ?? []).some((variant) => normalizeOptionalString(variant) === explicitHash),
    );
    if (!belongsToEntity) {
      throw referenceError(
        context,
        'selector-not-found',
        `selected image hash "${explicitHash}" is not assigned to this entity`,
        explicitHash,
      );
    }
    return [explicitHash];
  }
  const requestedSlot = normalizeOptionalString(ref.angleSlot);
  if (requestedSlot) {
    const normalize = normalizeSlot ?? normalizeReferenceSlot;
    const rawRequestedSlot = normalizeReferenceSlot(requestedSlot);
    const slotHash = normalizeOptionalString(
      (
        images.find((image) => normalizeReferenceSlot(image.slot) === rawRequestedSlot) ??
        images.find((image) => normalize(image.slot) === normalize(requestedSlot))
      )?.assetHash,
    );
    if (!slotHash) {
      throw referenceError(
        context,
        'selector-not-found',
        `selected slot "${requestedSlot}" has no active reference image`,
        requestedSlot,
      );
    }
    return [slotHash];
  }

  if (activeImages.length === 0) {
    throw referenceError(context, 'no-images', 'no active reference image is available');
  }
  if (activeImages.length > 1) {
    throw referenceError(
      context,
      'ambiguous',
      `has ${activeImages.length} active reference images; choose angleSlot or referenceImageHash explicitly`,
    );
  }
  return [activeImages[0].assetHash];
}

export function resolveEntityRefsAndImages(
  db: SqliteIndex,
  node: CanvasNode,
): ResolvedEntityRefsAndImages {
  const nodeData = node.data as ImageNodeData | VideoNodeData;
  const allHashes = new Set<string>();
  const referenceBindings: ResolvedEntityRefsAndImages['referenceBindings'] = [];
  const chars: GenerationEntityRef[] = [];
  const equips: GenerationEntityRef[] = [];
  const locs: GenerationEntityRef[] = [];

  for (const ref of nodeData.characterRefs ?? []) {
    const context: EntityReferenceContext = {
      nodeId: node.id,
      entityType: 'character',
      entityId: ref.characterId,
    };
    const characterId = tryCharacterId(ref.characterId);
    if (!characterId) {
      throw referenceError(context, 'invalid-id', 'entity ID is invalid');
    }
    const character = db.repos.entities.getCharacter(characterId);
    if (!character) {
      throw referenceError(context, 'entity-not-found', 'entity was not found');
    }

    const hashes = resolveRefImageHashes(character, ref, context, normalizeCharacterRefSlot);
    for (const h of hashes) {
      allHashes.add(h);
      referenceBindings.push({ entityType: 'character', entityId: ref.characterId, imageHash: h });
    }
    chars.push({ entityId: ref.characterId, imageHashes: hashes });
  }

  for (const ref of (nodeData as { equipmentRefs?: EquipmentRef[] }).equipmentRefs ?? []) {
    const context: EntityReferenceContext = {
      nodeId: node.id,
      entityType: 'equipment',
      entityId: ref.equipmentId,
    };
    const equipmentId = tryEquipmentId(ref.equipmentId);
    if (!equipmentId) {
      throw referenceError(context, 'invalid-id', 'entity ID is invalid');
    }
    const equipment = db.repos.entities.getEquipment(equipmentId);
    if (!equipment) {
      throw referenceError(context, 'entity-not-found', 'entity was not found');
    }

    const hashes = resolveRefImageHashes(equipment, ref, context);
    for (const h of hashes) {
      allHashes.add(h);
      referenceBindings.push({ entityType: 'equipment', entityId: ref.equipmentId, imageHash: h });
    }
    equips.push({ entityId: ref.equipmentId, imageHashes: hashes });
  }

  for (const ref of nodeData.locationRefs ?? []) {
    const context: EntityReferenceContext = {
      nodeId: node.id,
      entityType: 'location',
      entityId: ref.locationId,
    };
    const locationId = tryLocationId(ref.locationId);
    if (!locationId) {
      throw referenceError(context, 'invalid-id', 'entity ID is invalid');
    }
    const location = db.repos.entities.getLocation(locationId);
    if (!location) {
      throw referenceError(context, 'entity-not-found', 'entity was not found');
    }

    const hashes = resolveRefImageHashes(location, ref, context, normalizeLocationRefSlot);
    for (const h of hashes) {
      allHashes.add(h);
      referenceBindings.push({ entityType: 'location', entityId: ref.locationId, imageHash: h });
    }
    locs.push({ entityId: ref.locationId, imageHashes: hashes });
  }

  return {
    referenceImages: Array.from(allHashes),
    referenceBindings,
    characterRefs: chars.length > 0 ? chars : undefined,
    equipmentRefs: equips.length > 0 ? equips : undefined,
    locationRefs: locs.length > 0 ? locs : undefined,
  };
}

export type ResolvedVideoFrameReferenceImages = {
  first?: string;
  last?: string;
};

export interface CanvasGenerationIndex {
  nodesById: ReadonlyMap<string, CanvasNode>;
  incomingEdgesByNode: ReadonlyMap<string, readonly CanvasEdge[]>;
  outgoingEdgesByNode: ReadonlyMap<string, readonly CanvasEdge[]>;
  incidentEdgesByNode: ReadonlyMap<string, readonly CanvasEdge[]>;
}

export function buildCanvasGenerationIndex(canvas: Canvas): CanvasGenerationIndex {
  const nodesById = new Map(canvas.nodes.map((node) => [node.id, node]));
  const incomingEdgesByNode = new Map<string, CanvasEdge[]>();
  const outgoingEdgesByNode = new Map<string, CanvasEdge[]>();
  const incidentEdgesByNode = new Map<string, CanvasEdge[]>();
  const append = (index: Map<string, CanvasEdge[]>, nodeId: string, edge: CanvasEdge) => {
    const edges = index.get(nodeId);
    if (edges) edges.push(edge);
    else index.set(nodeId, [edge]);
  };

  for (const edge of canvas.edges) {
    append(outgoingEdgesByNode, edge.source, edge);
    append(incomingEdgesByNode, edge.target, edge);
    append(incidentEdgesByNode, edge.source, edge);
    if (edge.target !== edge.source) append(incidentEdgesByNode, edge.target, edge);
  }

  return { nodesById, incomingEdgesByNode, outgoingEdgesByNode, incidentEdgesByNode };
}

export function resolveVideoFrameReferenceImageSet(
  canvas: Canvas,
  node: CanvasNode,
  index: CanvasGenerationIndex = buildCanvasGenerationIndex(canvas),
): ResolvedVideoFrameReferenceImages {
  if (node.type !== 'video') {
    return {};
  }

  const data = node.data as VideoNodeData;
  const resolveFrameHash = (role: 'first' | 'last'): string | undefined => {
    const directHash = normalizeOptionalString(
      role === 'first' ? data.firstFrameAssetHash : data.lastFrameAssetHash,
    );
    if (directHash) {
      return directHash;
    }

    const frameNodeId =
      role === 'first'
        ? normalizeOptionalString(data.firstFrameNodeId)
        : normalizeOptionalString(data.lastFrameNodeId);
    if (!frameNodeId) {
      return undefined;
    }

    const frameNode = index.nodesById.get(frameNodeId);
    if (frameNode?.type !== 'image') return undefined;

    return normalizeOptionalString((frameNode.data as ImageNodeData).assetHash);
  };

  return {
    first: resolveFrameHash('first'),
    last: resolveFrameHash('last'),
  };
}

export function resolveVideoFrameReferenceImages(
  canvas: Canvas,
  node: CanvasNode,
  index: CanvasGenerationIndex = buildCanvasGenerationIndex(canvas),
): string[] {
  const frames = resolveVideoFrameReferenceImageSet(canvas, node, index);
  return [frames.first, frames.last].filter((hash): hash is string => Boolean(hash));
}

// ---------------------------------------------------------------------------
// Connected node helpers
// ---------------------------------------------------------------------------

export function collectConnectedTextContent(
  canvas: Canvas,
  nodeId: string,
  index: CanvasGenerationIndex = buildCanvasGenerationIndex(canvas),
): string[] {
  const connectedNodeIds = new Set<string>();
  for (const edge of index.incidentEdgesByNode.get(nodeId) ?? []) {
    if (edge.source === nodeId) connectedNodeIds.add(edge.target);
    if (edge.target === nodeId) connectedNodeIds.add(edge.source);
  }

  const textContent: string[] = [];
  for (const candidateId of connectedNodeIds) {
    const node = index.nodesById.get(candidateId);
    if (!node || node.type !== 'text') continue;
    const data = node.data as { content?: unknown };
    const content = normalizeOptionalString(data.content);
    if (content) textContent.push(content);
  }
  return textContent;
}

export function findConnectedImageHash(
  canvas: Canvas,
  nodeId: string,
  index: CanvasGenerationIndex = buildCanvasGenerationIndex(canvas),
): string | undefined {
  // Prefer incoming image edges (image -> video)
  for (const edge of index.incomingEdgesByNode.get(nodeId) ?? []) {
    const sourceNode = index.nodesById.get(edge.source);
    if (sourceNode?.type !== 'image') continue;
    const hash = normalizeOptionalString((sourceNode.data as ImageNodeData).assetHash);
    if (hash) return hash;
  }
  // Fallback: any connected image node
  for (const edge of index.incidentEdgesByNode.get(nodeId) ?? []) {
    const otherNodeId =
      edge.source === nodeId ? edge.target : edge.target === nodeId ? edge.source : undefined;
    if (!otherNodeId) continue;
    const imageNode = index.nodesById.get(otherNodeId);
    if (imageNode?.type !== 'image') continue;
    const hash = normalizeOptionalString((imageNode.data as ImageNodeData).assetHash);
    if (hash) return hash;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Entity resolution
// ---------------------------------------------------------------------------

export function resolveCharacterEntities(
  db: SqliteIndex,
  refs: ImageNodeData['characterRefs'] | undefined,
): ResolvedCharacter[] {
  if (!refs?.length) return [];
  const result: ResolvedCharacter[] = [];
  for (const ref of refs) {
    const characterId = tryCharacterId(ref.characterId);
    if (!characterId) continue;
    const character = db.repos.entities.getCharacter(characterId);
    if (!character) continue;
    const loadout =
      character.loadouts.find((l) => l.id === ref.loadoutId) ??
      character.loadouts.find((l) => l.id === character.defaultLoadoutId);
    const equipment: Equipment[] = [];
    if (loadout) {
      for (const eqId of loadout.equipmentIds) {
        const equipmentId = tryEquipmentId(eqId);
        if (!equipmentId) continue;
        const eq = db.repos.entities.getEquipment(equipmentId);
        if (eq) equipment.push(eq);
      }
    }
    result.push({
      character,
      loadout,
      equipment: equipment.length > 0 ? equipment : undefined,
      emotion: ref.emotion,
      costume: ref.costume,
    });
  }
  return result;
}

export function resolveLocationEntities(
  db: SqliteIndex,
  refs: LocationRef[] | undefined,
): Location[] {
  if (!refs?.length) return [];
  const result: Location[] = [];
  for (const ref of refs) {
    const locationId = tryLocationId(ref.locationId);
    if (!locationId) continue;
    const location = db.repos.entities.getLocation(locationId);
    if (location) result.push(location);
  }
  return result;
}

export function resolveStandaloneEquipment(
  db: SqliteIndex,
  refs: EquipmentRef[] | undefined,
  resolvedCharacters: ResolvedCharacter[],
): Equipment[] {
  if (!refs?.length) return [];
  const loadoutEquipmentIds = new Set<string>();
  for (const rc of resolvedCharacters) {
    if (rc.equipment) {
      for (const eq of rc.equipment) loadoutEquipmentIds.add(eq.id);
    }
  }
  const result: Equipment[] = [];
  for (const ref of refs) {
    if (loadoutEquipmentIds.has(ref.equipmentId)) continue;
    const equipmentId = tryEquipmentId(ref.equipmentId);
    if (!equipmentId) continue;
    const equipment = db.repos.entities.getEquipment(equipmentId);
    if (equipment) result.push(equipment);
  }
  return result;
}
