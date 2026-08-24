import { describe, expect, it } from 'vitest';
import {
  MessageSchema,
  ProjectMediaRefSchema,
  ProjectSchema,
  ProjectSettingsSchema,
  parseRequestV1,
  parseResponseV1,
} from './index.js';

const NOW = '2026-08-15T12:00:00.000Z';
const LATER = '2026-08-15T12:05:00.000Z';
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

const project = {
  authority: 'project',
  id: 'project.1',
  name: 'Demo film',
  lifecycle: 'active',
  schemaRevision: 1,
  revision: 1,
  contentHash: HASH_A,
  createdBy: { kind: 'direct_ui', actionId: 'action.create-project' },
  createdAt: NOW,
  updatedAt: NOW,
  archivedAt: null,
  deletedAt: null,
} as const;

const budget = {
  costUsd: { state: 'unknown', currency: 'USD' },
  maxGenerationCount: 10,
  maxInputTokens: 100_000,
  maxOutputTokens: 20_000,
} as const;

const formatPolicy = {
  aspectRatio: '16:9',
  customDimensions: null,
  frameRate: 24,
} as const;

const settings = {
  authority: 'project_settings',
  projectId: project.id,
  revision: 1,
  contentHash: HASH_B,
  defaultProviderProfileId: null,
  formatPolicy,
  permission: 'reversible',
  budget,
  enabledSkills: [
    { id: 'skill.continuity', version: '1.0.0' },
    { id: 'skill.prompt', version: '2.0.0' },
  ],
  updatedAt: NOW,
} as const;

const activeMedia = {
  authority: 'project_media_ref',
  id: 'media.1',
  projectId: project.id,
  globalAssetId: 'asset.1',
  revision: 1,
  contentHash: HASH_A,
  lifecycle: 'active',
  detachedAt: null,
  label: 'Harbor reference',
  collections: ['Locations'],
  roles: ['reference'],
  notes: 'Primary lighting reference.',
  productionLinks: [],
  createdBy: { kind: 'message', messageId: 'message.1' },
  createdAt: NOW,
  updatedAt: NOW,
} as const;

const receipt = {
  object: activeMedia,
  previousRevision: 0,
  eventId: 'event.media-attach.1',
  changedPaths: ['lifecycle'],
  undoRef: 'undo.media-attach.1',
} as const;

