import type { Character, Equipment, Location } from '@lucid-fin/contracts';
import type BetterSqlite3 from 'better-sqlite3';

// --- Characters ---

export function upsertCharacter(
  db: BetterSqlite3.Database,
  char: {
    id: string;
    name: string;
    role?: string;
    description?: string;
    appearance?: string;
    personality?: string;
    costumes?: unknown[];
    tags?: string[];
    age?: number;
    gender?: string;
    voice?: string;
    referenceImages?: unknown[];
    loadouts?: unknown[];
    defaultLoadoutId?: string;
    createdAt?: number;
    updatedAt?: number;
  },
): void {
  const now = Date.now();
  db.prepare(
    `
    INSERT INTO characters (id, name, role, description, appearance, personality, costumes, tags, age, gender, voice, reference_images, loadouts, default_loadout_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name, role=excluded.role,
      description=excluded.description, appearance=excluded.appearance, personality=excluded.personality,
      costumes=excluded.costumes, tags=excluded.tags,
      age=excluded.age, gender=excluded.gender, voice=excluded.voice,
      reference_images=excluded.reference_images, loadouts=excluded.loadouts,
      default_loadout_id=excluded.default_loadout_id, updated_at=excluded.updated_at
  `,
  ).run(
    char.id,
    char.name,
    char.role ?? 'supporting',
    char.description ?? '',
    char.appearance ?? '',
    char.personality ?? '',
    JSON.stringify(char.costumes ?? []),
    JSON.stringify(char.tags ?? []),
    char.age ?? null,
    char.gender ?? null,
    char.voice ?? null,
    JSON.stringify(char.referenceImages ?? []),
    JSON.stringify(char.loadouts ?? []),
    char.defaultLoadoutId ?? '',
    char.createdAt ?? now,
    char.updatedAt ?? now,
  );
}

