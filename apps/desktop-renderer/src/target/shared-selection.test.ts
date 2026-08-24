import { describe, expect, it } from 'vitest';
import type { DomainObjectRef } from '@lucid-fin/target-contracts';
import {
  EMPTY_TARGET_SELECTION,
  selectionToRunContext,
  targetSelectionReducer,
} from './shared-selection.js';

const shot: DomainObjectRef = {
  authority: 'production',
  id: 'shot.04',
  revision: 3,
  contentHash: 'a'.repeat(64),
};
const media: DomainObjectRef = {
  authority: 'project_media_ref',
  id: 'media.harbor',
  revision: 1,
  contentHash: 'b'.repeat(64),
};

describe('target shared selection', () => {
  it('keeps one authoritative primary object across workspaces', () => {
    const selected = targetSelectionReducer(EMPTY_TARGET_SELECTION, { type: 'select', ref: shot });
    const withReference = targetSelectionReducer(selected, { type: 'support', ref: media });

    expect(withReference).toEqual({ primary: shot, supporting: [media] });
    expect(selectionToRunContext(withReference)).toEqual([
      { ref: shot, role: 'selected' },
      { ref: media, role: 'reference' },
    ]);
  });

  it('deduplicates a primary ref and removes chips without changing domain data', () => {
    const withReference = targetSelectionReducer(
      { primary: shot, supporting: [media] },
      { type: 'select', ref: media },
    );
    expect(withReference).toEqual({ primary: media, supporting: [] });

    expect(
      targetSelectionReducer(withReference, {
        type: 'remove',
        authority: 'project_media_ref',
        id: media.id,
      }),
    ).toEqual(EMPTY_TARGET_SELECTION);
  });
});
