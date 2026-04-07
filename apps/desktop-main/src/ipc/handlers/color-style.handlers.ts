import type { IpcMain } from 'electron';
import type { SqliteIndex } from '@lucid-fin/storage';
import type { CAS } from '@lucid-fin/storage';
import type { WorkflowEngine } from '@lucid-fin/application';
import type { ColorStyle, ExposureProfile, ColorSwatch, GradientDef } from '@lucid-fin/contracts';
import log from '../../logger.js';
import { getCurrentProjectId } from '../project-context.js';

const DEFAULT_EXPOSURE: ExposureProfile = {
  brightness: 0,
  contrast: 0,
  highlights: 0,
  shadows: 0,
  temperature: 5500,
  tint: 0,
};

function clamp(v: unknown, min: number, max: number, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}

function sanitizePalette(raw: unknown): ColorSwatch[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (s): s is Record<string, unknown> =>
        !!s &&
        typeof s === 'object' &&
        typeof s.hex === 'string' &&
        /^#[0-9a-f]{6}$/i.test(s.hex as string),
    )
    .map((s) => ({
      hex: s.hex as string,
      name: typeof s.name === 'string' ? s.name : undefined,
      weight: clamp(s.weight, 0, 1, 0.1),
    }));
}

function sanitizeGradients(raw: unknown): GradientDef[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (g): g is Record<string, unknown> =>
        !!g &&
        typeof g === 'object' &&
        (g.type === 'linear' || g.type === 'radial') &&
        Array.isArray(g.stops),
    )
    .map((g) => ({
      type: g.type as 'linear' | 'radial',
      angle: g.type === 'linear' ? clamp(g.angle, 0, 360, 90) : undefined,
      stops: (g.stops as unknown[])
        .filter(
          (s): s is { hex: string; position: unknown } =>
            !!s && typeof s === 'object' && typeof (s as Record<string, unknown>).hex === 'string',
        )
        .map((s) => ({ hex: s.hex, position: clamp(s.position, 0, 1, 0) })),
    }));
}

function sanitizeExposure(raw: unknown): ExposureProfile {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_EXPOSURE };
  const e = raw as Record<string, unknown>;
  return {
    brightness: clamp(e.brightness, -100, 100, 0),
    contrast: clamp(e.contrast, -100, 100, 0),
    highlights: clamp(e.highlights, -100, 100, 0),
    shadows: clamp(e.shadows, -100, 100, 0),
    temperature: clamp(e.temperature, 2000, 10000, 5500),
    tint: clamp(e.tint, -100, 100, 0),
  };
}

export function registerColorStyleHandlers(
  ipcMain: IpcMain,
  db: SqliteIndex,
  _cas: CAS,
  workflowEngine: WorkflowEngine,
): void {
  ipcMain.handle('colorStyle:list', () => {
    return db.listColorStyles();
  });

  ipcMain.handle('colorStyle:save', (_e, data: ColorStyle) => {
    if (!data?.id || !data?.name) throw new Error('id and name are required');
    const now = Date.now();
    const cs: ColorStyle = {
      ...data,
      palette: sanitizePalette(data.palette),
      gradients: sanitizeGradients(data.gradients),
      exposure: sanitizeExposure(data.exposure),
      updatedAt: now,
      createdAt: data.createdAt || now,
    };
    db.upsertColorStyle(cs);
    return cs;
  });

  ipcMain.handle('colorStyle:delete', (_e, args: { id: string }) => {
    if (!args?.id) throw new Error('id is required');
    db.deleteColorStyle(args.id);
  });

  ipcMain.handle(
    'colorStyle:extract',
    async (_e, args: { assetHash: string; assetType: 'image' | 'video' }) => {
      if (!args?.assetHash) throw new Error('assetHash is required');
      const projectId = getCurrentProjectId();
      if (!projectId) throw new Error('No project open');

      const assets = db.queryAssets({
        projectId,
        type: args.assetType,
        limit: 10000,
      });
      const asset = assets.find((a) => a.hash === args.assetHash);
      if (!asset) throw new Error(`Asset not found in DB: ${args.assetHash}`);
      const workflowRunId = workflowEngine.start({
        workflowType: 'style.extract',
        projectId,
        entityType: 'asset',
        entityId: asset.hash,
        triggerSource: 'colorStyle:extract',
        input: {
          assetHash: asset.hash,
          assetType: args.assetType,
        },
        metadata: {
          relatedEntityLabel: `${args.assetType} asset`,
        },
      });

      void workflowEngine.pump(workflowRunId).catch((error) => {
        log.error(`Color style workflow ${workflowRunId} failed to start`, error);
      });

      return { workflowRunId };
    },
  );
}
