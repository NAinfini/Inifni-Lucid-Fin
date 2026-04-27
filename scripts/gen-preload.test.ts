import { describe, expect, it } from 'vitest';
import { channelToSymbolBase, expectedGeneratedNames } from './gen-preload.js';

describe('gen-preload helpers', () => {
  it('maps channel names to generated symbol bases', () => {
    expect(channelToSymbolBase('keychain:isConfigured')).toBe('KeychainIsConfigured');
    expect(channelToSymbolBase('asset:importBuffer')).toBe('AssetImportBuffer');
    expect(channelToSymbolBase('ffmpeg:thumbnail')).toBe('FfmpegThumbnail');
    expect(channelToSymbolBase('commander:cancel-step')).toBe('CommanderCancelStep');
  });

  it('derives channel constant and request/response names for invoke channels', () => {
    expect(expectedGeneratedNames({ kind: 'invoke', channel: 'canvas:save' })).toEqual({
      channelConstant: 'canvasSaveChannel',
      requestType: 'CanvasSaveRequest',
      responseType: 'CanvasSaveResponse',
    });
  });

  it('derives channel constant and payload name for push channels', () => {
    expect(expectedGeneratedNames({ kind: 'push', channel: 'updater:toast' })).toEqual({
      channelConstant: 'updaterToastChannel',
      payloadType: 'UpdaterToastPayload',
    });
  });
});
