/**
 * Structured logger for the main process.
 * Writes to file + console with log levels and rotation.
 */
import { app } from 'electron';
import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'fs';
import { join } from 'path';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';
export interface LoggerEntry {
  id: string;
  timestamp: number;
  level: LogLevel;
  category: string;
  message: string;
  detail?: string;
}

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  fatal: 4,
};

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_ROTATED = 3;
const MAX_BUFFERED_ENTRIES = 1000;

let logDir: string;
let logFile: string;
let minLevel: LogLevel = 'info';
let logForwarder: ((entry: LoggerEntry) => void) | undefined;
const logBuffer: LoggerEntry[] = [];

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
  const bufferedEntry = createBufferedEntry(level, message, data);

  // Console output
  const consoleFn =
    level === 'error' || level === 'fatal'
      ? console.error
      : level === 'warn'
        ? console.warn
        : console.log;
  consoleFn(`[${level.toUpperCase()}] ${message}`, bufferedEntry.detail ?? data ?? '');

  // File output
  if (logFile) {
    try {
      rotateIfNeeded();
      appendFileSync(logFile, line, 'utf8');
    } catch {
      /* don't crash on log failure */
    }
  }

  logBuffer.push(bufferedEntry);
  if (logBuffer.length > MAX_BUFFERED_ENTRIES) {
    logBuffer.splice(0, logBuffer.length - MAX_BUFFERED_ENTRIES);
  }
  logForwarder?.(bufferedEntry);
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

function createBufferedEntry(
  level: LogLevel,
  message: string,
  data?: Record<string, unknown>,
): LoggerEntry {
  return {
    id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: Date.now(),
    level,
    category: typeof data?.category === 'string' && data.category.trim().length > 0
      ? data.category
      : 'main',
    message,
    detail: buildDetail(data),
  };
}

function buildDetail(data?: Record<string, unknown>): string | undefined {
  if (!data) return undefined;
  if (typeof data.detail === 'string' && data.detail.trim().length > 0) {
    return data.detail;
  }

  const detailData = { ...data };
  delete detailData.category;
  delete detailData.detail;

  if (Object.keys(detailData).length === 0) {
    return undefined;
  }

  return safeStringify(detailData);
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function toRecord(args: unknown[]): Record<string, unknown> | undefined {
  if (args.length === 0) return undefined;

  const merged: Record<string, unknown> = {};
  const extras: unknown[] = [];

  for (const value of args) {
    if (value instanceof Error) {
      merged.errorName = value.name;
      merged.errorMessage = value.message;
      merged.errorStack = value.stack;
      const extended = value as Error & {
        code?: unknown;
        details?: unknown;
        cause?: unknown;
      };
      if (extended.code !== undefined) {
        merged.errorCode = extended.code;
      }
      if (extended.details !== undefined) {
        merged.errorDetails = extended.details;
      }
      if (extended.cause !== undefined) {
        merged.errorCause = extended.cause;
      }
      continue;
    }

    if (value && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(merged, value as Record<string, unknown>);
      continue;
    }

    extras.push(value);
  }

  if (extras.length > 0) {
    merged.extra = extras;
  }

  return Object.keys(merged).length > 0 ? merged : undefined;
}

function writeFlexible(level: LogLevel, message: unknown, ...args: unknown[]): void {
  if (message instanceof Error) {
    log(level, message.message, toRecord([message, ...args]));
    return;
  }

  log(level, typeof message === 'string' ? message : String(message), toRecord(args));
}

export function setLogForwarder(forwarder?: (entry: LoggerEntry) => void): void {
  logForwarder = forwarder;
}

export function getBufferedLogs(): LoggerEntry[] {
  return [...logBuffer];
}

export function getLogPath(): string {
  return logFile;
}

const defaultLogger = {
  debug: (message: unknown, ...args: unknown[]) => writeFlexible('debug', message, ...args),
  info: (message: unknown, ...args: unknown[]) => writeFlexible('info', message, ...args),
  warn: (message: unknown, ...args: unknown[]) => writeFlexible('warn', message, ...args),
  error: (message: unknown, ...args: unknown[]) => writeFlexible('error', message, ...args),
  fatal: (message: unknown, ...args: unknown[]) => writeFlexible('fatal', message, ...args),
};

export default defaultLogger;
