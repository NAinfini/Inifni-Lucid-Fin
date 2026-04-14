import type { IpcMain } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ScriptDocument, ParsedScene } from '@lucid-fin/contracts';
import { parseScript } from '@lucid-fin/domain';
import type { SqliteIndex } from '@lucid-fin/storage';

export function registerScriptHandlers(ipcMain: IpcMain, db: SqliteIndex): void {
  ipcMain.handle('script:parse', async (_e, args: { content: string; format?: string }) => {
    if (!args || typeof args.content !== 'string') throw new Error('content is required');
    const format =
      args.format === 'fountain' || args.format === 'fdx' || args.format === 'plaintext'
        ? args.format
        : 'fountain';
    return parseScript(args.content, format);
  });

  ipcMain.handle(
    'script:save',
    async (_e, args: { content: string; format: string; parsedScenes: unknown[] }) => {
      if (!args || typeof args.content !== 'string') throw new Error('content is required');
      const format =
        args.format === 'fountain' || args.format === 'fdx' || args.format === 'plaintext'
          ? args.format
          : 'fountain';
      const parsedScenes = Array.isArray(args.parsedScenes)
        ? (args.parsedScenes as ParsedScene[])
        : parseScript(args.content, format);
      const existing = db.getScript();
      const now = Date.now();
      const doc: ScriptDocument = {
        id: existing?.id ?? randomUUID(),
        content: args.content,
        format,
        parsedScenes,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      db.upsertScript(doc);
    },
  );

  ipcMain.handle('script:load', async () => {
    return db.getScript();
  });

  ipcMain.handle('script:import', async (_e, args: { filePath: string }) => {
    if (!args || typeof args.filePath !== 'string' || !args.filePath.trim()) {
      throw new Error('filePath is required');
    }
    const resolved = path.resolve(args.filePath);
    if (!fs.existsSync(resolved) || fs.statSync(resolved).isDirectory()) {
      throw new Error(`Script file not found: ${resolved}`);
    }
    const content = fs.readFileSync(resolved, 'utf-8');
    const ext = path.extname(resolved).toLowerCase();
    const format =
      ext === '.fountain'
        ? ('fountain' as const)
        : ext === '.fdx'
          ? ('fdx' as const)
          : ('plaintext' as const);
    const parsedScenes = parseScript(content, format);
    const existing = db.getScript();
    const now = Date.now();
    const doc: ScriptDocument = {
      id: existing?.id ?? randomUUID(),
      content,
      format,
      parsedScenes,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    db.upsertScript(doc);
    return doc;
  });
}
