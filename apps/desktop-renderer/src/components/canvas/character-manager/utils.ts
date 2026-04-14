import type {
  Character,
  CharacterGender,
  CharacterFace,
  CharacterHair,
  CharacterBody,
  VocalTraits,
} from '@lucid-fin/contracts';

export interface CharacterDraft {
  id: string;
  name: string;
  role: Character['role'];
  description: string;
  appearance: string;
  personality: string;
  tags: string;
  age: string;
  gender: CharacterGender | '';
  voice: string;
  face: CharacterFace;
  hair: CharacterHair;
  skinTone: string;
  body: CharacterBody;
  distinctTraits: string;
  vocalTraits: VocalTraits;
}

export function createDraft(char: Character): CharacterDraft {
  return {
    id: char.id,
    name: char.name,
    role: char.role,
    description: char.description,
    appearance: char.appearance,
    personality: char.personality,
    tags: char.tags.join(', '),
    age: char.age != null ? String(char.age) : '',
    gender: char.gender ?? '',
    voice: char.voice ?? '',
    face: char.face ?? {},
    hair: char.hair ?? {},
    skinTone: char.skinTone ?? '',
    body: char.body ?? {},
    distinctTraits: (char.distinctTraits ?? []).join(', '),
    vocalTraits: char.vocalTraits ?? {},
  };
}
