import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ProjectFS } from '../src/project-fs.js';

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'lucid-test-'));
}

describe('ProjectFS', () => {
  let pfs: ProjectFS;
  let base: string;

  beforeEach(() => {
    pfs = new ProjectFS();
    base = tmpDir();
  });

  afterEach(() => {
    fs.rmSync(base, { recursive: true, force: true });
  });

  describe('createProject', () => {
    it('creates project directory structure and manifest', () => {
      const { manifest, projectPath } = pfs.createProject({ title: 'Test Film', basePath: base });

      expect(manifest.title).toBe('Test Film');
      expect(manifest.id).toMatch(/^[\w-]{36}$/);
      expect(manifest.resolution).toEqual([1920, 1080]);
      expect(manifest.fps).toBe(24);
      expect(fs.existsSync(path.join(projectPath, 'project.json'))).toBe(true);
      expect(fs.existsSync(path.join(projectPath, 'scenes'))).toBe(true);
      expect(fs.existsSync(path.join(projectPath, 'assets', 'image'))).toBe(true);
      expect(fs.existsSync(path.join(projectPath, 'assets', 'video'))).toBe(true);
      expect(fs.existsSync(path.join(projectPath, 'assets', 'audio'))).toBe(true);
      expect(fs.existsSync(path.join(projectPath, 'snapshots'))).toBe(true);
    });

    it('opens existing project instead of throwing on duplicate create', () => {
      const first = pfs.createProject({ title: 'Dup', basePath: base });
      const second = pfs.createProject({ title: 'Dup', basePath: base });
      expect(second.manifest.id).toBe(first.manifest.id);
      expect(second.projectPath).toBe(first.projectPath);
    });

    it('sanitizes unsafe characters in title', () => {
      const { projectPath } = pfs.createProject({ title: 'My<>Film', basePath: base });
      expect(projectPath).not.toContain('<');
      expect(projectPath).not.toContain('>');
    });
  });

  describe('openProject', () => {
    it('reads manifest from existing project', () => {
      const { projectPath } = pfs.createProject({ title: 'Open Me', basePath: base });
      const manifest = pfs.openProject(projectPath);
      expect(manifest.title).toBe('Open Me');
    });

    it('throws for non-existent project', () => {
      expect(() => pfs.openProject(path.join(base, 'nope'))).toThrow('No project.json');
    });
  });

  describe('saveProject', () => {
    it('updates manifest on disk', () => {
      const { manifest, projectPath } = pfs.createProject({ title: 'Save Me', basePath: base });
      manifest.title = 'Saved';
      pfs.saveProject(projectPath, manifest);
      const reloaded = pfs.openProject(projectPath);
      expect(reloaded.title).toBe('Saved');
      expect(reloaded.updatedAt).toBeGreaterThanOrEqual(manifest.createdAt);
    });
  });

  describe('snapshots', () => {
    it('creates, lists, and restores snapshots', () => {
      const { manifest, projectPath } = pfs.createProject({ title: 'Snap Test', basePath: base });

      // Modify script.json to have something to snapshot
      fs.writeFileSync(
        path.join(projectPath, 'script.json'),
        JSON.stringify({ scenes: [{ id: 's1', title: 'Scene 1' }] }),
      );

      const snap = pfs.createSnapshot(projectPath, 'v1');
      expect(snap.name).toBe('v1');
      expect(snap.id).toMatch(/^[\w-]{36}$/);

      const list = pfs.listSnapshots(projectPath);
      expect(list.length).toBe(1);
      expect(list[0].name).toBe('v1');

      // Modify script.json again
      fs.writeFileSync(
        path.join(projectPath, 'script.json'),
        JSON.stringify({ scenes: [{ id: 's2', title: 'Scene 2' }] }),
      );

      // Restore snapshot
      pfs.restoreSnapshot(projectPath, snap.id);
      const restored = JSON.parse(fs.readFileSync(path.join(projectPath, 'script.json'), 'utf-8'));
      expect(restored.scenes[0].id).toBe('s1');
    });

    it('rejects invalid snapshot IDs', () => {
      const { projectPath } = pfs.createProject({ title: 'Bad Snap', basePath: base });
      expect(() => pfs.restoreSnapshot(projectPath, '../../../etc/passwd')).toThrow(
        'Invalid snapshot ID',
      );
    });
  });
});
