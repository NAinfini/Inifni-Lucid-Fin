import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import type { ProjectManifest, Snapshot, StyleGuide } from '@lucid-fin/contracts';
import type { SqliteIndex } from './sqlite-index.js';
import { ensureDir, atomicWrite, readJson } from './utils.js';

const APP_DIR = path.join(os.homedir(), '.lucid-fin');
const RECENT_FILE = path.join(APP_DIR, 'recent-projects.json');
const DEFAULT_STYLE_GUIDE: StyleGuide = {
  global: {
    artStyle: '',
    colorPalette: { primary: '', secondary: '', forbidden: [] },
    lighting: 'natural',
    texture: '',
    referenceImages: [],
    freeformDescription: '',
  },
  sceneOverrides: {},
};

export class ProjectFS {
  createProject(config: {
    title: string;
    description?: string;
    genre?: string;
    resolution?: [number, number];
    fps?: number;
    basePath?: string;
  }): { manifest: ProjectManifest; projectPath: string } {
    const id = randomUUID();
    const now = Date.now();
    // Sanitize title for filesystem safety — strip path separators and non-printable chars
    const safeTitle = config.title.replace(/[<>:"/\\|?*]/g, '_').replace(/[^\x20-\x7E\x80-\uFFFF]/g, '_').trim() || 'untitled';
    const projectDir = path.join(
      config.basePath ?? path.join(APP_DIR, 'projects'),
      `${safeTitle}.lucid`,
    );

    // If project already exists on disk, open it instead of failing
    if (fs.existsSync(path.join(projectDir, 'project.json'))) {
      const manifest = this.openProject(projectDir);
      this.updateRecent(manifest.id, manifest.title, projectDir);
      return { manifest, projectPath: projectDir };
    }

    // Create .lucid directory structure per 03-data-flow.md
    ensureDir(projectDir);
    ensureDir(path.join(projectDir, 'scenes'));
    ensureDir(path.join(projectDir, 'assets', 'image'));
    ensureDir(path.join(projectDir, 'assets', 'video'));
    ensureDir(path.join(projectDir, 'assets', 'audio'));
    ensureDir(path.join(projectDir, 'snapshots'));
    ensureDir(path.join(projectDir, 'templates'));
    ensureDir(path.join(projectDir, 'jobs'));

    const manifest: ProjectManifest = {
      id,
      title: config.title,
      description: config.description ?? '',
      genre: config.genre ?? '',
      resolution: config.resolution ?? [1920, 1080],
      fps: config.fps ?? 24,
      aspectRatio: '16:9',
      createdAt: now,
      updatedAt: now,
      aiProviders: [],
      snapshots: [],
      styleGuide: DEFAULT_STYLE_GUIDE,
    };

    // Write initial files
    atomicWrite(path.join(projectDir, 'project.json'), manifest);
    atomicWrite(path.join(projectDir, 'script.json'), { scenes: [] });
    atomicWrite(path.join(projectDir, 'characters.json'), { characters: [] });
    atomicWrite(path.join(projectDir, 'style-guide.json'), DEFAULT_STYLE_GUIDE);
    atomicWrite(path.join(projectDir, 'timeline.json'), {
      tracks: [],
      totalDuration: 0,
      fps: manifest.fps,
      updatedAt: now,
    });
    atomicWrite(path.join(projectDir, 'title-cards.json'), { cards: [] });
    atomicWrite(path.join(projectDir, 'jobs', 'job-log.json'), { entries: [] });

    // Track in recent projects
    this.addToRecent(id, config.title, projectDir);

    return { manifest, projectPath: projectDir };
  }

  openProject(projectPath: string): ProjectManifest {
    const manifestPath = path.join(projectPath, 'project.json');
    if (!fs.existsSync(manifestPath)) {
      throw new Error(`No project.json found at ${projectPath}`);
    }
    const manifest = readJson<ProjectManifest>(manifestPath);
    this.addToRecent(manifest.id, manifest.title, projectPath);
    return manifest;
  }

  saveProject(projectPath: string, manifest: ProjectManifest): void {
    manifest.updatedAt = Date.now();
    atomicWrite(path.join(projectPath, 'project.json'), manifest);
    this.updateRecent(manifest.id, manifest.title, projectPath);
  }

  listRecentProjects(): Array<{ id: string; title: string; path: string; updatedAt: number }> {
    ensureDir(APP_DIR);
    if (!fs.existsSync(RECENT_FILE)) return [];
    const all = readJson<Array<{ id: string; title: string; path: string; updatedAt: number }>>(
      RECENT_FILE,
    );
    return all.filter((p) => fs.existsSync(path.join(p.path, 'project.json')));
  }

  createSnapshot(projectPath: string, name: string, db?: SqliteIndex): Snapshot {
    const id = randomUUID();
    const now = Date.now();
    const snapshotDir = path.join(projectPath, 'snapshots');
    ensureDir(snapshotDir);

    // Collect current state
    const state: Record<string, unknown> = {};
    const filesToSnapshot = [
      'project.json',
      'script.json',
      'characters.json',
      'style-guide.json',
      'timeline.json',
      'title-cards.json',
    ];
    for (const file of filesToSnapshot) {
      const fp = path.join(projectPath, file);
      if (fs.existsSync(fp)) {
        state[file] = readJson(fp);
      }
    }

    // Include scene files
    const scenesDir = path.join(projectPath, 'scenes');
    if (fs.existsSync(scenesDir)) {
      const sceneFiles = fs.readdirSync(scenesDir).filter((f) => f.endsWith('.json'));
      state['scenes'] = Object.fromEntries(
        sceneFiles.map((f) => [f, readJson(path.join(scenesDir, f))]),
      );
    }

    // Include SQLite-managed entities if db is available
    if (db) {
      const manifestPath = path.join(projectPath, 'project.json');
      if (fs.existsSync(manifestPath)) {
        const manifest = readJson<ProjectManifest>(manifestPath);
        const projectId = manifest.id;
        state['__sqlite_entities'] = {
          characters: db.listCharacters(projectId),
          equipment: db.listEquipment(projectId),
          locations: db.listLocations(projectId),
          scenes: db.listScenes(projectId),
          canvases: db.listCanvasesFull(projectId),
          presetOverrides: db.listPresetOverrides(projectId),
        };
      }
    }

    const snapshot: Snapshot = { id, name, createdAt: now };
    atomicWrite(path.join(snapshotDir, `snap-${id}.json`), { ...snapshot, state });

    // Update manifest snapshots array
    const manifest = this.openProject(projectPath);
    manifest.snapshots.push(snapshot);
    this.saveProject(projectPath, manifest);

    return snapshot;
  }

  listSnapshots(projectPath: string): Snapshot[] {
    const manifest = readJson<ProjectManifest>(path.join(projectPath, 'project.json'));
    return manifest.snapshots;
  }

  restoreSnapshot(projectPath: string, snapshotId: string, db?: SqliteIndex): void {
    // Validate snapshotId is a safe UUID-like string (no path separators)
    if (!/^[\w-]+$/.test(snapshotId)) {
      throw new Error(`Invalid snapshot ID: ${snapshotId}`);
    }

    const snapshotDir = path.join(projectPath, 'snapshots');
    const snapshotPath = path.join(snapshotDir, `snap-${snapshotId}.json`);
    if (!fs.existsSync(snapshotPath)) {
      throw new Error(`Snapshot ${snapshotId} not found`);
    }

    const data = readJson<{ state: Record<string, unknown> }>(snapshotPath);
    const resolvedRoot = path.resolve(projectPath);

    // Allowlisted root-level files that can be restored
    const ALLOWED_ROOT_FILES = new Set([
      'project.json',
      'script.json',
      'characters.json',
      'style-guide.json',
      'timeline.json',
      'title-cards.json',
    ]);

    // Restore root-level JSON files (allowlisted only)
    for (const [file, content] of Object.entries(data.state)) {
      if (file === 'scenes') continue;
      if (!ALLOWED_ROOT_FILES.has(file)) continue;
      const target = path.resolve(projectPath, file);
      if (!target.startsWith(resolvedRoot + path.sep)) continue;
      atomicWrite(target, content);
    }

    // Restore scene files (validate filenames)
    if (data.state['scenes']) {
      const scenesDir = path.join(projectPath, 'scenes');
      ensureDir(scenesDir);
      // Clear existing scenes
      for (const f of fs.readdirSync(scenesDir)) {
        fs.unlinkSync(path.join(scenesDir, f));
      }
      for (const [file, content] of Object.entries(
        data.state['scenes'] as Record<string, unknown>,
      )) {
        // Validate scene filename stays within scenes directory
        if (!/^[\w.-]+\.json$/.test(file)) continue;
        const target = path.resolve(scenesDir, file);
        if (!target.startsWith(path.resolve(scenesDir) + path.sep)) continue;
        atomicWrite(target, content);
      }
    }

    // Restore SQLite-managed entities if db is available and snapshot contains them
    if (db && data.state['__sqlite_entities']) {
      const entities = data.state['__sqlite_entities'] as Record<string, unknown[]>;
      if (Array.isArray(entities.characters)) {
        for (const char of entities.characters as Parameters<typeof db.upsertCharacter>[0][]) {
          db.upsertCharacter(char);
        }
      }
      if (Array.isArray(entities.equipment)) {
        for (const equip of entities.equipment as Parameters<typeof db.upsertEquipment>[0][]) {
          db.upsertEquipment(equip);
        }
      }
      if (Array.isArray(entities.locations)) {
        for (const loc of entities.locations as Parameters<typeof db.upsertLocation>[0][]) {
          db.upsertLocation(loc);
        }
      }
      if (Array.isArray(entities.scenes)) {
        for (const scene of entities.scenes as Parameters<typeof db.upsertScene>[0][]) {
          db.upsertScene(scene);
        }
      }
      if (Array.isArray(entities.canvases)) {
        for (const canvas of entities.canvases as Parameters<typeof db.upsertCanvas>[0][]) {
          db.upsertCanvas(canvas);
        }
      }
      if (Array.isArray(entities.presetOverrides)) {
        for (const override of entities.presetOverrides as Parameters<typeof db.upsertPresetOverride>[0][]) {
          db.upsertPresetOverride(override);
        }
      }
    }
  }

  private addToRecent(id: string, title: string, projectPath: string): void {
    ensureDir(APP_DIR);
    const recent = fs.existsSync(RECENT_FILE)
      ? readJson<Array<{ id: string; title: string; path: string; updatedAt: number }>>(RECENT_FILE)
      : [];
    const filtered = recent.filter((r) => r.id !== id);
    filtered.unshift({ id, title, path: projectPath, updatedAt: Date.now() });
    atomicWrite(RECENT_FILE, filtered.slice(0, 20));
  }

  private updateRecent(id: string, title: string, projectPath: string): void {
    this.addToRecent(id, title, projectPath);
  }
}
