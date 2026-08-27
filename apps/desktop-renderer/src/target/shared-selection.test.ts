import { describe, expect, it } from 'vitest';
import type { DomainObjectRef } from '@lucid-fin/target-contracts';
import {
  EMPTY_TARGET_SELECTION,
  isTargetWorkspace,
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
  it('accepts only canonical Project workspace route segments', () => {
    expect(isTargetWorkspace('overview')).toBe(true);
    expect(isTargetWorkspace('delivery')).toBe(true);
    expect(isTargetWorkspace('legacy')).toBe(false);
    expect(isTargetWorkspace(null)).toBe(false);
  });

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

  it('rebases matching selected refs after an authoritative revision change', () => {
    const currentShot = {
      ...shot,
      revision: shot.revision + 1,
      contentHash: 'c'.repeat(64),
    };

    expect(
      targetSelectionReducer(
        { primary: shot, supporting: [media] },
        { type: 'refresh', ref: currentShot },
      ),
    ).toEqual({ primary: currentShot, supporting: [media] });

    expect(
      targetSelectionReducer(
        { primary: media, supporting: [shot] },
        { type: 'refresh', ref: currentShot },
      ),
    ).toEqual({ primary: media, supporting: [currentShot] });
  });
});
