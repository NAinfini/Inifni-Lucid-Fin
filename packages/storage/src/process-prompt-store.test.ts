import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { COMMANDER_GUIDE_LIMITS } from '@lucid-fin/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { PROCESS_PROMPT_DEFAULTS, ProcessPromptStore } from './process-prompt-store.js';

const tempFiles: string[] = [];
const RETIRED_PROCESS_PROMPT_KEYS = [
  'ordered-delivery',
  'task-list-orchestration',
  'style-plate-lock',
  'entities-before-generation',
  'batch-create-guidance',
  'prompt-quality-gate',
  'story-task-list-phase',
] as const;

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
  it('ships concise reference facts for every retained process category', () => {
    const expectedSnippets: Record<string, string[]> = {
      'entity-ref-image-generation': ['full-sheet', 'anti-collapse', 'ortho-grid', 'bible'],
      'image-node-generation': ['five elements', 'canvas.setNodeRefs'],
      'video-node-generation': ['three-part', 'canvas.setVideoFrames'],
      'audio-generation': [
        'emotionVector',
        'Bracketed',
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
      'snapshot-and-rollback': ['snapshot.restore', 'authenticated user confirmation'],
      'prompt-template-management': ['prompt.setCustom', 'process-prompt store'],
      'asset-library-management': ['asset.import', 'asset.list'],
      'canvas-settings': ['canvas.getInfo', 'stylePlate'],
    };

    expect(PROCESS_PROMPT_DEFAULTS).toHaveLength(21);

    const processKeys = PROCESS_PROMPT_DEFAULTS.map((entry) => entry.processKey);

    for (const entry of PROCESS_PROMPT_DEFAULTS) {
      expect(entry.defaultValue.length).toBeGreaterThan(220);
      for (const snippet of expectedSnippets[entry.processKey] ?? []) {
        expect(entry.defaultValue).toContain(snippet);
      }
    }

    for (const processKey of RETIRED_PROCESS_PROMPT_KEYS) {
      expect(processKeys).not.toContain(processKey);
    }
  });

  it('keeps retained guides free of fixed host workflows and forced questions', () => {
    const fixedWorkflowPatterns = [
      /reference workflow/i,
      /commander\.askUser/i,
      /\b(?:must|stop|always|exactly once)\b/i,
      /^\s*\d+\.\s+(?:call|read|write|create|use|check|verify)\b/im,
      /blind retry/i,
    ];

    for (const entry of PROCESS_PROMPT_DEFAULTS) {
      for (const pattern of fixedWorkflowPatterns) {
        expect(entry.defaultValue).not.toMatch(pattern);
      }
    }

    expect(
      PROCESS_PROMPT_DEFAULTS.find((entry) => entry.processKey === 'image-node-generation')
        ?.defaultValue,
    ).toContain('byte-for-byte');
    expect(
      PROCESS_PROMPT_DEFAULTS.find((entry) => entry.processKey === 'snapshot-and-rollback')
        ?.defaultValue,
    ).toContain('authenticated user confirmation');
  });

  it('seeds retained creative guides on construction', () => {
    const store = new ProcessPromptStore(createTempDbPath());

    const prompts = store.list();
    const retainedCreativeKeys = [
      'entity-ref-image-generation',
      'image-node-generation',
      'video-node-generation',
      'audio-generation',
      'vision-analysis',
      'script-development',
    ];

    expect(prompts).toHaveLength(PROCESS_PROMPT_DEFAULTS.length);
    for (const processKey of retainedCreativeKeys) {
      expect(prompts.some((prompt) => prompt.processKey === processKey)).toBe(true);
      expect(store.getEffectiveValue(processKey)).not.toBeNull();
    }
    store.close();
  });

  it('returns a retained creative default value until a custom prompt is saved', () => {
    const store = new ProcessPromptStore(createTempDbPath());

    expect(store.getEffectiveValue('image-node-generation')).toBe(
      PROCESS_PROMPT_DEFAULTS.find((entry) => entry.processKey === 'image-node-generation')
        ?.defaultValue,
    );

    store.setCustom('image-node-generation', 'Custom image rules');

    expect(store.getEffectiveValue('image-node-generation')).toBe('Custom image rules');
    expect(store.get('image-node-generation')?.customValue).toBe('Custom image rules');
    store.close();
  });

  it('resets a retained creative custom value back to its default', () => {
    const store = new ProcessPromptStore(createTempDbPath());

    store.setCustom('video-node-generation', 'Temporary override');
    store.resetToDefault('video-node-generation');

    expect(store.get('video-node-generation')?.customValue).toBeNull();
    expect(store.getEffectiveValue('video-node-generation')).toBe(
      PROCESS_PROMPT_DEFAULTS.find((entry) => entry.processKey === 'video-node-generation')
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

  it('keeps retired rows and custom values while hiding them from the current catalog', () => {
    const dbPath = createTempDbPath();
    const first = new ProcessPromptStore(dbPath);
    first.seedDefaults(
      RETIRED_PROCESS_PROMPT_KEYS.map((processKey) => ({
        processKey,
        name: `Retired ${processKey}`,
        description: 'Retained for compatibility',
        defaultValue: 'Legacy rules',
      })),
    );
    first.setCustom('ordered-delivery', 'Retained custom delivery guide');

    const firstListedKeys = first.list().map((prompt) => prompt.processKey);
    for (const processKey of RETIRED_PROCESS_PROMPT_KEYS) {
      expect(firstListedKeys).not.toContain(processKey);
      expect(first.get(processKey)?.defaultValue).toBe('Legacy rules');
    }
    expect(first.get('ordered-delivery')?.customValue).toBe('Retained custom delivery guide');
    first.close();

    const second = new ProcessPromptStore(dbPath);
    const secondListedKeys = second.list().map((prompt) => prompt.processKey);
    for (const processKey of RETIRED_PROCESS_PROMPT_KEYS) {
      expect(secondListedKeys).not.toContain(processKey);
      expect(second.get(processKey)?.defaultValue).toBe('Legacy rules');
    }
    expect(second.get('ordered-delivery')?.customValue).toBe('Retained custom delivery guide');
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
