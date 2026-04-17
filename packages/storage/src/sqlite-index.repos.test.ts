import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { SqliteIndex } from './sqlite-index.js';
import { SessionRepository } from './repositories/session-repository.js';
import { JobRepository } from './repositories/job-repository.js';
import { AssetRepository } from './repositories/asset-repository.js';
import { CanvasRepository } from './repositories/canvas-repository.js';
import { EntityRepository } from './repositories/entity-repository.js';
import { SeriesRepository } from './repositories/series-repository.js';
import { PresetRepository } from './repositories/preset-repository.js';
import { ShotTemplateRepository } from './repositories/shot-template-repository.js';
import { SnapshotRepository } from './repositories/snapshot-repository.js';
import { WorkflowRepository } from './repositories/workflow-repository.js';

describe('SqliteIndex.repos bundle (G1-4.1 strangler surface)', () => {
  let base: string;
  let index: SqliteIndex;

  beforeEach(() => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'lucid-sqlite-repos-'));
    index = new SqliteIndex(path.join(base, 'test.db'));
  });

  afterEach(() => {
    index.close();
    fs.rmSync(base, { recursive: true, force: true });
  });

  it('exposes all 10 repositories via the repos getter', () => {
    const { repos } = index;
    expect(repos.sessions).toBeInstanceOf(SessionRepository);
    expect(repos.jobs).toBeInstanceOf(JobRepository);
    expect(repos.assets).toBeInstanceOf(AssetRepository);
    expect(repos.canvases).toBeInstanceOf(CanvasRepository);
    expect(repos.entities).toBeInstanceOf(EntityRepository);
    expect(repos.series).toBeInstanceOf(SeriesRepository);
    expect(repos.presets).toBeInstanceOf(PresetRepository);
    expect(repos.shotTemplates).toBeInstanceOf(ShotTemplateRepository);
    expect(repos.snapshots).toBeInstanceOf(SnapshotRepository);
    expect(repos.workflows).toBeInstanceOf(WorkflowRepository);
  });

  it('repos bundle is stable across accesses (same instances)', () => {
    const a = index.repos;
    const b = index.repos;
    expect(a.sessions).toBe(b.sessions);
    expect(a.workflows).toBe(b.workflows);
  });

  it('repos bundle picks up rebuilt handles after repair()', () => {
    const before = index.repos.sessions;
    index.repair();
    const after = index.repos.sessions;
    // repair() rebuilds repositories against the fresh DB, so instances must change.
    expect(after).not.toBe(before);
    expect(after).toBeInstanceOf(SessionRepository);
  });
});