describe('R1 Project, Media, and Conversation authority contracts', () => {
  it('keeps Project core-only and owns all mutable settings in one strict authority', () => {
    expect(ProjectSchema.parse(project)).toEqual(project);
    expect(ProjectSchema.safeParse({ ...project, permission: 'reversible' }).success).toBe(false);
    expect(ProjectSettingsSchema.parse(settings)).toEqual(settings);

    expect(
      ProjectSettingsSchema.safeParse({
        ...settings,
        formatPolicy: {
          aspectRatio: 'custom',
          customDimensions: { width: 1_920, height: 804 },
          frameRate: 24,
        },
      }).success,
    ).toBe(true);
    expect(
      ProjectSettingsSchema.safeParse({
        ...settings,
        formatPolicy: { aspectRatio: 'custom', customDimensions: null, frameRate: 24 },
      }).success,
    ).toBe(false);
    expect(
      ProjectSettingsSchema.safeParse({
        ...settings,
        formatPolicy: {
          aspectRatio: '16:9',
          customDimensions: { width: 1_920, height: 1_080 },
          frameRate: 24,
        },
      }).success,
    ).toBe(false);
    expect(
      ProjectSettingsSchema.safeParse({
        ...settings,
        enabledSkills: [
          { id: 'skill.prompt', version: '2.0.0' },
          { id: 'skill.continuity', version: '1.0.0' },
        ],
      }).success,
    ).toBe(false);
    expect(
      ProjectSettingsSchema.safeParse({
        ...settings,
        enabledSkills: [
          { id: 'skill.prompt', version: '1.0.0' },
          { id: 'skill.prompt', version: '2.0.0' },
        ],
      }).success,
    ).toBe(false);
    expect(
      ProjectSettingsSchema.safeParse({
        ...settings,
        enabledSkillIds: ['skill.continuity'],
      }).success,
    ).toBe(false);
    expect(ProjectSettingsSchema.safeParse({ ...settings, legacyProvider: null }).success).toBe(
      false,
    );

    expect(
      ProjectSchema.safeParse({ ...project, lifecycle: 'archived', archivedAt: LATER }).success,
    ).toBe(true);
    expect(
      ProjectSchema.safeParse({ ...project, lifecycle: 'deleted', deletedAt: LATER }).success,
    ).toBe(true);
    for (const invalidLifecycle of [
      { ...project, archivedAt: LATER },
      { ...project, lifecycle: 'archived' },
      { ...project, lifecycle: 'archived', archivedAt: LATER, deletedAt: LATER },
      { ...project, lifecycle: 'deleted' },
      { ...project, lifecycle: 'deleted', archivedAt: LATER, deletedAt: LATER },
    ] as const) {
      expect(ProjectSchema.safeParse(invalidLifecycle).success).toBe(false);
    }
  });

  it('enforces the immutable Message role, status, and originating Run matrix', () => {
    const userMessage = {
      authority: 'message',
      id: 'message.user.1',
      projectId: project.id,
      chatId: 'chat.1',
      sequence: 1,
      role: 'user',
      status: 'accepted',
      originatingRunId: null,
      blocks: [{ type: 'text', text: 'Create a moonlit harbor sequence.' }],
      attachments: [],
      supersedesMessageId: null,
      contentHash: HASH_A,
      createdAt: NOW,
    } as const;
    const assistantMessage = {
      ...userMessage,
      id: 'message.assistant.1',
      sequence: 2,
      role: 'assistant',
      status: 'completed',
      originatingRunId: 'run.1',
    } as const;

    expect(MessageSchema.parse(userMessage)).toEqual(userMessage);
    expect(MessageSchema.parse(assistantMessage)).toEqual(assistantMessage);
    expect(MessageSchema.safeParse({ ...assistantMessage, status: 'interrupted' }).success).toBe(
      true,
    );
    expect(MessageSchema.safeParse({ ...userMessage, originatingRunId: 'run.1' }).success).toBe(
      false,
    );
    expect(MessageSchema.safeParse({ ...userMessage, status: 'completed' }).success).toBe(false);
    expect(MessageSchema.safeParse({ ...assistantMessage, originatingRunId: null }).success).toBe(
      false,
    );
    expect(MessageSchema.safeParse({ ...assistantMessage, status: 'accepted' }).success).toBe(
      false,
    );
    expect(MessageSchema.safeParse({ ...assistantMessage, status: 'failed' }).success).toBe(false);
    expect(
      MessageSchema.safeParse({ ...assistantMessage, privateReasoning: 'hidden' }).success,
    ).toBe(false);
    expect(MessageSchema.safeParse({ ...userMessage, chatId: null }).success).toBe(false);
  });

  it('makes Project Media detach reversible without changing relationship identity', () => {
    expect(ProjectMediaRefSchema.parse(activeMedia)).toEqual(activeMedia);
    expect(
      ProjectMediaRefSchema.safeParse({
        ...activeMedia,
        lifecycle: 'detached',
        detachedAt: LATER,
      }).success,
    ).toBe(true);
    expect(ProjectMediaRefSchema.safeParse({ ...activeMedia, lifecycle: 'detached' }).success).toBe(
      false,
    );
    expect(ProjectMediaRefSchema.safeParse({ ...activeMedia, detachedAt: LATER }).success).toBe(
      false,
    );
    expect(ProjectMediaRefSchema.safeParse({ ...activeMedia, lifecycle: 'deleted' }).success).toBe(
      false,
    );
    expect(ProjectMediaRefSchema.safeParse({ ...activeMedia, legacyActive: true }).success).toBe(
      false,
    );

    expect(() =>
      parseRequestV1({
        wireVersion: 1,
        kind: 'request',
        requestId: 'request.detach.1',
        method: 'media.project.detach',
        input: {
          projectMediaRefId: activeMedia.id,
          expectedRevision: activeMedia.revision,
          expectedContentHash: activeMedia.contentHash,
        },
      }),
    ).not.toThrow();
    expect(() =>
      parseRequestV1({
        wireVersion: 1,
        kind: 'request',
        requestId: 'request.detach.2',
        method: 'media.project.detach',
        input: {
          projectMediaRefId: activeMedia.id,
          expectedRevision: activeMedia.revision,
        },
      }),
    ).toThrow();

    const newAttachInput = {
      projectId: project.id,
      expectedProjectRevision: project.revision,
      globalAssetId: activeMedia.globalAssetId,
      expectedExistingRef: null,
      label: activeMedia.label,
      collections: activeMedia.collections,
      roles: activeMedia.roles,
      notes: activeMedia.notes,
    } as const;
    expect(() =>
      parseRequestV1({
        wireVersion: 1,
        kind: 'request',
        requestId: 'request.attach.1',
        method: 'media.project.attach',
        input: newAttachInput,
      }),
    ).not.toThrow();
    expect(() =>
      parseRequestV1({
        wireVersion: 1,
        kind: 'request',
        requestId: 'request.attach.2',
        method: 'media.project.attach',
        input: {
          ...newAttachInput,
          expectedExistingRef: {
            id: activeMedia.id,
            expectedRevision: activeMedia.revision,
            expectedContentHash: activeMedia.contentHash,
          },
        },
      }),
    ).not.toThrow();
    const missingExistingRef = structuredClone(newAttachInput) as Record<string, unknown>;
    delete missingExistingRef.expectedExistingRef;
    expect(() =>
      parseRequestV1({
        wireVersion: 1,
        kind: 'request',
        requestId: 'request.attach.3',
        method: 'media.project.attach',
        input: missingExistingRef,
      }),
    ).toThrow();
    expect(() =>
      parseRequestV1({
        wireVersion: 1,
        kind: 'request',
        requestId: 'request.attach.4',
        method: 'media.project.attach',
        input: {
          ...newAttachInput,
          expectedExistingRef: {
            id: activeMedia.id,
            expectedRevision: activeMedia.revision,
            expectedContentHash: activeMedia.contentHash,
            authority: 'project_media_ref',
          },
        },
      }),
    ).toThrow();
    expect(() =>
      parseRequestV1({
        wireVersion: 1,
        kind: 'request',
        requestId: 'request.attach.5',
        method: 'media.project.attach',
        input: {
          ...newAttachInput,
          expectedExistingRef: {
            id: activeMedia.id,
            revision: activeMedia.revision,
            contentHash: activeMedia.contentHash,
          },
        },
      }),
    ).toThrow();

    const detachedReceipt = {
      ...receipt,
      object: {
        ...activeMedia,
        revision: 2,
        contentHash: HASH_B,
        lifecycle: 'detached',
        detachedAt: LATER,
        updatedAt: LATER,
      },
      previousRevision: 1,
      changedPaths: ['detachedAt', 'lifecycle'],
    } as const;
    expect(() =>
      parseResponseV1({
        wireVersion: 1,
        kind: 'success',
        requestId: 'request.detach.1',
        method: 'media.project.detach',
        result: detachedReceipt,
      }),
    ).not.toThrow();
    expect(() =>
      parseResponseV1({
        wireVersion: 1,
        kind: 'success',
        requestId: 'request.detach.1',
        method: 'media.project.detach',
        result: { projectMediaRefId: activeMedia.id, detached: true },
      }),
    ).toThrow();

    const reattach = parseResponseV1({
      wireVersion: 1,
      kind: 'success',
      requestId: 'request.reattach.1',
      method: 'media.project.attach',
      result: receipt,
    });
    expect(reattach.kind).toBe('success');
    if (reattach.kind !== 'success' || reattach.method !== 'media.project.attach') {
      throw new Error('Expected media.project.attach success');
    }
    expect(reattach.result.object.id).toBe(activeMedia.id);
    expect(reattach.result.previousRevision).toBe(0);
  });

  it('returns Project and ProjectSettings together and uses settings CAS by hash', () => {
    const createInput = {
      name: project.name,
      permissionMode: settings.permission,
      budget,
      formatPolicy,
    } as const;
    expect(() =>
      parseRequestV1({
        wireVersion: 1,
        kind: 'request',
        requestId: 'request.create.input.1',
        method: 'project.create',
        input: createInput,
      }),
    ).not.toThrow();
    const missingFormatPolicy = structuredClone(createInput) as Record<string, unknown>;
    delete missingFormatPolicy.formatPolicy;
    expect(() =>
      parseRequestV1({
        wireVersion: 1,
        kind: 'request',
        requestId: 'request.create.input.2',
        method: 'project.create',
        input: missingFormatPolicy,
      }),
    ).toThrow();
    expect(() =>
      parseResponseV1({
        wireVersion: 1,
        kind: 'success',
        requestId: 'request.create.1',
        method: 'project.create',
        result: { project, settings },
      }),
    ).not.toThrow();

    const updateInput = {
      projectId: project.id,
      expectedRevision: settings.revision,
      expectedContentHash: settings.contentHash,
      defaultProviderProfileId: null,
      formatPolicy,
      permission: settings.permission,
      budget,
      enabledSkills: settings.enabledSkills,
    } as const;
    expect(() =>
      parseRequestV1({
        wireVersion: 1,
        kind: 'request',
        requestId: 'request.settings.1',
        method: 'project.settings.update',
        input: updateInput,
      }),
    ).not.toThrow();
    const missingHash = structuredClone(updateInput) as Record<string, unknown>;
    delete missingHash.expectedContentHash;
    expect(() =>
      parseRequestV1({
        wireVersion: 1,
        kind: 'request',
        requestId: 'request.settings.2',
        method: 'project.settings.update',
        input: missingHash,
      }),
    ).toThrow();
    expect(() =>
      parseRequestV1({
        wireVersion: 1,
        kind: 'request',
        requestId: 'request.settings.3',
        method: 'project.settings.update',
        input: {
          ...updateInput,
          enabledSkills: [
            { id: 'skill.prompt', version: '2.0.0' },
            { id: 'skill.continuity', version: '1.0.0' },
          ],
        },
      }),
    ).toThrow();
  });
});
