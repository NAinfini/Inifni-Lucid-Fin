import { describe, expect, it } from 'vitest';
import {
  characterCopyChannel,
  characterDeleteChannel,
  equipmentCopyChannel,
  equipmentDeleteChannel,
} from './batch-02.js';
import { locationCopyChannel, locationDeleteChannel } from './batch-03.js';
import { assetEntryDeleteChannel, assetEntryMoveChannel } from './batch-04.js';
import {
  characterSetFolderChannel,
  equipmentSetFolderChannel,
  locationSetFolderChannel,
} from './batch-12.js';

describe('bulk library IPC contracts', () => {
  it('rejects empty entity ID arrays', () => {
    for (const channel of [characterDeleteChannel, equipmentDeleteChannel, locationDeleteChannel]) {
      expect(() => channel.schemas.request.parse({ ids: [] })).toThrow();
    }
    for (const channel of [characterCopyChannel, equipmentCopyChannel, locationCopyChannel]) {
      expect(() => channel.schemas.request.parse({ ids: [], targetFolderId: null })).toThrow();
    }
    for (const channel of [
      characterSetFolderChannel,
      equipmentSetFolderChannel,
      locationSetFolderChannel,
    ]) {
      expect(() => channel.schemas.request.parse({ ids: [], folderId: null })).toThrow();
    }
  });

  it('rejects empty asset entry ID arrays', () => {
    expect(() =>
      assetEntryMoveChannel.schemas.request.parse({ entryIds: [], folderId: null }),
    ).toThrow();
    expect(() => assetEntryDeleteChannel.schemas.request.parse({ entryIds: [] })).toThrow();
  });
});
