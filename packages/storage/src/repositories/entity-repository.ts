/**
 * EntityRepository — Phase G1-2.6.
 *
 * Consolidates the three entity-domain tables (characters / equipment /
 * locations) behind branded IDs and fault-soft reads. Each domain gets its
 * own upsert/get/list/delete surface; the repository owns all SQL so
 * SqliteIndex's entity facade can delegate cleanly.
 *
 * Table column names flow through `CharactersTable` / `EquipmentTable` /
 * `LocationsTable` from contracts-parse G1-1 — schema drift fails at compile
 * time.
 *
 * Reads go through `parseOrDegrade` with domain-specific `ctx` so corrupt
 * rows surface as degraded-read telemetry + skip, never a crash. List
 * methods return `ListResult<T>` so UI layers can show a degraded-row badge
 * when needed (parity with CanvasRepository / AssetRepository).
 */

import type BetterSqlite3 from 'better-sqlite3';
import type {
  Character,
  CharacterId,
  Equipment,
  EquipmentId,
  Location,
  LocationId,
} from '@lucid-fin/contracts';
import {
  CharacterSchema,
  CharactersTable,
  EquipmentSchema,
  EquipmentTable,
  LocationSchema,
  LocationsTable,
  parseOrDegrade,
} from '@lucid-fin/contracts-parse';
import type { Tx } from '../transactions.js';

/** Result shape for list reads that surface degraded-row counts. */
export interface ListResult<T> {
  rows: T[];
  degradedCount: number;
}

// --- Character input shape (matches legacy upsertCharacter arg) ---
export interface CharacterUpsertInput {
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
}

export interface EquipmentUpsertInput {
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
}

export interface LocationUpsertInput {
  id: string;
  name: string;
  type?: string;
  subLocation?: string;
  description?: string;
  timeOfDay?: string;
  mood?: string;
  weather?: string;
  lighting?: string;
  architectureStyle?: string;
  dominantColors?: string[];
  keyFeatures?: string[];
  atmosphereKeywords?: string[];
  tags?: string[];
  referenceImages?: unknown[];
  createdAt?: number;
  updatedAt?: number;
}

const CHAR_TBL = CharactersTable.tableName;
const CHAR = CharactersTable.cols;
const EQUIP_TBL = EquipmentTable.tableName;
const EQUIP = EquipmentTable.cols;
const LOC_TBL = LocationsTable.tableName;
const LOC = LocationsTable.cols;

const CHARACTER_SENTINEL = Symbol('character-degraded');
const EQUIPMENT_SENTINEL = Symbol('equipment-degraded');
const LOCATION_SENTINEL = Symbol('location-degraded');

function parseJsonArrayOrEmpty(raw: unknown): unknown[] {
  if (typeof raw !== 'string' || raw.length === 0) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseStringArrayOrUndef(raw: unknown): string[] | undefined {
  if (typeof raw !== 'string' || raw.length === 0) return undefined;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as string[]) : undefined;
  } catch {
    return undefined;
  }
}

