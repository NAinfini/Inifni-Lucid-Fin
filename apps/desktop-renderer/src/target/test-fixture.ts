import { vi } from 'vitest';
import type {
  CanvasDocument,
  Chat,
  Message,
  Project,
  ProjectMediaRef,
  ProjectSettings,
  PublicRunEvent,
  Run,
  TargetDesktopApiV1,
  TargetDesktopCallV1,
  TargetDesktopResponseV1,
  WireSuccessV1,
} from '@lucid-fin/target-contracts';
import type { TargetResult } from './api.js';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);
const NOW = '2026-08-24T16:00:00.000Z';

const budget = {
  costUsd: { state: 'known' as const, value: '12.4', currency: 'USD' },
  maxGenerationCount: 40,
  maxInputTokens: 200_000,
  maxOutputTokens: 40_000,
};

export const targetProjectFixture: Project = {
  authority: 'project',
  id: 'project.blue-hour',
  name: 'Blue Hour',
  lifecycle: 'active',
  schemaRevision: 1,
  revision: 2,
  contentHash: HASH_A,
  createdBy: { kind: 'direct_ui', actionId: 'fixture.create' },
  createdAt: NOW,
  updatedAt: NOW,
  archivedAt: null,
  deletedAt: null,
};

export const targetSettingsFixture: ProjectSettings = {
  authority: 'project_settings',
  projectId: targetProjectFixture.id,
  revision: 1,
  contentHash: HASH_B,
  defaultProviderProfileId: 'provider.lucid',
  formatPolicy: { aspectRatio: '16:9', customDimensions: null, frameRate: 24 },
  permission: 'reversible',
  budget,
  enabledSkills: [{ id: 'skill.cinematography', version: '1.0.0' }],
  updatedAt: NOW,
};

export const targetChatFixture: Chat = {
  authority: 'chat',
  id: 'chat.opening-direction',
  projectId: targetProjectFixture.id,
  revision: 1,
  contentHash: HASH_C,
  title: 'Opening direction',
  lifecycle: 'active',
  messageCount: 1,
  messageHeadSequence: 1,
  createdAt: NOW,
  updatedAt: NOW,
  archivedAt: null,
  deletedAt: null,
};

export const targetRunFixture: Run = {
  authority: 'run',
  id: 'run.opening-direction',
  revision: 1,
  contentHash: HASH_A,
  rootRunId: 'run.opening-direction',
  retryOfRunId: null,
  retrySeedHash: null,
  parentRunId: null,
  projectId: targetProjectFixture.id,
  chatId: targetChatFixture.id,
  status: 'running',
  model: { providerId: 'provider.lucid', model: 'Lucid 1.0', reasoningStrength: null },
  permissionMode: 'reversible',
  budget,
  contextManifestId: 'context.opening-direction',
  contextManifestHash: HASH_B,
  capabilityCatalogSnapshotId: 'catalog.target',
  capabilityCatalogHash: HASH_C,
  publicEventHead: { sequence: 1, hash: HASH_A },
  privateRecoveryHead: null,
  acceptedAt: NOW,
  acceptedSource: { kind: 'message', messageId: 'message.opening', contentHash: HASH_C },
  terminalOutcome: null,
};

export const targetMessagesFixture: Message[] = [
  {
    authority: 'message',
    id: 'message.opening',
    projectId: targetProjectFixture.id,
    chatId: targetChatFixture.id,
    sequence: 1,
    role: 'user',
    status: 'accepted',
    blocks: [
      {
        type: 'text',
        text: 'Explore opening direction options for Shot 04. Keep the tone moody and grounded.',
      },
    ],
    attachments: [],
    supersedesMessageId: null,
    originatingRunId: null,
    contentHash: HASH_C,
    createdAt: NOW,
  },
];

