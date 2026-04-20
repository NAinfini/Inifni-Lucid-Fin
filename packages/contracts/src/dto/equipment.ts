import type { ReferenceImage } from './character.js';

export type EquipmentType =
  | 'weapon'
  | 'armor'
  | 'clothing'
  | 'accessory'
  | 'vehicle'
  | 'tool'
  | 'furniture'
  | 'other';

export const EQUIPMENT_STANDARD_SLOTS = [
  'front',
  'back',
  'left-side',
  'right-side',
  'detail-closeup',
  'in-use',
] as const;

export type EquipmentStandardSlot = (typeof EQUIPMENT_STANDARD_SLOTS)[number];

// --- Phase 2 overhaul: view-kind discriminated union ----------------------
// Replaces the enumerated slot set with a single `ortho-grid` view that packs
// front/back/left/right profiles + detail close-up on one 2x2+1 composite.
// `extra-angle` supports rare custom views while keeping storage flat.

export type EquipmentRefImageView =
  | { kind: 'ortho-grid' }
  | { kind: 'extra-angle'; angle: string };

export function equipmentViewToSlot(view: EquipmentRefImageView): string {
  if (view.kind === 'ortho-grid') return 'ortho-grid';
  return `extra-angle:${view.angle.trim().toLowerCase().replace(/\s+/g, '-')}`;
}

export function equipmentSlotToView(slot: string): EquipmentRefImageView {
  if (slot === 'ortho-grid') return { kind: 'ortho-grid' };
  if (slot.startsWith('extra-angle:')) {
    return { kind: 'extra-angle', angle: slot.slice('extra-angle:'.length) };
  }
  return { kind: 'ortho-grid' };
}

export interface EquipmentRef {
  equipmentId: string;
  angleSlot?: string;
  referenceImageHash?: string;
}

export interface Equipment {
  id: string;
  name: string;
  type: EquipmentType;
  subtype?: string;
  description: string;
  function?: string;
  material?: string;
  color?: string;
  condition?: string;
  visualDetails?: string;
  tags: string[];
  referenceImages: ReferenceImage[];
  folderId?: string | null;
  createdAt: number;
  updatedAt: number;
}