function parseStringArrayOrEmpty(raw: unknown): string[] {
  if (typeof raw !== 'string' || raw.length === 0) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

function rowToCharacter(row: Record<string, unknown>): Character {
  return {
    id: row.id as string,
    name: row.name as string,
    role: ((row.role as Character['role']) ?? 'supporting'),
    description: (row.description as string) ?? '',
    appearance: (row.appearance as string) ?? '',
    personality: (row.personality as string) ?? '',
    costumes: parseJsonArrayOrEmpty(row.costumes) as Character['costumes'],
    tags: parseStringArrayOrEmpty(row.tags),
    age: (row.age as number | null) ?? undefined,
    gender: (row.gender as Character['gender']) ?? undefined,
    voice: (row.voice as string | null) ?? undefined,
    referenceImages: parseJsonArrayOrEmpty(
      row.reference_images,
    ) as Character['referenceImages'],
    loadouts: parseJsonArrayOrEmpty(row.loadouts) as Character['loadouts'],
    defaultLoadoutId: (row.default_loadout_id as string) ?? '',
    createdAt: (row.created_at as number) ?? Date.now(),
    updatedAt: (row.updated_at as number) ?? Date.now(),
  };
}

function rowToEquipment(row: Record<string, unknown>): Equipment {
  return {
    id: row.id as string,
    name: row.name as string,
    type: (row.type as Equipment['type']) ?? 'other',
    subtype: (row.subtype as string | null) ?? undefined,
    description: (row.description as string) ?? '',
    function: (row.function_desc as string | null) ?? undefined,
    tags: parseStringArrayOrEmpty(row.tags),
    referenceImages: parseJsonArrayOrEmpty(
      row.reference_images,
    ) as Equipment['referenceImages'],
    createdAt: (row.created_at as number) ?? Date.now(),
    updatedAt: (row.updated_at as number) ?? Date.now(),
  };
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
    architectureStyle: (row.architecture_style as string | null) ?? undefined,
    dominantColors: parseStringArrayOrUndef(row.dominant_colors),
    keyFeatures: parseStringArrayOrUndef(row.key_features),
    atmosphereKeywords: parseStringArrayOrUndef(row.atmosphere_keywords),
    tags: parseStringArrayOrEmpty(row.tags),
    referenceImages: parseJsonArrayOrEmpty(
      row.reference_images,
    ) as Location['referenceImages'],
    createdAt: (row.created_at as number) ?? Date.now(),
    updatedAt: (row.updated_at as number) ?? Date.now(),
  };
}

export class EntityRepository {
  constructor(private readonly db: BetterSqlite3.Database) {}

  // ── Characters ─────────────────────────────────────────────────

  upsertCharacter(input: CharacterUpsertInput, tx?: Tx): void {
    const d = tx ?? this.db;
    const now = Date.now();
    d.prepare(
      `INSERT INTO ${CHAR_TBL}
         (${CHAR.id.sqlName}, ${CHAR.name.sqlName}, ${CHAR.role.sqlName},
          ${CHAR.description.sqlName}, ${CHAR.appearance.sqlName}, ${CHAR.personality.sqlName},
          ${CHAR.costumes.sqlName}, ${CHAR.tags.sqlName},
          ${CHAR.age.sqlName}, ${CHAR.gender.sqlName}, ${CHAR.voice.sqlName},
          ${CHAR.referenceImages.sqlName}, ${CHAR.loadouts.sqlName}, ${CHAR.defaultLoadoutId.sqlName},
          ${CHAR.createdAt.sqlName}, ${CHAR.updatedAt.sqlName})
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(${CHAR.id.sqlName}) DO UPDATE SET
         ${CHAR.name.sqlName}=excluded.${CHAR.name.sqlName}, ${CHAR.role.sqlName}=excluded.${CHAR.role.sqlName},
         ${CHAR.description.sqlName}=excluded.${CHAR.description.sqlName},
         ${CHAR.appearance.sqlName}=excluded.${CHAR.appearance.sqlName},
         ${CHAR.personality.sqlName}=excluded.${CHAR.personality.sqlName},
         ${CHAR.costumes.sqlName}=excluded.${CHAR.costumes.sqlName}, ${CHAR.tags.sqlName}=excluded.${CHAR.tags.sqlName},
         ${CHAR.age.sqlName}=excluded.${CHAR.age.sqlName}, ${CHAR.gender.sqlName}=excluded.${CHAR.gender.sqlName},
         ${CHAR.voice.sqlName}=excluded.${CHAR.voice.sqlName},
         ${CHAR.referenceImages.sqlName}=excluded.${CHAR.referenceImages.sqlName},
         ${CHAR.loadouts.sqlName}=excluded.${CHAR.loadouts.sqlName},
         ${CHAR.defaultLoadoutId.sqlName}=excluded.${CHAR.defaultLoadoutId.sqlName},
         ${CHAR.updatedAt.sqlName}=excluded.${CHAR.updatedAt.sqlName}`,
    ).run(
      input.id,
      input.name,
      input.role ?? 'supporting',
      input.description ?? '',
      input.appearance ?? '',
      input.personality ?? '',
      JSON.stringify(input.costumes ?? []),
      JSON.stringify(input.tags ?? []),
      input.age ?? null,
      input.gender ?? null,
      input.voice ?? null,
      JSON.stringify(input.referenceImages ?? []),
      JSON.stringify(input.loadouts ?? []),
      input.defaultLoadoutId ?? '',
      input.createdAt ?? now,
      input.updatedAt ?? now,
    );
  }

