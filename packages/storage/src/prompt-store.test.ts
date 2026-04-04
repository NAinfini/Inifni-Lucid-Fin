import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PromptStore } from './prompt-store.js';

const tempFiles: string[] = [];

function createTempDbPath(): string {
  const dbPath = path.join(
    os.tmpdir(),
    `lucid-fin-prompt-${Date.now()}-${Math.random().toString(16).slice(2)}.db`,
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
        /* ignore */
      }
    }
  }
});

describe('PromptStore', () => {
  it('seeds default prompts on construction', () => {
    const store = new PromptStore(createTempDbPath());
    const all = store.list();
    expect(all.length).toBeGreaterThan(0);
    expect(all.some((p) => p.code === 'agent-system')).toBe(true);
    store.close();
  });

  it('gets prompt by code', () => {
    const store = new PromptStore(createTempDbPath());
    const prompt = store.get('agent-system');
    expect(prompt).toBeDefined();
    expect(prompt!.code).toBe('agent-system');
    expect(prompt!.defaultValue.length).toBeGreaterThan(0);
    store.close();
  });

  it('returns undefined for unknown code', () => {
    const store = new PromptStore(createTempDbPath());
    expect(store.get('nonexistent')).toBeUndefined();
    store.close();
  });

  it('resolve returns defaultValue when no custom set', () => {
    const store = new PromptStore(createTempDbPath());
    const val = store.resolve('agent-system');
    expect(val.length).toBeGreaterThan(0);
    expect(val).toContain('Lucid Fin');
    store.close();
  });

  it('custom value overrides default', () => {
    const store = new PromptStore(createTempDbPath());
    store.setCustom('agent-system', 'Custom prompt');
    const prompt = store.get('agent-system');
    expect(prompt!.customValue).toBe('Custom prompt');
    expect(store.resolve('agent-system')).toBe('Custom prompt');
    store.close();
  });

  it('clearCustom restores default', () => {
    const store = new PromptStore(createTempDbPath());
    store.setCustom('agent-system', 'temp');
    store.clearCustom('agent-system');
    const prompt = store.get('agent-system');
    expect(prompt!.customValue).toBeNull();
    expect(store.resolve('agent-system')).toContain('Lucid Fin');
    store.close();
  });

  it('resolve throws for unknown code', () => {
    const store = new PromptStore(createTempDbPath());
    expect(() => store.resolve('nonexistent')).toThrow('Prompt not found');
    store.close();
  });

  it('setCustom throws for unknown code', () => {
    const store = new PromptStore(createTempDbPath());
    expect(() => store.setCustom('nonexistent', 'val')).toThrow('Prompt not found');
    store.close();
  });

  it('has all expected default prompts', () => {
    const store = new PromptStore(createTempDbPath());
    const codes = store.list().map((p) => p.code);
    expect(codes).toContain('agent-system');
    expect(codes).toContain('novel-to-script');
    expect(codes).toContain('character-extract');
    expect(codes).toContain('script-breakdown');
    expect(codes).toContain('segment-generate');
    store.close();
  });

  it('does not duplicate on re-open', () => {
    const dbPath = createTempDbPath();
    const store1 = new PromptStore(dbPath);
    const count1 = store1.list().length;
    store1.close();

    const store2 = new PromptStore(dbPath);
    const count2 = store2.list().length;
    store2.close();

    expect(count2).toBe(count1);
  });
});
