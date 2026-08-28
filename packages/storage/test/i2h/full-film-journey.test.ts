import { rm } from 'node:fs/promises';
import {
  canonicalJson,
  generationPromptAssemblyHashInput,
  type DeliveryRef,
  type GenerationSpec,
} from '@lucid-fin/contracts';
import { openStore, type DataAccess, type Store } from '@lucid-fin/storage';
import { createHostCatalogProvisioning } from '@lucid-fin/storage/host';
import { describe, expect, it } from 'vitest';
import {
  IMPORT_TOKEN,
  NOW,
  PROVIDER_ID,
  PROVIDER_MODEL,
  ROOT_CATALOG,
  budget,
  callCounts,
  commanderContext,
  createJourneyDataAccess,
  createJourneyFixture,
  formatPolicy,
  hashCanonical,
  memoryIndex,
  seedApprovedExportConfirmation,
  sha256,
  userContext,
} from './fixture.js';

function productionRef(object: { id: string; revision: number; contentHash: string }) {
  return {
    authority: 'production' as const,
    id: object.id,
    revision: object.revision,
    contentHash: object.contentHash,
  };
}

function deliveryRef(object: { id: string; revision: number; contentHash: string }): DeliveryRef {
  return {
    authority: 'delivery',
    id: object.id,
    revision: object.revision,
    contentHash: object.contentHash,
  };
}