  getCharacter(id: CharacterId, tx?: Tx): Character | undefined {
    const d = tx ?? this.db;
    const row = d
      .prepare(`SELECT * FROM ${CHAR_TBL} WHERE ${CHAR.id.sqlName} = ?`)
      .get(id) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    const parsed = parseOrDegrade(
      CharacterSchema,
      rowToCharacter(row),
      CHARACTER_SENTINEL as unknown as Character,
      { ctx: { name: 'Character' } },
    );
    return (parsed as unknown) === CHARACTER_SENTINEL ? undefined : (parsed as Character);
  }

  listCharacters(tx?: Tx): ListResult<Character> {
    const d = tx ?? this.db;
    const rows = d
      .prepare(`SELECT * FROM ${CHAR_TBL} ORDER BY ${CHAR.name.sqlName}`)
      .all() as Array<Record<string, unknown>>;
    const out: Character[] = [];
    let degradedCount = 0;
    for (const row of rows) {
      let candidate: Character | Record<string, unknown>;
      try {
        candidate = rowToCharacter(row);
      } catch {
        candidate = row;
      }
      const parsed = parseOrDegrade(
        CharacterSchema,
        candidate,
        CHARACTER_SENTINEL as unknown as Character,
        { ctx: { name: 'Character' } },
      );
      if ((parsed as unknown) === CHARACTER_SENTINEL) {
        degradedCount += 1;
        continue;
      }
      out.push(parsed as Character);
    }
    return { rows: out, degradedCount };
  }

  deleteCharacter(id: CharacterId, tx?: Tx): void {
    const d = tx ?? this.db;
    d.prepare(`DELETE FROM ${CHAR_TBL} WHERE ${CHAR.id.sqlName} = ?`).run(id);
  }

  // ── Equipment ──────────────────────────────────────────────────

  upsertEquipment(input: EquipmentUpsertInput, tx?: Tx): void {
    const d = tx ?? this.db;
    const now = Date.now();
    d.prepare(
      `INSERT INTO ${EQUIP_TBL}
         (${EQUIP.id.sqlName}, ${EQUIP.name.sqlName}, ${EQUIP.type.sqlName},
          ${EQUIP.subtype.sqlName}, ${EQUIP.description.sqlName}, ${EQUIP.functionDesc.sqlName},
          ${EQUIP.tags.sqlName}, ${EQUIP.referenceImages.sqlName},
          ${EQUIP.createdAt.sqlName}, ${EQUIP.updatedAt.sqlName})
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(${EQUIP.id.sqlName}) DO UPDATE SET
         ${EQUIP.name.sqlName}=excluded.${EQUIP.name.sqlName}, ${EQUIP.type.sqlName}=excluded.${EQUIP.type.sqlName},
         ${EQUIP.subtype.sqlName}=excluded.${EQUIP.subtype.sqlName},
         ${EQUIP.description.sqlName}=excluded.${EQUIP.description.sqlName},
         ${EQUIP.functionDesc.sqlName}=excluded.${EQUIP.functionDesc.sqlName},
         ${EQUIP.tags.sqlName}=excluded.${EQUIP.tags.sqlName},
         ${EQUIP.referenceImages.sqlName}=excluded.${EQUIP.referenceImages.sqlName},
         ${EQUIP.updatedAt.sqlName}=excluded.${EQUIP.updatedAt.sqlName}`,
    ).run(
      input.id,
      input.name,
      input.type ?? 'other',
      input.subtype ?? null,
      input.description ?? '',
      input.functionDesc ?? null,
      JSON.stringify(input.tags ?? []),
      JSON.stringify(input.referenceImages ?? []),
      input.createdAt ?? now,
      input.updatedAt ?? now,
    );
  }

