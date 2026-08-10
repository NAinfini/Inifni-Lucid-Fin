import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { COMMANDER_GUIDE_LIMITS } from '@lucid-fin/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { PROCESS_PROMPT_DEFAULTS, ProcessPromptStore } from './process-prompt-store.js';

const tempFiles: string[] = [];

function createTempDbPath(): string {
  const dbPath = path.join(
    os.tmpdir(),
    `lucid-fin-process-prompt-${Date.now()}-${Math.random().toString(16).slice(2)}.db`,
  );
  tempFiles.push(dbPath, `${dbPath}-wal`, `${dbPath}-shm`);
  return dbPath;
}

afterEach(() => {
  for (const file of tempFiles.splice(0)) {
    if (fs.existsSync(file)) {
      try {
        fs.rmSync(file, { force: true });
      } catch {
        /* ignore cleanup failures */
      }
    }
  }
});

describe('ProcessPromptStore', () => {
  it('ships compact, substantive defaults for every process category', () => {
    const expectedSnippets: Record<string, string[]> = {
      'entity-ref-image-generation': ['full-sheet', 'anti-collapse', 'ortho-grid', 'bible'],
      'image-node-generation': ['five elements', 'canvas.setNodeRefs'],
      'video-node-generation': ['three-part', 'canvas.setVideoFrames'],
      'audio-generation': [
        'emotionVector',
        'bracketed',
        'Genre anchor',
        'BPM',
        'Environment acoustics',
        'seamless loop',
      ],
      'node-preset-tracks': ['canvas.presetTracks', 'category'],
      'preset-definition-management': ['preset.manage', 'category'],
      'shot-template-management': ['canvas.presetTracks', 'shotTemplate.manage'],
      'color-style-management': ['colorStyle.manage', 'palette'],
      'entity-management': ['entity.list', 'durable identity'],
      'canvas-structure': ['canvas.createNodes'],
      'canvas-graph-and-layout': ['canvas.connectNodes', 'Left-to-right'],
      'canvas-node-editing': ['canvas.updateNodes', 'canvas.setNodeRefs'],
      'provider-management': ['provider.manage'],
      'node-provider-selection': ['canvas.configureNode', 'providerId'],
      'media-config': ['canvas.setMediaParams', 'width', 'duration', 'emotionVector'],
      'script-development': ['script.manage', 'Fountain'],
      'vision-analysis': ['text.analyze', 'intent'],
      'snapshot-and-rollback': ['snapshot.restore', 'commander.askUser'],
      'render-and-export': ['render.start', 'render.exportBundle'],
      'workflow-orchestration': [
        'workflow.manage',
        'workflow.visual',
        'workflow.media',
        'visible preview selector',
      ],
      'series-management': ['series.update', 'episode'],
      'prompt-template-management': ['prompt.setCustom', 'process-prompt store'],
      'asset-library-management': ['asset.import', 'asset.list'],
      'job-control': ['job.control', 'pause'],
      'entities-before-generation': ['reference images', 'entity.generateRefImage'],
      'batch-create-guidance': ['batch-creating', 'backdrops'],
      'prompt-quality-gate': ['canvas.getNode', 'canvas.previewPrompt'],
      'story-workflow-phase': [
        'The only approval gates',
        'Production Plan',
        'Visual Constitution',
        'workflow.visual',
        'workflow.media',
      ],
      'canvas-settings': ['canvas.getInfo', 'stylePlate'],
    };

    expect(PROCESS_PROMPT_DEFAULTS).toHaveLength(30);

    for (const entry of PROCESS_PROMPT_DEFAULTS) {
      expect(entry.defaultValue.length).toBeGreaterThan(220);
      for (const snippet of expectedSnippets[entry.processKey] ?? []) {
        expect(entry.defaultValue).toContain(snippet);
      }
    }
  });

  it('seeds defaults on construction', () => {
    const store = new ProcessPromptStore(createTempDbPath());

    const prompts = store.list();

    expect(prompts).toHaveLength(PROCESS_PROMPT_DEFAULTS.length);
    expect(prompts.some((prompt) => prompt.processKey === 'image-node-generation')).toBe(true);
    expect(prompts.some((prompt) => prompt.processKey === 'provider-management')).toBe(true);
    store.close();
  });

  it('returns default values until a custom prompt is saved', () => {
    const store = new ProcessPromptStore(createTempDbPath());

    expect(store.getEffectiveValue('provider-management')).toBe(
      PROCESS_PROMPT_DEFAULTS.find((entry) => entry.processKey === 'provider-management')
        ?.defaultValue,
    );

    store.setCustom('provider-management', 'Custom provider rules');

    expect(store.getEffectiveValue('provider-management')).toBe('Custom provider rules');
    expect(store.get('provider-management')?.customValue).toBe('Custom provider rules');
    store.close();
  });

  it('resets a custom value back to its default', () => {
    const store = new ProcessPromptStore(createTempDbPath());

    store.setCustom('canvas-node-editing', 'Temporary override');
    store.resetToDefault('canvas-node-editing');

    expect(store.get('canvas-node-editing')?.customValue).toBeNull();
    expect(store.getEffectiveValue('canvas-node-editing')).toBe(
      PROCESS_PROMPT_DEFAULTS.find((entry) => entry.processKey === 'canvas-node-editing')
        ?.defaultValue,
    );
    store.close();
  });

  it('does not duplicate seeded rows when reopening the same database', () => {
    const dbPath = createTempDbPath();
    const first = new ProcessPromptStore(dbPath);
    const firstCount = first.list().length;
    first.close();

    const second = new ProcessPromptStore(dbPath);
    const secondCount = second.list().length;
    second.close();

    expect(secondCount).toBe(firstCount);
  });

  it('keeps legacy rows in storage while hiding them from the current catalog', () => {
    const dbPath = createTempDbPath();
    const first = new ProcessPromptStore(dbPath);
    first.seedDefaults([
      {
        processKey: 'legacy-process',
        name: 'Legacy Process',
        description: 'Retained for compatibility',
        defaultValue: 'Legacy rules',
      },
    ]);

    expect(first.list().some((prompt) => prompt.processKey === 'legacy-process')).toBe(false);
    expect(first.get('legacy-process')?.defaultValue).toBe('Legacy rules');
    first.close();

    const second = new ProcessPromptStore(dbPath);
    expect(second.list().some((prompt) => prompt.processKey === 'legacy-process')).toBe(false);
    expect(second.get('legacy-process')?.defaultValue).toBe('Legacy rules');
    second.close();
  });

  it('rejects custom process prompts above the shared size limit', () => {
    const store = new ProcessPromptStore(createTempDbPath());

    expect(() =>
      store.setCustom(
        'provider-management',
        'x'.repeat(COMMANDER_GUIDE_LIMITS.maxProcessPromptChars + 1),
      ),
    ).toThrow(`at most ${COMMANDER_GUIDE_LIMITS.maxProcessPromptChars} characters`);
    expect(store.get('provider-management')?.customValue).toBeNull();
    store.close();
  });

  it('throws for unknown process keys', () => {
    const store = new ProcessPromptStore(createTempDbPath());

    expect(() => store.setCustom('unknown-process', 'bad')).toThrow('Process prompt not found');
    expect(() => store.resetToDefault('unknown-process')).toThrow('Process prompt not found');
    expect(store.get('unknown-process')).toBeNull();
    expect(store.getEffectiveValue('unknown-process')).toBeNull();
    store.close();
  });
});
