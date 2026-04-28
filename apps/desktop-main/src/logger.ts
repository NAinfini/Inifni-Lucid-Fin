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
const REDACTED_VALUE = '[REDACTED]';
const ROTATION_CHECK_INTERVAL_MS = 1000; // check at most once per second
const SENSITIVE_KEYS = new Set([
  'apikey',
  'authorization',
  'password',
  'secret',
  'token',
  'accesstoken',
  'refreshtoken',
  'x-api-key',
  'api-key',
  'ocp-apim-subscription-key',
]);

let logDir: string;
let logFile: string;
let minLevel: LogLevel = 'info';
let logForwarder: ((entry: LoggerEntry) => void) | undefined;
const logBuffer: LoggerEntry[] = [];
let lastRotationCheck = 0;

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

  const sanitizedData = sanitizeForLogging(data) as Record<string, unknown> | undefined;
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...sanitizedData,
  };

  const line = JSON.stringify(entry) + '\n';
  const bufferedEntry = createBufferedEntry(level, message, sanitizedData);

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
    } catch { /* log write failed (disk full, permissions) — don't crash on log failure */
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
  const now = Date.now();
  if (now - lastRotationCheck < ROTATION_CHECK_INTERVAL_MS) return;
  lastRotationCheck = now;
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
  } catch { /* log rotation failed (permissions, race condition) — leave current log file as-is */
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
  } catch { /* circular reference or non-serializable value — fall back to String() */
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

function mergeLogData(
  message: unknown,
  args: unknown[],
  fixedCategory?: string,
  baseData?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const record = toRecord(message instanceof Error ? [message, ...args] : args) ?? {};
  const merged = {
    ...(baseData ?? {}),
    ...record,
  };

  if (fixedCategory) {
    merged.category = fixedCategory;
  }

  return Object.keys(merged).length > 0 ? merged : undefined;
}

function writeFlexible(level: LogLevel, message: unknown, ...args: unknown[]): void {
  if (message instanceof Error) {
    log(level, message.message, mergeLogData(message, args));
    return;
  }

  log(level, typeof message === 'string' ? message : String(message), mergeLogData(message, args));
}

export interface ScopedLogger {
  debug: (message: unknown, ...args: unknown[]) => void;
  info: (message: unknown, ...args: unknown[]) => void;
  warn: (message: unknown, ...args: unknown[]) => void;
  error: (message: unknown, ...args: unknown[]) => void;
  fatal: (message: unknown, ...args: unknown[]) => void;
}

export function createScopedLogger(
  category: string,
  baseData?: Record<string, unknown>,
): ScopedLogger {
  const writeScoped = (level: LogLevel, message: unknown, ...args: unknown[]) => {
    if (message instanceof Error) {
      log(level, message.message, mergeLogData(message, args, category, baseData));
      return;
    }

    log(
      level,
      typeof message === 'string' ? message : String(message),
      mergeLogData(message, args, category, baseData),
    );
  };

  return {
    debug: (message: unknown, ...args: unknown[]) => writeScoped('debug', message, ...args),
    info: (message: unknown, ...args: unknown[]) => writeScoped('info', message, ...args),
    warn: (message: unknown, ...args: unknown[]) => writeScoped('warn', message, ...args),
    error: (message: unknown, ...args: unknown[]) => writeScoped('error', message, ...args),
    fatal: (message: unknown, ...args: unknown[]) => writeScoped('fatal', message, ...args),
  };
}

function sanitizeForLogging(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value == null) return value;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeForLogging(entry, seen));
  }
  if (typeof value !== 'object') {
    return String(value);
  }
  if (seen.has(value)) {
    return '[Circular]';
  }

  seen.add(value);
  const sanitized: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      sanitized[key] = REDACTED_VALUE;
      continue;
    }
    sanitized[key] = sanitizeForLogging(entry, seen);
  }
  return sanitized;
}

export function setLogForwarder(forwarder?: (entry: LoggerEntry) => void): void {
  logForwarder = forwarder;
}

export function getBufferedLogs(): LoggerEntry[] {
  return [...logBuffer];
}

const defaultLogger = {
  debug: (message: unknown, ...args: unknown[]) => writeFlexible('debug', message, ...args),
  info: (message: unknown, ...args: unknown[]) => writeFlexible('info', message, ...args),
  warn: (message: unknown, ...args: unknown[]) => writeFlexible('warn', message, ...args),
  error: (message: unknown, ...args: unknown[]) => writeFlexible('error', message, ...args),
  fatal: (message: unknown, ...args: unknown[]) => writeFlexible('fatal', message, ...args),
  scoped: createScopedLogger,
};

export default defaultLogger;
