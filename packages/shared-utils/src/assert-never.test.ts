import { describe, it, expect } from 'vitest';
import { assertNever } from './assert-never.js';

describe('assertNever', () => {
  it('throws with the offending value', () => {
    const value = 'surprise' as never;
    expect(() => assertNever(value)).toThrow(/surprise/);
  });

  it('includes context when supplied', () => {
    const value = { kind: 'legacy' } as never;
    expect(() => assertNever(value, 'node match')).toThrow(/node match/);
  });

  it('serialises non-string values without crashing', () => {
    const value = { a: 1 } as never;
    expect(() => assertNever(value)).toThrow(/"a":1/);
  });
});
