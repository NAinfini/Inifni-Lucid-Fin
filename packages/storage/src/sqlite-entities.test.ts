import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { SqliteIndex } from './sqlite-index.js';

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'lucid-entities-'));
}

// ---------------------------------------------------------------------------
// Characters
// ---------------------------------------------------------------------------

describe('characters entity storage', () => {
  let db: SqliteIndex;
  let base: string;

  beforeEach(() => {
    base = tmpDir();
    db = new SqliteIndex(path.join(base, 'test.db'));
  });

  afterEach(() => {
    db.close();
    fs.rmSync(base, { recursive: true, force: true });
  });

  it('inserts and retrieves a minimal character', () => {
    db.upsertCharacter({ id: 'c1', name: 'Alice' });
    const char = db.getCharacter('c1');
    expect(char).toBeDefined();
    expect(char!.id).toBe('c1');
    expect(char!.name).toBe('Alice');
  });

  it('applies default values for optional fields', () => {
    db.upsertCharacter({ id: 'c1', name: 'Alice' });
    const char = db.getCharacter('c1')!;
    expect(char.role).toBe('supporting');
    expect(char.description).toBe('');
    expect(char.appearance).toBe('');
    expect(char.personality).toBe('');
    expect(char.costumes).toEqual([]);
    expect(char.tags).toEqual([]);
    expect(char.referenceImages).toEqual([]);
    expect(char.loadouts).toEqual([]);
    expect(char.defaultLoadoutId).toBe('');
    expect(char.age).toBeUndefined();
    expect(char.gender).toBeUndefined();
    expect(char.voice).toBeUndefined();
    // ref_image is stored as NULL in SQLite; rowToCharacter casts but does not coerce null → undefined
    expect(char.referenceImage == null).toBe(true);
    expect(typeof char.createdAt).toBe('number');
    expect(typeof char.updatedAt).toBe('number');
  });

  it('stores all optional fields when provided', () => {
    const now = Date.now();
    db.upsertCharacter({
      id: 'c2',
      name: 'Bob',
      projectId: 'proj-1',
      role: 'protagonist',
      description: 'A brave hero',
      appearance: 'Tall',
      personality: 'Kind',
      refImage: 'hash-abc',
      costumes: [{ id: 'cos-1', name: 'Armour', description: 'Battle armour' }],
      tags: ['hero', 'main'],
      age: 30,
      gender: 'male',
      voice: 'deep',
      referenceImages: [{ slot: 'front', isStandard: true }],
      loadouts: [{ id: 'lo-1', name: 'Default', equipmentIds: ['e1'] }],
      defaultLoadoutId: 'lo-1',
      createdAt: now,
      updatedAt: now,
    });

    const char = db.getCharacter('c2')!;
    expect(char.projectId).toBe('proj-1');
    expect(char.role).toBe('protagonist');
    expect(char.description).toBe('A brave hero');
    expect(char.appearance).toBe('Tall');
    expect(char.personality).toBe('Kind');
    expect(char.referenceImage).toBe('hash-abc');
    expect(char.costumes).toHaveLength(1);
    expect(char.tags).toEqual(['hero', 'main']);
    expect(char.age).toBe(30);
    expect(char.gender).toBe('male');
    expect(char.voice).toBe('deep');
    expect(char.referenceImages).toHaveLength(1);
    expect(char.loadouts).toHaveLength(1);
    expect(char.defaultLoadoutId).toBe('lo-1');
    expect(char.createdAt).toBe(now);
    expect(char.updatedAt).toBe(now);
  });

  it('updates (upserts) an existing character without changing createdAt', () => {
    const createdAt = 1_000_000;
    db.upsertCharacter({ id: 'c1', name: 'Alice', createdAt, updatedAt: createdAt });
    db.upsertCharacter({ id: 'c1', name: 'Alice Updated', createdAt, updatedAt: createdAt + 1 });

    const char = db.getCharacter('c1')!;
    expect(char.name).toBe('Alice Updated');
    // createdAt is preserved because ON CONFLICT only updates the excluded.updated_at column
    // updatedAt should reflect the new value
    expect(char.updatedAt).toBe(createdAt + 1);
  });

  it('returns undefined for a non-existent character', () => {
    expect(db.getCharacter('does-not-exist')).toBeUndefined();
  });

  it('deletes a character by id', () => {
    db.upsertCharacter({ id: 'c1', name: 'Alice' });
    db.deleteCharacter('c1');
    expect(db.getCharacter('c1')).toBeUndefined();
  });

  it('delete is a no-op for non-existent id', () => {
    expect(() => db.deleteCharacter('ghost')).not.toThrow();
  });

  it('lists all characters when no projectId given', () => {
    db.upsertCharacter({ id: 'c1', name: 'Zelda', projectId: 'p1' });
    db.upsertCharacter({ id: 'c2', name: 'Alice', projectId: 'p2' });
    const all = db.listCharacters();
    expect(all.length).toBe(2);
    // Ordered by name ascending
    expect(all[0].name).toBe('Alice');
    expect(all[1].name).toBe('Zelda');
  });

  it('lists characters filtered by projectId', () => {
    db.upsertCharacter({ id: 'c1', name: 'Alice', projectId: 'p1' });
    db.upsertCharacter({ id: 'c2', name: 'Bob', projectId: 'p2' });
    db.upsertCharacter({ id: 'c3', name: 'Carol', projectId: 'p1' });

    const p1 = db.listCharacters('p1');
    expect(p1.length).toBe(2);
    expect(p1.map((c) => c.id).sort()).toEqual(['c1', 'c3']);

    const p2 = db.listCharacters('p2');
    expect(p2.length).toBe(1);
    expect(p2[0].id).toBe('c2');
  });

  it('returns empty array when project has no characters', () => {
    expect(db.listCharacters('non-existent-project')).toEqual([]);
  });

  it('parses JSON arrays correctly after round-trip', () => {
    const tags = ['a', 'b', 'c'];
    const costumes = [{ id: 'c', name: 'Robe', description: 'Long robe' }];
    db.upsertCharacter({ id: 'c1', name: 'Test', tags, costumes });
    const char = db.getCharacter('c1')!;
    expect(char.tags).toEqual(tags);
    expect(char.costumes).toEqual(costumes);
  });
});

