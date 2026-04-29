import { describe, it, expect } from 'vitest';
import {
  STANDARD_ANGLE_SLOTS,
  isCharacterReferenceSlotStandard,
  normalizeCharacterRefSlot,
} from './character.js';

describe('character DTO', () => {
  it('exports the supported standard angle slots in a stable order', () => {
    expect(STANDARD_ANGLE_SLOTS).toEqual([
      'front',
      'back',
      'left-side',
      'right-side',
      'face-closeup',
      'top-down',
    ]);
  });

  it('contains unique slot values for membership checks', () => {
    expect(new Set(STANDARD_ANGLE_SLOTS).size).toBe(STANDARD_ANGLE_SLOTS.length);
    expect(STANDARD_ANGLE_SLOTS).toContain('face-closeup');
    expect(STANDARD_ANGLE_SLOTS).not.toContain('detail-closeup');
  });

  it('normalizes main-like aliases to the canonical main slot', () => {
    expect(normalizeCharacterRefSlot('main')).toBe('main');
    expect(normalizeCharacterRefSlot('front')).toBe('main');
    expect(normalizeCharacterRefSlot(' default-angle ')).toBe('main');
    expect(normalizeCharacterRefSlot('PRIMARY')).toBe('main');
    expect(normalizeCharacterRefSlot('')).toBe('main');
  });

  it('normalizes common view aliases for profile and closeup slots', () => {
    expect(normalizeCharacterRefSlot('left')).toBe('left-side');
    expect(normalizeCharacterRefSlot('right_profile')).toBe('right-side');
    expect(normalizeCharacterRefSlot('face close up')).toBe('face-closeup');
    expect(normalizeCharacterRefSlot('overhead')).toBe('top-down');
  });

  it('treats the canonical main slot as a standard character reference slot', () => {
    expect(isCharacterReferenceSlotStandard('main')).toBe(true);
    expect(isCharacterReferenceSlotStandard('front')).toBe(true);
    expect(isCharacterReferenceSlotStandard('detail-closeup')).toBe(false);
  });
});
