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
