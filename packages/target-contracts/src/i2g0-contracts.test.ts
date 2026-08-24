import { describe, expect, it } from 'vitest';
import { UserChoiceSchema, userChoiceHashInput } from './decision.js';
import {
  DeliveryExportSchema,
  DeliveryManifestSchema,
  DeliveryMutationCommandSchema,
  DeliveryPreviewRequestSchema,
  ReviewCutAttemptSchema,
} from './delivery.js';
import { GeneratedResultRefSchema, GeneratedResultSchema } from './generation.js';
import { ProjectSearchSourceV1Schema, UserChoiceHistoryEntryViewSchema } from './history-memory.js';
import {
  OrderedNarrativeContentSchema,
  ProductionCitationFieldSchema,
  ShotContentSchema,
  ShotObjectSchema,
} from './production.js';
import { ConfirmationTargetSchema } from './run.js';
import { TOOL_DEFINITION_BY_ID } from './tools/catalog.js';
import { EXACT_TOOL_IDS } from './tools/ids.js';
import { PUBLIC_WIRE_METHODS_V1 } from './wire.js';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);
const HASH_D = 'd'.repeat(64);
const NOW = '2026-08-16T12:00:00.000Z';

const generatedResultRef = {
  authority: 'generated_result' as const,
  id: 'result.1',
  revision: 0 as const,
  contentHash: HASH_A,
};
const shotRef = {
  authority: 'production' as const,
  id: 'shot.1',
  revision: 2,
  contentHash: HASH_B,
};
const deliveryRef = {
  authority: 'delivery' as const,
  id: 'delivery.1',
  revision: 3,
  contentHash: HASH_C,
};
const itemRef = { id: 'delivery-item.1', revision: 1, contentHash: HASH_D };

function generatedResult() {
  return {
    authority: 'generated_result' as const,
    id: generatedResultRef.id,
    projectId: 'project.1',
    runId: 'run.1',
    revision: 0 as const,
    contentHash: generatedResultRef.contentHash,
    generationRequestId: 'request.1',
    generationAttemptId: 'attempt.1',
    targetProductionObjectId: shotRef.id,
    globalMediaAssetId: 'asset.1',
    mediaBlobHash: HASH_D,
    projectMediaRefId: 'project-media.1',
    mediaKind: 'video' as const,
    variantIndex: 0,
    submittedPrompt: 'Moonlit harbor reveal.',
    submittedNegativePrompt: null,
    promptProvenance: {
      sourceObjectId: shotRef.id,
      sourceRevision: shotRef.revision,
      sourceHash: shotRef.contentHash,
      assemblyHash: HASH_A,
      loadedSkillDigests: [],
    },
    referenceBindings: [],
    provider: { providerId: 'provider.1', model: 'video-model', reasoningStrength: null },
    seed: 42,
    receipt: {
      providerOperationId: 'provider-operation.1',
      submittedAt: NOW,
      reconciledAt: NOW,
      receiptHash: HASH_B,
    },
    usage: {
      inputTokens: { state: 'known' as const, value: 0 },
      outputTokens: { state: 'known' as const, value: 0 },
      generatedUnits: { state: 'known' as const, value: 1 },
      cost: { state: 'known' as const, value: '0', currency: 'USD' },
    },
    technicalValidation: {
      state: 'valid' as const,
      mimeTypeValid: true,
      dimensionsValid: true,
      durationValid: true,
      failureCode: null,
    },
    createdAt: NOW,
  };
}

function shotContent() {
  return {
    title: 'Harbor reveal',
    description: 'A moonlit harbor.',
    durationMs: 5_000,
    shotSize: 'wide' as const,
    cameraMovement: 'static' as const,
  };
}

function formatIntent() {
  return {
    container: 'mp4' as const,
    videoCodec: 'h264' as const,
    audioCodec: 'aac' as const,
    width: 1_920,
    height: 1_080,
    frameRate: 24,
    quality: 'master' as const,
  };
}