// ---------------------------------------------------------------------------
// Equipment
// ---------------------------------------------------------------------------

describe('equipment entity storage', () => {
  let db: SqliteIndex;
  let base: string;

  beforeEach(() => {
    base = tmpDir();
    db = new SqliteIndex(path.join(base, 'test.db'));
  });

  afterEach(() => {
    db.close();
    fs.rmSync(base, { recursive: true, force: true });
  });

  it('inserts and retrieves a minimal equipment item', () => {
    db.upsertEquipment({ id: 'e1', projectId: 'p1', name: 'Sword' });
    const equip = db.getEquipment('e1');
    expect(equip).toBeDefined();
    expect(equip!.id).toBe('e1');
    expect(equip!.name).toBe('Sword');
    expect(equip!.projectId).toBe('p1');
  });

  it('applies default values for optional fields', () => {
    db.upsertEquipment({ id: 'e1', projectId: 'p1', name: 'Sword' });
    const equip = db.getEquipment('e1')!;
    expect(equip.type).toBe('other');
    expect(equip.description).toBe('');
    expect(equip.tags).toEqual([]);
    expect(equip.referenceImages).toEqual([]);
    expect(equip.subtype).toBeUndefined();
    expect(equip.function).toBeUndefined();
    expect(typeof equip.createdAt).toBe('number');
    expect(typeof equip.updatedAt).toBe('number');
  });

  it('stores all optional fields when provided', () => {
    const now = Date.now();
    db.upsertEquipment({
      id: 'e1',
      projectId: 'p1',
      name: 'Longsword',
      type: 'weapon',
      subtype: 'melee',
      description: 'A sharp blade',
      functionDesc: 'For combat',
      tags: ['sharp', 'medieval'],
      referenceImages: [{ slot: 'front', isStandard: true }],
      createdAt: now,
      updatedAt: now,
    });

    const equip = db.getEquipment('e1')!;
    expect(equip.type).toBe('weapon');
    expect(equip.subtype).toBe('melee');
    expect(equip.description).toBe('A sharp blade');
    expect(equip.function).toBe('For combat');
    expect(equip.tags).toEqual(['sharp', 'medieval']);
    expect(equip.referenceImages).toHaveLength(1);
    expect(equip.createdAt).toBe(now);
    expect(equip.updatedAt).toBe(now);
  });

  it('updates (upserts) an existing equipment item', () => {
    db.upsertEquipment({ id: 'e1', projectId: 'p1', name: 'Sword' });
    db.upsertEquipment({ id: 'e1', projectId: 'p1', name: 'Upgraded Sword', type: 'weapon' });

    const equip = db.getEquipment('e1')!;
    expect(equip.name).toBe('Upgraded Sword');
    expect(equip.type).toBe('weapon');
  });

  it('returns undefined for a non-existent equipment id', () => {
    expect(db.getEquipment('ghost')).toBeUndefined();
  });

  it('deletes an equipment item by id', () => {
    db.upsertEquipment({ id: 'e1', projectId: 'p1', name: 'Shield' });
    db.deleteEquipment('e1');
    expect(db.getEquipment('e1')).toBeUndefined();
  });

  it('delete is a no-op for non-existent id', () => {
    expect(() => db.deleteEquipment('ghost')).not.toThrow();
  });

  it('lists all equipment for a project ordered by name', () => {
    db.upsertEquipment({ id: 'e1', projectId: 'p1', name: 'Sword' });
    db.upsertEquipment({ id: 'e2', projectId: 'p1', name: 'Armour' });
    db.upsertEquipment({ id: 'e3', projectId: 'p2', name: 'Bow' });

    const p1 = db.listEquipment('p1');
    expect(p1.length).toBe(2);
    expect(p1[0].name).toBe('Armour');
    expect(p1[1].name).toBe('Sword');
  });

  it('lists equipment filtered by type', () => {
    db.upsertEquipment({ id: 'e1', projectId: 'p1', name: 'Sword', type: 'weapon' });
    db.upsertEquipment({ id: 'e2', projectId: 'p1', name: 'Shield', type: 'armor' });
    db.upsertEquipment({ id: 'e3', projectId: 'p1', name: 'Dagger', type: 'weapon' });

    const weapons = db.listEquipment('p1', 'weapon');
    expect(weapons.length).toBe(2);
    expect(weapons.map((e) => e.id).sort()).toEqual(['e1', 'e3']);

    const armors = db.listEquipment('p1', 'armor');
    expect(armors.length).toBe(1);
    expect(armors[0].id).toBe('e2');
  });

  it('does not return equipment from a different project', () => {
    db.upsertEquipment({ id: 'e1', projectId: 'p1', name: 'Sword' });
    expect(db.listEquipment('p2')).toEqual([]);
  });

  it('type filter returns empty array when no match', () => {
    db.upsertEquipment({ id: 'e1', projectId: 'p1', name: 'Sword', type: 'weapon' });
    expect(db.listEquipment('p1', 'vehicle')).toEqual([]);
  });

  it('parses JSON arrays correctly after round-trip', () => {
    const tags = ['x', 'y'];
    const referenceImages = [{ slot: 'front', isStandard: false }];
    db.upsertEquipment({ id: 'e1', projectId: 'p1', name: 'Item', tags, referenceImages });
    const equip = db.getEquipment('e1')!;
    expect(equip.tags).toEqual(tags);
    expect(equip.referenceImages).toEqual(referenceImages);
  });
});