  getEquipment(id: EquipmentId, tx?: Tx): Equipment | undefined {
    const d = tx ?? this.db;
    const row = d
      .prepare(`SELECT * FROM ${EQUIP_TBL} WHERE ${EQUIP.id.sqlName} = ?`)
      .get(id) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    const parsed = parseOrDegrade(
      EquipmentSchema,
      rowToEquipment(row),
      EQUIPMENT_SENTINEL as unknown as Equipment,
      { ctx: { name: 'Equipment' } },
    );
    return (parsed as unknown) === EQUIPMENT_SENTINEL ? undefined : (parsed as Equipment);
  }

  listEquipment(type?: string, tx?: Tx): ListResult<Equipment> {
    const d = tx ?? this.db;
    const rows = (
      type === undefined
        ? d
            .prepare(`SELECT * FROM ${EQUIP_TBL} ORDER BY ${EQUIP.name.sqlName}`)
            .all()
        : d
            .prepare(
              `SELECT * FROM ${EQUIP_TBL} WHERE ${EQUIP.type.sqlName} = ? ORDER BY ${EQUIP.name.sqlName}`,
            )
            .all(type)
    ) as Array<Record<string, unknown>>;
    const out: Equipment[] = [];
    let degradedCount = 0;
    for (const row of rows) {
      let candidate: Equipment | Record<string, unknown>;
      try {
        candidate = rowToEquipment(row);
      } catch {
        candidate = row;
      }
      const parsed = parseOrDegrade(
        EquipmentSchema,
        candidate,
        EQUIPMENT_SENTINEL as unknown as Equipment,
        { ctx: { name: 'Equipment' } },
      );
      if ((parsed as unknown) === EQUIPMENT_SENTINEL) {
        degradedCount += 1;
        continue;
      }
      out.push(parsed as Equipment);
    }
    return { rows: out, degradedCount };
  }

  deleteEquipment(id: EquipmentId, tx?: Tx): void {
    const d = tx ?? this.db;
    d.prepare(`DELETE FROM ${EQUIP_TBL} WHERE ${EQUIP.id.sqlName} = ?`).run(id);
  }

  // ── Locations ──────────────────────────────────────────────────

