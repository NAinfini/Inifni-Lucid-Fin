import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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
      'character-ref-image-generation': ['full-sheet', 'anti-collapse'],
      'location-ref-image-generation': ['bible', 'no characters, no people'],
      'equipment-ref-image-generation': ['ortho-grid', 'silhouette'],
      'image-node-generation': ['five elements', 'canvas.setNodeRefs'],
      'video-node-generation': ['three-part', 'canvas.setVideoFrames'],
      'audio-voice': ['emotionVector', 'bracketed'],
      'audio-music': ['Genre anchor', 'BPM'],
      'audio-sfx': ['Environment acoustics', 'seamless loop'],
      'node-preset-tracks': ['canvas.writePresetTracksBatch', 'category'],
      'preset-definition-management': ['preset.create', 'category'],
      'shot-template-management': ['canvas.applyShotTemplate', 'shotTemplate.create'],
      'color-style-management': ['colorStyle.save', 'palette'],
      'character-management': ['character.create', 'durable identity'],
      'location-management': ['location.create', 'durable place identity'],
      'equipment-management': ['equipment.create', 'durable object identity'],
      'canvas-structure': ['canvas.addNode', 'canvas.batchCreate'],
      'canvas-graph-and-layout': ['canvas.connectNodes', 'Left-to-right'],
      'canvas-node-editing': ['canvas.updateNodes', 'canvas.setNodeRefs'],
      'provider-management': ['provider.list', 'provider.getCapabilities'],
      'node-provider-selection': ['canvas.setNodeProvider', 'providerId'],
      'image-config': ['canvas.setImageParams', 'width'],
      'video-config': ['canvas.setVideoParams', 'duration'],
      'audio-config': ['canvas.setAudioParams', 'emotionVector'],
      'script-development': ['script.write', 'Fountain'],
      'vision-analysis': ['vision.describeImage', 'intent'],
      'snapshot-and-rollback': ['snapshot.restore', 'commander.askUser'],
      'render-and-export': ['render.start', 'render.exportBundle'],
      'workflow-orchestration': ['workflow.expandIdea', 'workflow.control'],
      'series-management': ['series.update', 'episode'],
      'prompt-template-management': ['prompt.setCustom', 'process-prompt store'],
      'asset-library-management': ['asset.import', 'asset.list'],
      'job-control': ['job.control', 'pause'],
      'entities-before-generation': ['reference images', 'character.generateRefImage'],
      'batch-create-guidance': ['batch-creating', 'backdrops'],
      'prompt-quality-gate': ['canvas.getNode', 'canvas.previewPrompt'],
      'story-workflow-phase': ['phase gates', 'ref images'],
    };

    expect(PROCESS_PROMPT_DEFAULTS).toHaveLength(37);

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

  it('throws for unknown process keys', () => {
    const store = new ProcessPromptStore(createTempDbPath());

    expect(() => store.setCustom('unknown-process', 'bad')).toThrow('Process prompt not found');
    expect(() => store.resetToDefault('unknown-process')).toThrow('Process prompt not found');
    expect(store.get('unknown-process')).toBeNull();
    expect(store.getEffectiveValue('unknown-process')).toBeNull();
    store.close();
  });
});