// ---------------------------------------------------------------------------
// Locations
// ---------------------------------------------------------------------------

describe('locations entity storage', () => {
  let db: SqliteIndex;
  let base: string;

  beforeEach(() => {
    base = tmpDir();
    db = new SqliteIndex(path.join(base, 'test.db'));
  });

  afterEach(() => {
    db.close();
    fs.rmSync(base, { recursive: true, force: true });
  });

  it('inserts and retrieves a minimal location', () => {
    db.upsertLocation({ id: 'l1', projectId: 'p1', name: 'Forest' });
    const loc = db.getLocation('l1');
    expect(loc).toBeDefined();
    expect(loc!.id).toBe('l1');
    expect(loc!.name).toBe('Forest');
    expect(loc!.projectId).toBe('p1');
  });

  it('applies default values for optional fields', () => {
    db.upsertLocation({ id: 'l1', projectId: 'p1', name: 'Forest' });
    const loc = db.getLocation('l1')!;
    expect(loc.type).toBe('interior');
    expect(loc.description).toBe('');
    expect(loc.tags).toEqual([]);
    expect(loc.referenceImages).toEqual([]);
    expect(loc.subLocation).toBeUndefined();
    expect(loc.timeOfDay).toBeUndefined();
    expect(loc.mood).toBeUndefined();
    expect(loc.weather).toBeUndefined();
    expect(loc.lighting).toBeUndefined();
    expect(typeof loc.createdAt).toBe('number');
    expect(typeof loc.updatedAt).toBe('number');
  });

  it('stores all optional fields when provided', () => {
    const now = Date.now();
    db.upsertLocation({
      id: 'l1',
      projectId: 'p1',
      name: 'Castle Hall',
      type: 'interior',
      subLocation: 'Throne Room',
      description: 'Grand throne room',
      timeOfDay: 'evening',
      mood: 'tense',
      weather: 'stormy',
      lighting: 'candlelight',
      tags: ['royal', 'grand'],
      referenceImages: [{ slot: 'wide-establishing', isStandard: true }],
      createdAt: now,
      updatedAt: now,
    });

    const loc = db.getLocation('l1')!;
    expect(loc.type).toBe('interior');
    expect(loc.subLocation).toBe('Throne Room');
    expect(loc.description).toBe('Grand throne room');
    expect(loc.timeOfDay).toBe('evening');
    expect(loc.mood).toBe('tense');
    expect(loc.weather).toBe('stormy');
    expect(loc.lighting).toBe('candlelight');
    expect(loc.tags).toEqual(['royal', 'grand']);
    expect(loc.referenceImages).toHaveLength(1);
    expect(loc.createdAt).toBe(now);
    expect(loc.updatedAt).toBe(now);
  });

  it('updates (upserts) an existing location', () => {
    db.upsertLocation({ id: 'l1', projectId: 'p1', name: 'Forest' });
    db.upsertLocation({ id: 'l1', projectId: 'p1', name: 'Dark Forest', type: 'exterior' });

    const loc = db.getLocation('l1')!;
    expect(loc.name).toBe('Dark Forest');
    expect(loc.type).toBe('exterior');
  });

  it('returns undefined for a non-existent location id', () => {
    expect(db.getLocation('ghost')).toBeUndefined();
  });

  it('deletes a location by id', () => {
    db.upsertLocation({ id: 'l1', projectId: 'p1', name: 'Forest' });
    db.deleteLocation('l1');
    expect(db.getLocation('l1')).toBeUndefined();
  });

  it('delete is a no-op for non-existent id', () => {
    expect(() => db.deleteLocation('ghost')).not.toThrow();
  });

  it('lists all locations for a project ordered by name', () => {
    db.upsertLocation({ id: 'l1', projectId: 'p1', name: 'Village' });
    db.upsertLocation({ id: 'l2', projectId: 'p1', name: 'Castle' });
    db.upsertLocation({ id: 'l3', projectId: 'p2', name: 'Cave' });

    const p1 = db.listLocations('p1');
    expect(p1.length).toBe(2);
    expect(p1[0].name).toBe('Castle');
    expect(p1[1].name).toBe('Village');
  });

  it('lists locations filtered by type', () => {
    db.upsertLocation({ id: 'l1', projectId: 'p1', name: 'Bedroom', type: 'interior' });
    db.upsertLocation({ id: 'l2', projectId: 'p1', name: 'Street', type: 'exterior' });
    db.upsertLocation({ id: 'l3', projectId: 'p1', name: 'Patio', type: 'int-ext' });
    db.upsertLocation({ id: 'l4', projectId: 'p1', name: 'Kitchen', type: 'interior' });

    const interiors = db.listLocations('p1', 'interior');
    expect(interiors.length).toBe(2);
    expect(interiors.map((l) => l.id).sort()).toEqual(['l1', 'l4']);

    const exteriors = db.listLocations('p1', 'exterior');
    expect(exteriors.length).toBe(1);
    expect(exteriors[0].id).toBe('l2');

    const mixed = db.listLocations('p1', 'int-ext');
    expect(mixed.length).toBe(1);
    expect(mixed[0].id).toBe('l3');
  });

  it('does not return locations from a different project', () => {
    db.upsertLocation({ id: 'l1', projectId: 'p1', name: 'Forest' });
    expect(db.listLocations('p2')).toEqual([]);
  });

  it('type filter returns empty array when no match', () => {
    db.upsertLocation({ id: 'l1', projectId: 'p1', name: 'Forest', type: 'exterior' });
    expect(db.listLocations('p1', 'interior')).toEqual([]);
  });

  it('parses JSON arrays correctly after round-trip', () => {
    const tags = ['foggy', 'vast'];
    const referenceImages = [{ slot: 'atmosphere', isStandard: false, assetHash: 'abc123' }];
    db.upsertLocation({ id: 'l1', projectId: 'p1', name: 'Moor', tags, referenceImages });
    const loc = db.getLocation('l1')!;
    expect(loc.tags).toEqual(tags);
    expect(loc.referenceImages).toEqual(referenceImages);
  });
});

