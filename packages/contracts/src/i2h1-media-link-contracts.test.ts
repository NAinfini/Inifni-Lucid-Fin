import { describe, expect, it } from 'vitest';
import { ProjectMediaLinkInputSchema, ProjectMediaLinkSuccessSchema } from './media.js';
import { MediaLinkDefinition } from './tools/domain-tools.js';
import { EXACT_TOOL_IDS } from './tools/ids.js';
import { PUBLIC_WIRE_METHODS_V1, parseRequestV1 } from './wire.js';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);
const NOW = '2026-08-16T12:00:00.000Z';

const input = {
  mode: 'link' as const,
  mediaRef: {
    authority: 'project_media_ref' as const,
    id: 'media.1',
    revision: 1,
    contentHash: HASH_A,
  },
  target: {
    authority: 'production' as const,
    id: 'shot.1',
    revision: 2,
    contentHash: HASH_B,
  },
  relation: 'references' as const,
};

const success = {
  object: {
    authority: 'project_media_ref' as const,
    id: 'media.1',
    projectId: 'project.1',
    globalAssetId: 'asset.1',
    revision: 2,
    contentHash: HASH_C,
    lifecycle: 'active' as const,
    detachedAt: null,
    label: 'Harbor reference',
    collections: ['Locations'],
    roles: ['reference' as const],
    notes: 'Primary lighting reference.',
    productionLinks: [{ productionObjectId: 'shot.1', relation: 'references' as const }],
    createdBy: { kind: 'direct_ui' as const, actionId: 'action.attach' },
    createdAt: NOW,
    updatedAt: NOW,
  },
  previousRevision: 1,
  eventId: 'event.1',
  changedPaths: ['productionLinks'] as ['productionLinks'],
  undoRef: null,
};

describe('I2-H1 Project Media public link contract', () => {
  it('shares one exact input and success schema across Wire and the frozen tool', () => {
    expect(ProjectMediaLinkInputSchema.parse(input)).toEqual(input);
    expect(ProjectMediaLinkSuccessSchema.parse(success)).toEqual(success);
    expect(PUBLIC_WIRE_METHODS_V1['media.project.link'].inputSchema).toBe(
      ProjectMediaLinkInputSchema,
    );
    expect(PUBLIC_WIRE_METHODS_V1['media.project.link'].outputSchema).toBe(
      ProjectMediaLinkSuccessSchema,
    );
    expect(MediaLinkDefinition.inputSchema).toBe(ProjectMediaLinkInputSchema);
    expect(MediaLinkDefinition.successSchema).toBe(ProjectMediaLinkSuccessSchema);
    expect(
      parseRequestV1({
        wireVersion: 1,
        kind: 'request',
        requestId: 'request.media.link',
        method: 'media.project.link',
        input,
      }),
    ).toMatchObject({ method: 'media.project.link', input });
  });

  it('rejects non-public relations, non-Production targets, duplicate CAS, and loose shapes', () => {
    for (const relation of ['generated_for', 'selected_for', 'delivery_source']) {
      expect(ProjectMediaLinkInputSchema.safeParse({ ...input, relation }).success).toBe(false);
    }
    expect(
      ProjectMediaLinkInputSchema.safeParse({
        ...input,
        target: { ...input.target, authority: 'generated_result' },
      }).success,
    ).toBe(false);
    expect(
      ProjectMediaLinkInputSchema.safeParse({
        ...input,
        expectedTargetRevision: input.target.revision,
      }).success,
    ).toBe(false);
    expect(
      ProjectMediaLinkInputSchema.safeParse({
        ...input,
        mediaRef: { ...input.mediaRef, contentHash: undefined },
      }).success,
    ).toBe(false);
    expect(ProjectMediaLinkInputSchema.safeParse({ ...input, unexpected: true }).success).toBe(
      false,
    );

    expect(
      ProjectMediaLinkSuccessSchema.safeParse({ ...success, previousRevision: null }).success,
    ).toBe(false);
    expect(
      ProjectMediaLinkSuccessSchema.safeParse({ ...success, changedPaths: ['revision'] }).success,
    ).toBe(false);
    expect(ProjectMediaLinkSuccessSchema.safeParse({ ...success, undoRef: 'undo.1' }).success).toBe(
      false,
    );
  });

  it('keeps media.link unprotected, dual-CAS bound, variant-complete, and within 40 tools', () => {
    expect(MediaLinkDefinition.metadata.permission.dynamicProtection).toBe(false);
    expect(MediaLinkDefinition.metadata.confirmation.mode).toBe('none');
    expect(MediaLinkDefinition.metadata.cas).toEqual({
      mode: 'revision_and_content_hash',
      expectedFields: ['mediaRef', 'target'],
    });
    expect(MediaLinkDefinition.metadata.variantDiscriminant).toBe('mode');
    expect(MediaLinkDefinition.metadata.variants).toEqual([
      expect.objectContaining({ discriminant: 'link', confirmation: 'none' }),
      expect.objectContaining({ discriminant: 'unlink', confirmation: 'none' }),
    ]);
    expect(EXACT_TOOL_IDS).toHaveLength(40);
    expect(EXACT_TOOL_IDS.filter((id) => id === 'media.link')).toHaveLength(1);
  });
});
