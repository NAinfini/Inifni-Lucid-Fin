import fs from 'node:fs';
import type { IpcMain } from 'electron';
import { dialog } from 'electron';
import log from '../../logger.js';
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
        outputPath?: string;
      },
    ) => {
      if (!args?.project) {
        throw new Error('export:nle: project is required');
      }
      if (args.format !== 'fcpxml' && args.format !== 'edl') {
        throw new Error('export:nle: format must be "fcpxml" or "edl"');
      }

      let outputPath = args.outputPath;
      if (!outputPath) {
        const ext = args.format === 'fcpxml' ? 'fcpxml' : 'edl';
        const result = await dialog.showSaveDialog({
          defaultPath: `export.${ext}`,
          filters: [
            { name: args.format === 'fcpxml' ? 'Final Cut Pro XML' : 'Edit Decision List', extensions: [ext] },
            { name: 'All Files', extensions: ['*'] },
          ],
        });
        if (result.canceled || !result.filePath) {
          log.info('NLE export cancelled', {
            category: 'export',
            format: args.format,
          });
          return null;
        }
        outputPath = result.filePath;
      }

      const content = args.format === 'fcpxml'
        ? exportFCPXML(args.project)
        : exportEDL(args.project);

      fs.writeFileSync(outputPath, content, 'utf8');
      const stat = fs.statSync(outputPath);

      log.info('NLE export completed', {
        category: 'export',
        format: args.format,
        outputPath,
        fileSize: stat.size,
      });

      return {
        outputPath,
        format: args.format,
        fileSize: stat.size,
      };
    },
  );

  ipcMain.handle('export:assetBundle', async (_e, args: { outputPath: string }) => {
    if (!args?.outputPath) throw new Error('export:assetBundle: outputPath required');
    log.info('Asset bundle export requested', {
      category: 'export',
      outputPath: args.outputPath,
    });
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

      const content = args.format === 'srt'
        ? exportSRT(args.cues)
        : exportASS(args.cues, args.videoWidth, args.videoHeight);

      fs.writeFileSync(args.outputPath, content, 'utf8');
      log.info('Subtitle export completed', {
        category: 'export',
        format: args.format,
        outputPath: args.outputPath,
        cueCount: args.cues.length,
      });
    },
  );
}
