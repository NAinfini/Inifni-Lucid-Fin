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
 *
 * --- Partial UPDATE architecture (2026-04-28) ---
 * Upsert methods now separate INSERT (new entity with defaults) from UPDATE
 * (existing entity with only the provided fields). This prevents partial
 * payloads from resetting omitted fields to defaults — only fields explicitly
 * present in the input are written.
 */

import type BetterSqlite3 from 'better-sqlite3';
import type {
  Character,
  CharacterFace,
  CharacterHair,
  CharacterBody,
  VocalTraits,
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

// --- Character input shape ---
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
  face?: CharacterFace;
  hair?: CharacterHair;
  skinTone?: string;
  body?: CharacterBody;
  distinctTraits?: string[];
  vocalTraits?: VocalTraits;
  referenceImages?: unknown[];
  loadouts?: unknown[];
  defaultLoadoutId?: string;
  folderId?: string | null;
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
  material?: string;
  color?: string;
  condition?: string;
  visualDetails?: string;
  tags?: string[];
  referenceImages?: unknown[];
  folderId?: string | null;
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
  folderId?: string | null;
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

function parseJsonObjectOrUndef(raw: unknown): Record<string, unknown> | undefined {
  if (typeof raw !== 'string' || raw.length === 0) return undefined;
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
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

// ---------------------------------------------------------------------------
// Dynamic UPDATE builder — only sets columns present in the field map
// ---------------------------------------------------------------------------

interface FieldMapping {
  sqlName: string;
  value: unknown;
}

function buildPartialUpdate(
  tableName: string,
  idCol: string,
  id: string,
  fields: FieldMapping[],
): { sql: string; params: unknown[] } {
  const setClauses = fields.map((f) => `${f.sqlName} = ?`);
  const params = fields.map((f) => f.value);
  params.push(id);
  return {
    sql: `UPDATE ${tableName} SET ${setClauses.join(', ')} WHERE ${idCol} = ?`,
    params,
  };
}

// ---------------------------------------------------------------------------
// Row → domain object mappers
// ---------------------------------------------------------------------------

function rowToCharacter(row: Record<string, unknown>): Character {
  return {
    id: row.id as string,
    name: row.name as string,
    role: (row.role as Character['role']) ?? 'supporting',
    description: (row.description as string) ?? '',
    appearance: (row.appearance as string) ?? '',
    personality: (row.personality as string) ?? '',
    costumes: parseJsonArrayOrEmpty(row.costumes) as Character['costumes'],
    tags: parseStringArrayOrEmpty(row.tags),
    age: (row.age as number | null) ?? undefined,
    gender: (row.gender as Character['gender']) ?? undefined,
    voice: (row.voice as string | null) ?? undefined,
    face: parseJsonObjectOrUndef(row.face) as CharacterFace | undefined,
    hair: parseJsonObjectOrUndef(row.hair) as CharacterHair | undefined,
    skinTone: (row.skin_tone as string | null) ?? undefined,
    body: parseJsonObjectOrUndef(row.body) as CharacterBody | undefined,
    distinctTraits: parseStringArrayOrUndef(row.distinct_traits),
    vocalTraits: parseJsonObjectOrUndef(row.vocal_traits) as VocalTraits | undefined,
    referenceImages: parseJsonArrayOrEmpty(row.reference_images) as Character['referenceImages'],
    loadouts: parseJsonArrayOrEmpty(row.loadouts) as Character['loadouts'],
    defaultLoadoutId: (row.default_loadout_id as string) ?? '',
    folderId: (row.folder_id as string | null) ?? null,
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
    material: (row.material as string | null) ?? undefined,
    color: (row.color as string | null) ?? undefined,
    condition: (row.condition as string | null) ?? undefined,
    visualDetails: (row.visual_details as string | null) ?? undefined,
    tags: parseStringArrayOrEmpty(row.tags),
    referenceImages: parseJsonArrayOrEmpty(row.reference_images) as Equipment['referenceImages'],
    folderId: (row.folder_id as string | null) ?? null,
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
    referenceImages: parseJsonArrayOrEmpty(row.reference_images) as Location['referenceImages'],
    folderId: (row.folder_id as string | null) ?? null,
    createdAt: (row.created_at as number) ?? Date.now(),
    updatedAt: (row.updated_at as number) ?? Date.now(),
  };
}

export class EntityRepository {
  constructor(private readonly db: BetterSqlite3.Database) {}

  // ── Characters ─────────────────────────────────────────────────

  private existsCharacter(id: string, d: BetterSqlite3.Database | Tx): boolean {
    const row = d.prepare(`SELECT 1 FROM ${CHAR_TBL} WHERE ${CHAR.id.sqlName} = ?`).get(id) as
      | Record<string, unknown>
      | undefined;
    return row !== undefined;
  }

  upsertCharacter(input: CharacterUpsertInput, tx?: Tx): void {
    const d = tx ?? this.db;
    const now = Date.now();

    if (this.existsCharacter(input.id, d)) {
      const fields: FieldMapping[] = [];
      fields.push({ sqlName: CHAR.name.sqlName, value: input.name });
      if (input.role !== undefined) fields.push({ sqlName: CHAR.role.sqlName, value: input.role });
      if (input.description !== undefined)
        fields.push({ sqlName: CHAR.description.sqlName, value: input.description });
      if (input.appearance !== undefined)
        fields.push({ sqlName: CHAR.appearance.sqlName, value: input.appearance });
      if (input.personality !== undefined)
        fields.push({ sqlName: CHAR.personality.sqlName, value: input.personality });
      if (input.costumes !== undefined)
        fields.push({ sqlName: CHAR.costumes.sqlName, value: JSON.stringify(input.costumes) });
      if (input.tags !== undefined)
        fields.push({ sqlName: CHAR.tags.sqlName, value: JSON.stringify(input.tags) });
      if (input.age !== undefined) fields.push({ sqlName: CHAR.age.sqlName, value: input.age });
      if (input.gender !== undefined)
        fields.push({ sqlName: CHAR.gender.sqlName, value: input.gender });
      if (input.voice !== undefined)
        fields.push({ sqlName: CHAR.voice.sqlName, value: input.voice });
      if (input.face !== undefined)
        fields.push({ sqlName: CHAR.face.sqlName, value: JSON.stringify(input.face) });
      if (input.hair !== undefined)
        fields.push({ sqlName: CHAR.hair.sqlName, value: JSON.stringify(input.hair) });
      if (input.skinTone !== undefined)
        fields.push({ sqlName: CHAR.skinTone.sqlName, value: input.skinTone });
      if (input.body !== undefined)
        fields.push({ sqlName: CHAR.body.sqlName, value: JSON.stringify(input.body) });
      if (input.distinctTraits !== undefined)
        fields.push({
          sqlName: CHAR.distinctTraits.sqlName,
          value: JSON.stringify(input.distinctTraits),
        });
      if (input.vocalTraits !== undefined)
        fields.push({
          sqlName: CHAR.vocalTraits.sqlName,
          value: JSON.stringify(input.vocalTraits),
        });
      if (input.referenceImages !== undefined)
        fields.push({
          sqlName: CHAR.referenceImages.sqlName,
          value: JSON.stringify(input.referenceImages),
        });
      if (input.loadouts !== undefined)
        fields.push({ sqlName: CHAR.loadouts.sqlName, value: JSON.stringify(input.loadouts) });
      if (input.defaultLoadoutId !== undefined)
        fields.push({ sqlName: CHAR.defaultLoadoutId.sqlName, value: input.defaultLoadoutId });
      if (input.folderId !== undefined)
        fields.push({ sqlName: CHAR.folderId.sqlName, value: input.folderId });
      fields.push({ sqlName: CHAR.updatedAt.sqlName, value: input.updatedAt ?? now });

      if (fields.length > 0) {
        const { sql, params } = buildPartialUpdate(CHAR_TBL, CHAR.id.sqlName, input.id, fields);
        d.prepare(sql).run(...params);
      }
    } else {
      d.prepare(
        `INSERT INTO ${CHAR_TBL}
           (${CHAR.id.sqlName}, ${CHAR.name.sqlName}, ${CHAR.role.sqlName},
            ${CHAR.description.sqlName}, ${CHAR.appearance.sqlName}, ${CHAR.personality.sqlName},
            ${CHAR.costumes.sqlName}, ${CHAR.tags.sqlName},
            ${CHAR.age.sqlName}, ${CHAR.gender.sqlName}, ${CHAR.voice.sqlName},
            ${CHAR.face.sqlName}, ${CHAR.hair.sqlName}, ${CHAR.skinTone.sqlName},
            ${CHAR.body.sqlName}, ${CHAR.distinctTraits.sqlName}, ${CHAR.vocalTraits.sqlName},
            ${CHAR.referenceImages.sqlName}, ${CHAR.loadouts.sqlName}, ${CHAR.defaultLoadoutId.sqlName},
            ${CHAR.folderId.sqlName},
            ${CHAR.createdAt.sqlName}, ${CHAR.updatedAt.sqlName})
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        input.face ? JSON.stringify(input.face) : null,
        input.hair ? JSON.stringify(input.hair) : null,
        input.skinTone ?? null,
        input.body ? JSON.stringify(input.body) : null,
        input.distinctTraits ? JSON.stringify(input.distinctTraits) : null,
        input.vocalTraits ? JSON.stringify(input.vocalTraits) : null,
        JSON.stringify(input.referenceImages ?? []),
        JSON.stringify(input.loadouts ?? []),
        input.defaultLoadoutId ?? '',
        input.folderId ?? null,
        input.createdAt ?? now,
        input.updatedAt ?? now,
      );
    }
  }

  getCharacter(id: CharacterId, tx?: Tx): Character | undefined {
    const d = tx ?? this.db;
    const row = d.prepare(`SELECT * FROM ${CHAR_TBL} WHERE ${CHAR.id.sqlName} = ?`).get(id) as
      | Record<string, unknown>
      | undefined;
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

  private existsEquipment(id: string, d: BetterSqlite3.Database | Tx): boolean {
    const row = d.prepare(`SELECT 1 FROM ${EQUIP_TBL} WHERE ${EQUIP.id.sqlName} = ?`).get(id) as
      | Record<string, unknown>
      | undefined;
    return row !== undefined;
  }

  upsertEquipment(input: EquipmentUpsertInput, tx?: Tx): void {
    const d = tx ?? this.db;
    const now = Date.now();

    if (this.existsEquipment(input.id, d)) {
      const fields: FieldMapping[] = [];
      fields.push({ sqlName: EQUIP.name.sqlName, value: input.name });
      if (input.type !== undefined) fields.push({ sqlName: EQUIP.type.sqlName, value: input.type });
      if (input.subtype !== undefined)
        fields.push({ sqlName: EQUIP.subtype.sqlName, value: input.subtype });
      if (input.description !== undefined)
        fields.push({ sqlName: EQUIP.description.sqlName, value: input.description });
      if (input.functionDesc !== undefined)
        fields.push({ sqlName: EQUIP.functionDesc.sqlName, value: input.functionDesc });
      if (input.material !== undefined)
        fields.push({ sqlName: EQUIP.material.sqlName, value: input.material });
      if (input.color !== undefined)
        fields.push({ sqlName: EQUIP.color.sqlName, value: input.color });
      if (input.condition !== undefined)
        fields.push({ sqlName: EQUIP.condition.sqlName, value: input.condition });
      if (input.visualDetails !== undefined)
        fields.push({ sqlName: EQUIP.visualDetails.sqlName, value: input.visualDetails });
      if (input.tags !== undefined)
        fields.push({ sqlName: EQUIP.tags.sqlName, value: JSON.stringify(input.tags) });
      if (input.referenceImages !== undefined)
        fields.push({
          sqlName: EQUIP.referenceImages.sqlName,
          value: JSON.stringify(input.referenceImages),
        });
      if (input.folderId !== undefined)
        fields.push({ sqlName: EQUIP.folderId.sqlName, value: input.folderId });
      fields.push({ sqlName: EQUIP.updatedAt.sqlName, value: input.updatedAt ?? now });

      if (fields.length > 0) {
        const { sql, params } = buildPartialUpdate(EQUIP_TBL, EQUIP.id.sqlName, input.id, fields);
        d.prepare(sql).run(...params);
      }
    } else {
      d.prepare(
        `INSERT INTO ${EQUIP_TBL}
           (${EQUIP.id.sqlName}, ${EQUIP.name.sqlName}, ${EQUIP.type.sqlName},
            ${EQUIP.subtype.sqlName}, ${EQUIP.description.sqlName}, ${EQUIP.functionDesc.sqlName},
            ${EQUIP.material.sqlName}, ${EQUIP.color.sqlName}, ${EQUIP.condition.sqlName}, ${EQUIP.visualDetails.sqlName},
            ${EQUIP.tags.sqlName}, ${EQUIP.referenceImages.sqlName},
            ${EQUIP.folderId.sqlName},
            ${EQUIP.createdAt.sqlName}, ${EQUIP.updatedAt.sqlName})
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        input.id,
        input.name,
        input.type ?? 'other',
        input.subtype ?? null,
        input.description ?? '',
        input.functionDesc ?? null,
        input.material ?? null,
        input.color ?? null,
        input.condition ?? null,
        input.visualDetails ?? null,
        JSON.stringify(input.tags ?? []),
        JSON.stringify(input.referenceImages ?? []),
        input.folderId ?? null,
        input.createdAt ?? now,
        input.updatedAt ?? now,
      );
    }
  }

  getEquipment(id: EquipmentId, tx?: Tx): Equipment | undefined {
    const d = tx ?? this.db;
    const row = d.prepare(`SELECT * FROM ${EQUIP_TBL} WHERE ${EQUIP.id.sqlName} = ?`).get(id) as
      | Record<string, unknown>
      | undefined;
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
        ? d.prepare(`SELECT * FROM ${EQUIP_TBL} ORDER BY ${EQUIP.name.sqlName}`).all()
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

  private existsLocation(id: string, d: BetterSqlite3.Database | Tx): boolean {
    const row = d.prepare(`SELECT 1 FROM ${LOC_TBL} WHERE ${LOC.id.sqlName} = ?`).get(id) as
      | Record<string, unknown>
      | undefined;
    return row !== undefined;
  }

  upsertLocation(input: LocationUpsertInput, tx?: Tx): void {
    const d = tx ?? this.db;
    const now = Date.now();

    if (this.existsLocation(input.id, d)) {
      const fields: FieldMapping[] = [];
      fields.push({ sqlName: LOC.name.sqlName, value: input.name });
      if (input.type !== undefined) fields.push({ sqlName: LOC.type.sqlName, value: input.type });
      if (input.subLocation !== undefined)
        fields.push({ sqlName: LOC.subLocation.sqlName, value: input.subLocation });
      if (input.description !== undefined)
        fields.push({ sqlName: LOC.description.sqlName, value: input.description });
      if (input.timeOfDay !== undefined)
        fields.push({ sqlName: LOC.timeOfDay.sqlName, value: input.timeOfDay });
      if (input.mood !== undefined) fields.push({ sqlName: LOC.mood.sqlName, value: input.mood });
      if (input.weather !== undefined)
        fields.push({ sqlName: LOC.weather.sqlName, value: input.weather });
      if (input.lighting !== undefined)
        fields.push({ sqlName: LOC.lighting.sqlName, value: input.lighting });
      if (input.architectureStyle !== undefined)
        fields.push({ sqlName: LOC.architectureStyle.sqlName, value: input.architectureStyle });
      if (input.dominantColors !== undefined)
        fields.push({
          sqlName: LOC.dominantColors.sqlName,
          value: input.dominantColors ? JSON.stringify(input.dominantColors) : null,
        });
      if (input.keyFeatures !== undefined)
        fields.push({
          sqlName: LOC.keyFeatures.sqlName,
          value: input.keyFeatures ? JSON.stringify(input.keyFeatures) : null,
        });
      if (input.atmosphereKeywords !== undefined)
        fields.push({
          sqlName: LOC.atmosphereKeywords.sqlName,
          value: input.atmosphereKeywords ? JSON.stringify(input.atmosphereKeywords) : null,
        });
      if (input.tags !== undefined)
        fields.push({ sqlName: LOC.tags.sqlName, value: JSON.stringify(input.tags) });
      if (input.referenceImages !== undefined)
        fields.push({
          sqlName: LOC.referenceImages.sqlName,
          value: JSON.stringify(input.referenceImages),
        });
      if (input.folderId !== undefined)
        fields.push({ sqlName: LOC.folderId.sqlName, value: input.folderId });
      fields.push({ sqlName: LOC.updatedAt.sqlName, value: input.updatedAt ?? now });

      if (fields.length > 0) {
        const { sql, params } = buildPartialUpdate(LOC_TBL, LOC.id.sqlName, input.id, fields);
        d.prepare(sql).run(...params);
      }
    } else {
      d.prepare(
        `INSERT INTO ${LOC_TBL}
           (${LOC.id.sqlName}, ${LOC.name.sqlName}, ${LOC.type.sqlName},
            ${LOC.subLocation.sqlName}, ${LOC.description.sqlName},
            ${LOC.timeOfDay.sqlName}, ${LOC.mood.sqlName}, ${LOC.weather.sqlName},
            ${LOC.lighting.sqlName}, ${LOC.architectureStyle.sqlName},
            ${LOC.dominantColors.sqlName}, ${LOC.keyFeatures.sqlName}, ${LOC.atmosphereKeywords.sqlName},
            ${LOC.tags.sqlName}, ${LOC.referenceImages.sqlName},
            ${LOC.folderId.sqlName},
            ${LOC.createdAt.sqlName}, ${LOC.updatedAt.sqlName})
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        input.folderId ?? null,
        input.createdAt ?? now,
        input.updatedAt ?? now,
      );
    }
  }

  getLocation(id: LocationId, tx?: Tx): Location | undefined {
    const d = tx ?? this.db;
    const row = d.prepare(`SELECT * FROM ${LOC_TBL} WHERE ${LOC.id.sqlName} = ?`).get(id) as
      | Record<string, unknown>
      | undefined;
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

  // ── Folder assignments ─────────────────────────────────────────

  setCharacterFolder(id: CharacterId, folderId: string | null, tx?: Tx): void {
    const d = tx ?? this.db;
    d.prepare(
      `UPDATE ${CHAR_TBL} SET ${CHAR.folderId.sqlName} = ?, ${CHAR.updatedAt.sqlName} = ? WHERE ${CHAR.id.sqlName} = ?`,
    ).run(folderId, Date.now(), id);
  }

  setEquipmentFolder(id: EquipmentId, folderId: string | null, tx?: Tx): void {
    const d = tx ?? this.db;
    d.prepare(
      `UPDATE ${EQUIP_TBL} SET ${EQUIP.folderId.sqlName} = ?, ${EQUIP.updatedAt.sqlName} = ? WHERE ${EQUIP.id.sqlName} = ?`,
    ).run(folderId, Date.now(), id);
  }

  setLocationFolder(id: LocationId, folderId: string | null, tx?: Tx): void {
    const d = tx ?? this.db;
    d.prepare(
      `UPDATE ${LOC_TBL} SET ${LOC.folderId.sqlName} = ?, ${LOC.updatedAt.sqlName} = ? WHERE ${LOC.id.sqlName} = ?`,
    ).run(folderId, Date.now(), id);
  }
}
