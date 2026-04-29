import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import BetterSqlite3 from 'better-sqlite3';
import type {
  Character,
  CharacterId,
  Equipment,
  EquipmentId,
  Location,
  LocationId,
} from '@lucid-fin/contracts';
import { setDegradeReporter, type DegradeReporter } from '@lucid-fin/contracts-parse';
import { EntityRepository } from './entity-repository.js';

const SCHEMA = `
CREATE TABLE characters (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT,
  description TEXT,
  appearance TEXT,
  personality TEXT,
  costumes TEXT,
  tags TEXT,
  age INTEGER,
  gender TEXT,
  voice TEXT,
  face TEXT,
  hair TEXT,
  skin_tone TEXT,
  body TEXT,
  distinct_traits TEXT,
  vocal_traits TEXT,
  reference_images TEXT,
  loadouts TEXT,
  default_loadout_id TEXT,
  folder_id TEXT,
  created_at INTEGER,
  updated_at INTEGER
);
CREATE TABLE equipment (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT,
  subtype TEXT,
  description TEXT,
  function_desc TEXT,
  material TEXT,
  color TEXT,
  condition TEXT,
  visual_details TEXT,
  tags TEXT,
  reference_images TEXT,
  folder_id TEXT,
  created_at INTEGER,
  updated_at INTEGER
);
CREATE TABLE locations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT,
  sub_location TEXT,
  description TEXT,
  time_of_day TEXT,
  mood TEXT,
  weather TEXT,
  lighting TEXT,
  architecture_style TEXT,
  dominant_colors TEXT,
  key_features TEXT,
  atmosphere_keywords TEXT,
  tags TEXT,
  reference_images TEXT,
  folder_id TEXT,
  created_at INTEGER,
  updated_at INTEGER
);
`;

function openDb(): BetterSqlite3.Database {
  const db = new BetterSqlite3(':memory:');
  db.exec(SCHEMA);
  return db;
}

