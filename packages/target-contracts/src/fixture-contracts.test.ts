import { describe, expect, it } from 'vitest';
import {
  CanvasDocumentSchema,
  ChatSchema,
  DomainObjectRefSchema,
  DeliveryExportDefinition,
  DeliveryMutateDefinition,
  DeliveryPlanSchema,
  GenerationAttemptViewSchema,
  GenerationSubmitDefinition,
  MediaDerivationTransformSchema,
  MediaDeriveDefinition,
  MessageSchema,
  ProjectMediaRefSchema,
  ProjectSchema,
  ProjectSettingsSchema,
  TaskListSchema,
  UserChoiceSchema,
  parseCanonical,
} from './index.js';

const NOW = '2026-08-15T12:00:00.000Z';
const HASH_A = 'a'.repeat(64);

describe('I0 synthetic scenarios on target contracts', () => {
  it('represents an empty install without inventing a Project authority', () => {
    const emptyInstall = Object.freeze({ projects: [], chats: [], media: [] });
    expect(emptyInstall).toEqual({ projects: [], chats: [], media: [] });
  });

  it('round-trips one representative Project, Settings, Canvas, Chat, Message, and TaskList', () => {
    const project = parseCanonical(ProjectSchema, {
      authority: 'project',
      id: 'project.demo',
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
    });
    const settings = parseCanonical(ProjectSettingsSchema, {
      authority: 'project_settings',
      projectId: project.id,
      revision: 1,
      contentHash: HASH_A,
      defaultProviderProfileId: null,
      formatPolicy: {
        aspectRatio: '16:9',
        customDimensions: null,
        frameRate: 24,
      },
      permission: 'reversible',
      budget: {
        costUsd: { state: 'unknown', currency: 'USD' },
        maxGenerationCount: 0,
        maxInputTokens: 0,
        maxOutputTokens: 0,
      },
      enabledSkills: [{ id: 'skill.continuity', version: '1.0.0' }],
      updatedAt: NOW,
    });
    const canvas = parseCanonical(CanvasDocumentSchema, {
      authority: 'canvas',
      id: 'canvas.demo',
      projectId: project.id,
      revision: 0,
      contentHash: HASH_A,
      placements: [
        {
          id: 'placement.shot',
          target: {
            targetType: 'production',
            targetId: 'shot.demo',
            targetRevision: 2,
            targetContentHash: HASH_A,
          },
          position: { x: 0, y: 0 },
          size: { width: 320, height: 180 },
          zIndex: 0,
          revision: 0,
          createdAt: NOW,
          updatedAt: NOW,
        },
        {
          id: 'placement.reference',
          target: {
            targetType: 'project_media_ref',
            targetId: 'media.reference',
            targetRevision: 1,
            targetContentHash: HASH_A,
          },
          position: { x: 360, y: 0 },
          size: { width: 320, height: 180 },
          zIndex: 1,
          revision: 0,
          createdAt: NOW,
          updatedAt: NOW,
        },
      ],
      groups: [
        {
          id: 'group.sequence',
          title: 'Opening sequence',
          placementIds: ['placement.shot', 'placement.reference'],
          revision: 0,
          createdAt: NOW,
          updatedAt: NOW,
        },
      ],
      edges: [
        {
          id: 'edge.reference',
          sourcePlacementId: 'placement.reference',
          targetPlacementId: 'placement.shot',
          label: 'guides',
          revision: 0,
          createdAt: NOW,
          updatedAt: NOW,
        },
      ],
      annotations: [
        {
          id: 'annotation.intent',
          placementId: 'placement.shot',
          text: 'Match the moonlit composition.',
          geometry: {
            position: { x: 0, y: 200 },
            size: { width: 320, height: 80 },
          },
          revision: 0,
          createdAt: NOW,
          updatedAt: NOW,
        },
      ],
      viewport: { center: { x: 0, y: 0 }, zoom: 1 },
      savedViews: [
        {
          id: 'view.sequence',
          name: 'Opening sequence',
          viewport: { center: { x: 160, y: 90 }, zoom: 1 },
          revision: 0,
          createdAt: NOW,
        },
      ],
      nextZIndex: 2,
      createdAt: NOW,
      updatedAt: NOW,
    });
    const chat = parseCanonical(ChatSchema, {
      authority: 'chat',
      id: 'chat.demo',
      projectId: project.id,
      revision: 1,
      contentHash: HASH_A,
      title: 'Commander',
      lifecycle: 'active',
      messageCount: 1,
      messageHeadSequence: 1,
      createdAt: NOW,
      updatedAt: NOW,
      archivedAt: null,
      deletedAt: null,
    });
    const message = parseCanonical(MessageSchema, {
      authority: 'message',
      id: 'message.demo',
      projectId: project.id,
      chatId: chat.id,
      sequence: 1,
      role: 'user',
      status: 'accepted',
      originatingRunId: null,
      originatingImportedRunId: null,
      blocks: [{ type: 'text', text: 'Create a moonlit harbor sequence.' }],
      attachments: [],
      supersedesMessageId: null,
      contentHash: HASH_A,
      createdAt: NOW,
    });
    const taskList = parseCanonical(TaskListSchema, {
      authority: 'task_list',
      id: 'tasks.demo',
      runId: 'run.demo',
      title: 'Current work',
      state: 'active',
      revision: 1,
      contentHash: HASH_A,
      items: [
        {
          id: 'task.inspect-reference',
          title: 'Inspect the visual reference',
          state: 'in_progress',
          order: 0,
          parentItemId: null,
          childRunIds: [],
          publicNote: '',
        },
      ],
      createdAt: NOW,
      updatedAt: NOW,
      terminalizedAt: null,
    });

    expect([project.id, settings.projectId, canvas.id, chat.id, message.id, taskList.id]).toEqual([
      'project.demo',
      'project.demo',
      'canvas.demo',
      'chat.demo',
      'message.demo',
      'tasks.demo',
    ]);
    expect(Object.isFrozen(taskList.items[0])).toBe(true);
    expect(canvas.groups[0]?.placementIds).toEqual(['placement.shot', 'placement.reference']);
    expect(canvas.annotations[0]?.text).toBe('Match the moonlit composition.');

    const duplicateMembership = structuredClone(canvas);
    duplicateMembership.groups.push({
      ...duplicateMembership.groups[0]!,
      id: 'group.duplicate',
      placementIds: ['placement.shot'],
    });
    expect(CanvasDocumentSchema.safeParse(duplicateMembership).success).toBe(false);

    const placementWithLegacyMembership = structuredClone(canvas);
    Object.assign(placementWithLegacyMembership.placements[0]!, { groupId: 'group.sequence' });
    expect(CanvasDocumentSchema.safeParse(placementWithLegacyMembership).success).toBe(false);
  });

  it('parses a media reference whose Blob relationship must be proven by the I2 database', () => {
    const media = parseCanonical(ProjectMediaRefSchema, {
      authority: 'project_media_ref',
      id: 'media.missing',
      projectId: 'project.demo',
      globalAssetId: 'asset.missing',
      revision: 0,
      contentHash: HASH_A,
      lifecycle: 'active',
      detachedAt: null,
      label: 'Missing source fixture',
      collections: [],
      roles: ['reference'],
      notes: '',
      productionLinks: [],
      createdBy: { kind: 'import', importId: 'fixture.missing-media' },
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(media.globalAssetId).toBe('asset.missing');
    const deriveInput = {
      operation: 'resize',
      source: { kind: 'project_media_ref', id: 'media.missing' },
      expectedSourceHash: HASH_A,
      attach: { enabled: false, expectedProjectRevision: null },
      outputIntents: [
        {
          ordinal: 0,
          globalAsset: {
            filename: 'missing-source-1920x1080.png',
            displayName: 'Missing source 1920x1080',
            folderId: null,
            tags: [],
          },
          projectMediaRef: null,
        },
      ],
      width: 1_920,
      height: 1_080,
      fit: 'contain',
    } as const;
    expect(() => MediaDeriveDefinition.parseInput(deriveInput)).not.toThrow();
    expect(
      parseCanonical(MediaDerivationTransformSchema, {
        operation: deriveInput.operation,
        width: deriveInput.width,
        height: deriveInput.height,
        fit: deriveInput.fit,
      }),
    ).toEqual({ operation: 'resize', width: 1_920, height: 1_080, fit: 'contain' });
  });

  it('keeps an unknown Provider submission explicit and nonterminal', () => {
    const attempt = parseCanonical(GenerationAttemptViewSchema, {
      authority: 'generation_attempt',
      id: 'attempt.unknown',
      requestId: 'request.unknown',
      attemptNumber: 1,
      revision: 1,
      contentHash: HASH_A,
      provider: {
        providerId: 'provider.unavailable',
        model: 'model.unavailable',
        reasoningStrength: null,
      },
      quote: {
        state: 'estimated',
        quoteId: 'quote.unknown',
        quotedRequestHash: HASH_A,
        amount: '1',
        currency: 'USD',
        expiresAt: '2026-08-15T12:05:00.000Z',
        providerId: 'provider.unavailable',
        model: 'model.unavailable',
        quoteHash: HASH_A,
      },
      state: 'unknown',
      receipt: {
        providerOperationId: 'provider-operation.unknown',
        submittedAt: NOW,
        reconciledAt: null,
        receiptHash: HASH_A,
      },
      usage: null,
      cancelRequested: false,
      progressPercent: null,
      publicErrorCode: 'provider_state_unknown',
      promptProvenance: {
        sourceObjectId: 'shot.demo',
        sourceRevision: 1,
        sourceHash: HASH_A,
        assemblyHash: HASH_A,
        loadedSkillDigests: [],
      },
      request: {
        id: 'request.unknown',
        projectId: 'project.demo',
        runId: 'run.demo',
        spec: {
          kind: 'video',
          task: 'create',
          target: {
            authority: 'production',
            id: 'shot.demo',
            revision: 1,
            contentHash: HASH_A,
          },
          prompt: 'Moonlit harbor, restrained camera movement.',
          negativePrompt: null,
          references: [],
          provider: null,
          outputCount: 1,
          seed: null,
          width: 1920,
          height: 1080,
          durationMs: 5_000,
          frameRate: 24,
          includeAudio: false,
        },
        requestHash: HASH_A,
        idempotencyKey: HASH_A,
        createdAt: NOW,
      },
      finishedAt: null,
      createdAt: NOW,
    });
    expect(attempt.state).toBe('unknown');
    expect(() =>
      GenerationSubmitDefinition.parseInput({
        spec: attempt.request.spec,
        quote: attempt.quote,
        expectedProjectRevision: 1,
        promptProvenance: attempt.promptProvenance,
        outputIntents: [
          {
            variantIndex: 0,
            globalAsset: {
              filename: 'moonlit-harbor.mp4',
              displayName: 'Moonlit Harbor',
              folderId: null,
              tags: ['generated'],
            },
            projectMediaRef: {
              label: 'Moonlit Harbor candidate',
              collections: ['Generated candidates'],
              roles: ['generated_candidate'],
              notes: '',
            },
          },
        ],
      }),
    ).not.toThrow();
  });

  it('uses one Delivery spelling for domain state and tool commands', () => {
    const plan = parseCanonical(DeliveryPlanSchema, {
      authority: 'delivery',
      id: 'delivery.demo',
      projectId: 'project.demo',
      revision: 1,
      contentHash: HASH_A,
      name: 'Review sequence',
      lifecycle: 'active',
      items: [
        {
          id: 'delivery-item.demo',
          revision: 1,
          contentHash: HASH_A,
          lifecycle: 'active',
          removedAt: null,
          shot: {
            authority: 'production',
            id: 'shot.demo',
            revision: 2,
            contentHash: HASH_A,
          },
          result: {
            authority: 'generated_result',
            id: 'result.demo',
            revision: 0,
            contentHash: HASH_A,
          },
          projectMedia: {
            authority: 'project_media_ref',
            id: 'media.demo',
            revision: 1,
            contentHash: HASH_A,
          },
          order: 0,
          trimStartMs: 0,
          trimEndMs: 1_000,
          audioPolicy: 'use',
          transition: { kind: 'cut', durationMs: 0 },
          reviewState: 'unreviewed',
        },
      ],
      formatIntent: {
        container: 'mp4',
        videoCodec: 'h264',
        audioCodec: 'aac',
        width: 1_920,
        height: 1_080,
        frameRate: 24,
        quality: 'master',
      },
      currentChoices: [],
      protections: [],
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(plan.items[0]?.audioPolicy).toBe('use');
    expect(() =>
      DeliveryMutateDefinition.parseInput({
        action: 'create',
        project: {
          authority: 'project',
          id: plan.projectId,
          revision: 1,
          contentHash: HASH_A,
        },
        name: plan.name,
        formatIntent: plan.formatIntent,
      }),
    ).not.toThrow();
    expect(() =>
      DeliveryExportDefinition.parseInput({
        manifest: {
          authority: 'delivery_manifest',
          id: 'manifest.demo',
          revision: 0,
          contentHash: HASH_A,
        },
        destination: {
          kind: 'user_selected_file',
          grantId: 'grant.demo',
          grantHash: HASH_A,
          displayLabel: 'movie.mp4',
        },
        overwriteExisting: false,
      }),
    ).not.toThrow();
  });

  it('round-trips a protected user choice with exact field and causation', () => {
    const choice = parseCanonical(UserChoiceSchema, {
      authority: 'user_choice',
      id: 'choice.protect',
      projectId: 'project.demo',
      actor: 'user',
      authorization: {
        kind: 'direct_user',
        requestId: 'request.protect',
        inputHash: HASH_A,
      },
      causation: { kind: 'message', messageId: 'message.demo' },
      subject: {
        kind: 'protection',
        field: {
          owner: 'production',
          objectId: 'direction.demo',
          field: 'content',
        },
      },
      ownerBefore: {
        authority: 'production',
        id: 'direction.demo',
        revision: 2,
        contentHash: HASH_A,
      },
      ownerAfter: {
        authority: 'production',
        id: 'direction.demo',
        revision: 3,
        contentHash: HASH_A,
      },
      choice: {
        kind: 'protect',
        field: {
          owner: 'production',
          objectId: 'direction.demo',
          field: 'content',
        },
        reason: 'Keep the approved direction.',
      },
      beforeEffect: {
        kind: 'protection',
        field: { owner: 'production', objectId: 'direction.demo', field: 'content' },
        active: false,
      },
      afterEffect: {
        kind: 'protection',
        field: { owner: 'production', objectId: 'direction.demo', field: 'content' },
        active: true,
      },
      supersedesChoiceIds: [],
      createdAt: NOW,
      choiceHash: HASH_A,
    });
    expect(choice.choice.kind).toBe('protect');
  });

  it('rejects corrupt hashes and unsupported fields before persistence', () => {
    expect(() =>
      parseCanonical(DomainObjectRefSchema, {
        authority: 'production',
        id: 'shot.demo',
        revision: 1,
        contentHash: 'corrupt',
      }),
    ).toThrow();
    expect(() =>
      parseCanonical(ProjectSchema, {
        authority: 'project',
        id: 'project.demo',
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
        legacyCanvasId: 'canvas.demo',
      }),
    ).toThrow();
  });
});
