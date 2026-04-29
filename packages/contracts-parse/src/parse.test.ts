import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  parseStrict,
  parseOrDegrade,
  parsePartial,
  makeBrandParser,
  makeTryBrand,
  setDegradeReporter,
} from './parse.js';

const nameSchema = z.object({ name: z.string().min(1) });

afterEach(() => {
  setDegradeReporter(null);
});

describe('parseStrict', () => {
  it('returns parsed data on success', () => {
    expect(parseStrict(nameSchema, { name: 'x' })).toEqual({ name: 'x' });
  });

  it('throws with schema name on failure', () => {
    expect(() => parseStrict(nameSchema, { name: '' }, { name: 'Person' })).toThrow(/Person/);
  });
});

describe('parseOrDegrade', () => {
  it('returns parsed data on success', () => {
    const v = parseOrDegrade(nameSchema, { name: 'y' }, { name: 'fallback' });
    expect(v).toEqual({ name: 'y' });
  });

  it('returns fallback and fires reporter on failure', () => {
    const reporter = vi.fn();
    setDegradeReporter(reporter);

    const v = parseOrDegrade(
      nameSchema,
      { name: '' },
      { name: 'fallback' },
      { ctx: { name: 'Commander.save' } },
    );

    expect(v).toEqual({ name: 'fallback' });
    expect(reporter).toHaveBeenCalledOnce();
    expect(reporter.mock.calls[0][0].schema).toBe('Commander.save');
  });

  it('throws under throwOnDegrade=true for test harnesses', () => {
    expect(() =>
      parseOrDegrade(nameSchema, { name: '' }, { name: 'fallback' }, { throwOnDegrade: true }),
    ).toThrow(/strict-mode failure/);
  });
});

describe('parsePartial', () => {
  const schema = z.object({
    name: z.string().min(1),
    count: z.number().int().nonnegative(),
  });

  it('returns parsed data when input is valid', () => {
    expect(parsePartial(schema, { name: 'a', count: 1 }, { name: 'd', count: 0 })).toEqual({
      name: 'a',
      count: 1,
    });
  });

  it('recovers a single bad field using defaults', () => {
    const v = parsePartial(schema, { name: 'a', count: -1 }, { name: 'd', count: 0 });
    expect(v).toEqual({ name: 'a', count: 0 });
  });

  it('recovers multiple bad fields cumulatively', () => {
    const v = parsePartial(schema, { name: '', count: -1 }, { name: 'd', count: 0 });
    expect(v).toEqual({ name: 'd', count: 0 });
  });

  it('returns schema-parsed output (transforms applied, not raw probe)', () => {
    // The schema coerces name to uppercase via transform. parsePartial must
    // return the transform output, not the raw candidate object.
    const xformSchema = z.object({
      name: z
        .string()
        .min(1)
        .transform((s) => s.toUpperCase()),
      count: z.number().int().nonnegative(),
    });
    const v = parsePartial(xformSchema, { name: 'hello', count: -1 }, { name: 'd', count: 0 });
    // name is valid ('hello') → coerced to 'HELLO'; count was invalid → defaulted to 0
    expect(v).toEqual({ name: 'HELLO', count: 0 });
  });

  it('returns full defaults when input is not an object', () => {
    expect(parsePartial(schema, null, { name: 'd', count: 0 })).toEqual({
      name: 'd',
      count: 0,
    });
  });
});

type ProviderId = string & { readonly __brand: 'ProviderId' };

describe('makeBrandParser / makeTryBrand', () => {
  const raw = z
    .string()
    .min(1)
    .regex(/^[a-z0-9-]+$/);
  const parseProviderId = makeBrandParser<ProviderId>(raw, 'ProviderId');
  const tryProviderId = makeTryBrand<ProviderId>(raw);

  it('produces a branded value from a valid input', () => {
    const id = parseProviderId('openai');
    expect(id).toBe('openai');
  });

  it('throws with brand name on invalid input', () => {
    expect(() => parseProviderId('Bad ID!')).toThrow(/ProviderId/);
  });

  it('tryParse returns undefined instead of throwing', () => {
    expect(tryProviderId('Bad ID!')).toBeUndefined();
    expect(tryProviderId('ok-id')).toBe('ok-id');
  });
});
