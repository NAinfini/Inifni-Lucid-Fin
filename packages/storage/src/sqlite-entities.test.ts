import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { SqliteIndex } from './sqlite-index.js';
import { parseCharacterId, parseEquipmentId, parseLocationId } from '@lucid-fin/contracts-parse';

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
    db.repos.entities.upsertCharacter({ id: 'c1', name: 'Alice' });
    const char = db.repos.entities.getCharacter(parseCharacterId('c1'));
    expect(char).toBeDefined();
    expect(char!.id).toBe('c1');
    expect(char!.name).toBe('Alice');
  });

  it('applies default values for optional fields', () => {
    db.repos.entities.upsertCharacter({ id: 'c1', name: 'Alice' });
    const char = db.repos.entities.getCharacter(parseCharacterId('c1'))!;
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
    expect(typeof char.createdAt).toBe('number');
    expect(typeof char.updatedAt).toBe('number');
  });

  it('stores all optional fields when provided', () => {
    const now = Date.now();
    db.repos.entities.upsertCharacter({
      id: 'c2',
      name: 'Bob',
      role: 'protagonist',
      description: 'A brave hero',
      appearance: 'Tall',
      personality: 'Kind',
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

    const char = db.repos.entities.getCharacter(parseCharacterId('c2'))!;
    expect(char.role).toBe('protagonist');
    expect(char.description).toBe('A brave hero');
    expect(char.appearance).toBe('Tall');
    expect(char.personality).toBe('Kind');
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
    db.repos.entities.upsertCharacter({ id: 'c1', name: 'Alice', createdAt, updatedAt: createdAt });
    db.repos.entities.upsertCharacter({ id: 'c1', name: 'Alice Updated', createdAt, updatedAt: createdAt + 1 });

    const char = db.repos.entities.getCharacter(parseCharacterId('c1'))!;
    expect(char.name).toBe('Alice Updated');
    // createdAt is preserved because ON CONFLICT only updates the excluded.updated_at column
    // updatedAt should reflect the new value
    expect(char.updatedAt).toBe(createdAt + 1);
  });

  it('returns undefined for a non-existent character', () => {
    expect(db.repos.entities.getCharacter(parseCharacterId('does-not-exist'))).toBeUndefined();
  });

  it('deletes a character by id', () => {
    db.repos.entities.upsertCharacter({ id: 'c1', name: 'Alice' });
    db.repos.entities.deleteCharacter(parseCharacterId('c1'));
    expect(db.repos.entities.getCharacter(parseCharacterId('c1'))).toBeUndefined();
  });

  it('delete is a no-op for non-existent id', () => {
    expect(() => db.repos.entities.deleteCharacter(parseCharacterId('ghost'))).not.toThrow();
  });

  it('lists all characters ordered by name', () => {
    db.repos.entities.upsertCharacter({ id: 'c1', name: 'Zelda' });
    db.repos.entities.upsertCharacter({ id: 'c2', name: 'Alice' });
    const all = db.repos.entities.listCharacters().rows;
    expect(all.length).toBe(2);
    // Ordered by name ascending
    expect(all[0].name).toBe('Alice');
    expect(all[1].name).toBe('Zelda');
  });

  it('returns empty array when no characters exist', () => {
    expect(db.repos.entities.listCharacters().rows).toEqual([]);
  });

  it('parses JSON arrays correctly after round-trip', () => {
    const tags = ['a', 'b', 'c'];
    const costumes = [{ id: 'c', name: 'Robe', description: 'Long robe' }];
    db.repos.entities.upsertCharacter({ id: 'c1', name: 'Test', tags, costumes });
    const char = db.repos.entities.getCharacter(parseCharacterId('c1'))!;
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
    db.repos.entities.upsertEquipment({ id: 'e1', name: 'Sword' });
    const equip = db.repos.entities.getEquipment(parseEquipmentId('e1'));
    expect(equip).toBeDefined();
    expect(equip!.id).toBe('e1');
    expect(equip!.name).toBe('Sword');
  });

  it('applies default values for optional fields', () => {
    db.repos.entities.upsertEquipment({ id: 'e1', name: 'Sword' });
    const equip = db.repos.entities.getEquipment(parseEquipmentId('e1'))!;
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
    db.repos.entities.upsertEquipment({
      id: 'e1',
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

    const equip = db.repos.entities.getEquipment(parseEquipmentId('e1'))!;
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
    db.repos.entities.upsertEquipment({ id: 'e1', name: 'Sword' });
    db.repos.entities.upsertEquipment({ id: 'e1', name: 'Upgraded Sword', type: 'weapon' });

    const equip = db.repos.entities.getEquipment(parseEquipmentId('e1'))!;
    expect(equip.name).toBe('Upgraded Sword');
    expect(equip.type).toBe('weapon');
  });

  it('returns undefined for a non-existent equipment id', () => {
    expect(db.repos.entities.getEquipment(parseEquipmentId('ghost'))).toBeUndefined();
  });

  it('deletes an equipment item by id', () => {
    db.repos.entities.upsertEquipment({ id: 'e1', name: 'Shield' });
    db.repos.entities.deleteEquipment(parseEquipmentId('e1'));
    expect(db.repos.entities.getEquipment(parseEquipmentId('e1'))).toBeUndefined();
  });

  it('delete is a no-op for non-existent id', () => {
    expect(() => db.repos.entities.deleteEquipment(parseEquipmentId('ghost'))).not.toThrow();
  });

  it('lists all equipment ordered by name', () => {
    db.repos.entities.upsertEquipment({ id: 'e1', name: 'Sword' });
    db.repos.entities.upsertEquipment({ id: 'e2', name: 'Armour' });
    db.repos.entities.upsertEquipment({ id: 'e3', name: 'Bow' });

    const all = db.repos.entities.listEquipment().rows;
    expect(all.length).toBe(3);
    expect(all[0].name).toBe('Armour');
    expect(all[1].name).toBe('Bow');
    expect(all[2].name).toBe('Sword');
  });

  it('lists equipment filtered by type', () => {
    db.repos.entities.upsertEquipment({ id: 'e1', name: 'Sword', type: 'weapon' });
    db.repos.entities.upsertEquipment({ id: 'e2', name: 'Shield', type: 'armor' });
    db.repos.entities.upsertEquipment({ id: 'e3', name: 'Dagger', type: 'weapon' });

    const weapons = db.repos.entities.listEquipment('weapon').rows;
    expect(weapons.length).toBe(2);
    expect(weapons.map((e) => e.id).sort()).toEqual(['e1', 'e3']);

    const armors = db.repos.entities.listEquipment('armor').rows;
    expect(armors.length).toBe(1);
    expect(armors[0].id).toBe('e2');
  });

  it('type filter returns empty array when no match', () => {
    db.repos.entities.upsertEquipment({ id: 'e1', name: 'Sword', type: 'weapon' });
    expect(db.repos.entities.listEquipment('vehicle').rows).toEqual([]);
  });

  it('parses JSON arrays correctly after round-trip', () => {
    const tags = ['x', 'y'];
    const referenceImages = [{ slot: 'front', isStandard: false }];
    db.repos.entities.upsertEquipment({ id: 'e1', name: 'Item', tags, referenceImages });
    const equip = db.repos.entities.getEquipment(parseEquipmentId('e1'))!;
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
    db.repos.entities.upsertLocation({ id: 'l1', name: 'Forest' });
    const loc = db.repos.entities.getLocation(parseLocationId('l1'));
    expect(loc).toBeDefined();
    expect(loc!.id).toBe('l1');
    expect(loc!.name).toBe('Forest');
  });

  it('applies default values for optional fields', () => {
    db.repos.entities.upsertLocation({ id: 'l1', name: 'Forest' });
    const loc = db.repos.entities.getLocation(parseLocationId('l1'))!;
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
    db.repos.entities.upsertLocation({
      id: 'l1',
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

    const loc = db.repos.entities.getLocation(parseLocationId('l1'))!;
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
    db.repos.entities.upsertLocation({ id: 'l1', name: 'Forest' });
    db.repos.entities.upsertLocation({ id: 'l1', name: 'Dark Forest', type: 'exterior' });

    const loc = db.repos.entities.getLocation(parseLocationId('l1'))!;
    expect(loc.name).toBe('Dark Forest');
    expect(loc.type).toBe('exterior');
  });

  it('returns undefined for a non-existent location id', () => {
    expect(db.repos.entities.getLocation(parseLocationId('ghost'))).toBeUndefined();
  });

  it('deletes a location by id', () => {
    db.repos.entities.upsertLocation({ id: 'l1', name: 'Forest' });
    db.repos.entities.deleteLocation(parseLocationId('l1'));
    expect(db.repos.entities.getLocation(parseLocationId('l1'))).toBeUndefined();
  });

  it('delete is a no-op for non-existent id', () => {
    expect(() => db.repos.entities.deleteLocation(parseLocationId('ghost'))).not.toThrow();
  });

  it('lists all locations ordered by name', () => {
    db.repos.entities.upsertLocation({ id: 'l1', name: 'Village' });
    db.repos.entities.upsertLocation({ id: 'l2', name: 'Castle' });
    db.repos.entities.upsertLocation({ id: 'l3', name: 'Cave' });

    const all = db.repos.entities.listLocations().rows;
    expect(all.length).toBe(3);
    expect(all[0].name).toBe('Castle');
    expect(all[1].name).toBe('Cave');
    expect(all[2].name).toBe('Village');
  });

  it('lists locations filtered by type', () => {
    db.repos.entities.upsertLocation({ id: 'l1', name: 'Bedroom', type: 'interior' });
    db.repos.entities.upsertLocation({ id: 'l2', name: 'Street', type: 'exterior' });
    db.repos.entities.upsertLocation({ id: 'l3', name: 'Patio', type: 'int-ext' });
    db.repos.entities.upsertLocation({ id: 'l4', name: 'Kitchen', type: 'interior' });

    const interiors = db.repos.entities.listLocations('interior').rows;
    expect(interiors.length).toBe(2);
    expect(interiors.map((l) => l.id).sort()).toEqual(['l1', 'l4']);

    const exteriors = db.repos.entities.listLocations('exterior').rows;
    expect(exteriors.length).toBe(1);
    expect(exteriors[0].id).toBe('l2');

    const mixed = db.repos.entities.listLocations('int-ext').rows;
    expect(mixed.length).toBe(1);
    expect(mixed[0].id).toBe('l3');
  });

  it('type filter returns empty array when no match', () => {
    db.repos.entities.upsertLocation({ id: 'l1', name: 'Forest', type: 'exterior' });
    expect(db.repos.entities.listLocations('interior').rows).toEqual([]);
  });

  it('parses JSON arrays correctly after round-trip', () => {
    const tags = ['foggy', 'vast'];
    const referenceImages = [{ slot: 'atmosphere', isStandard: false, assetHash: 'abc123' }];
    db.repos.entities.upsertLocation({ id: 'l1', name: 'Moor', tags, referenceImages });
    const loc = db.repos.entities.getLocation(parseLocationId('l1'))!;
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
    db.repos.entities.upsertCharacter({ id: 'shared-id', name: 'Character' });
    db.repos.entities.upsertEquipment({ id: 'shared-id', name: 'Equipment' });
    db.repos.entities.upsertLocation({ id: 'shared-id', name: 'Location' });

    expect(db.repos.entities.getCharacter(parseCharacterId('shared-id'))!.name).toBe('Character');
    expect(db.repos.entities.getEquipment(parseEquipmentId('shared-id'))!.name).toBe('Equipment');
    expect(db.repos.entities.getLocation(parseLocationId('shared-id'))!.name).toBe('Location');
  });

  it('deleting a character does not affect equipment or locations with the same id', () => {
    db.repos.entities.upsertCharacter({ id: 'shared-id', name: 'Character' });
    db.repos.entities.upsertEquipment({ id: 'shared-id', name: 'Equipment' });
    db.repos.entities.upsertLocation({ id: 'shared-id', name: 'Location' });

    db.repos.entities.deleteCharacter(parseCharacterId('shared-id'));

    expect(db.repos.entities.getCharacter(parseCharacterId('shared-id'))).toBeUndefined();
    expect(db.repos.entities.getEquipment(parseEquipmentId('shared-id'))).toBeDefined();
    expect(db.repos.entities.getLocation(parseLocationId('shared-id'))).toBeDefined();
  });
});
