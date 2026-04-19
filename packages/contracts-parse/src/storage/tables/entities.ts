/**
 * Entity-domain table constants: characters, equipment, locations.
 */
import type { CharacterId, EquipmentId, LocationId } from '@lucid-fin/contracts';
import { defineTable, col } from '../../tables.js';

export const CharactersTable = defineTable('characters', {
  id: col<CharacterId>('id'),
  name: col<string>('name'),
  role: col<string | null>('role'),
  description: col<string | null>('description'),
  appearance: col<string | null>('appearance'),
  personality: col<string | null>('personality'),
  refImage: col<string | null>('ref_image'),
  costumes: col<string | null>('costumes'),
  tags: col<string | null>('tags'),
  age: col<number | null>('age'),
  gender: col<string | null>('gender'),
  voice: col<string | null>('voice'),
  referenceImages: col<string | null>('reference_images'),
  loadouts: col<string | null>('loadouts'),
  defaultLoadoutId: col<string | null>('default_loadout_id'),
  folderId: col<string | null>('folder_id'),
  createdAt: col<number | null>('created_at'),
  updatedAt: col<number | null>('updated_at'),
});

export const EquipmentTable = defineTable('equipment', {
  id: col<EquipmentId>('id'),
  name: col<string>('name'),
  type: col<string>('type'),
  subtype: col<string | null>('subtype'),
  description: col<string | null>('description'),
  functionDesc: col<string | null>('function_desc'),
  tags: col<string | null>('tags'),
  referenceImages: col<string | null>('reference_images'),
  folderId: col<string | null>('folder_id'),
  createdAt: col<number>('created_at'),
  updatedAt: col<number>('updated_at'),
});

export const LocationsTable = defineTable('locations', {
  id: col<LocationId>('id'),
  name: col<string>('name'),
  type: col<string>('type'),
  subLocation: col<string | null>('sub_location'),
  description: col<string | null>('description'),
  timeOfDay: col<string | null>('time_of_day'),
  mood: col<string | null>('mood'),
  weather: col<string | null>('weather'),
  lighting: col<string | null>('lighting'),
  architectureStyle: col<string | null>('architecture_style'),
  dominantColors: col<string | null>('dominant_colors'),
  keyFeatures: col<string | null>('key_features'),
  atmosphereKeywords: col<string | null>('atmosphere_keywords'),
  tags: col<string | null>('tags'),
  referenceImages: col<string | null>('reference_images'),
  folderId: col<string | null>('folder_id'),
  createdAt: col<number>('created_at'),
  updatedAt: col<number>('updated_at'),
});
