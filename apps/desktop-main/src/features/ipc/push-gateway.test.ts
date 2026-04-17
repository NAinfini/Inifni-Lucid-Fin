import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { definePushChannel } from '@lucid-fin/contracts-parse';
import { createRendererPushGateway } from './push-gateway.js';

const testChannel = definePushChannel({
  channel: 'test:ping',
  payload: z.object({ value: z.number() }),
});

function mockWindow(options: { destroyed?: boolean } = {}) {
  return {
    isDestroyed: () => options.destroyed ?? false,
    webContents: { send: vi.fn() },
  };
}

describe('RendererPushGateway', () => {
  it('parses the payload through the channel zod schema and forwards it', () => {
    const win = mockWindow();
    const gw = createRendererPushGateway({
      getWindow: () => win as unknown as Electron.BrowserWindow,
    });
    gw.emit(testChannel, { value: 42 });
    expect(win.webContents.send).toHaveBeenCalledWith('test:ping', { value: 42 });
  });

  it('throws when the payload fails the channel schema (loud main-process bug surfacing)', () => {
    const win = mockWindow();
    const gw = createRendererPushGateway({
      getWindow: () => win as unknown as Electron.BrowserWindow,
    });
    expect(() => gw.emit(testChannel, { value: 'not-a-number' } as never)).toThrow(
      /parseStrict failed/,
    );
    expect(win.webContents.send).not.toHaveBeenCalled();
  });

  it('logs via the injected logger and no-ops when the window is null', () => {
    const logger = { warn: vi.fn() };
    const gw = createRendererPushGateway({ getWindow: () => null, logger });
    gw.emit(testChannel, { value: 1 });
    expect(logger.warn).toHaveBeenCalledOnce();
    expect(logger.warn.mock.calls[0][0]).toMatch(/no BrowserWindow/);
  });

  it('drops the send when the window is destroyed', () => {
    const logger = { warn: vi.fn() };
    const win = mockWindow({ destroyed: true });
    const gw = createRendererPushGateway({
      getWindow: () => win as unknown as Electron.BrowserWindow,
      logger,
    });
    gw.emit(testChannel, { value: 1 });
    expect(win.webContents.send).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledOnce();
    expect(logger.warn.mock.calls[0][0]).toMatch(/destroyed/);
  });

  it('falls back to console.warn when no logger is injected', () => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const gw = createRendererPushGateway({ getWindow: () => null });
    gw.emit(testChannel, { value: 1 });
    expect(consoleWarn).toHaveBeenCalled();
    consoleWarn.mockRestore();
  });
});
