import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { CAS } from '../src/cas.js';

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'lucid-cas-'));
}

describe('CAS', () => {
  let cas: CAS;
  let base: string;
  let srcFile: string;

  beforeEach(() => {
    base = tmpDir();
    cas = new CAS(path.join(base, 'assets'));

    // Create a test source file
    srcFile = path.join(base, 'test-image.png');
    fs.writeFileSync(srcFile, 'fake-png-content-for-testing');
  });

  afterEach(() => {
    fs.rmSync(base, { recursive: true, force: true });
  });

  it('imports an asset and returns ref + meta', async () => {
    const { ref, meta } = await cas.importAsset(srcFile, 'image');

    expect(ref.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(ref.type).toBe('image');
    expect(ref.format).toBe('png');
    expect(meta.originalName).toBe('test-image.png');
    expect(meta.fileSize).toBeGreaterThan(0);
    expect(meta.tags).toEqual([]);
    expect(fs.existsSync(ref.path)).toBe(true);
  });

  it('deduplicates on second import', async () => {
    const first = await cas.importAsset(srcFile, 'image');
    const second = await cas.importAsset(srcFile, 'image');

    expect(first.ref.hash).toBe(second.ref.hash);
    expect(first.meta.originalName).toBe(second.meta.originalName);
  });

  it('getAssetPath returns correct path structure', async () => {
    const { ref } = await cas.importAsset(srcFile, 'image');
    const assetPath = cas.getAssetPath(ref.hash, 'image', 'png');
    expect(assetPath).toContain(ref.hash.slice(0, 2));
    expect(assetPath).toContain(`${ref.hash}.png`);
  });

  it('assetExists returns true for imported assets', async () => {
    const { ref } = await cas.importAsset(srcFile, 'image');
    expect(cas.assetExists(ref.hash, 'image', 'png')).toBe(true);
    expect(cas.assetExists('deadbeef00000000', 'image', 'png')).toBe(false);
  });

  it('uses project root when set', async () => {
    const projectDir = path.join(base, 'my-project');
    fs.mkdirSync(projectDir, { recursive: true });
    cas.setProjectRoot(projectDir);

    const { ref } = await cas.importAsset(srcFile, 'image');
    expect(ref.path).toContain('my-project');
  });

  it('deletes imported asset files and metadata by hash', async () => {
    const { ref } = await cas.importAsset(srcFile, 'image');
    const assetDir = path.dirname(ref.path);
    const metaPath = path.join(assetDir, `${ref.hash}.meta.json`);

    expect(fs.existsSync(ref.path)).toBe(true);
    expect(fs.existsSync(metaPath)).toBe(true);

    cas.deleteAsset(ref.hash);

    expect(fs.existsSync(ref.path)).toBe(false);
    expect(fs.existsSync(metaPath)).toBe(false);
  });
});
