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
  it('ships substantive process guides for every default process', () => {
    const expectedSnippets: Record<string, string[]> = {
      'ref-image-generation': ['one turnaround sheet', '2048x1360', 'provider.getCapabilities'],
      'image-node-generation': ['Foreground, midground, and background spatial layers', 'commander.askUser'],
      'video-node-generation': ['3 to 5 seconds for a quick insert', 'canvas.setVideoFrames'],
      'audio-generation': ['voice, music, or sound effect', 'Sync patterns'],
      'preset-and-style': ['canvas.applyShotTemplate', 'One dominant influence per category'],
      'entity-management': ['commander.askUser', 'structured face fields'],
      'canvas-workflow': ['canvas.batchCreate', 'left-to-right temporal flow'],
      'provider-and-config': ['provider.list', 'Unknown capability means query first or choose the safe minimum'],
      'script-development': ['Fountain format', 'leading period', 'canvas.batchCreate'],
      'vision-analysis': ['reverse-engineer', 'exact counts', 'node prompt'],
      'snapshot-and-rollback': ['snapshot.restore', 'commander.askUser', 'label'],
      'render-and-export': ['render.start', 'render.exportBundle', 'H.264'],
      'workflow-orchestration': ['workflow.expandIdea', 'workflow.control', 'transient failures'],
    };

    expect(PROCESS_PROMPT_DEFAULTS).toHaveLength(13);

    for (const entry of PROCESS_PROMPT_DEFAULTS) {
      expect(entry.defaultValue.length).toBeGreaterThan(700);
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
    store.close();
  });

  it('returns default values until a custom prompt is saved', () => {
    const store = new ProcessPromptStore(createTempDbPath());

    expect(store.getEffectiveValue('provider-and-config')).toBe(
      PROCESS_PROMPT_DEFAULTS.find((entry) => entry.processKey === 'provider-and-config')?.defaultValue,
    );

    store.setCustom('provider-and-config', 'Custom provider rules');

    expect(store.getEffectiveValue('provider-and-config')).toBe('Custom provider rules');
    expect(store.get('provider-and-config')?.customValue).toBe('Custom provider rules');
    store.close();
  });

  it('resets a custom value back to its default', () => {
    const store = new ProcessPromptStore(createTempDbPath());

    store.setCustom('canvas-workflow', 'Temporary override');
    store.resetToDefault('canvas-workflow');

    expect(store.get('canvas-workflow')?.customValue).toBeNull();
    expect(store.getEffectiveValue('canvas-workflow')).toBe(
      PROCESS_PROMPT_DEFAULTS.find((entry) => entry.processKey === 'canvas-workflow')?.defaultValue,
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
