import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export interface CapCutClip {
  title: string;
  assetPath: string;
  assetType: 'video' | 'audio' | 'image';
  durationMs: number;
  startMs?: number;
}

export interface CapCutExportOptions {
  projectName: string;
  clips: CapCutClip[];
  outputDir: string;
  width?: number;
  height?: number;
}

export async function exportCapCut(opts: CapCutExportOptions): Promise<{ draftDir: string }> {
  // Create draft folder
  const draftId = randomUUID();
  const draftDir = path.join(opts.outputDir, `${opts.projectName}_${draftId}`);
  fs.mkdirSync(draftDir, { recursive: true });

  const now = Math.floor(Date.now() / 1000);
  const width = opts.width ?? 1920;
  const height = opts.height ?? 1080;

  // Build materials and tracks
  const materials: { videos: Array<Record<string, unknown>> } = { videos: [] };
  const videoSegments: Array<Record<string, unknown>> = [];
  const audioSegments: Array<Record<string, unknown>> = [];
  let timeOffset = 0;

  for (const clip of opts.clips) {
    const materialId = randomUUID();
    const durationUs = clip.durationMs * 1000; // microseconds

    materials.videos.push({
      id: materialId,
      path: clip.assetPath.replace(/\\/g, '/'),
      duration: durationUs,
      type: clip.assetType === 'audio' ? 'audio' : 'video',
    });

    const segment = {
      id: randomUUID(),
      material_id: materialId,
      source_timerange: { start: 0, duration: durationUs },
      target_timerange: { start: timeOffset * 1000, duration: durationUs },
    };

    if (clip.assetType === 'audio') {
      audioSegments.push(segment);
    } else {
      videoSegments.push(segment);
    }

    timeOffset += clip.durationMs;
  }

  // Write draft_content.json
  const draftContent = {
    id: draftId,
    tracks: [
      ...(videoSegments.length > 0 ? [{ id: randomUUID(), type: 'video', segments: videoSegments }] : []),
      ...(audioSegments.length > 0 ? [{ id: randomUUID(), type: 'audio', segments: audioSegments }] : []),
    ],
    materials,
    canvas_config: { width, height, ratio: 'original' },
  };

  // Write draft_meta_info.json
  const draftMeta = {
    draft_id: draftId,
    draft_name: opts.projectName,
    draft_cover: '',
    tm_draft_create: now,
    tm_draft_modified: now,
  };

  fs.writeFileSync(path.join(draftDir, 'draft_content.json'), JSON.stringify(draftContent, null, 2), 'utf-8');
  fs.writeFileSync(path.join(draftDir, 'draft_meta_info.json'), JSON.stringify(draftMeta, null, 2), 'utf-8');

  return { draftDir };
}
