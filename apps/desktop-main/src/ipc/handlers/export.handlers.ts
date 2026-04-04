import fs from 'node:fs';
import type { IpcMain } from 'electron';
import log from 'electron-log';
import {
  exportFCPXML,
  exportEDL,
  exportSRT,
  exportASS,
  type NLEProject,
  type SubtitleCue,
} from '@lucid-fin/media-engine';

export function registerExportHandlers(ipcMain: IpcMain): void {
  ipcMain.handle(
    'export:nle',
    async (
      _e,
      args: {
        format: 'fcpxml' | 'edl';
        project: NLEProject;
        outputPath: string;
      },
    ) => {
      if (!args?.project || !args?.outputPath) {
        throw new Error('export:nle: project and outputPath are required');
      }
      if (args.format !== 'fcpxml' && args.format !== 'edl') {
        throw new Error('export:nle: format must be "fcpxml" or "edl"');
      }

      log.info('export:nle', { format: args.format, outputPath: args.outputPath });

      const content = args.format === 'fcpxml'
        ? exportFCPXML(args.project)
        : exportEDL(args.project);

      fs.writeFileSync(args.outputPath, content, 'utf8');
      const stat = fs.statSync(args.outputPath);

      return {
        outputPath: args.outputPath,
        format: args.format,
        fileSize: stat.size,
      };
    },
  );

  ipcMain.handle('export:assetBundle', async (_e, args: { outputPath: string }) => {
    if (!args?.outputPath) throw new Error('export:assetBundle: outputPath required');
    log.info('export:assetBundle', args.outputPath);
    // Asset bundling requires a zip library (archiver/yazl).
    // This remains a placeholder until a zip dependency is added.
    throw new Error('export:assetBundle: not yet implemented — requires zip dependency');
  });

  ipcMain.handle(
    'export:subtitles',
    async (
      _e,
      args: {
        format: 'srt' | 'ass';
        cues: SubtitleCue[];
        outputPath: string;
        videoWidth?: number;
        videoHeight?: number;
      },
    ) => {
      if (!args?.outputPath || !Array.isArray(args?.cues)) {
        throw new Error('export:subtitles: cues and outputPath required');
      }
      if (args.format !== 'srt' && args.format !== 'ass') {
        throw new Error('export:subtitles: format must be "srt" or "ass"');
      }

      log.info('export:subtitles', { format: args.format, outputPath: args.outputPath, cueCount: args.cues.length });

      const content = args.format === 'srt'
        ? exportSRT(args.cues)
        : exportASS(args.cues, args.videoWidth, args.videoHeight);

      fs.writeFileSync(args.outputPath, content, 'utf8');
    },
  );
}
