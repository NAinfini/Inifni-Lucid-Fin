/**
 * Structured logger for the main process.
 * Writes to file + console with log levels and rotation.
 */
import { app } from 'electron';
import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'fs';
import { join } from 'path';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  fatal: 4,
};

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_ROTATED = 3;

let logDir: string;
let logFile: string;
let minLevel: LogLevel = 'info';

export function initLogger(level?: LogLevel): void {
  logDir = join(app.getPath('userData'), 'logs');
  if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });
  logFile = join(logDir, 'lucid-fin.log');
  if (level) minLevel = level;
}

export function setLogLevel(level: LogLevel): void {
  minLevel = level;
}

export function log(level: LogLevel, message: string, data?: Record<string, unknown>): void {
  if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[minLevel]) return;

  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...data,
  };

  const line = JSON.stringify(entry) + '\n';

  // Console output
  const consoleFn =
    level === 'error' || level === 'fatal'
      ? console.error
      : level === 'warn'
        ? console.warn
        : console.log;
  consoleFn(`[${level.toUpperCase()}] ${message}`, data ?? '');

  // File output
  if (logFile) {
    try {
      rotateIfNeeded();
      appendFileSync(logFile, line, 'utf8');
    } catch {
      /* don't crash on log failure */
    }
  }
}

function rotateIfNeeded(): void {
  try {
    if (!existsSync(logFile)) return;
    const stat = statSync(logFile);
    if (stat.size < MAX_FILE_SIZE) return;

    // Rotate: .log.2 → .log.3, .log.1 → .log.2, .log → .log.1
    for (let i = MAX_ROTATED - 1; i >= 1; i--) {
      const from = `${logFile}.${i}`;
      const to = `${logFile}.${i + 1}`;
      if (existsSync(from)) renameSync(from, to);
    }
    renameSync(logFile, `${logFile}.1`);
  } catch {
    /* ignore rotation errors */
  }
}

// Convenience methods
export const debug = (msg: string, data?: Record<string, unknown>) => log('debug', msg, data);
export const info = (msg: string, data?: Record<string, unknown>) => log('info', msg, data);
export const warn = (msg: string, data?: Record<string, unknown>) => log('warn', msg, data);
export const error = (msg: string, data?: Record<string, unknown>) => log('error', msg, data);
export const fatal = (msg: string, data?: Record<string, unknown>) => log('fatal', msg, data);

export function getLogPath(): string {
  return logFile;
}
