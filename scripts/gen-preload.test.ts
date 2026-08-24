import { describe, expect, it } from 'vitest';
import { channelToSymbolBase, expectedGeneratedNames, generateOutputs } from './gen-preload.js';

describe('gen-preload helpers', () => {
  it('maps channel names to generated symbol bases', () => {
    expect(channelToSymbolBase('keychain:isConfigured')).toBe('KeychainIsConfigured');
    expect(channelToSymbolBase('assetEntry:importBuffer')).toBe('AssetEntryImportBuffer');
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

  it('deterministically generates invoke, push, and dotted channel surfaces', async () => {
    const channels = [
      { kind: 'push' as const, channel: 'updater:toast' },
      { kind: 'invoke' as const, channel: 'health:ping' },
      { kind: 'invoke' as const, channel: 'folder.character:list' },
    ];
    const availableTypes = new Set([
      'UpdaterToastPayload',
      'HealthPingRequest',
      'HealthPingResponse',
    ]);

    const first = await generateOutputs(channels, availableTypes);
    const second = await generateOutputs([...channels].reverse(), availableTypes);

    expect(second).toEqual(first);
    expect(first.preload).toContain("ipcRenderer.invoke('folder.character:list', parsed)");
    expect(first.preload).toContain("ipcRenderer.on('updater:toast', listener)");
    expect(first.lucidApi).toContain('characterList(');
    expect(first.lucidApi).toContain('onToast(');
    expect(first.lucidApi).toContain('type FolderCharacterListRequest = unknown;');
    expect(first.lucidApi).toContain('type FolderCharacterListResponse = unknown;');
  });

  it('rejects duplicate channel entries instead of emitting ambiguous methods', async () => {
    await expect(
      generateOutputs(
        [
          { kind: 'invoke', channel: 'health:ping' },
          { kind: 'invoke', channel: 'health:ping' },
        ],
        new Set(['HealthPingRequest', 'HealthPingResponse']),
      ),
    ).rejects.toThrow('Duplicate IPC channel: health:ping');
  });
});