function readSnapshot(
  data: DataAccess,
  ids: {
    projectId: string;
    chatId: string;
    runId: string;
    productionIds: readonly string[];
    planId: string;
    manifestId: string;
    choiceIds: readonly string[];
    operationRefs: readonly Parameters<
      DataAccess['operations']['get']
    >[0]['input']['operations'][number][];
  },
) {
  const project = data.projects.get({
    wireVersion: 1,
    kind: 'request',
    requestId: 'read.project.i2h',
    method: 'project.get',
    input: { projectId: ids.projectId },
  }).result;
  const settings = data.projects.getSettings({
    wireVersion: 1,
    kind: 'request',
    requestId: 'read.settings.i2h',
    method: 'project.settings.get',
    input: { projectId: ids.projectId },
  }).result;
  const chats = data.conversations.listChats({
    wireVersion: 1,
    kind: 'request',
    requestId: 'read.chats.i2h',
    method: 'chat.list',
    input: {
      projectId: ids.projectId,
      lifecycle: ['active', 'archived', 'deleted'],
      page: { cursor: null, limit: 100 },
    },
  }).result;
  const messages = data.conversations.listMessages({
    wireVersion: 1,
    kind: 'request',
    requestId: 'read.messages.i2h',
    method: 'message.list',
    input: { chatId: ids.chatId, beforeSequence: null, page: { cursor: null, limit: 100 } },
  }).result;
  const production = data.production.query({
    wireVersion: 1,
    kind: 'request',
    requestId: 'read.production.i2h',
    method: 'production.query',
    input: {
      projectId: ids.projectId,
      ids: [...ids.productionIds],
      types: [],
      includeArchived: true,
      includeFactSources: true,
      page: { cursor: null, limit: 100 },
    },
  }).result;
  const canvas = data.canvas.get({
    wireVersion: 1,
    kind: 'request',
    requestId: 'read.canvas.i2h',
    method: 'canvas.get',
    input: { projectId: ids.projectId },
  }).result;
  const globalMedia = data.globalMedia.listGlobal({
    wireVersion: 1,
    kind: 'request',
    requestId: 'read.global-media.i2h',
    method: 'media.global.list',
    input: { kinds: [], query: '', page: { cursor: null, limit: 100 } },
  }).result;
  const projectMedia = data.projectMedia.list({
    wireVersion: 1,
    kind: 'request',
    requestId: 'read.project-media.i2h',
    method: 'media.project.list',
    input: {
      projectId: ids.projectId,
      roles: [],
      query: '',
      page: { cursor: null, limit: 100 },
    },
  }).result;
  const results = data.results.query(ids.projectId, {
    resultIds: [],
    requestIds: [],
    targetRefs: [],
    include: ['artifact', 'prompt', 'references', 'provider', 'assessments'],
    page: { cursor: null, limit: 100 },
  });
  const delivery = data.delivery.query({
    wireVersion: 1,
    kind: 'request',
    requestId: 'read.delivery.i2h',
    method: 'delivery.query',
    input: {
      projectId: ids.projectId,
      deliveryPlanIds: [ids.planId],
      page: { cursor: null, limit: 100 },
    },
  }).result;
  const operations = data.operations.get({
    wireVersion: 1,
    kind: 'request',
    requestId: 'read.operations.i2h',
    method: 'operation.get',
    input: { operations: [...ids.operationRefs] },
  }).result;
  const run = data.runs.get({
    wireVersion: 1,
    kind: 'request',
    requestId: 'read.run.i2h',
    method: 'run.get',
    input: { runId: ids.runId },
  }).result;
  const runEvents = data.runs.listPublicEvents({
    wireVersion: 1,
    kind: 'request',
    requestId: 'read.run-events.i2h',
    method: 'run.events.list',
    input: { runId: ids.runId, afterSequence: null, page: { cursor: null, limit: 100 } },
  }).result;
  const history = data.history.query(ids.projectId, {
    sources: [],
    eventTypes: [],
    subjects: [],
    actors: [],
    time: { from: null, to: null },
    page: { cursor: null, limit: 100 },
  });
  const search = ['harbor', 'Review Cut', 'final review'].map((query) =>
    data.search.query(ids.projectId, {
      query,
      kinds: [],
      state: 'any',
      page: { cursor: null, limit: 100 },
    }),
  );
  const memory = {
    head: data.memory.getHead(ids.projectId),
    query: data.memory.query(ids.projectId, {
      query: 'selected harbor',
      categories: ['decision'],
      itemKeys: [],
      limit: 20,
    }),
  };
  return {
    project,
    settings,
    chats,
    messages,
    production,
    canvas,
    globalMedia,
    projectMedia,
    results,
    delivery,
    manifest: data.delivery.getManifest(ids.manifestId),
    operations,
    run,
    runEvents,
    taskList: data.taskLists.get(ids.runId),
    choices: ids.choiceIds.map((choiceId) => data.userChoices.getChoice(choiceId)),
    history,
    historyWatermark: data.history.getWatermark(ids.projectId),
    search,
    memory,
    replay: data.runReplay.get(ids.runId),
    recoveryCandidates: data.runReplay.listRecoveryCandidates(ids.projectId),
  };
}

