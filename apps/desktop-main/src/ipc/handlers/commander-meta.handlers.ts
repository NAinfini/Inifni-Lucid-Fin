import type { IpcMain } from 'electron';
import log from '../../logger.js';
import { runningSessions, lastToolRegistry } from './commander-registry.js';

export function registerCommanderMetaHandlers(ipcMain: IpcMain): void {
  const logger = log.scoped('commander', { surface: 'meta' });

  ipcMain.handle('commander:cancel', async (_event, args: { canvasId: string }) => {
    if (!args || typeof args.canvasId !== 'string' || !args.canvasId.trim()) {
      throw new Error('canvasId is required');
    }
    const session = runningSessions.get(args.canvasId);
    logger.info('Commander cancel requested', {
      canvasId: args.canvasId,
      hasSession: !!session,
    });
    if (session) {
      session.aborted = true;
      session.orchestrator?.cancel();
    }
  });

  ipcMain.handle('commander:inject-message', async (_event, args: { canvasId: string; message: string }) => {
    if (!args || typeof args.canvasId !== 'string' || !args.canvasId.trim()) throw new Error('canvasId is required');
    if (typeof args.message !== 'string' || !args.message.trim()) throw new Error('message is required');
    const session = runningSessions.get(args.canvasId);
    if (!session?.orchestrator) {
      logger.warn('Commander message injection requested with no active session', {
        canvasId: args.canvasId,
      });
      throw new Error('Commander has no active session');
    }
    logger.info('Commander message injection requested', {
      canvasId: args.canvasId,
      messageChars: args.message.length,
    });
    session.orchestrator.injectMessage(args.message);
  });

  ipcMain.handle('commander:tool:decision', async (_event, args: { canvasId: string; toolCallId: string; approved: boolean }) => {
    if (!args || typeof args.canvasId !== 'string' || !args.canvasId.trim()) throw new Error('canvasId is required');
    if (typeof args.toolCallId !== 'string' || !args.toolCallId.trim()) throw new Error('toolCallId is required');
    const session = runningSessions.get(args.canvasId);
    if (!session?.orchestrator) {
      logger.warn('Commander tool decision received with no active session', {
        canvasId: args.canvasId,
        toolCallId: args.toolCallId,
        approved: !!args.approved,
      });
      return;
    }
    logger.info('Commander tool decision received', {
      canvasId: args.canvasId,
      toolCallId: args.toolCallId,
      approved: !!args.approved,
    });
    session.orchestrator.confirmTool(args.toolCallId, !!args.approved);
  });

  ipcMain.handle('commander:tool:answer', async (_event, args: { canvasId: string; toolCallId: string; answer: string }) => {
    if (!args || typeof args.canvasId !== 'string' || !args.canvasId.trim()) throw new Error('canvasId is required');
    if (typeof args.toolCallId !== 'string' || !args.toolCallId.trim()) throw new Error('toolCallId is required');
    if (typeof args.answer !== 'string') throw new Error('answer is required');
    const session = runningSessions.get(args.canvasId);
    if (!session?.orchestrator) {
      logger.warn('Commander tool answer received with no active session', {
        canvasId: args.canvasId,
        toolCallId: args.toolCallId,
        answerChars: args.answer.length,
      });
      return;
    }
    logger.info('Commander tool answer received', {
      canvasId: args.canvasId,
      toolCallId: args.toolCallId,
      answerChars: args.answer.length,
    });
    session.orchestrator.answerQuestion(args.toolCallId, args.answer);
  });

  ipcMain.handle('commander:compact', async (_event, args: { canvasId: string }) => {
    if (!args || typeof args.canvasId !== 'string' || !args.canvasId.trim()) {
      throw new Error('canvasId is required');
    }
    const session = runningSessions.get(args.canvasId);
    if (!session?.orchestrator) {
      logger.warn('Commander compact requested with no active session', {
        canvasId: args.canvasId,
      });
      return { freedChars: 0, messageCount: 0, toolCount: 0 };
    }
    const result = await session.orchestrator.compactNow();
    logger.info('Commander compact executed', {
      canvasId: args.canvasId,
      ...result,
    });
    return result;
  });

  ipcMain.handle('commander:tool-list', async () => {
    const tools = lastToolRegistry?.list().map((t) => ({
      name: t.name,
      description: t.description,
      tags: (t as { tags?: string[] }).tags,
      tier: t.tier,
    })) ?? [];
    logger.info('Commander tool list requested', {
      toolCount: tools.length,
    });
    return tools;
  });

  ipcMain.handle('commander:tool-search', async (_event, args: { query?: string }) => {
    const tools = lastToolRegistry?.list() ?? [];
    const query = typeof args?.query === 'string' ? args.query.toLowerCase() : '';
    const results = !query
      ? tools.map((t) => ({ name: t.name, description: t.description }))
      : tools
      .filter((t) => t.name.toLowerCase().includes(query) || t.description.toLowerCase().includes(query))
      .map((t) => ({ name: t.name, description: t.description }));
    logger.info('Commander tool search requested', {
      query,
      resultCount: results.length,
    });
    return results;
  });
}
