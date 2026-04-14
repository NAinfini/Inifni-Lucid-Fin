import { describe, expect, it } from 'vitest';
import { isRecord, isNodeReferenceKey, isNodeReferenceListKey, formatNodeReference, annotateToolPayload } from './node-formatting.js';

describe('isRecord', () => {
  it('returns true for plain objects', () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord({ a: 1 })).toBe(true);
  });
  it('returns false for arrays', () => {
    expect(isRecord([])).toBe(false);
  });
  it('returns false for null', () => {
    expect(isRecord(null)).toBe(false);
  });
  it('returns false for primitives', () => {
    expect(isRecord('str')).toBe(false);
    expect(isRecord(42)).toBe(false);
  });
});

describe('isNodeReferenceKey', () => {
  it('matches nodeId', () => expect(isNodeReferenceKey('nodeId')).toBe(true));
  it('matches sourceNodeId', () => expect(isNodeReferenceKey('sourceNodeId')).toBe(true));
  it('matches source', () => expect(isNodeReferenceKey('source')).toBe(true));
  it('matches target', () => expect(isNodeReferenceKey('target')).toBe(true));
  it('rejects random key', () => expect(isNodeReferenceKey('name')).toBe(false));
});

describe('isNodeReferenceListKey', () => {
  it('matches nodeIds', () => expect(isNodeReferenceListKey('nodeIds')).toBe(true));
  it('matches selectedNodeIds', () => expect(isNodeReferenceListKey('selectedNodeIds')).toBe(true));
  it('rejects nodeId (singular)', () => expect(isNodeReferenceListKey('nodeId')).toBe(false));
});

describe('formatNodeReference', () => {
  it('returns title with id when title exists', () => {
    expect(formatNodeReference('n1', { n1: 'Scene 1' })).toBe('Scene 1 (n1)');
  });
  it('returns id when no title', () => {
    expect(formatNodeReference('n1', {})).toBe('n1');
  });
  it('returns id when title equals id', () => {
    expect(formatNodeReference('n1', { n1: 'n1' })).toBe('n1');
  });
});

describe('annotateToolPayload', () => {
  it('annotates nodeId values with titles', () => {
    const result = annotateToolPayload({ nodeId: 'n1', name: 'test' }, { n1: 'Hero Shot' });
    expect(result).toEqual({ nodeId: 'Hero Shot (n1)', name: 'test' });
  });
  it('annotates nodeIds arrays', () => {
    const result = annotateToolPayload({ nodeIds: ['n1', 'n2'] }, { n1: 'A', n2: 'B' });
    expect(result).toEqual({ nodeIds: ['A (n1)', 'B (n2)'] });
  });
  it('returns primitives unchanged', () => {
    expect(annotateToolPayload('hello', {})).toBe('hello');
    expect(annotateToolPayload(42, {})).toBe(42);
  });
});
