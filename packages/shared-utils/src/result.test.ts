import { describe, it, expect } from 'vitest';
import { ok, err, isOk, isErr, mapOk, mapErr, type Result } from './result.js';

describe('Result', () => {
  it('narrows via isOk / isErr', () => {
    const good: Result<number, string> = ok(3);
    const bad: Result<number, string> = err('nope');

    expect(isOk(good)).toBe(true);
    expect(isErr(bad)).toBe(true);
    if (isOk(good)) expect(good.value).toBe(3);
    if (isErr(bad)) expect(bad.error).toBe('nope');
  });

  it('mapOk passes failures through', () => {
    const good: Result<number, string> = ok(2);
    const bad: Result<number, string> = err('x');
    expect(mapOk(good, (n) => n * 10)).toEqual({ ok: true, value: 20 });
    expect(mapOk(bad, (n) => n * 10)).toEqual({ ok: false, error: 'x' });
  });

  it('mapErr passes successes through', () => {
    const good: Result<number, string> = ok(1);
    const bad: Result<number, string> = err('boom');
    expect(mapErr(good, (e) => e.toUpperCase())).toEqual({
      ok: true,
      value: 1,
    });
    expect(mapErr(bad, (e) => e.toUpperCase())).toEqual({
      ok: false,
      error: 'BOOM',
    });
  });
});
