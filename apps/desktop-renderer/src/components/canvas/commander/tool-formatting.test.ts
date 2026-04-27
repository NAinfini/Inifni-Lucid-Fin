import { describe, expect, it } from 'vitest';
import { formatAction, formatToolName } from './tool-formatting.js';

describe('formatAction', () => {
  it('converts camelCase to title case', () => {
    expect(formatAction('generateImage')).toBe('Generate Image');
  });

  it('handles single word', () => {
    expect(formatAction('list')).toBe('List');
  });

  it('uses i18n when available', () => {
    const t = (key: string) => key === 'commander.toolAction.list' ? 'List All' : key;
    expect(formatAction('list', t)).toBe('List All');
  });

  it('falls back when i18n key not found', () => {
    const t = (key: string) => key; // returns key as-is (no translation)
    expect(formatAction('createNode', t)).toBe('Create Node');
  });
});

describe('formatToolName', () => {
  it('formats domain.action', () => {
    expect(formatToolName('character.list')).toBe('Character: List');
  });

  it('formats single name', () => {
    expect(formatToolName('list')).toBe('List');
  });

  it('uses i18n for domain', () => {
    const t = (key: string) => {
      if (key === 'commander.toolDomain.canvas') return 'Canvas';
      if (key === 'commander.toolAction.addNode') return 'Add Node';
      return key;
    };
    expect(formatToolName('canvas.addNode', t)).toBe('Canvas: Add Node');
  });

  it('normalizes LLM wire-format snake_case tool names', () => {
    // OpenAI Responses / Claude rewrite `.` to `_` in function names;
    // the UI may see the wire-format name before orchestrator remapping.
    const t = (key: string) => {
      if (key === 'commander.toolDomain.commander') return 'Commander';
      if (key === 'commander.toolAction.askUser') return 'Ask User';
      return key;
    };
    expect(formatToolName('commander_ask_user', t)).toBe('Commander: Ask User');
    expect(formatToolName('commander.askUser', t)).toBe('Commander: Ask User');
  });
});
