import type { IpcMain } from 'electron';
import { randomUUID } from 'node:crypto';
import type { SceneSegment, StyleGuide } from '@lucid-fin/contracts';
import { assembleSegmentPrompt } from '@lucid-fin/domain';
import type { SqliteIndex } from '@lucid-fin/storage';

const DEFAULT_STYLE_GUIDE: StyleGuide = {
  global: {
    artStyle: '',
    colorPalette: { primary: '', secondary: '', forbidden: [] },
    lighting: 'natural',
    texture: '',
    referenceImages: [],
    freeformDescription: '',
  },
  sceneOverrides: {},
};

export function registerOrchestrationHandlers(ipcMain: IpcMain, db: SqliteIndex): void {
  ipcMain.handle('orchestration:list', async (_e, args: { sceneId: string }) => {
    if (!args || typeof args.sceneId !== 'string') throw new Error('sceneId is required');
    const scene = db.getScene(args.sceneId);
    if (!scene) throw new Error(`Scene not found: ${args.sceneId}`);
    return scene.segments;
  });

  ipcMain.handle(
    'orchestration:save',
    async (_e, args: Partial<SceneSegment> & { sceneId: string }) => {
      if (!args || typeof args.sceneId !== 'string') throw new Error('sceneId is required');
      const scene = db.getScene(args.sceneId);
      if (!scene) throw new Error(`Scene not found: ${args.sceneId}`);

      const now = Date.now();
      const existing = args.id ? scene.segments.find((s) => s.id === args.id) : undefined;

      const segment: SceneSegment = {
        id: existing?.id ?? (typeof args.id === 'string' && args.id ? args.id : randomUUID()),
        sceneId: args.sceneId,
        startKeyframeId:
          typeof args.startKeyframeId === 'string'
            ? args.startKeyframeId
            : (existing?.startKeyframeId ?? ''),
        endKeyframeId:
          typeof args.endKeyframeId === 'string'
            ? args.endKeyframeId
            : (existing?.endKeyframeId ?? ''),
        motion: typeof args.motion === 'string' ? args.motion : (existing?.motion ?? ''),
        camera: typeof args.camera === 'string' ? args.camera : (existing?.camera ?? ''),
        mood: typeof args.mood === 'string' ? args.mood : (existing?.mood ?? ''),
        moodIntensity:
          typeof args.moodIntensity === 'number' ? args.moodIntensity : existing?.moodIntensity,
        negativePrompt:
          typeof args.negativePrompt === 'string' ? args.negativePrompt : existing?.negativePrompt,
        seed: typeof args.seed === 'number' ? args.seed : existing?.seed,
        duration: typeof args.duration === 'number' ? args.duration : (existing?.duration ?? 0),
        videoAssetHash:
          typeof args.videoAssetHash === 'string' ? args.videoAssetHash : existing?.videoAssetHash,
      };

      const segments = existing
        ? scene.segments.map((s) => (s.id === segment.id ? segment : s))
        : [...scene.segments, segment];

      db.upsertScene({ ...scene, segments, updatedAt: now });
      return segment;
    },
  );

  ipcMain.handle('orchestration:delete', async (_e, args: { id: string }) => {
    if (!args || typeof args.id !== 'string') throw new Error('id is required');
    const scenes = db.listScenes();
    const scene = scenes.find((s) => s.segments.some((seg) => seg.id === args.id));
    if (!scene) throw new Error(`Segment not found: ${args.id}`);

    db.upsertScene({
      ...scene,
      segments: scene.segments.filter((s) => s.id !== args.id),
      updatedAt: Date.now(),
    });
  });

  ipcMain.handle(
    'orchestration:reorder',
    async (_e, args: { sceneId: string; segmentIds: string[] }) => {
      if (!args || typeof args.sceneId !== 'string') throw new Error('sceneId is required');
      if (!Array.isArray(args.segmentIds)) throw new Error('segmentIds is required');
      const scene = db.getScene(args.sceneId);
      if (!scene) throw new Error(`Scene not found: ${args.sceneId}`);

      const segmentMap = new Map(scene.segments.map((s) => [s.id, s]));
      const reordered = args.segmentIds
        .filter((id) => segmentMap.has(id))
        .map((id) => segmentMap.get(id) as SceneSegment);

      db.upsertScene({ ...scene, segments: reordered, updatedAt: Date.now() });
      return reordered;
    },
  );

  ipcMain.handle('orchestration:generatePrompt', async (_e, args: { segmentId: string }) => {
    if (!args || typeof args.segmentId !== 'string') throw new Error('segmentId is required');

    const scenes = db.listScenes();
    const scene = scenes.find((s) => s.segments.some((seg) => seg.id === args.segmentId));
    if (!scene) throw new Error(`Segment not found: ${args.segmentId}`);

    const segment = scene.segments.find((s) => s.id === args.segmentId) as SceneSegment;
    const characters = db.listCharacters();
    const styleGuide = DEFAULT_STYLE_GUIDE;

    return assembleSegmentPrompt(segment, scene, characters, styleGuide);
  });
}
