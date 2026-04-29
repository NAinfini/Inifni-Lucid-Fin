import fs from 'node:fs';
import fsp from 'node:fs/promises';
import _path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { IpcMain } from 'electron';
import { dialog } from 'electron';
import archiver from 'archiver';
import PDFDocument from 'pdfkit';
import type { CAS } from '@lucid-fin/storage';
import type { AssetType, CanvasNode, NodeKind, VideoNodeData } from '@lucid-fin/contracts';
import log from '../../logger.js';
import {
  exportFCPXML,
  exportEDL,
  exportSRT,
  exportASS,
  parseSRT,
  exportCapCut,
  type NLEProject,
  type SubtitleCue,
} from '@lucid-fin/media-engine';
import { matchNode } from '@lucid-fin/shared-utils';
import type { CanvasStore } from './canvas.handlers.js';
import { assertSafePath, getSafeRoots, getImportSafeRoots } from '../path-safety.js';

const FALLBACK_EXTS: Record<string, string[]> = {
  image: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'],
  video: ['mp4', 'webm', 'mov', 'avi', 'mkv', 'bin'],
  audio: ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a'],
};

function findAssetFileForExport(cas: CAS, hash: string): string | null {
  for (const type of ['image', 'video', 'audio'] as AssetType[]) {
    for (const ext of FALLBACK_EXTS[type] ?? []) {
      const p = cas.getAssetPath(hash, type, ext);
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
}

export function registerExportHandlers(
  ipcMain: IpcMain,
  cas?: CAS,
  canvasStore?: CanvasStore,
): void {
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
            {
              name: args.format === 'fcpxml' ? 'Final Cut Pro XML' : 'Edit Decision List',
              extensions: [ext],
            },
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
      } else {
        outputPath = assertSafePath(outputPath, getSafeRoots());
      }

      const content =
        args.format === 'fcpxml' ? exportFCPXML(args.project) : exportEDL(args.project);

      await fsp.writeFile(outputPath, content, 'utf8');
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

  /** Asset bundle export — ZIP of all resolved asset files. */
  ipcMain.handle(
    'export:assetBundle',
    async (
      _e,
      args: {
        assetHashes: string[];
        outputPath?: string;
      },
    ) => {
      if (!cas) throw new Error('export:assetBundle: CAS not available');
      if (!Array.isArray(args?.assetHashes) || args.assetHashes.length === 0) {
        throw new Error('export:assetBundle: assetHashes array required');
      }

      let outputPath = args.outputPath;
      if (!outputPath) {
        const result = await dialog.showSaveDialog({
          defaultPath: 'assets.zip',
          filters: [
            { name: 'ZIP Archive', extensions: ['zip'] },
            { name: 'All Files', extensions: ['*'] },
          ],
        });
        if (result.canceled || !result.filePath) {
          log.info('Asset bundle export cancelled', { category: 'export' });
          return null;
        }
        outputPath = result.filePath;
      } else {
        outputPath = assertSafePath(outputPath, getSafeRoots());
      }

      const resolved: Array<{ hash: string; path: string }> = [];
      for (const hash of args.assetHashes) {
        const assetPath = findAssetFileForExport(cas, hash);
        if (assetPath) {
          assertSafePath(assetPath, getImportSafeRoots(cas.getAssetsRoot()));
          resolved.push({ hash, path: assetPath });
        }
      }

      if (resolved.length === 0) {
        throw new Error('export:assetBundle: no asset files found for given hashes');
      }

      const output = fs.createWriteStream(outputPath);
      const archive = archiver('zip', { zlib: { level: 6 } });

      const done = new Promise<void>((resolve, reject) => {
        output.on('close', resolve);
        archive.on('error', reject);
      });

      archive.pipe(output);
      for (const item of resolved) {
        const ext = item.path.split('.').pop() ?? 'bin';
        archive.file(item.path, { name: `${item.hash.slice(0, 12)}.${ext}` });
      }
      await archive.finalize();
      await done;

      const stat = fs.statSync(outputPath);
      log.info('Asset bundle export completed', {
        category: 'export',
        outputPath,
        fileCount: resolved.length,
        fileSize: stat.size,
      });

      return {
        outputPath,
        fileCount: resolved.length,
        fileSize: stat.size,
      };
    },
  );

  ipcMain.handle(
    'export:subtitles',
    async (
      _e,
      args: {
        format: 'srt' | 'ass';
        cues: SubtitleCue[];
        outputPath?: string;
        videoWidth?: number;
        videoHeight?: number;
      },
    ) => {
      if (!Array.isArray(args?.cues)) {
        throw new Error('export:subtitles: cues array required');
      }
      if (args.format !== 'srt' && args.format !== 'ass') {
        throw new Error('export:subtitles: format must be "srt" or "ass"');
      }

      let outputPath = args.outputPath;
      if (!outputPath) {
        const ext = args.format;
        const result = await dialog.showSaveDialog({
          defaultPath: `subtitles.${ext}`,
          filters: [
            {
              name: args.format === 'srt' ? 'SubRip Subtitle' : 'Advanced SubStation Alpha',
              extensions: [ext],
            },
            { name: 'All Files', extensions: ['*'] },
          ],
        });
        if (result.canceled || !result.filePath) {
          log.info('Subtitle export cancelled', { category: 'export', format: args.format });
          return null;
        }
        outputPath = result.filePath;
      } else {
        outputPath = assertSafePath(outputPath, getSafeRoots());
      }

      const content =
        args.format === 'srt'
          ? exportSRT(args.cues)
          : exportASS(args.cues, args.videoWidth, args.videoHeight);

      await fsp.writeFile(outputPath, content, 'utf8');
      log.info('Subtitle export completed', {
        category: 'export',
        format: args.format,
        outputPath,
        cueCount: args.cues.length,
      });
    },
  );

  /** PDF storyboard export (M6) */
  ipcMain.handle(
    'export:storyboard',
    async (
      _e,
      args: {
        nodes: Array<{
          title: string;
          prompt?: string;
          assetHash?: string;
          type: string;
          sceneNumber?: string;
          shotOrder?: number;
          annotation?: string;
          colorTag?: string;
          tags?: string[];
          providerId?: string;
          seed?: number;
        }>;
        projectTitle?: string;
        outputPath?: string;
      },
    ) => {
      if (!Array.isArray(args?.nodes) || args.nodes.length === 0) {
        throw new Error('export:storyboard: nodes array required');
      }

      let outputPath = args.outputPath;
      if (!outputPath) {
        const result = await dialog.showSaveDialog({
          defaultPath: `${args.projectTitle ?? 'storyboard'}.pdf`,
          filters: [
            { name: 'PDF Document', extensions: ['pdf'] },
            { name: 'All Files', extensions: ['*'] },
          ],
        });
        if (result.canceled || !result.filePath) {
          log.info('Storyboard export cancelled', { category: 'export' });
          return null;
        }
        outputPath = result.filePath;
      } else {
        outputPath = assertSafePath(outputPath, getSafeRoots());
      }

      const doc = new PDFDocument({ size: 'A4', margin: 40 });
      const stream = fs.createWriteStream(outputPath);
      const done = new Promise<void>((resolve, reject) => {
        stream.on('finish', resolve);
        stream.on('error', reject);
      });
      doc.pipe(stream);

      // Title page
      doc.fontSize(24).text(args.projectTitle ?? 'Storyboard', { align: 'center' });
      doc.moveDown(0.5);
      doc
        .fontSize(10)
        .fillColor('#888888')
        .text(`${args.nodes.length} shots · Generated ${new Date().toLocaleDateString()}`, {
          align: 'center',
        });
      doc.moveDown(2);

      // Grid layout: 2 columns, 3 rows per page = 6 shots per page
      const COLS = 2;
      const ROWS = 3;
      const pageWidth = doc.page.width - 80; // margins
      const cellWidth = pageWidth / COLS - 10;
      const cellHeight = 200;
      let col = 0;
      let row = 0;
      let pageStarted = false;

      for (const node of args.nodes) {
        if (row >= ROWS) {
          doc.addPage();
          col = 0;
          row = 0;
          pageStarted = false;
        }
        if (!pageStarted && row === 0 && col === 0) {
          pageStarted = true;
        }

        const x = 40 + col * (cellWidth + 10);
        const y = 120 + row * (cellHeight + 15);

        // Thumbnail placeholder (gray rect if no image)
        const thumbHeight = cellHeight - 60;
        if (node.assetHash && cas) {
          const assetPath = findAssetFileForExport(cas, node.assetHash);
          if (assetPath) {
            try {
              doc.image(assetPath, x, y, {
                width: cellWidth,
                height: thumbHeight,
                fit: [cellWidth, thumbHeight],
                align: 'center',
                valign: 'center',
              });
            } catch {
              /* pdfkit failed to embed image — render placeholder rect */
              doc.rect(x, y, cellWidth, thumbHeight).fill('#2a2a2a');
              doc
                .fillColor('#666666')
                .fontSize(8)
                .text('Image unavailable', x, y + thumbHeight / 2 - 5, {
                  width: cellWidth,
                  align: 'center',
                });
            }
          } else {
            doc.rect(x, y, cellWidth, thumbHeight).fill('#2a2a2a');
          }
        } else {
          doc.rect(x, y, cellWidth, thumbHeight).fill('#2a2a2a');
          doc
            .fillColor('#666666')
            .fontSize(8)
            .text(node.type.toUpperCase(), x, y + thumbHeight / 2 - 5, {
              width: cellWidth,
              align: 'center',
            });
        }

        // Shot info below thumbnail
        const textY = y + thumbHeight + 4;
        const shotLabel = node.sceneNumber
          ? `${node.sceneNumber}${node.shotOrder != null ? `-${node.shotOrder}` : ''}`
          : '';
        doc
          .fillColor('#ffffff')
          .fontSize(9)
          .font('Helvetica-Bold')
          .text(`${shotLabel ? shotLabel + ' · ' : ''}${node.title}`, x, textY, {
            width: cellWidth,
            lineBreak: false,
            ellipsis: true,
          });

        if (node.prompt) {
          doc
            .fillColor('#aaaaaa')
            .fontSize(7)
            .font('Helvetica')
            .text(
              node.prompt.slice(0, 120) + (node.prompt.length > 120 ? '...' : ''),
              x,
              textY + 12,
              { width: cellWidth, height: 28, lineBreak: true },
            );
        }

        if (node.annotation) {
          doc
            .fillColor('#88ccff')
            .fontSize(7)
            .text(node.annotation, x, textY + 42, {
              width: cellWidth,
              lineBreak: false,
              ellipsis: true,
            });
        }

        col++;
        if (col >= COLS) {
          col = 0;
          row++;
        }
      }

      doc.end();
      await done;

      const stat = fs.statSync(outputPath);
      log.info('Storyboard PDF export completed', {
        category: 'export',
        outputPath,
        nodeCount: args.nodes.length,
        fileSize: stat.size,
      });

      return { outputPath, nodeCount: args.nodes.length, fileSize: stat.size };
    },
  );

  /** Structured metadata export — CSV or JSON (M12) */
  ipcMain.handle(
    'export:metadata',
    async (
      _e,
      args: {
        format: 'csv' | 'json';
        nodes: Array<{
          id: string;
          type: string;
          title: string;
          prompt?: string;
          negativePrompt?: string;
          providerId?: string;
          seed?: number;
          width?: number;
          height?: number;
          assetHash?: string;
          cost?: number;
          generationTimeMs?: number;
          sceneNumber?: string;
          shotOrder?: number;
          colorTag?: string;
          tags?: string[];
        }>;
        projectTitle?: string;
        outputPath?: string;
      },
    ) => {
      if (!Array.isArray(args?.nodes)) {
        throw new Error('export:metadata: nodes array required');
      }
      if (args.format !== 'csv' && args.format !== 'json') {
        throw new Error('export:metadata: format must be "csv" or "json"');
      }

      let outputPath = args.outputPath;
      if (!outputPath) {
        const ext = args.format;
        const result = await dialog.showSaveDialog({
          defaultPath: `${args.projectTitle ?? 'metadata'}.${ext}`,
          filters: [
            { name: args.format === 'csv' ? 'CSV File' : 'JSON File', extensions: [ext] },
            { name: 'All Files', extensions: ['*'] },
          ],
        });
        if (result.canceled || !result.filePath) {
          log.info('Metadata export cancelled', { category: 'export' });
          return null;
        }
        outputPath = result.filePath;
      } else {
        outputPath = assertSafePath(outputPath, getSafeRoots());
      }

      let content: string;
      if (args.format === 'json') {
        content = JSON.stringify(
          {
            project: args.projectTitle ?? '',
            exportedAt: new Date().toISOString(),
            nodeCount: args.nodes.length,
            nodes: args.nodes,
          },
          null,
          2,
        );
      } else {
        const headers = [
          'id',
          'type',
          'title',
          'prompt',
          'negativePrompt',
          'providerId',
          'seed',
          'width',
          'height',
          'assetHash',
          'cost',
          'generationTimeMs',
          'sceneNumber',
          'shotOrder',
          'colorTag',
          'tags',
        ];
        const csvEscape = (v: unknown): string => {
          const s = v == null ? '' : String(v);
          return s.includes(',') || s.includes('"') || s.includes('\n')
            ? `"${s.replace(/"/g, '""')}"`
            : s;
        };
        const rows = args.nodes.map((n) =>
          headers
            .map((h) => {
              const val = (n as Record<string, unknown>)[h];
              return csvEscape(Array.isArray(val) ? val.join(';') : val);
            })
            .join(','),
        );
        content = [headers.join(','), ...rows].join('\n');
      }

      await fsp.writeFile(outputPath, content, 'utf8');
      const stat = fs.statSync(outputPath);

      log.info('Metadata export completed', {
        category: 'export',
        format: args.format,
        outputPath,
        nodeCount: args.nodes.length,
        fileSize: stat.size,
      });

      return { outputPath, format: args.format, nodeCount: args.nodes.length, fileSize: stat.size };
    },
  );

  ipcMain.handle(
    'import:srt',
    async (
      _e,
      args: {
        canvasId: string;
        filePath: string;
        alignToNodes?: boolean;
      },
    ) => {
      if (!args?.canvasId || !args?.filePath) {
        throw new Error('import:srt: canvasId and filePath are required');
      }

      const safePath = assertSafePath(
        args.filePath,
        getImportSafeRoots(cas?.getAssetsRoot() ?? ''),
      );
      const raw = await fsp.readFile(safePath, 'utf8');
      const cues = parseSRT(raw);

      if (cues.length === 0) {
        log.info('SRT import: no cues parsed', { category: 'import', filePath: args.filePath });
        return { importedCount: 0, alignedCount: 0 };
      }

      if (args.alignToNodes) {
        if (!canvasStore) throw new Error('import:srt: canvasStore not available');
        const canvas = canvasStore.get(args.canvasId);
        if (!canvas) throw new Error(`import:srt: canvas not found: ${args.canvasId}`);

        const videoNodes = canvas.nodes
          .filter((n) => n.type === 'video')
          .sort((a, b) => a.position.x - b.position.x);

        if (videoNodes.length === 0) {
          return { importedCount: cues.length, alignedCount: 0, noVideoNodes: true };
        }

        let alignedCount = 0;
        for (let i = 0; i < Math.min(cues.length, videoNodes.length); i++) {
          const node = videoNodes[i];
          (node.data as VideoNodeData).prompt = cues[i].text;
          node.updatedAt = Date.now();
          alignedCount++;
        }

        canvasStore.save(canvas);
        log.info('SRT import aligned to video nodes', {
          category: 'import',
          filePath: args.filePath,
          cueCount: cues.length,
          alignedCount,
        });
        return { importedCount: cues.length, alignedCount };
      }

      // Create text nodes in a column
      if (!canvasStore) throw new Error('import:srt: canvasStore not available');
      const canvas = canvasStore.get(args.canvasId);
      if (!canvas) throw new Error(`import:srt: canvas not found: ${args.canvasId}`);

      const NODE_WIDTH = 220;
      const NODE_HEIGHT = 80;
      const GAP = 20;
      const now = Date.now();

      const newNodes: CanvasNode[] = cues.map((cue: SubtitleCue, i: number) => ({
        id: randomUUID(),
        type: 'text' as const,
        position: { x: 0, y: i * (NODE_HEIGHT + GAP) },
        data: { content: cue.text },
        title: `Subtitle ${cue.id}`,
        status: 'idle' as const,
        bypassed: false,
        locked: false,
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
        createdAt: now,
        updatedAt: now,
      }));

      canvas.nodes.push(...newNodes);
      canvasStore.save(canvas);

      log.info('SRT import created text nodes', {
        category: 'import',
        filePath: args.filePath,
        nodeCount: newNodes.length,
      });

      return { importedCount: cues.length, alignedCount: 0 };
    },
  );

  /** CapCut / 剪映 draft export */
  ipcMain.handle(
    'export:capcut',
    async (
      _e,
      args: {
        nodes: Array<{ title: string; assetHash: string; type: string; durationMs?: number }>;
        projectTitle?: string;
        outputDir?: string;
      },
    ) => {
      if (!cas) throw new Error('export:capcut: CAS not available');
      if (!Array.isArray(args?.nodes) || args.nodes.length === 0) {
        throw new Error('export:capcut: nodes array required');
      }

      let outputDir = args.outputDir;
      if (!outputDir) {
        const result = await dialog.showOpenDialog({
          properties: ['openDirectory', 'createDirectory'],
          title: 'Select output folder for CapCut draft',
        });
        if (result.canceled || !result.filePaths[0]) {
          log.info('CapCut export cancelled', { category: 'export' });
          return null;
        }
        outputDir = result.filePaths[0];
      } else {
        outputDir = assertSafePath(outputDir, getSafeRoots());
      }

      const clips: Array<{
        title: string;
        assetPath: string;
        assetType: 'video' | 'audio' | 'image';
        durationMs: number;
      }> = [];
      for (const node of args.nodes) {
        const assetPath = findAssetFileForExport(cas, node.assetHash);
        if (!assetPath) continue;
        const assetType = matchNode(node.type as NodeKind, {
          audio: () => 'audio' as const,
          video: () => 'video' as const,
          image: () => 'image' as const,
          text: () => 'image' as const,
          backdrop: () => 'image' as const,
        });
        clips.push({
          title: node.title,
          assetPath,
          assetType,
          durationMs: node.durationMs ?? 5000,
        });
      }

      if (clips.length === 0) {
        throw new Error('export:capcut: no nodes with assets to export');
      }

      const { draftDir } = await exportCapCut({
        projectName: args.projectTitle ?? 'project',
        clips,
        outputDir,
      });

      log.info('CapCut export completed', {
        category: 'export',
        draftDir,
        clipCount: clips.length,
      });

      return { draftDir };
    },
  );
}