describe('I2-H1 full film composition journey', () => {
  it('survives close/reopen and exact replay without duplicated authority evidence or side effects', async () => {
    const fixture = await createJourneyFixture();
    let activeStore: Store = fixture.store;
    try {
      let data = fixture.data;
      let host = createHostCatalogProvisioning(activeStore, { now: () => NOW });
      const providerSeed = {
        id: PROVIDER_ID,
        displayName: 'I2-H Film Provider',
        providerKind: 'fake-video',
        model: PROVIDER_MODEL,
        status: 'ready' as const,
      };
      const skillContent = 'Preserve identity, screen direction, lighting, and shot continuity.';
      const skill = {
        skillId: 'skill.film-continuity',
        version: '1.0.0',
        name: 'Film continuity',
        description: 'Checks continuity across generated shots.',
        content: skillContent,
        contentHash: sha256(skillContent),
        provenance: 'built_in' as const,
        trust: 'trusted' as const,
        createdAt: NOW,
      };
      expect(host.registerProviderProfile(providerSeed)).toEqual(providerSeed);
      expect(host.registerSkill({ document: skill, projectId: null })).toMatchObject({
        status: 'inserted',
        document: skill,
        projectId: null,
      });
      const projectRequest = {
        wireVersion: 1 as const,
        kind: 'request' as const,
        requestId: 'request.i2h.project.create',
        method: 'project.create' as const,
        input: {
          name: 'Harbor at Midnight',
          permissionMode: 'reversible' as const,
          budget,
          formatPolicy,
        },
      };
      const createdProject = data.projects.create(projectRequest, userContext);
      const project = createdProject.result.project;
      const initialSettings = createdProject.result.settings;
      const settingsRequest = {
        wireVersion: 1 as const,
        kind: 'request' as const,
        requestId: 'request.i2h.settings.update',
        method: 'project.settings.update' as const,
        input: {
          projectId: project.id,
          expectedRevision: initialSettings.revision,
          expectedContentHash: initialSettings.contentHash,
          defaultProviderProfileId: PROVIDER_ID,
          formatPolicy,
          permission: 'reversible' as const,
          budget,
          enabledSkills: [{ id: skill.skillId, version: skill.version }],
        },
      };
      const updatedSettings = data.projects.updateSettings(settingsRequest, userContext);
      const chatRequest = {
        wireVersion: 1 as const,
        kind: 'request' as const,
        requestId: 'request.i2h.chat.create',
        method: 'chat.create' as const,
        input: { projectId: project.id, title: 'Harbor production' },
      };
      const createdChat = data.conversations.createChat(chatRequest, userContext);
      const messageRequest = {
        wireVersion: 1 as const,
        kind: 'request' as const,
        requestId: 'request.i2h.message.send',
        method: 'message.send' as const,
        input: {
          chatId: createdChat.result.id,
          blocks: [
            {
              type: 'text' as const,
              text: 'Create a rain-soaked midnight harbor sequence and deliver a review cut.',
            },
          ],
          attachments: [],
          selectedContext: [
            {
              ref: {
                authority: 'project' as const,
                id: project.id,
                revision: project.revision,
                contentHash: project.contentHash,
              },
              role: 'target' as const,
            },
          ],
          exportDestinationGrant: null,
          supersedesMessageId: null,
        },
      };
      const messageSeed = {
        model: { providerId: PROVIDER_ID, model: PROVIDER_MODEL, reasoningStrength: null },
        locale: 'en-US',
        timeZone: 'America/New_York',
        capabilityCatalog: ROOT_CATALOG,
        projectMediaSelections: [],
        citedMemoryEntryIds: [],
      };
      const sentMessage = data.conversations.sendMessage(messageRequest, userContext, messageSeed);
      const run = sentMessage.result.acceptedRun;
      const commander = commanderContext(run.id);
      expect(data.taskLists.get(run.id)).toBeNull();
      expect(data.runReplay.get(run.id).catalog.tools).toHaveLength(40);

      const storyRequest = {
        wireVersion: 1 as const,
        kind: 'request' as const,
        requestId: 'request.i2h.production.story',
        method: 'production.apply' as const,
        input: {
          action: 'create' as const,
          projectId: project.id,
          expectedProjectRevision: project.revision,
          value: {
            objectType: 'story' as const,
            content: {
              title: 'Harbor at Midnight',
              premise: 'A courier crosses a rain-soaked harbor.',
              synopsis: 'One continuous nocturnal passage through reflected cyan light.',
            },
          },
          relations: [],
        },
      };
      const story = data.production.apply(storyRequest, commander).result.object;
      const sceneRequest = {
        wireVersion: 1 as const,
        kind: 'request' as const,
        requestId: 'request.i2h.production.scene',
        method: 'production.apply' as const,
        input: {
          action: 'create' as const,
          projectId: project.id,
          expectedProjectRevision: project.revision,
          value: {
            objectType: 'scene' as const,
            content: {
              title: 'Midnight harbor arrival',
              summary: 'The courier enters through rain and sodium mist.',
            },
          },
          relations: [
            {
              relation: 'contains' as const,
              targetType: 'story' as const,
              targetId: story.id,
              ordinal: 0,
            },
          ],
        },
      };
      const scene = data.production.apply(sceneRequest, commander).result.object;
      const shotRequest = {
        wireVersion: 1 as const,
        kind: 'request' as const,
        requestId: 'request.i2h.production.shot',
        method: 'production.apply' as const,
        input: {
          action: 'create' as const,
          projectId: project.id,
          expectedProjectRevision: project.revision,
          value: {
            objectType: 'shot' as const,
            content: {
              title: 'Harbor tracking shot',
              description: 'A wide lateral move follows the courier through reflected rain.',
              durationMs: 8_000,
              shotSize: 'wide' as const,
              cameraMovement: 'dolly' as const,
            },
          },
          relations: [
            {
              relation: 'contains' as const,
              targetType: 'scene' as const,
              targetId: scene.id,
              ordinal: 0,
            },
          ],
        },
      };
      const shot = data.production.apply(shotRequest, commander).result.object;

      const emptyCanvas = data.canvas.get({
        wireVersion: 1,
        kind: 'request',
        requestId: 'request.i2h.canvas.get.initial',
        method: 'canvas.get',
        input: { projectId: project.id },
      }).result;
      const canvasRequest = {
        wireVersion: 1 as const,
        kind: 'request' as const,
        requestId: 'request.i2h.canvas.place',
        method: 'canvas.apply' as const,
        input: {
          projectId: project.id,
          expectedCanvasRevision: emptyCanvas.revision,
          command: {
            action: 'place' as const,
            target: { targetType: 'production' as const, targetId: shot.id },
            position: { x: 120, y: 80 },
            size: { width: 480, height: 270 },
            zIndex: 0,
          },
        },
      };
      const placedCanvas = data.canvas.apply(canvasRequest, commander);

      const importRequest = {
        wireVersion: 1 as const,
        kind: 'request' as const,
        requestId: 'request.i2h.media.import',
        method: 'media.global.import' as const,
        input: {
          capabilityToken: IMPORT_TOKEN,
          displayName: 'Harbor lighting reference',
          tags: ['harbor', 'lighting', 'reference'],
        },
      };
      const imported = await data.globalMedia.importGlobal(importRequest, userContext);
      const attachRequest = {
        wireVersion: 1 as const,
        kind: 'request' as const,
        requestId: 'request.i2h.media.attach',
        method: 'media.project.attach' as const,
        input: {
          projectId: project.id,
          expectedProjectRevision: project.revision,
          globalAssetId: imported.result.asset.id,
          expectedExistingRef: null,
          label: 'Harbor cyan-rain reference',
          collections: ['Visual direction'],
          roles: ['reference' as const],
          notes: 'Match reflections, rain density, and restrained cyan contrast.',
        },
      };
      const attached = data.projectMedia.attach(attachRequest, userContext);
      const linkRequest = {
        wireVersion: 1 as const,
        kind: 'request' as const,
        requestId: 'request.i2h.media.link',
        method: 'media.project.link' as const,
        input: {
          mode: 'link' as const,
          mediaRef: {
            authority: 'project_media_ref' as const,
            id: attached.result.object.id,
            revision: attached.result.object.revision,
            contentHash: attached.result.object.contentHash,
          },
          target: productionRef(shot),
          relation: 'references' as const,
        },
      };
      const linked = data.projectMedia.link(linkRequest, userContext);
      const deriveInput = {
        operation: 'resize' as const,
        source: { kind: 'project_media_ref' as const, id: linked.result.object.id },
        expectedSourceHash: imported.result.asset.blobHash,
        attach: { enabled: true as const, expectedProjectRevision: project.revision },
        outputIntents: [
          {
            ordinal: 0,
            globalAsset: {
              filename: 'harbor-reference-960.png',
              displayName: 'Harbor reference 960',
              folderId: null,
              tags: ['harbor', 'derived'],
            },
            projectMediaRef: {
              label: 'Harbor derived reference',
              collections: ['Visual direction'],
              roles: ['reference' as const],
              notes: 'Local working derivative.',
            },
          },
        ],
        width: 960,
        height: 540,
        fit: 'contain' as const,
      };
      const deriveStartInput = {
        runId: run.id,
        commandId: 'command.i2h.media.derive.start',
        input: deriveInput,
      };
      const deriveStarted = await data.mediaDerivations.start(deriveStartInput, commander);
      const deriveContinueInput = {
        dispatchOperationId: deriveStarted.operation.id,
        commandId: 'command.i2h.media.derive.continue',
      };
      const derived = await data.mediaDerivations.continue(deriveContinueInput, commander);
      expect(data.taskLists.get(run.id)).toBeNull();

      const spec: GenerationSpec = {
        kind: 'video',
        task: 'create',
        target: productionRef(shot),
        prompt: 'A cinematic midnight harbor tracking shot through rain and cyan reflections.',
        negativePrompt: 'daylight, dry pavement, handheld shake',
        references: [
          {
            source: { kind: 'project_media_ref', id: linked.result.object.id },
            expectedContentHash: linked.result.object.contentHash,
            role: 'style_reference',
            influence: 0.8,
          },
        ],
        provider: { providerId: PROVIDER_ID, model: PROVIDER_MODEL },
        outputCount: 2,
        seed: 17,
        width: 1_920,
        height: 1_080,
        durationMs: 8_000,
        frameRate: 24,
        includeAudio: true,
      };
      const generationQuote = await data.generation.quote({ runId: run.id, request: { spec } });
      const generationSubmitInput = {
        runId: run.id,
        commandId: 'command.i2h.generation.submit',
        request: {
          spec,
          quote: generationQuote.quote,
          expectedProjectRevision: project.revision,
          promptProvenance: {
            sourceObjectId: shot.id,
            sourceRevision: shot.revision,
            sourceHash: shot.contentHash,
            assemblyHash: hashCanonical(
              generationPromptAssemblyHashInput({
                target: spec.target,
                prompt: spec.prompt,
                negativePrompt: spec.negativePrompt,
                references: spec.references,
                loadedSkillDigests: [],
              }),
            ),
            loadedSkillDigests: [],
          },
          outputIntents: [0, 1].map((variantIndex) => ({
            variantIndex,
            globalAsset: {
              filename: `harbor-candidate-${variantIndex}.mp4`,
              displayName: `Harbor candidate ${variantIndex}`,
              folderId: null,
              tags: ['harbor', 'generated'],
            },
            projectMediaRef: {
              label: `Harbor candidate ${variantIndex}`,
              collections: ['Candidates'],
              roles: ['generated_candidate' as const],
              notes: '',
            },
          })),
        },
      };
      const generated = await data.generation.submit(generationSubmitInput, commander);
      expect(generated.state).toBe('succeeded');
      const generatedViews = data.results.query(project.id, {
        resultIds: [],
        requestIds: [],
        targetRefs: [],
        include: ['artifact', 'prompt', 'references', 'provider', 'assessments'],
        page: { cursor: null, limit: 100 },
      }).items;
      expect(generatedViews).toHaveLength(2);
      const generatedRefs = generatedViews.map(({ resultRef: ref }) => ref);

      const assessmentRequest = {
        kind: 'reference_similarity' as const,
        subjects: generatedRefs,
        references: [
          {
            authority: 'project_media_ref' as const,
            id: linked.result.object.id,
            revision: linked.result.object.revision,
            contentHash: linked.result.object.contentHash,
          },
        ],
        aspects: ['composition' as const, 'palette' as const, 'lighting' as const],
        provider: { providerId: PROVIDER_ID, model: PROVIDER_MODEL },
      };
      const assessmentStartInput = {
        runId: run.id,
        commandId: 'command.i2h.assessment.start',
        request: assessmentRequest,
      };
      const assessmentStarted = await data.resultAssessments.start(assessmentStartInput, commander);
      const assessmentSubmitInput = {
        operation: assessmentStarted.operation,
        expectedRevision: assessmentStarted.operation.revision,
        commandId: 'command.i2h.assessment.submit',
      };
      const assessment = await data.resultAssessments.submitProvider(
        assessmentSubmitInput,
        commander,
      );
      expect(assessment).toMatchObject({ state: 'succeeded' });

      const currentShot = data.production.get(shot.id).object;
      const selectRequest = {
        wireVersion: 1 as const,
        kind: 'request' as const,
        requestId: 'request.i2h.choice.select',
        method: 'decision.record' as const,
        input: {
          action: 'select' as const,
          shot: productionRef(currentShot),
          result: generatedRefs[0]!,
          feedback: 'Use this take for the harbor delivery.',
        },
      };
      const selected = data.userChoices.recordResultDecision(selectRequest, userContext);
      const selectedShot = data.production.get(shot.id).object;
      const protectionField = {
        owner: 'production' as const,
        objectId: shot.id,
        field: 'resultDecision' as const,
        resultId: generatedRefs[0]!.id,
      };
      const protectRequest = {
        wireVersion: 1 as const,
        kind: 'request' as const,
        requestId: 'request.i2h.choice.protect',
        method: 'decision.protect' as const,
        input: {
          mode: 'protect' as const,
          owner: productionRef(selectedShot),
          field: protectionField,
          reason: 'User-approved hero take.',
        },
      };
      const protectedChoice = data.userChoices.setProtection(protectRequest, userContext);

      const formatIntent = {
        container: 'mp4' as const,
        videoCodec: 'h264' as const,
        audioCodec: 'aac' as const,
        width: 1_920,
        height: 1_080,
        frameRate: 24,
        quality: 'review' as const,
      };
      const deliveryCreateRequest = {
        wireVersion: 1 as const,
        kind: 'request' as const,
        requestId: 'request.i2h.delivery.create',
        method: 'delivery.apply' as const,
        input: {
          action: 'create' as const,
          project: {
            authority: 'project' as const,
            id: project.id,
            revision: project.revision,
            contentHash: project.contentHash,
          },
          name: 'Harbor review cut',
          formatIntent,
        },
      };
      const deliveryCreated = data.delivery.apply(deliveryCreateRequest, userContext);
      const deliveryPlaceOneRequest = {
        wireVersion: 1 as const,
        kind: 'request' as const,
        requestId: 'request.i2h.delivery.place.1',
        method: 'delivery.apply' as const,
        input: {
          action: 'place' as const,
          plan: deliveryRef(deliveryCreated.result.plan),
          shot: productionRef(data.production.get(shot.id).object),
          result: generatedRefs[0]!,
          order: 0,
          trim: { startMs: 0, endMs: 8_000 },
          audioPolicy: 'use' as const,
          transition: { kind: 'cut' as const, durationMs: 0 },
        },
      };
      const deliveryPlacedOne = data.delivery.apply(deliveryPlaceOneRequest, userContext);
      const deliveryPlaceTwoRequest = {
        wireVersion: 1 as const,
        kind: 'request' as const,
        requestId: 'request.i2h.delivery.place.2',
        method: 'delivery.apply' as const,
        input: {
          ...deliveryPlaceOneRequest.input,
          plan: deliveryRef(deliveryPlacedOne.result.plan),
          result: generatedRefs[1]!,
          order: 1,
        },
      };
      const deliveryPlacedTwo = data.delivery.apply(deliveryPlaceTwoRequest, userContext);
      const deliverySettingsRequest = {
        wireVersion: 1 as const,
        kind: 'request' as const,
        requestId: 'request.i2h.delivery.settings',
        method: 'delivery.apply' as const,
        input: {
          action: 'updateSettings' as const,
          plan: deliveryRef(deliveryPlacedTwo.result.plan),
          name: 'Harbor final review',
          formatIntent: { ...formatIntent, quality: 'high' as const },
        },
      };
      const deliverySettings = data.delivery.apply(deliverySettingsRequest, userContext);
      const orderedItems = [...deliverySettings.result.plan.items]
        .filter(({ lifecycle }) => lifecycle === 'active')
        .sort((left, right) => right.order - left.order)
        .map(({ id, revision, contentHash }) => ({ id, revision, contentHash }));
      const deliveryReorderRequest = {
        wireVersion: 1 as const,
        kind: 'request' as const,
        requestId: 'request.i2h.delivery.reorder',
        method: 'delivery.apply' as const,
        input: {
          action: 'reorder' as const,
          plan: deliveryRef(deliverySettings.result.plan),
          orderedItems,
        },
      };
      const deliveryReordered = data.delivery.apply(deliveryReorderRequest, userContext);
      expect(data.taskLists.get(run.id)).toBeNull();
      const manifest = data.delivery.freeze(
        { plan: deliveryRef(deliveryReordered.result.plan) },
        commander,
      );

      const previewInput = {
        runId: run.id,
        commandId: 'command.i2h.delivery.preview',
        request: {
          plan: deliveryRef(deliveryReordered.result.plan),
          range: { startItem: 0, endItem: 1 },
        },
      };
      const review = await data.deliveryOperations.preview(previewInput, commander);
      const exportRequest = {
        manifest: {
          authority: 'delivery_manifest' as const,
          id: manifest.id,
          revision: 0 as const,
          contentHash: manifest.contentHash,
        },
        destination: {
          kind: 'user_selected_file' as const,
          grantId: 'destination.i2h.final',
          grantHash: hashCanonical({ grant: 'destination.i2h.final' }),
          displayLabel: 'harbor-final-review.mp4',
        },
        overwriteExisting: false,
      };
      const confirmationId = seedApprovedExportConfirmation(
        activeStore,
        run.id,
        manifest,
        exportRequest,
      );
      const exportInput = {
        runId: run.id,
        commandId: 'command.i2h.delivery.export',
        confirmationId,
        request: exportRequest,
      };
      const exported = await data.deliveryOperations.export(exportInput, commander);

      const historyWatermark = data.history.getWatermark(project.id);
      const memoryVersion = data.memory.recordVersion(
        memoryIndex(project.id, historyWatermark, [
          productionRef(data.production.get(shot.id).object),
          { choiceId: selected.result.id },
        ]),
      );
      data.memory.publishHead({
        projectId: project.id,
        memoryVersionId: memoryVersion.id,
        expectedHeadRevision: null,
        updatedAt: NOW,
      });

      const operationRefs = [
        derived.operation,
        generated.operation,
        assessment.operation,
        review.operation,
        exported.operation,
      ];
      const snapshotIds = {
        projectId: project.id,
        chatId: createdChat.result.id,
        runId: run.id,
        productionIds: [story.id, scene.id, shot.id],
        planId: deliveryReordered.result.plan.id,
        manifestId: manifest.id,
        choiceIds: [selected.result.id, protectedChoice.result.id],
        operationRefs,
      };
      const before = readSnapshot(data, snapshotIds);
      const beforeCalls = callCounts(fixture.dependencies);
      const searchKinds = new Set(
        before.search.flatMap(({ items }) => items.map(({ source }) => source.kind)),
      );
      expect(searchKinds).toEqual(
        new Set([
          'production',
          'project_media_ref',
          'message',
          'generated_result',
          'result_assessment',
          'delivery',
          'review_cut',
          'delivery_export',
        ]),
      );
      expect(new Set(before.history.items.map(({ source }) => source))).toEqual(
        new Set(['message', 'run_event', 'project_event', 'generated_result', 'user_choice']),
      );
      expect(before).toMatchObject({
        taskList: null,
        results: { items: [{ assessmentIds: [assessment.assessmentId] }, {}] },
        memory: { head: { state: 'ready' }, query: { state: 'ready' } },
        replay: { providerContinuation: { state: 'unavailable' } },
      });
      expect(before.replay.catalog.tools).toHaveLength(40);

      activeStore.close();
      const reopened = await openStore(fixture.databasePath);
      activeStore = reopened;
      data = createJourneyDataAccess(reopened, fixture.dependencies);
      host = createHostCatalogProvisioning(reopened, { now: () => NOW });
      expect(canonicalJson(readSnapshot(data, snapshotIds))).toBe(canonicalJson(before));

      expect(host.registerProviderProfile(providerSeed)).toEqual(providerSeed);
      expect(host.registerSkill({ document: skill, projectId: null })).toMatchObject({
        status: 'unchanged',
        document: skill,
        projectId: null,
      });
      expect(data.projects.create(projectRequest, userContext)).toEqual(createdProject);
      expect(data.projects.updateSettings(settingsRequest, userContext)).toEqual(updatedSettings);
      expect(data.conversations.createChat(chatRequest, userContext)).toEqual(createdChat);
      expect(data.conversations.sendMessage(messageRequest, userContext, messageSeed)).toEqual(
        sentMessage,
      );
      expect(data.production.apply(storyRequest, commander).result.object).toEqual(story);
      expect(data.production.apply(sceneRequest, commander).result.object).toEqual(scene);
      expect(data.production.apply(shotRequest, commander).result.object).toEqual(shot);
      expect(data.canvas.apply(canvasRequest, commander)).toEqual(placedCanvas);
      expect(await data.globalMedia.importGlobal(importRequest, userContext)).toEqual(imported);
      expect(data.projectMedia.attach(attachRequest, userContext)).toEqual(attached);
      expect(data.projectMedia.link(linkRequest, userContext)).toEqual(linked);
      expect(await data.mediaDerivations.start(deriveStartInput, commander)).toEqual(derived);
      expect(await data.mediaDerivations.continue(deriveContinueInput, commander)).toEqual(derived);
      expect(await data.generation.submit(generationSubmitInput, commander)).toEqual(generated);
      expect(await data.resultAssessments.start(assessmentStartInput, commander)).toEqual(
        assessment,
      );
      expect(await data.resultAssessments.submitProvider(assessmentSubmitInput, commander)).toEqual(
        assessment,
      );
      expect(data.userChoices.recordResultDecision(selectRequest, userContext)).toEqual(selected);
      expect(data.userChoices.setProtection(protectRequest, userContext)).toEqual(protectedChoice);
      expect(data.delivery.apply(deliveryCreateRequest, userContext)).toEqual(deliveryCreated);
      expect(data.delivery.apply(deliveryPlaceOneRequest, userContext)).toEqual(deliveryPlacedOne);
      expect(data.delivery.apply(deliveryPlaceTwoRequest, userContext)).toEqual(deliveryPlacedTwo);
      expect(data.delivery.apply(deliverySettingsRequest, userContext)).toEqual(deliverySettings);
      expect(data.delivery.apply(deliveryReorderRequest, userContext)).toEqual(deliveryReordered);
      expect(
        data.delivery.freeze({ plan: deliveryRef(deliveryReordered.result.plan) }, commander),
      ).toEqual(manifest);
      expect(await data.deliveryOperations.preview(previewInput, commander)).toEqual(review);
      expect(await data.deliveryOperations.export(exportInput, commander)).toEqual(exported);

      expect(callCounts(fixture.dependencies)).toEqual({
        ...beforeCalls,
        cas: { ...beforeCalls.cas, verifies: beforeCalls.cas.verifies + 2 },
      });
      expect(canonicalJson(readSnapshot(data, snapshotIds))).toBe(canonicalJson(before));
    } finally {
      activeStore.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 60_000);
});
