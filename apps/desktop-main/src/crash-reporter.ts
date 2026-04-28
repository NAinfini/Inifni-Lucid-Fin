/**
 * Crash reporter — catches unhandled exceptions and rejections in the main process.
 * Logs them via the structured logger and optionally sends opt-in crash reports.
 */
import { log } from './logger.js';

let crashReportEnabled = false;

export function initCrashReporter(optIn = false): void {
  crashReportEnabled = optIn;

  process.on('uncaughtException', (error) => {
    log('fatal', 'Uncaught exception', {
      message: error.message,
      stack: error.stack,
      name: error.name,
    });
    if (crashReportEnabled) sendCrashReport(error);
  });

  process.on('unhandledRejection', (reason) => {
    const error = reason instanceof Error ? reason : new Error(String(reason));
    log('error', 'Unhandled rejection', {
      message: error.message,
      stack: error.stack,
    });
    if (crashReportEnabled) sendCrashReport(error);
  });
}

function sendCrashReport(error: Error): void {
  // Placeholder for opt-in crash reporting service
  // In production, this would POST to a crash reporting endpoint
  log('info', 'Crash report queued (opt-in)', {
    message: error.message,
    name: error.name,
  });
}
