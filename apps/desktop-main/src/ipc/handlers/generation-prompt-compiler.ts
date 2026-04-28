import { randomUUID } from 'node:crypto';
import type {
  Canvas,
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
import { createEmptyPresetTrackSet, normalizeCharacterRefSlot } from '@lucid-fin/contracts';
import type { ResolvedCharacter } from '@lucid-fin/application';
import type { SqliteIndex } from '@lucid-fin/storage';
import { tryCharacterId, tryEquipmentId, tryLocationId } from '@lucid-fin/contracts-parse';
import {
  DEFAULT_STYLE_GUIDE,
  STYLE_GUIDE_LIGHTING_PRESETS,
  normalizeOptionalString,
  normalizePresetLookupValue,
} from './generation-helpers.js';

// ---------------------------------------------------------------------------
// Style guide loading
// ---------------------------------------------------------------------------

export function loadCurrentProjectStyleGuide(): StyleGuide {
  return DEFAULT_STYLE_GUIDE;
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
  const scenePresetId = STYLE_GUIDE_LIGHTING_PRESETS[styleGuide.global.lighting];

  maybeFillTrack(next, 'look', lookPresetId);
  maybeFillTrack(next, 'scene', scenePresetId);

  return next as PresetTrackSet;
}

function maybeFillTrack(tracks: TrackMap, category: PresetCategory, presetId: string | undefined): void {
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
      normalizePresetLookupValue(preset.id.split(':')[1]),
    ].includes(normalizedValue);
  });
  if (exactMatch) return exactMatch.id;

  const fuzzyMatches = candidates.filter((preset) => {
    const presetKeys = [
      normalizePresetLookupValue(preset.name),
      normalizePresetLookupValue(preset.id.split(':')[1]),
    ].filter(Boolean);
    return presetKeys.some((key) => key.includes(normalizedValue) || normalizedValue.includes(key));
  });
  return fuzzyMatches.length === 1 ? fuzzyMatches[0]?.id : undefined;
}

// ---------------------------------------------------------------------------
// Node data type guards
// ---------------------------------------------------------------------------

export function hasPresetTracks(data: unknown): data is { presetTracks?: PresetTrackSet } {
  return typeof data === 'object' && data !== null && 'presetTracks' in data;
}

export function hasCharacterRefs(data: unknown): data is { characterRefs?: ImageNodeData['characterRefs'] } {
  return typeof data === 'object' && data !== null && 'characterRefs' in data;
}

export function hasEquipmentRefs(data: unknown): data is { equipmentRefs?: ImageNodeData['equipmentRefs'] } {
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
  characterRefs?: GenerationEntityRef[];
  equipmentRefs?: GenerationEntityRef[];
  locationRefs?: GenerationEntityRef[];
}

function resolveRefImageHashes(
  entity: { referenceImages?: Array<{ slot?: string; assetHash?: string }> } | undefined,
  ref: { angleSlot?: string; referenceImageHash?: string },
  normalizeSlot?: (s: string | undefined) => string | undefined,
): string[] {
  const hashes: string[] = [];
  const explicitHash = normalizeOptionalString(ref.referenceImageHash);
  if (explicitHash) {
    hashes.push(explicitHash);
    return hashes;
  }
  if (ref.angleSlot && entity?.referenceImages) {
    const normalize = normalizeSlot ?? ((s: string | undefined) => s);
    const slotHash = normalizeOptionalString(
      entity.referenceImages.find(
        (r) => normalize(r.slot) === normalize(ref.angleSlot),
      )?.assetHash,
    );
    if (slotHash) {
      hashes.push(slotHash);
      return hashes;
    }
  }
  for (const image of entity?.referenceImages ?? []) {
    const h = normalizeOptionalString(image.assetHash);
    if (h) hashes.push(h);
  }
  return hashes;
}

