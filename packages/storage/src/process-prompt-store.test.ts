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

function insertLegacyPrompt(
  store: ProcessPromptStore,
  processKey: string,
  name: string,
  customValue: string,
): void {
  const db = (store as unknown as {
    db: { prepare: (sql: string) => { run: (...args: unknown[]) => void } };
  }).db;

  db.prepare(`
    INSERT INTO process_prompts (
      process_key,
      name,
      description,
      default_value,
      custom_value,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(process_key) DO UPDATE SET
      name = excluded.name,
      description = excluded.description,
      default_value = excluded.default_value,
      custom_value = excluded.custom_value,
      updated_at = excluded.updated_at
  `).run(
    processKey,
    name,
    `Legacy ${name}`,
    'Legacy default rules',
    customValue,
    1,
    1,
  );
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
      'character-ref-image-generation': ['two-row model sheet', 'anti-collapse'],
      'location-ref-image-generation': ['wide-establishing', 'No characters, no people'],
      'equipment-ref-image-generation': ['orthographic', 'silhouette'],
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
    };

    expect(PROCESS_PROMPT_DEFAULTS).toHaveLength(32);

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

  it('migrates legacy entity-management custom prompts into the split entity keys', () => {
    const dbPath = createTempDbPath();
    const first = new ProcessPromptStore(dbPath);
    insertLegacyPrompt(first, 'entity-management', 'Entity Management', 'Legacy entity rules');
    first.close();

    const second = new ProcessPromptStore(dbPath);

    expect(second.get('entity-management')).toBeNull();
    expect(second.get('character-management')?.customValue).toBe('Legacy entity rules');
    expect(second.get('location-management')?.customValue).toBe('Legacy entity rules');
    expect(second.get('equipment-management')?.customValue).toBe('Legacy entity rules');
    second.close();
  });

  it('migrates legacy ref-image-generation custom prompts into the split ref-image keys', () => {
    const dbPath = createTempDbPath();
    const first = new ProcessPromptStore(dbPath);
    insertLegacyPrompt(
      first,
      'ref-image-generation',
      'Reference Image Generation',
      'Legacy ref-image rules',
    );
    first.close();

    const second = new ProcessPromptStore(dbPath);

    expect(second.get('ref-image-generation')).toBeNull();
    expect(second.get('character-ref-image-generation')?.customValue).toBe(
      'Legacy ref-image rules',
    );
    expect(second.get('location-ref-image-generation')?.customValue).toBe(
      'Legacy ref-image rules',
    );
    expect(second.get('equipment-ref-image-generation')?.customValue).toBe(
      'Legacy ref-image rules',
    );
    second.close();
  });

  it('migrates legacy preset-and-style custom prompts into split style keys', () => {
    const dbPath = createTempDbPath();
    const first = new ProcessPromptStore(dbPath);
    insertLegacyPrompt(first, 'preset-and-style', 'Preset And Style', 'Legacy style rules');
    first.close();

    const second = new ProcessPromptStore(dbPath);

    expect(second.get('preset-and-style')).toBeNull();
    expect(second.get('node-preset-tracks')?.customValue).toBe('Legacy style rules');
    expect(second.get('preset-definition-management')?.customValue).toBe(
      'Legacy style rules',
    );
    expect(second.get('shot-template-management')?.customValue).toBe('Legacy style rules');
    expect(second.get('color-style-management')?.customValue).toBe('Legacy style rules');
    second.close();
  });

  it('migrates legacy canvas-workflow custom prompts into split canvas keys', () => {
    const dbPath = createTempDbPath();
    const first = new ProcessPromptStore(dbPath);
    insertLegacyPrompt(first, 'canvas-workflow', 'Canvas Workflow', 'Legacy canvas rules');
    first.close();

    const second = new ProcessPromptStore(dbPath);

    expect(second.get('canvas-workflow')).toBeNull();
    expect(second.get('canvas-structure')?.customValue).toBe('Legacy canvas rules');
    expect(second.get('canvas-graph-and-layout')?.customValue).toBe('Legacy canvas rules');
    expect(second.get('canvas-node-editing')?.customValue).toBe('Legacy canvas rules');
    second.close();
  });

  it('migrates legacy provider-and-config custom prompts into split provider keys', () => {
    const dbPath = createTempDbPath();
    const first = new ProcessPromptStore(dbPath);
    insertLegacyPrompt(
      first,
      'provider-and-config',
      'Provider And Config',
      'Legacy provider rules',
    );
    first.close();

    const second = new ProcessPromptStore(dbPath);

    expect(second.get('provider-and-config')).toBeNull();
    expect(second.get('provider-management')?.customValue).toBe('Legacy provider rules');
    expect(second.get('node-provider-selection')?.customValue).toBe(
      'Legacy provider rules',
    );
    expect(second.get('image-config')?.customValue).toBe('Legacy provider rules');
    expect(second.get('video-config')?.customValue).toBe('Legacy provider rules');
    expect(second.get('audio-config')?.customValue).toBe('Legacy provider rules');
    second.close();
  });

  it('migrates legacy audio-generation custom prompts into split audio keys', () => {
    const dbPath = createTempDbPath();
    const first = new ProcessPromptStore(dbPath);
    insertLegacyPrompt(first, 'audio-generation', 'Audio Generation', 'Legacy audio rules');
    first.close();

    const second = new ProcessPromptStore(dbPath);

    expect(second.get('audio-generation')).toBeNull();
    expect(second.get('audio-voice')?.customValue).toBe('Legacy audio rules');
    expect(second.get('audio-music')?.customValue).toBe('Legacy audio rules');
    expect(second.get('audio-sfx')?.customValue).toBe('Legacy audio rules');
    second.close();
  });

  it('throws for unknown process keys', () => {
    const store = new ProcessPromptStore(createTempDbPath());

    expect(() => store.setCustom('unknown-process', 'bad')).toThrow('Process prompt not found');
    expect(() => store.resetToDefault('unknown-process')).toThrow(
      'Process prompt not found',
    );
    expect(store.get('unknown-process')).toBeNull();
    expect(store.getEffectiveValue('unknown-process')).toBeNull();
    store.close();
  });
});
