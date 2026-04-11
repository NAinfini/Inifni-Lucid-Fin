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

export interface EquipmentRef {
  equipmentId: string;
  angleSlot?: string;
  referenceImageHash?: string;
}

export interface Equipment {
  id: string;
  projectId: string;
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
  createdAt: number;
  updatedAt: number;
}
