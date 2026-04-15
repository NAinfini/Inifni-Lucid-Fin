import type { IpcMain } from 'electron';
import { randomUUID } from 'node:crypto';
import type { Location, ReferenceImage } from '@lucid-fin/contracts';
import type { SqliteIndex } from '@lucid-fin/storage';
import { safeHandle } from '../ipc-error-handler.js';

const VALID_LOCATION_TYPES = new Set<Location['type']>(['interior', 'exterior', 'int-ext']);

function normalizeLocationType(
  value: unknown,
  fallback: Location['type'] = 'interior',
): Location['type'] {
  return typeof value === 'string' && VALID_LOCATION_TYPES.has(value as Location['type'])
    ? (value as Location['type'])
    : fallback;
}

export function registerLocationHandlers(ipcMain: IpcMain, db: SqliteIndex): void {
  safeHandle(ipcMain, 'location:list', async (_e, args?: { type?: string } | void) => {
    const typeFilter =
      args && typeof args === 'object' && typeof args.type === 'string'
        ? args.type
        : undefined;
    return db.listLocations(typeFilter);
  });

  safeHandle(ipcMain, 'location:get', async (_e, args: { id: string }) => {
    if (!args || typeof args.id !== 'string') throw new Error('id is required');
    const loc = db.getLocation(args.id);
    if (!loc) throw new Error(`Location not found: ${args.id}`);
    return loc;
  });

  safeHandle(ipcMain, 'location:save', async (_e, args: Partial<Location>) => {
    if (!args || (typeof args.name !== 'string' && typeof args.id !== 'string')) {
      throw new Error('name or id is required');
    }
    const existing = typeof args.id === 'string' ? db.getLocation(args.id) : undefined;
    const now = Date.now();

    const name = (typeof args.name === 'string' ? args.name : (existing?.name ?? '')).trim();
    if (!name) throw new Error('name is required');

    const loc: Location = {
      id: existing?.id ?? (typeof args.id === 'string' && args.id ? args.id : randomUUID()),
      name,
      type: normalizeLocationType(args.type, existing?.type ?? 'interior'),
      subLocation:
        typeof args.subLocation === 'string' ? args.subLocation : existing?.subLocation,
      description:
        typeof args.description === 'string' ? args.description : (existing?.description ?? ''),
      timeOfDay: typeof args.timeOfDay === 'string' ? args.timeOfDay : existing?.timeOfDay,
      mood: typeof args.mood === 'string' ? args.mood : existing?.mood,
      weather: typeof args.weather === 'string' ? args.weather : existing?.weather,
      lighting: typeof args.lighting === 'string' ? args.lighting : existing?.lighting,
      architectureStyle: typeof args.architectureStyle === 'string' ? args.architectureStyle : existing?.architectureStyle,
      dominantColors: Array.isArray(args.dominantColors)
        ? args.dominantColors.filter((c): c is string => typeof c === 'string')
        : existing?.dominantColors,
      keyFeatures: Array.isArray(args.keyFeatures)
        ? args.keyFeatures.filter((f): f is string => typeof f === 'string')
        : existing?.keyFeatures,
      atmosphereKeywords: Array.isArray(args.atmosphereKeywords)
        ? args.atmosphereKeywords.filter((k): k is string => typeof k === 'string')
        : existing?.atmosphereKeywords,
      tags: Array.isArray(args.tags)
        ? args.tags.filter((t): t is string => typeof t === 'string')
        : (existing?.tags ?? []),
      referenceImages: Array.isArray(args.referenceImages)
        ? args.referenceImages
        : (existing?.referenceImages ?? []),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    db.upsertLocation({
      id: loc.id,
      name: loc.name,
      type: loc.type,
      subLocation: loc.subLocation,
      description: loc.description,
      timeOfDay: loc.timeOfDay,
      mood: loc.mood,
      weather: loc.weather,
      lighting: loc.lighting,
      architectureStyle: loc.architectureStyle,
      dominantColors: loc.dominantColors,
      keyFeatures: loc.keyFeatures,
      atmosphereKeywords: loc.atmosphereKeywords,
      tags: loc.tags,
      referenceImages: loc.referenceImages,
      createdAt: loc.createdAt,
      updatedAt: loc.updatedAt,
    });
    return loc;
  });

  safeHandle(ipcMain, 'location:delete', async (_e, args: { id: string }) => {
    if (!args || typeof args.id !== 'string') throw new Error('id is required');
    db.deleteLocation(args.id);
  });

  safeHandle(ipcMain,
    'location:setRefImage',
    async (
      _e,
      args: { locationId: string; slot: string; assetHash: string; isStandard: boolean },
    ) => {
      if (!args || typeof args.locationId !== 'string')
        throw new Error('locationId is required');
      if (typeof args.slot !== 'string') throw new Error('slot is required');
      if (typeof args.assetHash !== 'string') throw new Error('assetHash is required');

      const loc = db.getLocation(args.locationId);
      if (!loc) throw new Error(`Location not found: ${args.locationId}`);

      const existing = loc.referenceImages.find((r) => r.slot === args.slot);
      const refImage: ReferenceImage = {
        slot: args.slot,
        assetHash: args.assetHash,
        isStandard: args.isStandard ?? true,
        ...(existing?.variants ? { variants: existing.variants } : {}),
      };

      const refs = loc.referenceImages.filter((r) => r.slot !== args.slot);
      refs.push(refImage);

      db.upsertLocation({
        ...loc,
        referenceImages: refs,
        updatedAt: Date.now(),
      });

      return refImage;
    },
  );

  safeHandle(ipcMain,
    'location:removeRefImage',
    async (_e, args: { locationId: string; slot: string }) => {
      if (!args || typeof args.locationId !== 'string')
        throw new Error('locationId is required');
      if (typeof args.slot !== 'string') throw new Error('slot is required');

      const loc = db.getLocation(args.locationId);
      if (!loc) throw new Error(`Location not found: ${args.locationId}`);

      const refs = loc.referenceImages.filter((r) => r.slot !== args.slot);

      db.upsertLocation({
        ...loc,
        referenceImages: refs,
        updatedAt: Date.now(),
      });
    },
  );
}
