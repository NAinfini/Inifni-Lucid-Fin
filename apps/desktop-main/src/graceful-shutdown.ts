export const RENDERER_FLUSH_TIMEOUT_MS = 5_000;

export interface RendererFlushHandshake {
  request: () => void;
  subscribe: (complete: () => void) => () => void;
  timeoutMs?: number;
}

export function waitForRendererFlush({
  request,
  subscribe,
  timeoutMs = RENDERER_FLUSH_TIMEOUT_MS,
}: RendererFlushHandshake): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let unsubscribe = (): void => {};
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsubscribe();
      if (error) reject(error);
      else resolve();
    };
    const timer = setTimeout(
      () => finish(new Error(`Renderer persistence flush timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );

    try {
      unsubscribe = subscribe(() => finish());
      request();
    } catch (error: unknown) {
      finish(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

interface ShutdownLogger {
  error(message: string, context: Record<string, unknown>): void;
  warn(message: string, context: Record<string, unknown>): void;
}

export interface GracefulShutdownDependencies {
  flushRenderer: () => Promise<void>;
  stopOAuth: () => Promise<void>;
  stopBackgroundTasks: () => void;
  closeDb: () => void;
  log: ShutdownLogger;
}

export async function completeGracefulShutdown({
  flushRenderer,
  stopOAuth,
  stopBackgroundTasks,
  closeDb,
  log,
}: GracefulShutdownDependencies): Promise<void> {
  try {
    await flushRenderer();
  } catch (error: unknown) {
    log.error('Renderer persistence flush failed before shutdown', {
      category: 'shutdown',
      error: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    await stopOAuth();
  } catch (error: unknown) {
    log.warn('Codex App Server shutdown failed', {
      category: 'provider',
      providerId: 'oauth',
      error: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    stopBackgroundTasks();
  } catch (error: unknown) {
    log.error('Background task shutdown failed', {
      category: 'shutdown',
      error: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    closeDb();
  } catch (error: unknown) {
    log.error('Database shutdown failed', {
      category: 'shutdown',
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