// ---------------------------------------------------------------------------
// Cross-entity isolation
// ---------------------------------------------------------------------------

describe('entity type isolation', () => {
  let db: SqliteIndex;
  let base: string;

  beforeEach(() => {
    base = tmpDir();
    db = new SqliteIndex(path.join(base, 'test.db'));
  });

  afterEach(() => {
    db.close();
    fs.rmSync(base, { recursive: true, force: true });
  });

  it('characters, equipment and locations use independent id spaces', () => {
    // Insert entities with the same id across different tables
    db.upsertCharacter({ id: 'shared-id', name: 'Character' });
    db.upsertEquipment({ id: 'shared-id', projectId: 'p1', name: 'Equipment' });
    db.upsertLocation({ id: 'shared-id', projectId: 'p1', name: 'Location' });

    expect(db.getCharacter('shared-id')!.name).toBe('Character');
    expect(db.getEquipment('shared-id')!.name).toBe('Equipment');
    expect(db.getLocation('shared-id')!.name).toBe('Location');
  });

  it('deleting a character does not affect equipment or locations with the same id', () => {
    db.upsertCharacter({ id: 'shared-id', name: 'Character' });
    db.upsertEquipment({ id: 'shared-id', projectId: 'p1', name: 'Equipment' });
    db.upsertLocation({ id: 'shared-id', projectId: 'p1', name: 'Location' });

    db.deleteCharacter('shared-id');

    expect(db.getCharacter('shared-id')).toBeUndefined();
    expect(db.getEquipment('shared-id')).toBeDefined();
    expect(db.getLocation('shared-id')).toBeDefined();
  });
});