export const targetRunEventsFixture: PublicRunEvent[] = [
  {
    visibility: 'public',
    eventId: 'event.progress.1',
    eventVersion: 1,
    runId: targetRunFixture.id,
    sequence: 1,
    occurredAt: NOW,
    actor: 'commander',
    causation: { kind: 'run', runId: targetRunFixture.id },
    correlationId: null,
    idempotencyKey: null,
    payloadHash: HASH_B,
    previousEventHash: null,
    eventHash: HASH_A,
    payloadState: {
      state: 'available',
      payload: { type: 'progress', summary: 'Generating four opening-direction candidates.' },
    },
  },
];

export const targetCanvasFixture: CanvasDocument = {
  authority: 'canvas',
  id: 'canvas.blue-hour',
  projectId: targetProjectFixture.id,
  revision: 1,
  contentHash: HASH_A,
  placements: [
    {
      id: 'placement.shot-04',
      target: {
        targetType: 'production',
        targetId: 'shot.04',
        targetRevision: 3,
        targetContentHash: HASH_B,
      },
      position: { x: 120, y: 90 },
      size: { width: 260, height: 150 },
      zIndex: 1,
      revision: 0,
      createdAt: NOW,
      updatedAt: NOW,
    },
  ],
  groups: [],
  edges: [],
  annotations: [],
  viewport: { center: { x: 0, y: 0 }, zoom: 1 },
  savedViews: [],
  nextZIndex: 2,
  createdAt: NOW,
  updatedAt: NOW,
};

export const targetMediaFixture: ProjectMediaRef = {
  authority: 'project_media_ref',
  id: 'media.harbor-reference',
  projectId: targetProjectFixture.id,
  globalAssetId: 'asset.harbor-reference',
  revision: 1,
  contentHash: HASH_B,
  lifecycle: 'active',
  detachedAt: null,
  label: 'Harbor reference',
  collections: ['Opening'],
  roles: ['reference'],
  notes: 'Night harbor reference.',
  productionLinks: [{ productionObjectId: 'shot.04', relation: 'references' }],
  createdBy: { kind: 'direct_ui', actionId: 'fixture.attach' },
  createdAt: NOW,
  updatedAt: NOW,
};

export type TargetApiFixture = ReturnType<typeof createTargetApiFixture>;

function ok<Method extends keyof ApiInputs>(
  method: Method,
  request: ApiInputs[Method],
  result: TargetResult<Method>,
): TargetDesktopResponseV1<Method> {
  return {
    wireVersion: 1,
    kind: 'success',
    requestId: request.requestId,
    method,
    result,
  } as Extract<WireSuccessV1, { method: Method }>;
}

type ApiInputs = {
  [Method in import('@lucid-fin/target-contracts').PublicWireMethodV1]: TargetDesktopCallV1<Method>;
};