function manifest() {
  return {
    authority: 'delivery_manifest' as const,
    id: 'manifest.1',
    projectId: 'project.1',
    revision: 0 as const,
    contentHash: HASH_D,
    sourcePlan: deliveryRef,
    formatIntent: formatIntent(),
    items: [
      {
        deliveryItemId: itemRef.id,
        deliveryItemRevision: itemRef.revision,
        deliveryItemContentHash: itemRef.contentHash,
        shotId: shotRef.id,
        shotRevision: shotRef.revision,
        shotContentHash: shotRef.contentHash,
        generatedResultId: generatedResultRef.id,
        generatedResultRevision: 0 as const,
        generatedResultContentHash: generatedResultRef.contentHash,
        projectMediaRefId: 'project-media.1',
        projectMediaRevision: 4,
        projectMediaContentHash: HASH_A,
        globalAssetId: 'asset.1',
        globalAssetRevision: 5,
        globalAssetContentHash: HASH_B,
        blobHash: HASH_C,
        order: 0,
        trimStartMs: 0,
        trimEndMs: 5_000,
        audioPolicy: 'use' as const,
        transition: { kind: 'cut' as const, durationMs: 0 },
        reviewState: 'approved' as const,
      },
    ],
    currentChoices: [
      {
        field: {
          owner: 'delivery' as const,
          deliveryId: deliveryRef.id,
          itemId: itemRef.id,
          field: 'clip' as const,
        },
        choice: { authority: 'user_choice' as const, id: 'choice.1', choiceHash: HASH_A },
      },
    ],
    protections: [
      {
        field: {
          owner: 'delivery' as const,
          deliveryId: deliveryRef.id,
          itemId: itemRef.id,
          field: 'trim' as const,
        },
        choice: { authority: 'user_choice' as const, id: 'choice.2', choiceHash: HASH_B },
      },
    ],
    createdBy: { kind: 'run' as const, runId: 'run.1' },
    frozenAt: NOW,
  };
}

function localAttemptBase(state: 'running' | 'submitted' | 'unknown' = 'running') {
  return {
    revision: 1,
    contentHash: HASH_A,
    state,
    provider: null,
    receipt: null,
    usage: null,
    cancelRequested: false,
    progressPercent: null,
    publicErrorCode: state === 'unknown' ? ('provider_state_unknown' as const) : null,
    createdAt: NOW,
    finishedAt: null,
  };
}

describe('I2-G0 immutable result and Production decision contracts', () => {
  it('keeps GeneratedResult at revision zero and rejects mutable state fields', () => {
    const value = generatedResult();
    expect(GeneratedResultSchema.parse(value)).toEqual(value);
    expect(GeneratedResultRefSchema.parse(generatedResultRef)).toEqual(generatedResultRef);
    expect(GeneratedResultSchema.safeParse({ ...value, revision: 1 }).success).toBe(false);
    expect(GeneratedResultRefSchema.safeParse({ ...generatedResultRef, revision: 1 }).success).toBe(
      false,
    );
    expect(GeneratedResultSchema.safeParse({ ...value, state: 'available' }).success).toBe(false);
    expect(GeneratedResultSchema.safeParse({ ...value, updatedAt: NOW }).success).toBe(false);
  });

  it('stores result decisions only on Shot and permits at most one selected candidate', () => {
    expect(ShotContentSchema.parse(shotContent())).toEqual(shotContent());
    expect(ShotContentSchema.safeParse({ ...shotContent(), sceneId: null }).success).toBe(false);
    expect(ShotContentSchema.safeParse({ ...shotContent(), order: 0 }).success).toBe(false);
    expect(
      OrderedNarrativeContentSchema.safeParse({
        title: 'Harbor sequence',
        summary: 'A sequence crossing the harbor.',
        parentId: null,
      }).success,
    ).toBe(false);
    expect(
      OrderedNarrativeContentSchema.safeParse({
        title: 'Harbor sequence',
        summary: 'A sequence crossing the harbor.',
        order: 0,
      }).success,
    ).toBe(false);
    expect(ProductionCitationFieldSchema.safeParse('order').success).toBe(false);
    expect(
      ShotContentSchema.safeParse({ ...shotContent(), selectedResultId: generatedResultRef.id })
        .success,
    ).toBe(false);

    const shot = {
      authority: 'production' as const,
      id: shotRef.id,
      projectId: 'project.1',
      revision: shotRef.revision,
      contentHash: shotRef.contentHash,
      lifecycle: 'active' as const,
      relations: [],
      protections: [],
      createdBy: { kind: 'message' as const, messageId: 'message.1' },
      updatedBy: { kind: 'message' as const, messageId: 'message.1' },
      createdAt: NOW,
      updatedAt: NOW,
      type: 'shot' as const,
      content: shotContent(),
      resultDecisions: [
        {
          result: generatedResultRef,
          value: { state: 'selected' as const, feedback: '' },
          currentChoiceId: 'choice.1',
        },
      ],
    };
    expect(ShotObjectSchema.safeParse(shot).success).toBe(true);
    expect(
      ShotObjectSchema.safeParse({
        ...shot,
        resultDecisions: [
          ...shot.resultDecisions,
          {
            result: { ...generatedResultRef, id: 'result.2' },
            value: { state: 'selected', feedback: '' },
            currentChoiceId: 'choice.2',
          },
        ],
      }).success,
    ).toBe(false);
  });
});

