import type { ReferenceImage } from './character.js';

export type LocationType = 'interior' | 'exterior' | 'int-ext';

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
  projectId: string;
  name: string;
  type: LocationType;
  subLocation?: string;
  timeOfDay?: string;
  description: string;
  mood?: string;
  weather?: string;
  lighting?: string;
  tags: string[];
  referenceImages: ReferenceImage[];
  createdAt: number;
  updatedAt: number;
}
