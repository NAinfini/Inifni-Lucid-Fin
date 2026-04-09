import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';

const logger = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: vi.fn(),
}));

const showSaveDialog = vi.hoisted(() => vi.fn());
const exportFCPXML = vi.hoisted(() => vi.fn(() => '<fcpxml />'));
const exportEDL = vi.hoisted(() => vi.fn(() => 'TITLE: test'));
const exportSRT = vi.hoisted(() => vi.fn(() => '1\n00:00:00,000 --> 00:00:01,000\nhello'));
const exportASS = vi.hoisted(() => vi.fn(() => '[Script Info]'));

vi.mock('../../logger.js', () => ({
  default: logger,
  debug: logger.debug,
  info: logger.info,
  warn: logger.warn,
  error: logger.error,
  fatal: logger.fatal,
}));

vi.mock('electron', () => ({
  dialog: {
    showSaveDialog,
  },
}));

vi.mock('@lucid-fin/media-engine', () => ({
  exportFCPXML,
  exportEDL,
  exportSRT,
  exportASS,
}));

import { registerExportHandlers } from './export.handlers.js';

describe('registerExportHandlers', () => {
  let handlers: Map<string, (...args: unknown[]) => unknown>;

  beforeEach(() => {
    handlers = new Map();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs resolved export path and file size when NLE export succeeds through the save dialog flow', async () => {
    const writeSpy = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => undefined);
    const statSpy = vi.spyOn(fs, 'statSync').mockReturnValue({ size: 321 } as fs.Stats);
    showSaveDialog.mockResolvedValue({
      canceled: false,
      filePath: 'C:\\exports\\timeline.fcpxml',
    });

    registerExportHandlers(
      {
        handle(channel: string, handler: (...args: unknown[]) => unknown) {
          handlers.set(channel, handler);
        },
      } as never,
    );

    const exportNle = handlers.get('export:nle');
    expect(exportNle).toBeTypeOf('function');

    const project = { metadata: { title: 'Pilot' }, tracks: [] };
    await expect(
      exportNle?.({}, {
        format: 'fcpxml',
        project,
      }),
    ).resolves.toEqual({
      outputPath: 'C:\\exports\\timeline.fcpxml',
      format: 'fcpxml',
      fileSize: 321,
    });

    expect(writeSpy).toHaveBeenCalledWith('C:\\exports\\timeline.fcpxml', '<fcpxml />', 'utf8');
    expect(statSpy).toHaveBeenCalledWith('C:\\exports\\timeline.fcpxml');
    expect(logger.info).toHaveBeenCalledWith(
      'NLE export completed',
      expect.objectContaining({
        category: 'export',
        format: 'fcpxml',
        outputPath: 'C:\\exports\\timeline.fcpxml',
        fileSize: 321,
      }),
    );
  });

  it('logs when the user cancels the export save dialog', async () => {
    showSaveDialog.mockResolvedValue({
      canceled: true,
      filePath: undefined,
    });

    registerExportHandlers(
      {
        handle(channel: string, handler: (...args: unknown[]) => unknown) {
          handlers.set(channel, handler);
        },
      } as never,
    );

    const exportNle = handlers.get('export:nle');
    expect(exportNle).toBeTypeOf('function');

    await expect(
      exportNle?.({}, {
        format: 'edl',
        project: { metadata: { title: 'Pilot' }, tracks: [] },
      }),
    ).resolves.toBeNull();

    expect(logger.info).toHaveBeenCalledWith(
      'NLE export cancelled',
      expect.objectContaining({
        category: 'export',
        format: 'edl',
      }),
    );
  });
});
