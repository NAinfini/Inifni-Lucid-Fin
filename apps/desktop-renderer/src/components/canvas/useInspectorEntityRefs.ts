/**
 * Custom hook encapsulating entity-ref (character, equipment, location) management
 * for the InspectorPanel.
 *
 * Extracted to keep InspectorPanel focused on layout orchestration.
 */
import { useCallback, useMemo, useState } from 'react';
import { useDispatch } from 'react-redux';
import {
  addNodeCharacterRef,
  removeNodeCharacterRef,
  updateNodeCharacterRef,
  addNodeEquipmentRef,
  removeNodeEquipmentRef,
  updateNodeEquipmentRef,
  addNodeLocationRef,
  removeNodeLocationRef,
} from '../../store/slices/canvas.js';
import type {
  CanvasNode,
  CharacterRef,
  EquipmentRef,
  LocationRef,
  ImageNodeData,
  VideoNodeData,
  ReferenceImage,
  Character,
  Equipment,
  Location,
} from '@lucid-fin/contracts';

export interface UseInspectorEntityRefsOptions {
  selectedNode: CanvasNode | undefined;
  characters: Character[];
  equipmentItems: Equipment[];
  locationItems: Location[];
}

export function useInspectorEntityRefs({
  selectedNode,
  characters,
  equipmentItems,
  locationItems,
}: UseInspectorEntityRefsOptions) {
  const dispatch = useDispatch();

  // --- Picker open state ---
  const [charPickerOpen, setCharPickerOpen] = useState(false);
  const [equipPickerOpen, setEquipPickerOpen] = useState(false);
  const [locPickerOpen, setLocPickerOpen] = useState(false);

  // --- Lookup maps ---
  const characterById = useMemo(() => {
    const map: Record<string, Character> = {};
    for (const ch of characters) map[ch.id] = ch;
    return map;
  }, [characters]);

  const equipmentById = useMemo(() => {
    const map: Record<string, Equipment> = {};
    for (const eq of equipmentItems) map[eq.id] = eq;
    return map;
  }, [equipmentItems]);

  const locationById = useMemo(() => {
    const map: Record<string, Location> = {};
    for (const loc of locationItems) map[loc.id] = loc;
    return map;
  }, [locationItems]);

  // --- Derived refs on selected node ---
  const nodeCharacterRefs: CharacterRef[] = useMemo(() => {
    if (!selectedNode || (selectedNode.type !== 'image' && selectedNode.type !== 'video'))
      return [];
    return (selectedNode.data as ImageNodeData | VideoNodeData).characterRefs ?? [];
  }, [selectedNode]);

  const nodeEquipmentRefs: EquipmentRef[] = useMemo(() => {
    if (!selectedNode || (selectedNode.type !== 'image' && selectedNode.type !== 'video'))
      return [];
    const raw = (selectedNode.data as ImageNodeData | VideoNodeData).equipmentRefs ?? [];
    return raw.map((r) => (typeof r === 'string' ? { equipmentId: r } : r));
  }, [selectedNode]);

  const nodeLocationRefs: LocationRef[] = useMemo(() => {
    if (!selectedNode || (selectedNode.type !== 'image' && selectedNode.type !== 'video'))
      return [];
    return (selectedNode.data as ImageNodeData | VideoNodeData).locationRefs ?? [];
  }, [selectedNode]);

  // --- Available (not-yet-added) entities ---
  const availableCharacters = useMemo(() => {
    const usedIds = new Set(nodeCharacterRefs.map((r) => r.characterId));
    return characters.filter((ch) => !usedIds.has(ch.id));
  }, [characters, nodeCharacterRefs]);

  const availableEquipment = useMemo(() => {
    const usedIds = new Set(nodeEquipmentRefs.map((r) => r.equipmentId));
    return equipmentItems.filter((eq) => !usedIds.has(eq.id));
  }, [equipmentItems, nodeEquipmentRefs]);

  const availableLocations = useMemo(() => {
    const usedIds = new Set(nodeLocationRefs.map((r) => r.locationId));
    return locationItems.filter((loc) => !usedIds.has(loc.id));
  }, [locationItems, nodeLocationRefs]);

  const contextBadgeCount =
    nodeCharacterRefs.length + nodeEquipmentRefs.length + nodeLocationRefs.length;

  // --- Handlers ---
  const handleAddCharacterRef = useCallback(
    (characterId: string) => {
      if (!selectedNode) return;
      const character = characterById[characterId];
      dispatch(
        addNodeCharacterRef({
          id: selectedNode.id,
          characterRef: {
            characterId,
            loadoutId: character?.defaultLoadoutId ?? '',
          },
        }),
      );
      setCharPickerOpen(false);
    },
    [dispatch, selectedNode, characterById],
  );

  const handleRemoveCharacterRef = useCallback(
    (characterId: string) => {
      if (!selectedNode) return;
      dispatch(removeNodeCharacterRef({ id: selectedNode.id, characterId }));
    },
    [dispatch, selectedNode],
  );

  const handleCharacterAngleChange = useCallback(
    (characterId: string, angleSlot: string | undefined) => {
      if (!selectedNode) return;
      const character = characters.find((c) => c.id === characterId);
      const referenceImageHash = angleSlot
        ? character?.referenceImages?.find((r: ReferenceImage) => r.slot === angleSlot)?.assetHash
        : undefined;
      dispatch(
        updateNodeCharacterRef({
          id: selectedNode.id,
          characterId,
          changes: { angleSlot, referenceImageHash },
        }),
      );
    },
    [dispatch, selectedNode, characters],
  );

  const handleAddEquipmentRef = useCallback(
    (equipmentId: string) => {
      if (!selectedNode) return;
      dispatch(addNodeEquipmentRef({ id: selectedNode.id, equipmentId }));
      setEquipPickerOpen(false);
    },
    [dispatch, selectedNode],
  );

  const handleRemoveEquipmentRef = useCallback(
    (equipmentId: string) => {
      if (!selectedNode) return;
      dispatch(removeNodeEquipmentRef({ id: selectedNode.id, equipmentId }));
    },
    [dispatch, selectedNode],
  );

  const handleEquipmentAngleChange = useCallback(
    (equipmentId: string, angleSlot: string | undefined) => {
      if (!selectedNode) return;
      const equipment = equipmentItems.find((e) => e.id === equipmentId);
      const referenceImageHash = angleSlot
        ? equipment?.referenceImages?.find((r: ReferenceImage) => r.slot === angleSlot)?.assetHash
        : undefined;
      dispatch(
        updateNodeEquipmentRef({
          id: selectedNode.id,
          equipmentId,
          changes: { angleSlot, referenceImageHash },
        }),
      );
    },
    [dispatch, selectedNode, equipmentItems],
  );

  const handleAddLocationRef = useCallback(
    (locationId: string) => {
      if (!selectedNode) return;
      dispatch(addNodeLocationRef({ id: selectedNode.id, locationId }));
      setLocPickerOpen(false);
    },
    [dispatch, selectedNode],
  );

  const handleRemoveLocationRef = useCallback(
    (locationId: string) => {
      if (!selectedNode) return;
      dispatch(removeNodeLocationRef({ id: selectedNode.id, locationId }));
    },
    [dispatch, selectedNode],
  );

  return {
    // Refs
    nodeCharacterRefs,
    nodeEquipmentRefs,
    nodeLocationRefs,
    // Available
    availableCharacters,
    availableEquipment,
    availableLocations,
    // Lookup maps
    characterById,
    equipmentById,
    locationById,
    // Badge
    contextBadgeCount,
    // Picker state
    charPickerOpen,
    setCharPickerOpen,
    equipPickerOpen,
    setEquipPickerOpen,
    locPickerOpen,
    setLocPickerOpen,
    // Handlers
    handleAddCharacterRef,
    handleRemoveCharacterRef,
    handleCharacterAngleChange,
    handleAddEquipmentRef,
    handleRemoveEquipmentRef,
    handleEquipmentAngleChange,
    handleAddLocationRef,
    handleRemoveLocationRef,
  };
}
