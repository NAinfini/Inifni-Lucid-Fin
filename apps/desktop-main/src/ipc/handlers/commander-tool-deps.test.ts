import { describe, expect, it } from 'vitest';
import { mergePromptGuidesWithBuiltIns } from './commander-tool-deps.js';

describe('mergePromptGuidesWithBuiltIns', () => {
  it('keeps caller-provided guides and appends missing built-in workflow guides', () => {
    const merged = mergePromptGuidesWithBuiltIns([
      { id: 'meta-prompt', name: 'Meta Prompt', content: 'template-body' },
      { id: 'wf-video-clone', name: 'Renderer Workflow', content: 'renderer-body' },
    ]);

    expect(merged).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'meta-prompt', content: 'template-body' }),
        expect.objectContaining({ id: 'wf-video-clone', content: 'renderer-body' }),
        expect.objectContaining({ id: 'workflow-style-transfer' }),
      ]),
    );
  });

  it('does not duplicate built-in workflow guides when ids already exist', () => {
    const merged = mergePromptGuidesWithBuiltIns([
      { id: 'workflow-style-transfer', name: 'Custom Override', content: 'custom-body' },
    ]);

    expect(merged.filter((guide) => guide.id === 'workflow-style-transfer')).toHaveLength(1);
    expect(merged.find((guide) => guide.id === 'workflow-style-transfer')).toEqual(
      expect.objectContaining({ name: 'Custom Override', content: 'custom-body' }),
    );
  });
});