export function createTargetApiFixture() {
  const listeners = new Set<(push: import('@lucid-fin/target-contracts').WirePushV1) => void>();
  const calls = {
    projectList: vi.fn(async (request: ApiInputs['project.list']) =>
      ok('project.list', request, {
        items: [
          {
            id: targetProjectFixture.id,
            name: targetProjectFixture.name,
            lifecycle: targetProjectFixture.lifecycle,
            revision: targetProjectFixture.revision,
            contentHash: targetProjectFixture.contentHash,
            updatedAt: targetProjectFixture.updatedAt,
          },
        ],
        nextCursor: null,
      }),
    ),
    projectCreate: vi.fn(async (request: ApiInputs['project.create']) =>
      ok('project.create', request, {
        project: targetProjectFixture,
        settings: targetSettingsFixture,
      }),
    ),
    projectGet: vi.fn(async (request: ApiInputs['project.get']) =>
      ok('project.get', request, targetProjectFixture),
    ),
    projectUpdate: vi.fn(async (request: ApiInputs['project.update']) =>
      ok('project.update', request, {
        ...targetProjectFixture,
        name: request.input.name ?? targetProjectFixture.name,
        lifecycle: request.input.lifecycle ?? targetProjectFixture.lifecycle,
        revision: targetProjectFixture.revision + 1,
      }),
    ),
    settingsGet: vi.fn(async (request: ApiInputs['project.settings.get']) =>
      ok('project.settings.get', request, targetSettingsFixture),
    ),
    settingsUpdate: vi.fn(async (request: ApiInputs['project.settings.update']) =>
      ok('project.settings.update', request, {
        ...targetSettingsFixture,
        revision: targetSettingsFixture.revision + 1,
        permission: request.input.permission,
        budget: request.input.budget,
        formatPolicy: request.input.formatPolicy,
        defaultProviderProfileId: request.input.defaultProviderProfileId,
        enabledSkills: request.input.enabledSkills,
      }),
    ),
    overviewGet: vi.fn(async (request: ApiInputs['overview.get']) =>
      ok('overview.get', request, {
        project: targetProjectFixture,
        activeRuns: [targetRunFixture],
        taskLists: [
          {
            authority: 'task_list',
            id: 'tasks.opening',
            runId: targetRunFixture.id,
            title: 'Create opening direction',
            state: 'active',
            revision: 1,
            contentHash: HASH_C,
            items: [
              {
                id: 'task.references',
                title: 'Read references',
                state: 'completed',
                order: 0,
                parentItemId: null,
                childRunIds: [],
                publicNote: '',
              },
              {
                id: 'task.generate',
                title: 'Generate four candidates',
                state: 'in_progress',
                order: 1,
                parentItemId: null,
                childRunIds: [],
                publicNote: 'Waiting for provider',
              },
            ],
            createdAt: NOW,
            updatedAt: NOW,
            terminalizedAt: null,
          },
        ],
        counts: { chats: 1, deliveryPlans: 0, media: 1, productionObjects: 2 },
      }),
    ),
    chatList: vi.fn(async (request: ApiInputs['chat.list']) =>
      ok('chat.list', request, { items: [targetChatFixture], nextCursor: null }),
    ),
    chatCreate: vi.fn(async (request: ApiInputs['chat.create']) =>
      ok('chat.create', request, targetChatFixture),
    ),
    messageList: vi.fn(async (request: ApiInputs['message.list']) =>
      ok('message.list', request, { items: targetMessagesFixture, nextCursor: null }),
    ),
    messageSend: vi.fn(async (request: ApiInputs['message.send']) =>
      ok('message.send', request, {
        message: targetMessagesFixture[0] as Extract<Message, { role: 'user' }>,
        acceptedRun: targetRunFixture,
      }),
    ),
    runGet: vi.fn(async (request: ApiInputs['run.get']) =>
      ok('run.get', request, targetRunFixture),
    ),
    runEventsList: vi.fn(async (request: ApiInputs['run.events.list']) =>
      ok('run.events.list', request, { items: targetRunEventsFixture, nextCursor: null }),
    ),
    runControl: vi.fn(async (request: ApiInputs['run.control']) =>
      ok('run.control', request, {
        ...targetRunFixture,
        revision: targetRunFixture.revision + 1,
        status: request.input.action === 'pause' ? 'paused' : 'running',
      } as Run),
    ),
    runSendFollowup: vi.fn(async (request: ApiInputs['run.sendFollowup']) =>
      ok('run.sendFollowup', request, {
        id: 'inbox.followup',
        runId: targetRunFixture.id,
        sequence: 1,
        actor: 'user',
        source: {
          kind: 'message',
          messageId: 'message.followup',
          contentHash: HASH_B,
        },
        state: 'queued',
        selectedContext: request.input.selectedContext,
        contentHash: HASH_B,
        createdAt: NOW,
      }),
    ),
    canvasGet: vi.fn(async (request: ApiInputs['canvas.get']) =>
      ok('canvas.get', request, targetCanvasFixture),
    ),
    mediaProjectList: vi.fn(async (request: ApiInputs['media.project.list']) =>
      ok('media.project.list', request, { items: [targetMediaFixture], nextCursor: null }),
    ),
    productionQuery: vi.fn(async (request: ApiInputs['production.query']) =>
      ok('production.query', request, {
        items: [
          {
            object: {
              authority: 'production',
              id: 'direction.main',
              projectId: targetProjectFixture.id,
              revision: 1,
              contentHash: HASH_A,
              lifecycle: 'active',
              type: 'direction',
              content: {
                summary: 'A grounded blue-hour harbor story.',
                visualLanguage: 'Cool blues, practical highlights, and reflective surfaces.',
                tone: 'Contemplative and observational.',
                constraints: ['Natural motion', 'No glossy futurism'],
              },
              relations: [],
              protections: [],
              createdBy: { kind: 'run', runId: targetRunFixture.id },
              updatedBy: { kind: 'run', runId: targetRunFixture.id },
              createdAt: NOW,
              updatedAt: NOW,
            },
            factSources: [],
          },
          {
            object: {
              authority: 'production',
              id: 'shot.04',
              projectId: targetProjectFixture.id,
              revision: 3,
              contentHash: HASH_B,
              lifecycle: 'active',
              type: 'shot',
              content: {
                title: 'Shot 04 · Harbor arrival',
                description: 'A patient approach across the water toward the city lights.',
                durationMs: 8000,
                shotSize: 'wide',
                cameraMovement: 'dolly',
              },
              relations: [],
              protections: [],
              resultDecisions: [],
              createdBy: { kind: 'run', runId: targetRunFixture.id },
              updatedBy: { kind: 'run', runId: targetRunFixture.id },
              createdAt: NOW,
              updatedAt: NOW,
            },
            factSources: [],
          },
        ],
        nextCursor: null,
      }),
    ),
    deliveryQuery: vi.fn(async (request: ApiInputs['delivery.query']) =>
      ok('delivery.query', request, {
        plans: [],
        manifests: [],
        operations: [],
        nextCursor: null,
      }),
    ),
    confirmationRespond: vi.fn(async (request: ApiInputs['confirmation.respond']) =>
      ok('confirmation.respond', request, {
        confirmationId: request.input.confirmationId,
        messageId: 'message.confirmation',
        decision: request.input.decision,
        effect: null,
      }),
    ),
    interactionAnswer: vi.fn(async (request: ApiInputs['interaction.answer']) =>
      ok('interaction.answer', request, {
        interactionId: request.input.interactionId,
        messageId: 'message.answer',
        state: 'answered',
      }),
    ),
  };

  const unavailable = async () => {
    throw new Error('Unexpected target API call in fixture');
  };
  const api = {
    project: {
      list: calls.projectList,
      create: calls.projectCreate,
      get: calls.projectGet,
      update: calls.projectUpdate,
      settingsGet: calls.settingsGet,
      settingsUpdate: calls.settingsUpdate,
    },
    overview: { get: calls.overviewGet },
    chat: {
      list: calls.chatList,
      create: calls.chatCreate,
      rename: unavailable,
      archive: unavailable,
      delete: unavailable,
    },
    message: { list: calls.messageList, send: calls.messageSend },
    run: {
      get: calls.runGet,
      eventsList: calls.runEventsList,
      control: calls.runControl,
      sendFollowup: calls.runSendFollowup,
      onEventsAppended: (
        listener: (push: import('@lucid-fin/target-contracts').WirePushV1) => void,
      ) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    canvas: { get: calls.canvasGet, apply: unavailable },
    media: {
      projectList: calls.mediaProjectList,
      globalList: unavailable,
      globalImport: unavailable,
      globalRemove: unavailable,
      projectAttach: unavailable,
      projectDetach: unavailable,
      projectLink: unavailable,
    },
    production: { query: calls.productionQuery, apply: unavailable },
    delivery: { query: calls.deliveryQuery, apply: unavailable },
    confirmation: { respond: calls.confirmationRespond },
    interaction: { answer: calls.interactionAnswer },
    decision: { record: unavailable, protect: unavailable },
    operation: { get: unavailable, cancel: unavailable },
    os: { mediaPick: unavailable, exportPick: unavailable },
  } as unknown as TargetDesktopApiV1;

  return { api, calls, listeners };
}
