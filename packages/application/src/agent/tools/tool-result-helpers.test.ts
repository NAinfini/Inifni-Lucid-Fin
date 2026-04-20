import { describe, expect, it } from 'vitest';
import { ok, fail, requireString, requireNumber, requireStringArray, requireText, requireBoolean, extractSet, warnExtraKeys, formatValidationError } from './tool-result-helpers.js';

describe('tool-result-helpers', () => {
  describe('ok', () => {
    it('returns success without data', () => {
      expect(ok()).toEqual({ success: true });
    });
    it('returns success with data', () => {
      expect(ok({ id: '1' })).toEqual({ success: true, data: { id: '1' } });
    });
    it('returns success with explicit undefined', () => {
      expect(ok(undefined)).toEqual({ success: true });
    });
  });

  describe('fail', () => {
    it('extracts message from Error', () => {
      expect(fail(new Error('boom'))).toEqual({ success: false, error: 'boom' });
    });
    it('stringifies non-Error', () => {
      expect(fail('oops')).toEqual({ success: false, error: 'oops' });
    });
    it('handles null', () => {
      expect(fail(null)).toEqual({ success: false, error: 'null' });
    });
  });

  describe('requireString', () => {
    it('returns trimmed value', () => {
      expect(requireString({ name: '  hello  ' }, 'name')).toBe('hello');
    });
    it('throws on missing key', () => {
      expect(() => requireString({}, 'name')).toThrow('name is required');
    });
    it('throws on empty string', () => {
      expect(() => requireString({ name: '' }, 'name')).toThrow('name is required');
    });
    it('throws on whitespace-only', () => {
      expect(() => requireString({ name: '   ' }, 'name')).toThrow('name is required');
    });
    it('throws on non-string', () => {
      expect(() => requireString({ name: 42 }, 'name')).toThrow('name is required');
    });
  });

  describe('requireNumber', () => {
    it('returns valid number', () => {
      expect(requireNumber({ count: 5 }, 'count')).toBe(5);
    });
    it('returns zero', () => {
      expect(requireNumber({ count: 0 }, 'count')).toBe(0);
    });
    it('returns negative', () => {
      expect(requireNumber({ count: -3 }, 'count')).toBe(-3);
    });
    it('throws on NaN', () => {
      expect(() => requireNumber({ count: NaN }, 'count')).toThrow('count must be a finite number');
    });
    it('throws on Infinity', () => {
      expect(() => requireNumber({ count: Infinity }, 'count')).toThrow('count must be a finite number');
    });
    it('throws on string', () => {
      expect(() => requireNumber({ count: '5' }, 'count')).toThrow('count must be a finite number');
    });
  });

  describe('requireStringArray', () => {
    it('returns trimmed array', () => {
      expect(requireStringArray({ ids: [' a ', 'b'] }, 'ids')).toEqual(['a', 'b']);
    });
    it('deduplicates values', () => {
      expect(requireStringArray({ ids: ['a', 'a', 'b'] }, 'ids')).toEqual(['a', 'b']);
    });
    it('throws on empty array', () => {
      expect(() => requireStringArray({ ids: [] }, 'ids')).toThrow('ids must be a non-empty array');
    });
    it('throws on non-array', () => {
      expect(() => requireStringArray({ ids: 'not-array' }, 'ids')).toThrow('ids must be a non-empty array');
    });
    it('throws on empty string element', () => {
      expect(() => requireStringArray({ ids: ['a', ''] }, 'ids')).toThrow('ids[1] must be a non-empty string');
    });
  });

  describe('requireText', () => {
    it('returns string including empty', () => {
      expect(requireText({ text: '' }, 'text')).toBe('');
    });
    it('returns non-empty string', () => {
      expect(requireText({ text: 'hello' }, 'text')).toBe('hello');
    });
    it('throws on non-string', () => {
      expect(() => requireText({ text: 42 }, 'text')).toThrow('text is required');
    });
  });

  describe('requireBoolean', () => {
    it('returns true', () => {
      expect(requireBoolean({ flag: true }, 'flag')).toBe(true);
    });
    it('returns false', () => {
      expect(requireBoolean({ flag: false }, 'flag')).toBe(false);
    });
    it('throws on non-boolean', () => {
      expect(() => requireBoolean({ flag: 1 }, 'flag')).toThrow('flag must be a boolean');
    });
  });

  describe('extractSet', () => {
    it('returns the set object when present and non-empty', () => {
      expect(extractSet({ canvasId: 'c1', set: { prompt: 'hello', width: 100 } }))
        .toEqual({ prompt: 'hello', width: 100 });
    });

    it('throws when set is missing', () => {
      expect(() => extractSet({ canvasId: 'c1' })).toThrow('"set" object is required');
    });

    it('throws when set is not an object', () => {
      expect(() => extractSet({ canvasId: 'c1', set: 'bad' })).toThrow('"set" object is required');
    });

    it('throws when set is null', () => {
      expect(() => extractSet({ canvasId: 'c1', set: null })).toThrow('"set" object is required');
    });

    it('throws when set is an array', () => {
      expect(() => extractSet({ canvasId: 'c1', set: [1, 2] })).toThrow('"set" object is required');
    });

    it('throws when set is empty', () => {
      expect(() => extractSet({ canvasId: 'c1', set: {} })).toThrow('"set" must contain at least one field');
    });

    it('preserves empty string and zero values inside set', () => {
      expect(extractSet({ set: { prompt: '', seed: 0, locked: false } }))
        .toEqual({ prompt: '', seed: 0, locked: false });
    });

    it('returns set with a single field', () => {
      expect(extractSet({ set: { seed: 0 } })).toEqual({ seed: 0 });
    });
  });

  describe('warnExtraKeys', () => {
    it('returns empty array when no extra keys', () => {
      expect(warnExtraKeys({ canvasId: 'c1', nodeId: 'n1', set: { prompt: 'x' } })).toEqual([]);
    });

    it('detects data fields outside set', () => {
      const warnings = warnExtraKeys({ canvasId: 'c1', set: { prompt: 'x' }, width: 0, title: '' });
      expect(warnings).toEqual(['Fields outside "set" were ignored: width, title']);
    });

    it('ignores structural keys', () => {
      expect(warnExtraKeys({ canvasId: 'c1', nodeId: 'n1', nodeIds: ['a'], id: 'x', set: { p: 1 } }))
        .toEqual([]);
    });
  });

  describe('formatValidationError (04-19 fake-user-study fix)', () => {
    it('emits the canonical "<tool>: <param> <constraint>. You called it with: <args>." shape', () => {
      const msg = formatValidationError('workflow.expandIdea', 'prompt', 'is required and must be a non-empty string', {});
      expect(msg).toBe('workflow.expandIdea: "prompt" is required and must be a non-empty string. You called it with: {}.');
    });

    it('appends the alternative-tool pointer when provided', () => {
      const msg = formatValidationError(
        'canvas.batchCreate',
        'nodes',
        'must be a non-empty array',
        { edges: [] },
        'If you only want to connect existing nodes, call canvas.connectNodes.',
      );
      expect(msg).toContain('canvas.batchCreate: "nodes" must be a non-empty array');
      expect(msg).toContain('You called it with: {"edges":[]}');
      expect(msg).toContain('If you only want to connect existing nodes, call canvas.connectNodes.');
    });

    it('truncates args JSON at 400 chars to keep the error short', () => {
      const big = { prompt: 'x'.repeat(600) };
      const msg = formatValidationError('workflow.expandIdea', 'prompt', 'is required', big);
      expect(msg.length).toBeLessThan(600);
      expect(msg).toContain('...');
    });

    it('handles unserializable args gracefully', () => {
      const cycle: Record<string, unknown> = {};
      cycle.self = cycle;
      const msg = formatValidationError('some.tool', 'x', 'is required', cycle);
      expect(msg).toContain('<unserializable>');
    });
  });
});
