// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { extractChanges } from './ArtifactPreview.js';

describe('extractChanges', () => {
  const titles: Record<string, string> = { n1: 'My Node', n2: 'Other Node' };

  it('extracts added nodes from batchCreate result', () => {
    const result = { success: true, nodes: [{ id: 'n1', title: 'My Node' }] };
    const changes = extractChanges('canvas.batchCreate', result, titles);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toEqual({ type: 'added', label: 'My Node', id: 'n1' });
  });

  it('extracts updated nodes from updateNodes result', () => {
    const result = { success: true, nodeIds: ['n1', 'n2'] };
    const changes = extractChanges('canvas.updateNodes', result, titles);
    expect(changes).toHaveLength(2);
    expect(changes[0].type).toBe('updated');
    expect(changes[1].label).toBe('Other Node');
  });

  it('extracts removed node from deleteNode result', () => {
    const result = { success: true, nodeId: 'n1' };
    const changes = extractChanges('canvas.deleteNode', result, titles);
    expect(changes).toHaveLength(1);
    expect(changes[0].type).toBe('removed');
  });

  it('extracts connected from addEdge', () => {
    const result = { success: true };
    const changes = extractChanges('canvas.connectNodes', result, titles);
    expect(changes).toHaveLength(1);
    expect(changes[0].type).toBe('connected');
    // Label is null — resolved at render time via i18n.
    expect(changes[0].label).toBeNull();
  });

  it('returns empty for unrecognized tools', () => {
    expect(extractChanges('unknown.tool', { foo: 1 }, titles)).toEqual([]);
  });

  it('returns empty for null result', () => {
    expect(extractChanges('canvas.addNode', null, titles)).toEqual([]);
  });

  it('handles generic success with nodeId', () => {
    const result = { success: true, nodeId: 'n1' };
    const changes = extractChanges('some.other.tool', result, titles);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toEqual({ type: 'updated', label: 'My Node', id: 'n1' });
  });
});
