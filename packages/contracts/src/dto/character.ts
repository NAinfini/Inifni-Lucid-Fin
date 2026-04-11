export interface Costume {
  id: string;
  name: string;
  description: string;
  referenceImage?: string;
}

export interface ReferenceImage {
  slot: string;
  assetHash?: string;
  isStandard: boolean;
}

export const STANDARD_ANGLE_SLOTS = [
  'front',
  'back',
  'left-side',
  'right-side',
  'face-closeup',
  'top-down',
] as const;

export type StandardAngleSlot = (typeof STANDARD_ANGLE_SLOTS)[number];

export interface EquipmentLoadout {
  id: string;
  name: string;
  equipmentIds: string[];
}

export interface CharacterRef {
  characterId: string;
  loadoutId: string;
  costume?: string;
  emotion?: string;
  angleSlot?: string;
  referenceImageHash?: string;
}

export type CharacterGender = 'male' | 'female' | 'non-binary' | 'other';

export interface CharacterFace {
  eyeShape?: string;
  eyeColor?: string;
  noseType?: string;
  lipShape?: string;
  jawline?: string;
  definingFeatures?: string;
}

export interface CharacterHair {
  color?: string;
  style?: string;
  length?: string;
  texture?: string;
}

export interface CharacterBody {
  height?: string;
  build?: string;
  proportions?: string;
}

export interface VocalTraits {
  pitch?: string;
  accent?: string;
  cadence?: string;
}

export interface Character {
  id: string;
  name: string;
  role: 'protagonist' | 'antagonist' | 'supporting' | 'extra';
  description: string;
  appearance: string;
  personality: string;
  referenceImage?: string;
  costumes: Costume[];
  tags: string[];
  projectId?: string;
  age?: number;
  gender?: CharacterGender;
  voice?: string;
  face?: CharacterFace;
  hair?: CharacterHair;
  skinTone?: string;
  body?: CharacterBody;
  distinctTraits?: string[];
  vocalTraits?: VocalTraits;
  referenceImages: ReferenceImage[];
  loadouts: EquipmentLoadout[];
  defaultLoadoutId: string;
  createdAt: number;
  updatedAt: number;
}
