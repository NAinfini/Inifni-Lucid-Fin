import { describe, expect, it } from 'vitest';
import { parseStrict } from '../../parse.js';
import { assetContentInspectChannel } from './batch-04.js';

describe('asset content inspect IPC contract', () => {
  it('accepts a content hash and authoritative video metadata', () => {
    expect(
      parseStrict(
        assetContentInspectChannel.schemas.request,
        { hash: 'video-hash' },
        { name: 'assetContent:inspect.request' },
      ),
    ).toEqual({ hash: 'video-hash' });

    expect(
      parseStrict(
        assetContentInspectChannel.schemas.response,
        {
          hash: 'video-hash',
          type: 'video',
          format: 'mp4',
          originalName: 'video.mp4',
          fileSize: 10,
          duration: 1,
          hasAudio: true,
          createdAt: 1,
        },
        { name: 'assetContent:inspect.response' },
      ),
    ).toMatchObject({ hash: 'video-hash', hasAudio: true });
  });

  it('rejects empty hashes and non-boolean audio metadata', () => {
    expect(() =>
      parseStrict(
        assetContentInspectChannel.schemas.request,
        { hash: '' },
        { name: 'assetContent:inspect.request' },
      ),
    ).toThrow();
    expect(() =>
      parseStrict(
        assetContentInspectChannel.schemas.response,
        {
          hash: 'video-hash',
          type: 'video',
          format: 'mp4',
          originalName: 'video.mp4',
          fileSize: 10,
          hasAudio: 1,
          createdAt: 1,
        },
        { name: 'assetContent:inspect.response' },
      ),
    ).toThrow();
  });
});
