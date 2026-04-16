export interface Costume {
  id: string;
  name: string;
  description: string;
}

export interface ReferenceImage {
  slot: string;
  assetHash?: string;
  isStandard: boolean;
  /** Alternative generated images for this slot. User can pick one to promote to assetHash. */
  variants?: string[];
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
export type CharacterReferenceSlot = 'main' | StandardAngleSlot;

const CHARACTER_REF_SLOT_ALIASES: Record<string, CharacterReferenceSlot> = {
  main: 'main',
  front: 'main',
  default: 'main',
  'default-angle': 'main',
  'default-view': 'main',
  primary: 'main',
  hero: 'main',
  back: 'back',
  rear: 'back',
  'back-view': 'back',
  left: 'left-side',
  'left-side': 'left-side',
  leftside: 'left-side',
  'left-profile': 'left-side',
  'profile-left': 'left-side',
  right: 'right-side',
  'right-side': 'right-side',
  rightside: 'right-side',
  'right-profile': 'right-side',
  'profile-right': 'right-side',
  face: 'face-closeup',
  'face-closeup': 'face-closeup',
  'face-close-up': 'face-closeup',
  closeup: 'face-closeup',
  'close-up': 'face-closeup',
  'face-closeup-view': 'face-closeup',
  overhead: 'top-down',
  topdown: 'top-down',
  'top-down': 'top-down',
};

function normalizeSlotKey(slot: string | undefined | null): string {
  return (slot ?? '')
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, '-')
    .replace(/-+/g, '-');
}

export function normalizeCharacterRefSlot(slot: string | undefined | null): string {
  const normalized = normalizeSlotKey(slot);
  if (!normalized) return 'main';
  return CHARACTER_REF_SLOT_ALIASES[normalized] ?? normalized;
}

export function isCharacterReferenceSlotStandard(slot: string | undefined | null): boolean {
  const normalized = normalizeCharacterRefSlot(slot);
  return normalized === 'main' || STANDARD_ANGLE_SLOTS.includes(normalized as StandardAngleSlot);
}

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
  costumes: Costume[];
  tags: string[];
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
