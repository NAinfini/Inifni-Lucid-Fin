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
    expect(val).toContain('Specialized process guidance may be injected');
    expect(val).not.toContain('Generation baseline');
    expect(val).not.toContain('Prompt compilation');
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
    expect(codes).toHaveLength(5);
    expect(codes).toContain('agent-system');
    expect(codes).toContain('domain-canvas-tools');
    expect(codes).toContain('novel-to-script');
    expect(codes).toContain('character-extract');
    expect(codes).toContain('script-breakdown');
    expect(codes).not.toContain('domain-script');
    expect(codes).not.toContain('domain-project');
    expect(codes).not.toContain('segment-generate');
    expect(codes).not.toContain('domain-vision');
    expect(codes).not.toContain('domain-video-clone');
    expect(codes).not.toContain('domain-dual-prompt');
    expect(codes).not.toContain('domain-lipsync');
    expect(codes).not.toContain('domain-emotion-tts');
    expect(codes).not.toContain('domain-cross-frame');
    expect(codes).not.toContain('domain-semantic-search');
    expect(store.get('domain-script')).toBeUndefined();
    expect(store.get('domain-project')).toBeUndefined();
    expect(store.get('segment-generate')).toBeUndefined();
    store.close();
  });

  it('keeps only the minimal always-loaded prompt set', () => {
    const store = new PromptStore(createTempDbPath());
    const codes = new Set(store.list().map((p) => p.code));

    expect(codes.has('domain-canvas-video-rules')).toBe(false);
    expect(codes.has('domain-canvas-video-workflow')).toBe(false);
    expect(codes.has('domain-entity')).toBe(false);
    expect(codes.has('domain-preset-tools')).toBe(false);
    expect(codes.has('domain-preset-tracks')).toBe(false);
    expect(codes.has('domain-generation-providers')).toBe(false);
    expect(codes.has('domain-generation-guides')).toBe(false);
    expect(codes.has('segment-generate')).toBe(false);
    expect(codes.has('domain-vision')).toBe(false);
    expect(codes.has('domain-video-clone')).toBe(false);
    expect(codes.has('domain-dual-prompt')).toBe(false);
    expect(codes.has('domain-lipsync')).toBe(false);
    expect(codes.has('domain-emotion-tts')).toBe(false);
    expect(codes.has('domain-cross-frame')).toBe(false);
    expect(codes.has('domain-semantic-search')).toBe(false);

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