export function getCharacter(db: BetterSqlite3.Database, id: string): Character | undefined {
  const row = db.prepare('SELECT * FROM characters WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  if (!row) return undefined;
  return rowToCharacter(row);
}

export function listCharacters(db: BetterSqlite3.Database): Character[] {
  const rows = db.prepare('SELECT * FROM characters ORDER BY name').all() as Array<
    Record<string, unknown>
  >;
  return rows.map((r) => rowToCharacter(r));
}

export function deleteCharacter(db: BetterSqlite3.Database, id: string): void {
  db.prepare('DELETE FROM characters WHERE id = ?').run(id);
}

function rowToCharacter(row: Record<string, unknown>): Character {
  return {
    id: row.id as string,
    name: row.name as string,
    role: (row.role as Character['role']) ?? 'supporting',
    description: (row.description as string) ?? '',
    appearance: (row.appearance as string) ?? '',
    personality: (row.personality as string) ?? '',
    costumes: JSON.parse((row.costumes as string) || '[]'),
    tags: JSON.parse((row.tags as string) || '[]'),
    age: (row.age as number | null) ?? undefined,
    gender: (row.gender as Character['gender']) ?? undefined,
    voice: (row.voice as string | null) ?? undefined,
    referenceImages: JSON.parse((row.reference_images as string) || '[]'),
    loadouts: JSON.parse((row.loadouts as string) || '[]'),
    defaultLoadoutId: (row.default_loadout_id as string) ?? '',
    createdAt: (row.created_at as number) ?? Date.now(),
    updatedAt: (row.updated_at as number) ?? Date.now(),
  };
}

// --- Equipment ---

export function upsertEquipment(
  db: BetterSqlite3.Database,
  equip: {
    id: string;
    name: string;
    type?: string;
    subtype?: string;
    description?: string;
    functionDesc?: string;
    tags?: string[];
    referenceImages?: unknown[];
    createdAt?: number;
    updatedAt?: number;
  },
): void {
  const now = Date.now();
  db.prepare(
    `
    INSERT INTO equipment (id, name, type, subtype, description, function_desc, tags, reference_images, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name, type=excluded.type,
      subtype=excluded.subtype, description=excluded.description, function_desc=excluded.function_desc,
      tags=excluded.tags, reference_images=excluded.reference_images, updated_at=excluded.updated_at
  `,
  ).run(
    equip.id,
    equip.name,
    equip.type ?? 'other',
    equip.subtype ?? null,
    equip.description ?? '',
    equip.functionDesc ?? null,
    JSON.stringify(equip.tags ?? []),
    JSON.stringify(equip.referenceImages ?? []),
    equip.createdAt ?? now,
    equip.updatedAt ?? now,
  );
}

export function getEquipment(db: BetterSqlite3.Database, id: string): Equipment | undefined {
  const row = db.prepare('SELECT * FROM equipment WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  if (!row) return undefined;
  return rowToEquipment(row);
}

export function listEquipment(
  db: BetterSqlite3.Database,
  type?: string,
): Equipment[] {
  const rows = type
    ? (db
        .prepare('SELECT * FROM equipment WHERE type = ? ORDER BY name')
        .all(type) as Array<Record<string, unknown>>)
    : (db
        .prepare('SELECT * FROM equipment ORDER BY name')
        .all() as Array<Record<string, unknown>>);
  return rows.map((r) => rowToEquipment(r));
}

export function deleteEquipment(db: BetterSqlite3.Database, id: string): void {
  db.prepare('DELETE FROM equipment WHERE id = ?').run(id);
}

function rowToEquipment(row: Record<string, unknown>): Equipment {
  return {
    id: row.id as string,
    name: row.name as string,
    type: (row.type as Equipment['type']) ?? 'other',
    subtype: (row.subtype as string | null) ?? undefined,
    description: (row.description as string) ?? '',
    function: (row.function_desc as string | null) ?? undefined,
    tags: JSON.parse((row.tags as string) || '[]'),
    referenceImages: JSON.parse((row.reference_images as string) || '[]'),
    createdAt: (row.created_at as number) ?? Date.now(),
    updatedAt: (row.updated_at as number) ?? Date.now(),
  };
}

// --- Locations ---

export function upsertLocation(
  db: BetterSqlite3.Database,
  loc: {
    id: string;
    name: string;
    type?: string;
    subLocation?: string;
    description?: string;
    timeOfDay?: string;
    mood?: string;
    weather?: string;
    lighting?: string;
    tags?: string[];
    referenceImages?: unknown[];
    createdAt?: number;
    updatedAt?: number;
  },
): void {
  const now = Date.now();
  db.prepare(
    `
    INSERT INTO locations (id, name, type, sub_location, description, time_of_day, mood, weather, lighting, tags, reference_images, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name, type=excluded.type,
      sub_location=excluded.sub_location, description=excluded.description,
      time_of_day=excluded.time_of_day, mood=excluded.mood, weather=excluded.weather,
      lighting=excluded.lighting, tags=excluded.tags, reference_images=excluded.reference_images,
      updated_at=excluded.updated_at
  `,
  ).run(
    loc.id,
    loc.name,
    loc.type ?? 'interior',
    loc.subLocation ?? null,
    loc.description ?? '',
    loc.timeOfDay ?? null,
    loc.mood ?? null,
    loc.weather ?? null,
    loc.lighting ?? null,
    JSON.stringify(loc.tags ?? []),
    JSON.stringify(loc.referenceImages ?? []),
    loc.createdAt ?? now,
    loc.updatedAt ?? now,
  );
}

export function getLocation(db: BetterSqlite3.Database, id: string): Location | undefined {
  const row = db.prepare('SELECT * FROM locations WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  if (!row) return undefined;
  return rowToLocation(row);
}

export function listLocations(
  db: BetterSqlite3.Database,
  type?: string,
): Location[] {
  const rows = type
    ? (db
        .prepare('SELECT * FROM locations WHERE type = ? ORDER BY name')
        .all(type) as Array<Record<string, unknown>>)
    : (db
        .prepare('SELECT * FROM locations ORDER BY name')
        .all() as Array<Record<string, unknown>>);
  return rows.map((r) => rowToLocation(r));
}

export function deleteLocation(db: BetterSqlite3.Database, id: string): void {
  db.prepare('DELETE FROM locations WHERE id = ?').run(id);
}

function rowToLocation(row: Record<string, unknown>): Location {
  return {
    id: row.id as string,
    name: row.name as string,
    type: (row.type as Location['type']) ?? 'interior',
    subLocation: (row.sub_location as string | null) ?? undefined,
    description: (row.description as string) ?? '',
    timeOfDay: (row.time_of_day as string | null) ?? undefined,
    mood: (row.mood as string | null) ?? undefined,
    weather: (row.weather as string | null) ?? undefined,
    lighting: (row.lighting as string | null) ?? undefined,
    tags: JSON.parse((row.tags as string) || '[]'),
    referenceImages: JSON.parse((row.reference_images as string) || '[]'),
    createdAt: (row.created_at as number) ?? Date.now(),
    updatedAt: (row.updated_at as number) ?? Date.now(),
  };
}
