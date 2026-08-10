import { describe, expect, it } from 'vitest';
import { mergePromptGuidesWithBuiltIns } from './helpers.js';

describe('mergePromptGuidesWithBuiltIns', () => {
  it('keeps the host process guide authoritative when a renderer guide reuses its id', () => {
    const merged = mergePromptGuidesWithBuiltIns(
      [
        { id: 'process:workflow-orchestration', name: 'Shadow', content: 'renderer shadow' },
        { id: 'custom-guide', name: 'Custom', content: 'custom content' },
      ],
      [
        {
          id: 'process:workflow-orchestration',
          name: 'Workflow orchestration',
          content: 'host process rules',
        },
      ],
    );

    expect(merged).toEqual([
      {
        id: 'process:workflow-orchestration',
        name: 'Workflow orchestration',
        content: 'host process rules',
      },
      { id: 'custom-guide', name: 'Custom', content: 'custom content' },
    ]);
  });
});
