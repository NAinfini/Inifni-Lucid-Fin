import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import BetterSqlite3 from 'better-sqlite3';
import type { EpisodeId, Series, SeriesId } from '@lucid-fin/contracts';
import {
  setDegradeReporter,
  type DegradeReporter,
} from '@lucid-fin/contracts-parse';
import { SeriesRepository } from './series-repository.js';

const SCHEMA = `
CREATE TABLE series (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  style_guide TEXT,
  episode_ids TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE episodes (
  id TEXT PRIMARY KEY,
  series_id TEXT NOT NULL,
  title TEXT NOT NULL,
  episode_order INTEGER NOT NULL,
  status TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
`;

function openDb(): BetterSqlite3.Database {
  const db = new BetterSqlite3(':memory:');
  db.exec(SCHEMA);
  return db;
}

function mkSeries(id: string, overrides: Partial<Series> = {}): Series {
  return {
    id,
    title: `series ${id}`,
    description: '',
    styleGuide: { scene: {} } as unknown as Series['styleGuide'],
    episodeIds: [],
    createdAt: 100,
    updatedAt: 100,
    ...overrides,
  };
}

describe('SeriesRepository', () => {
  let db: BetterSqlite3.Database;
  let repo: SeriesRepository;
  const reports: Array<{ schema: string; context?: string }> = [];
  const reporter: DegradeReporter = (info) => {
    reports.push({ schema: info.schema, context: info.context });
  };

  beforeEach(() => {
    db = openDb();
    repo = new SeriesRepository(db);
    reports.length = 0;
    setDegradeReporter(reporter);
  });

  afterEach(() => {
    setDegradeReporter(null);
    db.close();
  });

  // ── Series ───────────────────────────────────────────────────

  it('upsertSeries + getSeries round-trips scalar + JSON fields', () => {
    repo.upsertSeries(
      mkSeries('s1', {
        title: 'Alpha',
        description: 'desc',
        episodeIds: ['e1', 'e2'],
      }),
    );
    const got = repo.getSeries('s1' as SeriesId)!;
    expect(got.title).toBe('Alpha');
    expect(got.description).toBe('desc');
    expect(got.episodeIds).toEqual(['e1', 'e2']);
  });

  it('upsertSeries updates existing row', () => {
    repo.upsertSeries(mkSeries('s1', { title: 'v1', updatedAt: 10 }));
    repo.upsertSeries(mkSeries('s1', { title: 'v2', updatedAt: 20 }));
    const got = repo.getSeries('s1' as SeriesId)!;
    expect(got.title).toBe('v2');
    expect(got.updatedAt).toBe(20);
  });

  it('getSeries returns undefined for missing id', () => {
    expect(repo.getSeries('missing' as SeriesId)).toBeUndefined();
  });

  it('deleteSeries cascades to episodes', () => {
    repo.upsertSeries(mkSeries('s1'));
    repo.upsertEpisode({
      id: 'e1',
      seriesId: 's1',
      title: 'Pilot',
      order: 1,
      createdAt: 1,
      updatedAt: 1,
    });
    repo.upsertEpisode({
      id: 'e2',
      seriesId: 's1',
      title: 'Two',
      order: 2,
      createdAt: 1,
      updatedAt: 1,
    });
    repo.deleteSeries('s1' as SeriesId);
    expect(repo.getSeries('s1' as SeriesId)).toBeUndefined();
    expect(repo.listEpisodes('s1' as SeriesId).rows).toEqual([]);
  });

  it('deleteSeries leaves other series episodes intact', () => {
    repo.upsertSeries(mkSeries('s1'));
    repo.upsertSeries(mkSeries('s2'));
    repo.upsertEpisode({
      id: 'e-a', seriesId: 's1', title: 'A', order: 1, createdAt: 1, updatedAt: 1,
    });
    repo.upsertEpisode({
      id: 'e-b', seriesId: 's2', title: 'B', order: 1, createdAt: 1, updatedAt: 1,
    });
    repo.deleteSeries('s1' as SeriesId);
    expect(repo.listEpisodes('s2' as SeriesId).rows.map((r) => r.id)).toEqual(['e-b']);
  });

  it('fault injection: series with non-numeric createdAt reports degrade', () => {
    repo.upsertSeries(mkSeries('good'));
    // Inject a row where created_at is a string — passes SQLite TEXT affinity
    // but zod rejects the shape, so the degrade reporter must fire.
    db.prepare(
      `INSERT INTO series (id, title, description, style_guide, episode_ids, created_at, updated_at)
       VALUES (?, ?, '', '{}', '[]', ?, ?)`,
    ).run('bad', 'Bad', 'not-a-number', 1);
    const got = repo.getSeries('bad' as SeriesId);
    expect(got).toBeUndefined();
    expect(reports.some((r) => r.schema === 'Series')).toBe(true);
  });

  it('fault injection: malformed style_guide JSON reports degrade via reporter', () => {
    repo.upsertSeries(mkSeries('good'));
    db.prepare(
      `INSERT INTO series (id, title, description, style_guide, episode_ids, created_at, updated_at)
       VALUES (?, ?, '', ?, '[]', 1, 1)`,
    ).run('bad', 'Bad', '{"broken":');
    expect(repo.getSeries('bad' as SeriesId)).toBeUndefined();
    expect(reports.some((r) => r.schema === 'Series')).toBe(true);
  });

  // ── Episodes ─────────────────────────────────────────────────

  it('upsertEpisode + listEpisodes orders by episode_order ascending', () => {
    repo.upsertSeries(mkSeries('s1'));
    repo.upsertEpisode({ id: 'e2', seriesId: 's1', title: 'Two', order: 2, createdAt: 1, updatedAt: 1 });
    repo.upsertEpisode({ id: 'e1', seriesId: 's1', title: 'One', order: 1, createdAt: 1, updatedAt: 1 });
    repo.upsertEpisode({ id: 'e3', seriesId: 's1', title: 'Three', order: 3, createdAt: 1, updatedAt: 1 });
    const { rows, degradedCount } = repo.listEpisodes('s1' as SeriesId);
    expect(degradedCount).toBe(0);
    expect(rows.map((r) => r.id)).toEqual(['e1', 'e2', 'e3']);
    expect(rows[0].status).toBe('draft');
  });

  it('deleteEpisode removes the row', () => {
    repo.upsertSeries(mkSeries('s1'));
    repo.upsertEpisode({ id: 'e1', seriesId: 's1', title: 'One', order: 1, createdAt: 1, updatedAt: 1 });
    repo.deleteEpisode('e1' as EpisodeId);
    expect(repo.listEpisodes('s1' as SeriesId).rows).toEqual([]);
  });

  it('fault injection: episode with missing seriesId reports degrade', () => {
    repo.upsertSeries(mkSeries('s1'));
    repo.upsertEpisode({ id: 'good', seriesId: 's1', title: 'G', order: 1, createdAt: 1, updatedAt: 1 });
    // Inject an episode row where series_id passes the NOT NULL constraint
    // with an empty string, which zod (min(1)) will reject.
    db.prepare(
      `INSERT INTO episodes (id, series_id, title, episode_order, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run('bad', '', 'Bad', 2, 'draft', 1, 1);
    const { rows, degradedCount } = repo.listEpisodes('' as SeriesId);
    expect(degradedCount).toBe(1);
    expect(rows).toEqual([]);
    expect(reports.some((r) => r.schema === 'Episode')).toBe(true);
  });

  // ── Transactions ─────────────────────────────────────────────

  it('accepts Tx argument on upserts', () => {
    const tx = db.transaction(() => {
      repo.upsertSeries(mkSeries('tx-s'), db);
      repo.upsertEpisode(
        { id: 'tx-e', seriesId: 'tx-s', title: 'TxEp', order: 1, createdAt: 1, updatedAt: 1 },
        db,
      );
    });
    tx();
    expect(repo.getSeries('tx-s' as SeriesId)?.title).toBe('series tx-s');
    expect(repo.listEpisodes('tx-s' as SeriesId).rows[0].title).toBe('TxEp');
  });
});
