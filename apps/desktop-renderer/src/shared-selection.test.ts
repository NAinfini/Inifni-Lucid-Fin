import { describe, expect, it } from 'vitest';
import type { DomainObjectRef } from '@lucid-fin/contracts';
import {
  EMPTY_SELECTION,
  isWorkspace,
  selectionToRunContext,
  selectionReducer,
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

describe('shared selection', () => {
  it('accepts only canonical Project workspace route segments', () => {
    expect(isWorkspace('overview')).toBe(true);
    expect(isWorkspace('delivery')).toBe(true);
    expect(isWorkspace('unknown')).toBe(false);
    expect(isWorkspace(null)).toBe(false);
  });

  it('keeps one authoritative primary object across workspaces', () => {
    const selected = selectionReducer(EMPTY_SELECTION, { type: 'select', ref: shot });
    const withReference = selectionReducer(selected, { type: 'support', ref: media });

    expect(withReference).toEqual({ primary: shot, supporting: [media] });
    expect(selectionToRunContext(withReference)).toEqual([
      { ref: shot, role: 'selected' },
      { ref: media, role: 'reference' },
    ]);
  });

  it('deduplicates a primary ref and removes chips without changing domain data', () => {
    const withReference = selectionReducer(
      { primary: shot, supporting: [media] },
      { type: 'select', ref: media },
    );
    expect(withReference).toEqual({ primary: media, supporting: [] });

    expect(
      selectionReducer(withReference, {
        type: 'remove',
        authority: 'project_media_ref',
        id: media.id,
      }),
    ).toEqual(EMPTY_SELECTION);
  });

  it('rebases matching selected refs after an authoritative revision change', () => {
    const currentShot = {
      ...shot,
      revision: shot.revision + 1,
      contentHash: 'c'.repeat(64),
    };

    expect(
      selectionReducer(
        { primary: shot, supporting: [media] },
        { type: 'refresh', ref: currentShot },
      ),
    ).toEqual({ primary: currentShot, supporting: [media] });

    expect(
      selectionReducer(
        { primary: media, supporting: [shot] },
        { type: 'refresh', ref: currentShot },
      ),
    ).toEqual({ primary: media, supporting: [currentShot] });
  });
});