describe('I2-G0 Choice, protection, and confirmation contracts', () => {
  const beforeEffect = {
    kind: 'result_decisions' as const,
    shotId: shotRef.id,
    entries: [{ resultId: generatedResultRef.id, value: null }],
  };
  const afterEffect = {
    kind: 'result_decisions' as const,
    shotId: shotRef.id,
    entries: [
      {
        resultId: generatedResultRef.id,
        value: { state: 'selected' as const, feedback: 'Use this take.' },
      },
    ],
  };
  const choice = {
    authority: 'user_choice' as const,
    id: 'choice.1',
    projectId: 'project.1',
    actor: 'user' as const,
    authorization: { kind: 'direct_user' as const, requestId: 'request.1', inputHash: HASH_A },
    causation: { kind: 'message' as const, messageId: 'message.1' },
    subject: {
      kind: 'result_decision' as const,
      shotId: shotRef.id,
      resultIds: [generatedResultRef.id],
    },
    ownerBefore: shotRef,
    ownerAfter: { ...shotRef, revision: shotRef.revision + 1, contentHash: HASH_C },
    choice: {
      kind: 'select' as const,
      resultId: generatedResultRef.id,
      feedback: 'Use this take.',
    },
    beforeEffect,
    afterEffect,
    supersedesChoiceIds: [],
    createdAt: NOW,
    choiceHash: HASH_D,
  };

  it('requires coherent immutable UserChoice evidence and excludes hash from its preimage', () => {
    expect(UserChoiceSchema.safeParse(choice).success).toBe(true);
    expect(userChoiceHashInput(UserChoiceSchema.parse(choice))).not.toHaveProperty('choiceHash');
    expect(UserChoiceSchema.safeParse({ ...choice, actor: 'commander' }).success).toBe(false);
    expect(
      UserChoiceSchema.safeParse({
        ...choice,
        ownerAfter: { ...choice.ownerAfter, revision: choice.ownerAfter.revision + 1 },
      }).success,
    ).toBe(false);
    expect(
      UserChoiceSchema.safeParse({ ...choice, afterEffect: { ...afterEffect, shotId: 'shot.2' } })
        .success,
    ).toBe(false);
    expect(
      UserChoiceSchema.safeParse({ ...choice, supersedesChoiceIds: ['choice.2', 'choice.2'] })
        .success,
    ).toBe(false);
    expect(UserChoiceSchema.safeParse({ ...choice, choiceHash: 'bad' }).success).toBe(false);
  });

  it('binds protected confirmation proof to exact owner, fields, active choices, and effect hash', () => {
    const target = {
      kind: 'protected_mutation' as const,
      dispatch: {
        operationId: 'dispatch.1',
        toolId: 'production.mutate' as const,
        toolVersion: '2.0.0',
        inputHash: HASH_A,
        fingerprint: HASH_B,
        authorityWatermarkHash: null,
      },
      owner: shotRef,
      fields: [
        {
          owner: 'production' as const,
          objectId: shotRef.id,
          field: 'content' as const,
        },
      ],
      activeChoiceIds: ['choice.1'],
      plannedIds: {
        tool: 'production.mutate' as const,
        variant: 'production_update' as const,
        objectEventId: 'event.production-update.1',
      },
      proposedEffectHash: HASH_A,
    };
    expect(ConfirmationTargetSchema.parse(target)).toEqual(target);
    expect(ConfirmationTargetSchema.parse({ ...target, activeChoiceIds: [] })).toMatchObject({
      kind: 'protected_mutation',
      activeChoiceIds: [],
    });
    expect(
      ConfirmationTargetSchema.safeParse({ ...target, activeChoiceIds: ['choice.1', 'choice.1'] })
        .success,
    ).toBe(false);
    expect(
      ConfirmationTargetSchema.safeParse({ ...target, activeChoiceIds: ['choice.2', 'choice.1'] })
        .success,
    ).toBe(false);
    const { dispatch: _dispatch, ...legacyTarget } = target;
    expect(ConfirmationTargetSchema.safeParse(legacyTarget).success).toBe(false);
    expect(
      ConfirmationTargetSchema.safeParse({
        ...target,
        dispatch: { ...target.dispatch, toolId: 'delivery.apply' },
      }).success,
    ).toBe(false);
    expect(
      ConfirmationTargetSchema.safeParse({
        ...target,
        dispatch: { ...target.dispatch, toolId: 'decision.record' },
      }).success,
    ).toBe(false);
    expect(
      ConfirmationTargetSchema.safeParse({
        ...target,
        plannedIds: { userChoiceId: 'choice.planned.1', projectEventId: 'event.planned.1' },
      }).success,
    ).toBe(false);
    expect(
      ConfirmationTargetSchema.safeParse({
        ...target,
        fields: [{ ...target.fields[0], objectId: 'shot.2' }],
      }).success,
    ).toBe(false);

    const productionPlannedIds = [
      {
        tool: 'production.mutate',
        variant: 'production_create',
        productionObjectId: 'production.planned.1',
        containmentRelationId: 'relation.planned.1',
        objectEventId: 'event.production-create.1',
        parentEventId: 'event.parent.1',
      },
      {
        tool: 'production.mutate',
        variant: 'production_update',
        objectEventId: 'event.production-update.1',
      },
      {
        tool: 'production.mutate',
        variant: 'production_relate_link',
        relationId: 'relation.planned.2',
        sourceEventId: 'event.source.1',
      },
      {
        tool: 'production.mutate',
        variant: 'production_relate_unlink',
        sourceEventId: 'event.source.2',
      },
      {
        tool: 'production.mutate',
        variant: 'production_reorder',
        parentEventId: 'event.parent.2',
      },
      {
        tool: 'production.mutate',
        variant: 'production_archive',
        objectEventId: 'event.production-archive.1',
      },
      {
        tool: 'production.mutate',
        variant: 'production_restore',
        objectEventId: 'event.production-restore.1',
      },
      {
        tool: 'production.mutate',
        variant: 'production_cite',
        factSourceId: 'fact-source.planned.1',
        objectEventId: 'event.production-cite.1',
      },
    ] as const;
    for (const plannedIds of productionPlannedIds) {
      expect(ConfirmationTargetSchema.safeParse({ ...target, plannedIds }).success).toBe(true);
    }
    expect(
      ConfirmationTargetSchema.safeParse({
        ...target,
        plannedIds: { ...productionPlannedIds[1], extraId: 'extra.1' },
      }).success,
    ).toBe(false);

    expect(
      ConfirmationTargetSchema.safeParse({
        ...target,
        dispatch: { ...target.dispatch, toolId: 'decision.record', toolVersion: '1.0.0' },
        fields: [
          {
            owner: 'production' as const,
            objectId: shotRef.id,
            field: 'resultDecision' as const,
            resultId: generatedResultRef.id,
          },
        ],
        plannedIds: {
          tool: 'decision.record',
          userChoiceId: 'choice.planned.1',
          projectEventId: 'event.planned.1',
        },
      }).success,
    ).toBe(true);
    expect(
      ConfirmationTargetSchema.safeParse({
        ...target,
        dispatch: { ...target.dispatch, toolId: 'delivery.mutate', toolVersion: '1.0.0' },
        owner: deliveryRef,
        fields: [
          {
            owner: 'delivery' as const,
            deliveryId: deliveryRef.id,
            itemId: null,
            field: 'name' as const,
          },
        ],
        plannedIds: {
          tool: 'delivery.mutate',
          userChoiceId: 'choice.delivery.1',
          projectEventId: 'event.delivery.1',
          deliveryPlanId: null,
          deliveryItemId: null,
        },
      }).success,
    ).toBe(true);
  });

  it('binds Skill registration confirmation to one Project and one reviewed Project Skill', () => {
    const target = {
      kind: 'skill_registration' as const,
      projectId: 'project.1',
      skill: {
        skillId: 'skill.project.1',
        name: 'Continuity reviewer',
        description: 'Review shots for visible continuity errors.',
        version: '1.0.0',
        contentHash: HASH_A,
        provenance: 'project' as const,
        trust: 'reviewed' as const,
        content: 'Check props, wardrobe, lighting, and screen direction.',
        createdAt: NOW,
      },
      expectedProjectSettingsRevision: 2,
      expectedProjectSettingsContentHash: HASH_B,
      proposedEffectHash: HASH_C,
    };

    expect(ConfirmationTargetSchema.parse(target)).toEqual(target);
    expect(
      ConfirmationTargetSchema.safeParse({
        ...target,
        skill: { ...target.skill, provenance: 'installed' },
      }).success,
    ).toBe(false);
    expect(
      ConfirmationTargetSchema.safeParse({
        ...target,
        skill: { ...target.skill, trust: 'unreviewed' },
      }).success,
    ).toBe(false);
    expect(
      ConfirmationTargetSchema.safeParse({
        ...target,
        skill: { ...target.skill, projectId: target.projectId },
      }).success,
    ).toBe(false);
  });

  it('rejects caller-supplied identity and authorization on Decision Wire and tool inputs', () => {
    const command = {
      action: 'select' as const,
      shot: shotRef,
      result: generatedResultRef,
      feedback: 'Use this take.',
    };
    for (const extra of [
      { actor: 'commander' },
      { authorization: choice.authorization },
      { confirmationId: 'confirmation.1' },
    ]) {
      expect(() =>
        TOOL_DEFINITION_BY_ID['decision.record'].parseInput({ ...command, ...extra }),
      ).toThrow();
      expect(
        PUBLIC_WIRE_METHODS_V1['decision.record'].inputSchema.safeParse({ ...command, ...extra })
          .success,
      ).toBe(false);
    }
  });

  it('allows a Decision record without a current owner state and rejects invalid states', () => {
    const definition = TOOL_DEFINITION_BY_ID['decision.record'];
    const success = { ...definition.examples.success, currentState: null };

    expect(definition.parseSuccess(success)).toEqual(success);
    expect(() => definition.parseSuccess({ ...success, currentState: 'unknown' })).toThrow();
  });
});

