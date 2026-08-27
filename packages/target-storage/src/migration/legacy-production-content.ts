import {
  NamedWorldContentSchema,
  StoryContentSchema,
  parseCanonical,
  type ProductionObject,
} from '@lucid-fin/target-contracts';
import type { LegacyClassificationRow } from './classification-subjects.js';

export type LegacyProductionTable = 'characters' | 'equipment' | 'locations' | 'scripts';

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label} must be non-empty text`);
  }
  return value.trim();
}

function optionalText(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function optionalJsonDocument(value: unknown, label: string): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') throw new TypeError(`${label} must be JSON text`);
  try {
    return JSON.parse(value) as unknown;
  } catch (cause) {
    throw new TypeError(`${label} must be valid JSON`, { cause });
  }
}

function stringArray(value: unknown, label: string): readonly string[] {
  const parsed = optionalJsonDocument(value, label) ?? [];
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string')) {
    throw new TypeError(`${label} must be a text array`);
  }
  return [...new Set(parsed.map((item) => item.trim()).filter(Boolean))].sort(compareText);
}

function joinedDescription(
  row: LegacyClassificationRow,
  fields: readonly string[],
  label: string,
): string {
  const values = fields.flatMap((field) => {
    const value = optionalText(row.values[field]);
    return value === null ? [] : [`${field}: ${value}`];
  });
  return values.length === 0 ? `Imported Legacy ${label}.` : values.join('\n');
}

export function buildLegacyProductionTypedContent(
  row: LegacyClassificationRow,
  table: LegacyProductionTable,
): Readonly<{
  type: ProductionObject['type'];
  content: ProductionObject['content'];
}> {
  const id = text(row.values.id, `${table}.id`);
  if (table === 'characters') {
    return {
      type: 'character',
      content: parseCanonical(NamedWorldContentSchema, {
        name: text(row.values.name, `characters.${id}.name`),
        description: joinedDescription(
          row,
          [
            'description',
            'role',
            'appearance',
            'personality',
            'age',
            'gender',
            'skin_tone',
            'hair',
            'face',
            'body',
            'voice',
            'vocal_traits',
          ],
          `Character ${id}`,
        ),
        traits: [
          ...stringArray(row.values.tags, `characters.${id}.tags`),
          ...stringArray(row.values.distinct_traits, `characters.${id}.distinct_traits`),
        ],
      }),
    };
  }
  if (table === 'locations') {
    return {
      type: 'location',
      content: parseCanonical(NamedWorldContentSchema, {
        name: text(row.values.name, `locations.${id}.name`),
        description: joinedDescription(
          row,
          [
            'description',
            'type',
            'sub_location',
            'time_of_day',
            'weather',
            'lighting',
            'mood',
            'architecture_style',
          ],
          `Location ${id}`,
        ),
        traits: [
          ...stringArray(row.values.tags, `locations.${id}.tags`),
          ...stringArray(row.values.atmosphere_keywords, `locations.${id}.atmosphere_keywords`),
          ...stringArray(row.values.dominant_colors, `locations.${id}.dominant_colors`),
          ...stringArray(row.values.key_features, `locations.${id}.key_features`),
        ],
      }),
    };
  }
  if (table === 'equipment') {
    return {
      type: 'equipment',
      content: parseCanonical(NamedWorldContentSchema, {
        name: text(row.values.name, `equipment.${id}.name`),
        description: joinedDescription(
          row,
          [
            'description',
            'type',
            'subtype',
            'function_desc',
            'material',
            'color',
            'condition',
            'visual_details',
          ],
          `Equipment ${id}`,
        ),
        traits: stringArray(row.values.tags, `equipment.${id}.tags`),
      }),
    };
  }
  const content = text(row.values.content, `scripts.${id}.content`);
  return {
    type: 'story',
    content: parseCanonical(StoryContentSchema, {
      title: `Imported Script ${id}`.slice(0, 240),
      premise: content.slice(0, 4_000),
      synopsis: content,
    }),
  };
}