describe('EntityRepository', () => {
  let db: BetterSqlite3.Database;
  let repo: EntityRepository;
  const reports: Array<{ schema: string; context?: string }> = [];
  const reporter: DegradeReporter = (info) => {
    reports.push({ schema: info.schema, context: info.context });
  };

  beforeEach(() => {
    db = openDb();
    repo = new EntityRepository(db);
    reports.length = 0;
    setDegradeReporter(reporter);
  });

  afterEach(() => {
    setDegradeReporter(null);
    db.close();
  });

  // ── Characters ───────────────────────────────────────────────

  it('character: upsert + get round-trips canonical fields', () => {
    repo.upsertCharacter({
      id: 'c1',
      name: 'Alice',
      role: 'protagonist',
      tags: ['hero'],
      costumes: [{ id: 'x', name: 'cloak', description: '' }],
      createdAt: 1,
      updatedAt: 2,
    });
    const got = repo.getCharacter('c1' as CharacterId);
    expect(got?.name).toBe('Alice');
    expect(got?.role).toBe('protagonist');
    expect(got?.tags).toEqual(['hero']);
    expect(got?.costumes).toHaveLength(1);
  });

  it('character: upsert updates existing row (name + updatedAt advance)', () => {
    repo.upsertCharacter({ id: 'c1', name: 'v1', createdAt: 10, updatedAt: 10 });
    repo.upsertCharacter({ id: 'c1', name: 'v2', updatedAt: 20 });
    const got = repo.getCharacter('c1' as CharacterId)!;
    expect(got.name).toBe('v2');
    expect(got.updatedAt).toBe(20);
  });

  it('character: list orders by name ascending', () => {
    repo.upsertCharacter({ id: 'c1', name: 'Zed' });
    repo.upsertCharacter({ id: 'c2', name: 'Alice' });
    const { rows, degradedCount } = repo.listCharacters();
    expect(degradedCount).toBe(0);
    expect(rows.map((r) => r.name)).toEqual(['Alice', 'Zed']);
  });

  it('character: delete removes the row', () => {
    repo.upsertCharacter({ id: 'c1', name: 'Alice' });
    repo.deleteCharacter('c1' as CharacterId);
    expect(repo.getCharacter('c1' as CharacterId)).toBeUndefined();
  });

  it('character: fault injection — malformed JSON column surfaces as degraded + reports', () => {
    repo.upsertCharacter({ id: 'good', name: 'Good' });
    // Inject a row with corrupt `costumes` JSON payload + invalid role enum
    // so zod rejects the shape after the tolerant rowToCharacter normalizes.
    db.prepare(
      `INSERT INTO characters (id, name, role, description, appearance, personality,
         costumes, tags, age, gender, voice, reference_images, loadouts, default_loadout_id,
         created_at, updated_at)
       VALUES (?, ?, ?, '', '', '', ?, '[]', null, null, null, '[]', '[]', '', 1, 1)`,
    ).run('bad', 'Bad', 'not-a-role', '[');
    const { rows, degradedCount } = repo.listCharacters();
    expect(degradedCount).toBe(1);
    expect(rows.map((r) => r.id)).toEqual(['good']);
    expect(reports.some((r) => r.schema === 'Character')).toBe(true);
  });

  // ── Equipment ────────────────────────────────────────────────

  it('equipment: upsert + get round-trips type + functionDesc', () => {
    repo.upsertEquipment({
      id: 'e1',
      name: 'Sword',
      type: 'weapon',
      functionDesc: 'sharp',
      tags: ['metal'],
      createdAt: 1,
      updatedAt: 1,
    });
    const got = repo.getEquipment('e1' as EquipmentId)!;
    expect(got.type).toBe('weapon');
    expect(got.function).toBe('sharp');
    expect(got.tags).toEqual(['metal']);
  });

  it('equipment: list filters by type, orders by name', () => {
    repo.upsertEquipment({ id: 'w1', name: 'Axe', type: 'weapon' });
    repo.upsertEquipment({ id: 'a1', name: 'Plate', type: 'armor' });
    repo.upsertEquipment({ id: 'w2', name: 'Bow', type: 'weapon' });
    const weapons = repo.listEquipment('weapon');
    expect(weapons.rows.map((r) => r.name)).toEqual(['Axe', 'Bow']);
    const all = repo.listEquipment();
    expect(all.rows).toHaveLength(3);
  });

  it('equipment: delete removes the row', () => {
    repo.upsertEquipment({ id: 'e1', name: 'Sword' });
    repo.deleteEquipment('e1' as EquipmentId);
    expect(repo.getEquipment('e1' as EquipmentId)).toBeUndefined();
  });

  it('equipment: fault injection — invalid type enum reports degrade', () => {
    repo.upsertEquipment({ id: 'good', name: 'Good', type: 'weapon' });
    db.prepare(
      `INSERT INTO equipment (id, name, type, subtype, description, function_desc, tags, reference_images, created_at, updated_at)
       VALUES (?, ?, ?, null, '', null, '[]', '[]', 1, 1)`,
    ).run('bad', 'Bad', 'not-a-real-type');
    const { rows, degradedCount } = repo.listEquipment();
    expect(degradedCount).toBe(1);
    expect(rows.map((r) => r.id)).toEqual(['good']);
    expect(reports.some((r) => r.schema === 'Equipment')).toBe(true);
  });

  // ── Locations ────────────────────────────────────────────────

  it('location: upsert + get preserves nullable arrays', () => {
    repo.upsertLocation({
      id: 'l1',
      name: 'Castle',
      type: 'exterior',
      dominantColors: ['red', 'gold'],
      keyFeatures: ['tower'],
      atmosphereKeywords: undefined,
      tags: ['fantasy'],
      createdAt: 1,
      updatedAt: 1,
    });
    const got = repo.getLocation('l1' as LocationId)!;
    expect(got.type).toBe('exterior');
    expect(got.dominantColors).toEqual(['red', 'gold']);
    expect(got.keyFeatures).toEqual(['tower']);
    expect(got.atmosphereKeywords).toBeUndefined();
    expect(got.tags).toEqual(['fantasy']);
  });

  it('location: list filters by type, orders by name', () => {
    repo.upsertLocation({ id: 'i1', name: 'Hall', type: 'interior' });
    repo.upsertLocation({ id: 'e1', name: 'Field', type: 'exterior' });
    const interiors = repo.listLocations('interior');
    expect(interiors.rows.map((r) => r.name)).toEqual(['Hall']);
  });

  it('location: delete removes the row', () => {
    repo.upsertLocation({ id: 'l1', name: 'Hall' });
    repo.deleteLocation('l1' as LocationId);
    expect(repo.getLocation('l1' as LocationId)).toBeUndefined();
  });

  it('location: fault injection — invalid type enum reports degrade', () => {
    repo.upsertLocation({ id: 'good', name: 'Good', type: 'interior' });
    db.prepare(
      `INSERT INTO locations (id, name, type, sub_location, description, time_of_day, mood, weather,
         lighting, architecture_style, dominant_colors, key_features, atmosphere_keywords,
         tags, reference_images, created_at, updated_at)
       VALUES (?, ?, ?, null, '', null, null, null, null, null, null, null, null, '[]', '[]', 1, 1)`,
    ).run('bad', 'Bad', 'not-a-real-type');
    const { rows, degradedCount } = repo.listLocations();
    expect(degradedCount).toBe(1);
    expect(rows.map((r) => r.id)).toEqual(['good']);
    expect(reports.some((r) => r.schema === 'Location')).toBe(true);
  });

  // ── Transactions ─────────────────────────────────────────────

  it('accepts Tx argument on upserts', () => {
    const tx = db.transaction(() => {
      repo.upsertCharacter({ id: 'tx-c', name: 'TxChar' }, db);
      repo.upsertEquipment({ id: 'tx-e', name: 'TxEquip' }, db);
      repo.upsertLocation({ id: 'tx-l', name: 'TxLoc' }, db);
    });
    tx();
    expect(repo.getCharacter('tx-c' as CharacterId)?.name).toBe('TxChar');
    expect(repo.getEquipment('tx-e' as EquipmentId)?.name).toBe('TxEquip');
    expect(repo.getLocation('tx-l' as LocationId)?.name).toBe('TxLoc');
  });
});

// Keep satisfying unused-import check across Character/Equipment/Location types
// by referencing them in a void coercion at the bottom.
void (null as unknown as Character | Equipment | Location);