describe('I2-G0 Delivery, manifest, and local operation contracts', () => {
  it('accepts semantic Delivery mutations and rejects full-plan or generic patch mutation', () => {
    const commands = [
      {
        action: 'create',
        project: { authority: 'project', id: 'project.1', revision: 1, contentHash: HASH_A },
        name: 'Master',
        formatIntent: formatIntent(),
      },
      {
        action: 'updateSettings',
        plan: deliveryRef,
        name: 'Master v2',
        formatIntent: formatIntent(),
      },
      {
        action: 'place',
        plan: deliveryRef,
        shot: shotRef,
        result: generatedResultRef,
        order: 0,
        trim: { startMs: 0, endMs: 5_000 },
        audioPolicy: 'use',
        transition: { kind: 'cut', durationMs: 0 },
      },
      { action: 'remove', plan: deliveryRef, item: itemRef },
      { action: 'reorder', plan: deliveryRef, orderedItems: [itemRef] },
      { action: 'trim', plan: deliveryRef, item: itemRef, value: { startMs: 250, endMs: 4_750 } },
      {
        action: 'transition',
        plan: deliveryRef,
        item: itemRef,
        value: { kind: 'crossfade', durationMs: 250 },
      },
      { action: 'audioPolicy', plan: deliveryRef, item: itemRef, value: 'mute' },
      { action: 'reviewState', plan: deliveryRef, item: itemRef, value: 'approved' },
      { action: 'archive', plan: deliveryRef },
      { action: 'restore', plan: deliveryRef },
    ];
    for (const command of commands)
      expect(DeliveryMutationCommandSchema.safeParse(command).success).toBe(true);
    expect(
      DeliveryMutationCommandSchema.safeParse({
        action: 'patch',
        plan: deliveryRef,
        path: '/name',
        value: 'x',
      }).success,
    ).toBe(false);
    expect(
      DeliveryMutationCommandSchema.safeParse({
        action: 'updateSettings',
        plan: deliveryRef,
        value: { authority: 'delivery' },
      }).success,
    ).toBe(false);
    expect(() => TOOL_DEFINITION_BY_ID['delivery.mutate'].parseInput(commands[2])).not.toThrow();
    expect(
      PUBLIC_WIRE_METHODS_V1['delivery.apply'].inputSchema.safeParse(commands[2]).success,
    ).toBe(true);
  });

  it('requires a complete immutable manifest, choice/protection hashes, and quality', () => {
    const value = manifest();
    expect(DeliveryManifestSchema.safeParse(value).success).toBe(true);
    for (const key of [
      'deliveryItemContentHash',
      'shotContentHash',
      'generatedResultContentHash',
      'projectMediaContentHash',
      'globalAssetContentHash',
      'blobHash',
    ] as const) {
      const item = { ...value.items[0] } as Record<string, unknown>;
      delete item[key];
      expect(DeliveryManifestSchema.safeParse({ ...value, items: [item] }).success, key).toBe(
        false,
      );
    }
    expect(
      DeliveryManifestSchema.safeParse({
        ...value,
        currentChoices: [
          { ...value.currentChoices[0], choice: { authority: 'user_choice', id: 'choice.1' } },
        ],
      }).success,
    ).toBe(false);
    expect(
      DeliveryManifestSchema.safeParse({
        ...value,
        formatIntent: { ...value.formatIntent, quality: undefined },
      }).success,
    ).toBe(false);
  });

  it('keeps Preview, Review Cut, and Export strictly local with no path or capability token', () => {
    expect(DeliveryPreviewRequestSchema.safeParse({ plan: deliveryRef, range: null }).success).toBe(
      true,
    );
    expect(
      DeliveryPreviewRequestSchema.safeParse({
        plan: deliveryRef,
        range: null,
        execution: { kind: 'provider', providerId: 'provider.1', model: 'video-model' },
      }).success,
    ).toBe(false);

    const review = {
      ...localAttemptBase(),
      authority: 'review_cut_attempt' as const,
      id: 'review.1',
      projectId: 'project.1',
      runId: 'run.1',
      manifest: {
        authority: 'delivery_manifest' as const,
        id: 'manifest.1',
        revision: 0 as const,
        contentHash: HASH_A,
      },
      request: {
        manifest: {
          authority: 'delivery_manifest' as const,
          id: 'manifest.1',
          revision: 0 as const,
          contentHash: HASH_A,
        },
        range: null,
      },
      requestHash: HASH_B,
      idempotencyKey: HASH_C,
      outputBlobHash: null,
    };
    expect(ReviewCutAttemptSchema.safeParse(review).success).toBe(true);
    expect(
      ReviewCutAttemptSchema.safeParse({ ...review, ...localAttemptBase('submitted') }).success,
    ).toBe(false);
    expect(
      ReviewCutAttemptSchema.safeParse({ ...review, ...localAttemptBase('unknown') }).success,
    ).toBe(false);
    expect(
      ReviewCutAttemptSchema.safeParse({
        ...review,
        provider: { providerId: 'p', model: 'm', reasoningStrength: null },
      }).success,
    ).toBe(false);

    const exported = {
      ...localAttemptBase(),
      authority: 'delivery_export' as const,
      id: 'export.1',
      projectId: 'project.1',
      runId: 'run.1',
      manifest: {
        authority: 'delivery_manifest' as const,
        id: 'manifest.1',
        revision: 0 as const,
        contentHash: HASH_A,
      },
      destination: {
        kind: 'user_selected_file' as const,
        grantId: 'grant.1',
        grantHash: HASH_B,
        displayLabel: 'movie.mp4',
      },
      overwriteExisting: false,
      requestHash: HASH_C,
      idempotencyKey: HASH_D,
      outputBlobHash: null,
      outputContentHash: null,
    };
    expect(DeliveryExportSchema.safeParse(exported).success).toBe(true);
    expect(
      DeliveryExportSchema.safeParse({
        ...exported,
        destination: { ...exported.destination, capabilityToken: 'secret-token' },
      }).success,
    ).toBe(false);
    expect(
      DeliveryExportSchema.safeParse({
        ...exported,
        destination: { ...exported.destination, displayLabel: 'C:\\movie.mp4' },
      }).success,
    ).toBe(false);
    expect(
      DeliveryExportSchema.safeParse({
        ...exported,
        provider: { providerId: 'p', model: 'm', reasoningStrength: null },
      }).success,
    ).toBe(false);
  });
});

