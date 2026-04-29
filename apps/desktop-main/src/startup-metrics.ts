/**
 * Startup performance tracker for the main process.
 * Measures key milestones from app launch to fully interactive.
 */
import { log } from './logger.js';

const marks: Record<string, number> = {};
const appStart = Date.now();

export function mark(name: string): void {
  marks[name] = Date.now();
}

export function logStartupMetrics(): void {
  const total = Date.now() - appStart;
  const metrics: Record<string, number> = { totalMs: total };

  if (marks['window-created']) metrics.windowCreatedMs = marks['window-created'] - appStart;
  if (marks['dom-ready']) metrics.domReadyMs = marks['dom-ready'] - appStart;
  if (marks['fully-loaded']) metrics.fullyLoadedMs = marks['fully-loaded'] - appStart;

  log('info', 'Startup metrics', metrics);

  if (marks['window-created'] && marks['window-created'] - appStart > 3000) {
    log('warn', 'Window creation exceeded 3s target', metrics);
  }
  if (total > 5000) {
    log('warn', 'Full startup exceeded 5s target', metrics);
  }
}
