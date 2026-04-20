import type { ReferenceImage } from './character.js';

export const LOCATION_STANDARD_SLOTS = [
  'wide-establishing',
  'interior-detail',
  'atmosphere',
  'key-angle-1',
  'key-angle-2',
  'overhead',
] as const;

export type LocationStandardSlot = (typeof LOCATION_STANDARD_SLOTS)[number];

// --- Phase 2 overhaul: view-kind discriminated union ----------------------
// Locations use a 2-kind primary set: `bible` (wide establish + atmosphere +
// interior detail + key angles on one sheet) and `fake-360` (8 panels at 45°
// intervals stitched into a pseudo-panorama). `extra-angle` supports custom
// needs.

export type LocationRefImageView =
  | { kind: 'bible' }
  | { kind: 'fake-360' }
  | { kind: 'extra-angle'; angle: string };

export function locationViewToSlot(view: LocationRefImageView): string {
  if (view.kind === 'bible') return 'bible';
  if (view.kind === 'fake-360') return 'fake-360';
  return `extra-angle:${view.angle.trim().toLowerCase().replace(/\s+/g, '-')}`;
}

export function locationSlotToView(slot: string): LocationRefImageView {
  if (slot === 'bible') return { kind: 'bible' };
  if (slot === 'fake-360') return { kind: 'fake-360' };
  if (slot.startsWith('extra-angle:')) {
    return { kind: 'extra-angle', angle: slot.slice('extra-angle:'.length) };
  }
  return { kind: 'bible' };
}

export interface LocationRef {
  locationId: string;
  angleSlot?: string;
  referenceImageHash?: string;
}

export interface Location {
  id: string;
  name: string;
  type?: 'interior' | 'exterior' | 'int-ext';
  subLocation?: string;
  timeOfDay?: string;
  description: string;
  mood?: string;
  weather?: string;
  lighting?: string;
  architectureStyle?: string;
  dominantColors?: string[];
  keyFeatures?: string[];
  atmosphereKeywords?: string[];
  tags: string[];
  referenceImages: ReferenceImage[];
  folderId?: string | null;
  createdAt: number;
  updatedAt: number;
}