describe('I2-G0 search, history, tool-count, and TaskList boundaries', () => {
  it('adds strictly bound Review Cut and Delivery Export search sources', () => {
    for (const [kind, authority] of [
      ['review_cut', 'review_cut_attempt'],
      ['delivery_export', 'delivery_export'],
    ] as const) {
      const source = {
        kind,
        ref: { authority, id: `${kind}.1`, revision: 1, contentHash: HASH_A },
      };
      expect(ProjectSearchSourceV1Schema.safeParse(source).success).toBe(true);
      expect(
        ProjectSearchSourceV1Schema.safeParse({
          ...source,
          ref: { ...source.ref, authority: 'generated_result' },
        }).success,
      ).toBe(false);
    }
  });

  it('keeps history as canonical row references and the catalog at exactly 40 IDs', () => {
    expect(
      UserChoiceHistoryEntryViewSchema.safeParse({
        projectId: 'project.1',
        source: 'user_choice',
        choiceId: 'choice.1',
        actor: 'user',
        subject: {
          kind: 'result_decision',
          shotId: shotRef.id,
          resultIds: [generatedResultRef.id],
        },
        causation: { kind: 'message', messageId: 'message.1' },
        occurredAt: NOW,
        summary: 'Selected result.1',
      }).success,
    ).toBe(true);
    expect(EXACT_TOOL_IDS).toHaveLength(40);
  });

  it('contains no TaskList field or guard in Choice and Delivery public inputs', () => {
    const serialized = JSON.stringify({
      decision: TOOL_DEFINITION_BY_ID['decision.record'].inputSchema,
      protect: TOOL_DEFINITION_BY_ID['decision.protect'].inputSchema,
      delivery: TOOL_DEFINITION_BY_ID['delivery.mutate'].inputSchema,
      wireDecision: PUBLIC_WIRE_METHODS_V1['decision.record'].inputSchema,
      wireDelivery: PUBLIC_WIRE_METHODS_V1['delivery.apply'].inputSchema,
    });
    expect(serialized.toLowerCase()).not.toContain('tasklist');
    expect(serialized.toLowerCase()).not.toContain('task_list');
  });
});