  upsertLocation(input: LocationUpsertInput, tx?: Tx): void {
    const d = tx ?? this.db;
    const now = Date.now();
    d.prepare(
      `INSERT INTO ${LOC_TBL}
         (${LOC.id.sqlName}, ${LOC.name.sqlName}, ${LOC.type.sqlName},
          ${LOC.subLocation.sqlName}, ${LOC.description.sqlName},
          ${LOC.timeOfDay.sqlName}, ${LOC.mood.sqlName}, ${LOC.weather.sqlName},
          ${LOC.lighting.sqlName}, ${LOC.architectureStyle.sqlName},
          ${LOC.dominantColors.sqlName}, ${LOC.keyFeatures.sqlName}, ${LOC.atmosphereKeywords.sqlName},
          ${LOC.tags.sqlName}, ${LOC.referenceImages.sqlName},
          ${LOC.createdAt.sqlName}, ${LOC.updatedAt.sqlName})
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(${LOC.id.sqlName}) DO UPDATE SET
         ${LOC.name.sqlName}=excluded.${LOC.name.sqlName}, ${LOC.type.sqlName}=excluded.${LOC.type.sqlName},
         ${LOC.subLocation.sqlName}=excluded.${LOC.subLocation.sqlName},
         ${LOC.description.sqlName}=excluded.${LOC.description.sqlName},
         ${LOC.timeOfDay.sqlName}=excluded.${LOC.timeOfDay.sqlName},
         ${LOC.mood.sqlName}=excluded.${LOC.mood.sqlName},
         ${LOC.weather.sqlName}=excluded.${LOC.weather.sqlName},
         ${LOC.lighting.sqlName}=excluded.${LOC.lighting.sqlName},
         ${LOC.architectureStyle.sqlName}=excluded.${LOC.architectureStyle.sqlName},
         ${LOC.dominantColors.sqlName}=excluded.${LOC.dominantColors.sqlName},
         ${LOC.keyFeatures.sqlName}=excluded.${LOC.keyFeatures.sqlName},
         ${LOC.atmosphereKeywords.sqlName}=excluded.${LOC.atmosphereKeywords.sqlName},
         ${LOC.tags.sqlName}=excluded.${LOC.tags.sqlName},
         ${LOC.referenceImages.sqlName}=excluded.${LOC.referenceImages.sqlName},
         ${LOC.updatedAt.sqlName}=excluded.${LOC.updatedAt.sqlName}`,
    ).run(
      input.id,
      input.name,
      input.type ?? 'interior',
      input.subLocation ?? null,
      input.description ?? '',
      input.timeOfDay ?? null,
      input.mood ?? null,
      input.weather ?? null,
      input.lighting ?? null,
      input.architectureStyle ?? null,
      input.dominantColors ? JSON.stringify(input.dominantColors) : null,
      input.keyFeatures ? JSON.stringify(input.keyFeatures) : null,
      input.atmosphereKeywords ? JSON.stringify(input.atmosphereKeywords) : null,
      JSON.stringify(input.tags ?? []),
      JSON.stringify(input.referenceImages ?? []),
      input.createdAt ?? now,
      input.updatedAt ?? now,
    );
  }

  getLocation(id: LocationId, tx?: Tx): Location | undefined {
    const d = tx ?? this.db;
    const row = d
      .prepare(`SELECT * FROM ${LOC_TBL} WHERE ${LOC.id.sqlName} = ?`)
      .get(id) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    const parsed = parseOrDegrade(
      LocationSchema,
      rowToLocation(row),
      LOCATION_SENTINEL as unknown as Location,
      { ctx: { name: 'Location' } },
    );
    return (parsed as unknown) === LOCATION_SENTINEL ? undefined : (parsed as Location);
  }

  listLocations(type?: string, tx?: Tx): ListResult<Location> {
    const d = tx ?? this.db;
    const rows = (
      type === undefined
        ? d.prepare(`SELECT * FROM ${LOC_TBL} ORDER BY ${LOC.name.sqlName}`).all()
        : d
            .prepare(
              `SELECT * FROM ${LOC_TBL} WHERE ${LOC.type.sqlName} = ? ORDER BY ${LOC.name.sqlName}`,
            )
            .all(type)
    ) as Array<Record<string, unknown>>;
    const out: Location[] = [];
    let degradedCount = 0;
    for (const row of rows) {
      let candidate: Location | Record<string, unknown>;
      try {
        candidate = rowToLocation(row);
      } catch {
        candidate = row;
      }
      const parsed = parseOrDegrade(
        LocationSchema,
        candidate,
        LOCATION_SENTINEL as unknown as Location,
        { ctx: { name: 'Location' } },
      );
      if ((parsed as unknown) === LOCATION_SENTINEL) {
        degradedCount += 1;
        continue;
      }
      out.push(parsed as Location);
    }
    return { rows: out, degradedCount };
  }

  deleteLocation(id: LocationId, tx?: Tx): void {
    const d = tx ?? this.db;
    d.prepare(`DELETE FROM ${LOC_TBL} WHERE ${LOC.id.sqlName} = ?`).run(id);
  }
}