export function resolveEntityRefsAndImages(
  db: SqliteIndex,
  node: CanvasNode,
): ResolvedEntityRefsAndImages {
  const nodeData = node.data as ImageNodeData | VideoNodeData;
  const allHashes = new Set<string>();
  const chars: GenerationEntityRef[] = [];
  const equips: GenerationEntityRef[] = [];
  const locs: GenerationEntityRef[] = [];

  for (const ref of nodeData.characterRefs ?? []) {
    const characterId = tryCharacterId(ref.characterId);
    if (!characterId) continue;
    const character = db.repos.entities.getCharacter(characterId);
    if (!character) continue;

    const hashes = resolveRefImageHashes(character, ref, normalizeCharacterRefSlot);
    for (const h of hashes) allHashes.add(h);
    if (hashes.length > 0) {
      chars.push({ entityId: ref.characterId, imageHashes: hashes });
    }
  }

  for (const ref of (nodeData as { equipmentRefs?: EquipmentRef[] }).equipmentRefs ?? []) {
    const equipmentId = tryEquipmentId(ref.equipmentId);
    if (!equipmentId) continue;
    const equipment = db.repos.entities.getEquipment(equipmentId);
    if (!equipment) continue;

    const hashes = resolveRefImageHashes(equipment, ref);
    for (const h of hashes) allHashes.add(h);
    if (hashes.length > 0) {
      equips.push({ entityId: ref.equipmentId, imageHashes: hashes });
    }
  }

  for (const ref of nodeData.locationRefs ?? []) {
    const locationId = tryLocationId(ref.locationId);
    if (!locationId) continue;
    const location = db.repos.entities.getLocation(locationId);
    if (!location) continue;

    const hashes = resolveRefImageHashes(location, ref);
    for (const h of hashes) allHashes.add(h);
    if (hashes.length > 0) {
      locs.push({ entityId: ref.locationId, imageHashes: hashes });
    }
  }

  return {
    referenceImages: Array.from(allHashes),
    characterRefs: chars.length > 0 ? chars : undefined,
    equipmentRefs: equips.length > 0 ? equips : undefined,
    locationRefs: locs.length > 0 ? locs : undefined,
  };
}

export function resolveReferenceImages(db: SqliteIndex, canvas: Canvas, node: CanvasNode): string[] {
  void canvas;
  return resolveEntityRefsAndImages(db, node).referenceImages;
}

export function resolveStructuredEntityRefs(
  db: SqliteIndex,
  node: CanvasNode,
): {
  characterRefs?: GenerationEntityRef[];
  equipmentRefs?: GenerationEntityRef[];
  locationRefs?: GenerationEntityRef[];
} {
  const { characterRefs, equipmentRefs, locationRefs } = resolveEntityRefsAndImages(db, node);
  return { characterRefs, equipmentRefs, locationRefs };
}

export type ResolvedVideoFrameReferenceImages = {
  first?: string;
  last?: string;
};

export function resolveVideoFrameReferenceImageSet(
  canvas: Canvas,
  node: CanvasNode,
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

    const frameNode = canvas.nodes.find(
      (entry) => entry.id === frameNodeId && entry.type === 'image',
    );
    if (!frameNode) {
      return undefined;
    }

    return normalizeOptionalString((frameNode.data as ImageNodeData).assetHash);
  };

  return {
    first: resolveFrameHash('first'),
    last: resolveFrameHash('last'),
  };
}

export function resolveVideoFrameReferenceImages(canvas: Canvas, node: CanvasNode): string[] {
  const frames = resolveVideoFrameReferenceImageSet(canvas, node);
  return [frames.first, frames.last].filter(
    (hash): hash is string => Boolean(hash),
  );
}

// ---------------------------------------------------------------------------
// Connected node helpers
// ---------------------------------------------------------------------------

export function collectConnectedTextContent(canvas: Canvas, nodeId: string): string[] {
  const connectedNodeIds = new Set<string>();
  for (const edge of canvas.edges) {
    if (edge.source === nodeId) connectedNodeIds.add(edge.target);
    if (edge.target === nodeId) connectedNodeIds.add(edge.source);
  }

  const textContent: string[] = [];
  for (const candidateId of connectedNodeIds) {
    const node = canvas.nodes.find((entry) => entry.id === candidateId);
    if (!node || node.type !== 'text') continue;
    const data = node.data as { content?: unknown };
    const content = normalizeOptionalString(data.content);
    if (content) textContent.push(content);
  }
  return textContent;
}

export function findConnectedImageHash(canvas: Canvas, nodeId: string): string | undefined {
  // Prefer incoming image edges (image -> video)
  for (const edge of canvas.edges) {
    if (edge.target !== nodeId) continue;
    const sourceNode = canvas.nodes.find((node) => node.id === edge.source && node.type === 'image');
    if (!sourceNode) continue;
    const hash = normalizeOptionalString((sourceNode.data as ImageNodeData).assetHash);
    if (hash) return hash;
  }
  // Fallback: any connected image node
  for (const edge of canvas.edges) {
    const otherNodeId = edge.source === nodeId ? edge.target : edge.target === nodeId ? edge.source : undefined;
    if (!otherNodeId) continue;
    const imageNode = canvas.nodes.find((node) => node.id === otherNodeId && node.type === 'image');
    if (!imageNode) continue;
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
    const loadout = character.loadouts.find((l) => l.id === ref.loadoutId)
      ?? character.loadouts.find((l) => l.id === character.defaultLoadoutId);
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
