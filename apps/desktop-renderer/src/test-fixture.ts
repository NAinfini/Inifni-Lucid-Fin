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
  DesktopApiV1,
  DesktopCallV1,
  DesktopResponseV1,
  WireSuccessV1,
} from '@lucid-fin/contracts';
import type { WireResult } from './api.js';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);
const NOW = '2026-08-24T16:00:00.000Z';

export const exportGrantFixture = {
  destination: {
    kind: 'user_selected_file' as const,
    grantId: 'grant.export.blue-hour',
    grantHash: HASH_C,
    displayLabel: 'Blue Hour Review.mp4',
    projectId: 'project.blue-hour',
    deliveryPlan: {
      authority: 'delivery' as const,
      id: 'delivery.blue-hour',
      revision: 4,
      contentHash: HASH_A,
    },
    allowedExtensions: ['mp4'],
  },
  expiresAt: '2026-08-24T17:00:00.000Z',
};

export const deliveryPlanFixture = {
  authority: 'delivery' as const,
  id: exportGrantFixture.destination.deliveryPlan.id,
  projectId: exportGrantFixture.destination.projectId,
  revision: exportGrantFixture.destination.deliveryPlan.revision,
  contentHash: exportGrantFixture.destination.deliveryPlan.contentHash,
  name: 'Blue Hour Review',
  lifecycle: 'active' as const,
  formatIntent: {
    container: 'mp4' as const,
    videoCodec: 'h264' as const,
    audioCodec: 'aac' as const,
    width: 1920,
    height: 1080,
    frameRate: 24,
    quality: 'review' as const,
  },
  items: [],
  currentChoices: [],
  protections: [],
  createdAt: NOW,
  updatedAt: NOW,
} satisfies WireResult<'delivery.query'>['plans'][number];

export const deliveryOperationRefFixture = {
  id: 'operation.review.blue-hour',
  revision: 1,
  kind: 'review_cut_attempt' as const,
  ownerRef: {
    authority: 'review_cut_attempt' as const,
    id: 'review.blue-hour',
    revision: 1,
    contentHash: HASH_C,
  },
} satisfies WireResult<'delivery.query'>['operations'][number];

const budget = {
  costUsd: { state: 'known' as const, value: '12.4', currency: 'USD' },
  maxGenerationCount: 40,
  maxInputTokens: 200_000,
  maxOutputTokens: 40_000,
};

export const projectFixture: Project = {
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

export const settingsFixture: ProjectSettings = {
  authority: 'project_settings',
  projectId: projectFixture.id,
  revision: 1,
  contentHash: HASH_B,
  defaultProviderProfileId: 'provider.lucid',
  formatPolicy: { aspectRatio: '16:9', customDimensions: null, frameRate: 24 },
  permission: 'reversible',
  budget,
  enabledSkills: [{ id: 'skill.cinematography', version: '1.0.0' }],
  updatedAt: NOW,
};

export const pluginManifestFixture = {
  packageId: 'plugin.storyboard',
  version: '1.0.0',
  name: 'Storyboard review',
  description: 'Trusted storyboard review Skills.',
  manifestHash: HASH_C,
  skills: [
    {
      skillId: 'skill.storyboard.review',
      name: 'Storyboard review',
      description: 'Review storyboard continuity.',
      version: '1.0.0',
      contentHash: HASH_A,
      provenance: 'installed' as const,
      trust: 'trusted' as const,
      content: 'Review storyboard continuity.',
      createdAt: NOW,
    },
  ],
} satisfies WireResult<'plugin.query'>['packages'][number]['manifest'];

export const chatFixture: Chat = {
  authority: 'chat',
  id: 'chat.opening-direction',
  projectId: projectFixture.id,
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

export const runFixture: Run = {
  authority: 'run',
  id: 'run.opening-direction',
  revision: 1,
  contentHash: HASH_A,
  rootRunId: 'run.opening-direction',
  retryOfRunId: null,
  retrySeedHash: null,
  parentRunId: null,
  projectId: projectFixture.id,
  chatId: chatFixture.id,
  status: 'running',
  model: { providerId: 'provider.lucid', model: 'Lucid 1.0', reasoningStrength: null },
  permissionMode: 'reversible',
  budget,
  contextManifestId: 'context.opening-direction',
  contextManifestHash: HASH_B,
  capabilityCatalogSnapshotId: 'catalog.canonical',
  capabilityCatalogHash: HASH_C,
  publicEventHead: { sequence: 1, hash: HASH_A },
  privateRecoveryHead: null,
  acceptedAt: NOW,
  acceptedSource: { kind: 'message', messageId: 'message.opening', contentHash: HASH_C },
  terminalOutcome: null,
};

export const messagesFixture: Message[] = [
  {
    authority: 'message',
    id: 'message.opening',
    projectId: projectFixture.id,
    chatId: chatFixture.id,
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

export const runEventsFixture: PublicRunEvent[] = [
  {
    visibility: 'public',
    eventId: 'event.progress.1',
    eventVersion: 1,
    runId: runFixture.id,
    sequence: 1,
    occurredAt: NOW,
    actor: 'commander',
    causation: { kind: 'run', runId: runFixture.id },
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
  {
    visibility: 'public',
    eventId: 'event.result.2',
    eventVersion: 1,
    runId: runFixture.id,
    sequence: 2,
    occurredAt: NOW,
    actor: 'commander',
    causation: { kind: 'run', runId: runFixture.id },
    correlationId: null,
    idempotencyKey: null,
    payloadHash: HASH_A,
    previousEventHash: HASH_A,
    eventHash: HASH_C,
    payloadState: {
      state: 'available',
      payload: {
        type: 'result_published',
        resultId: 'result.opening.1',
        summary: 'A restrained harbor arrival candidate.',
      },
    },
  },
];

export const canvasFixture: CanvasDocument = {
  authority: 'canvas',
  id: 'canvas.blue-hour',
  projectId: projectFixture.id,
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

export const mediaFixture: ProjectMediaRef = {
  authority: 'project_media_ref',
  id: 'media.harbor-reference',
  projectId: projectFixture.id,
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

export const globalMediaFixture = {
  asset: {
    authority: 'global_media_asset',
    id: 'asset.harbor-reference',
    revision: 1,
    contentHash: HASH_B,
    blobHash: HASH_A,
    kind: 'image',
    filename: 'harbor-reference.jpg',
    displayName: 'Harbor reference',
    source: {
      kind: 'imported',
      originalFileName: 'harbor-reference.jpg',
      importId: 'import.harbor-reference',
    },
    folderId: null,
    tags: ['reference'],
    createdAt: NOW,
    updatedAt: NOW,
  },
  byteLength: 428_000,
  mimeType: 'image/jpeg',
} satisfies WireResult<'media.global.list'>['items'][number];

export const resultFixture = {
  resultRef: {
    authority: 'generated_result',
    id: 'result.opening.1',
    revision: 0,
    contentHash: HASH_C,
  },
  requestId: 'generation.opening.1',
  targetRef: {
    authority: 'production',
    id: 'shot.04',
    revision: 3,
    contentHash: HASH_B,
  },
  technicalValidation: {
    state: 'valid',
    mimeTypeValid: true,
    dimensionsValid: true,
    durationValid: true,
    failureCode: null,
  },
  artifact: {
    kind: 'video',
    id: 'artifact.opening.1',
    contentHash: HASH_C,
    mimeType: 'video/mp4',
    width: 1920,
    height: 1080,
    durationMs: 8000,
  },
  submittedPrompt: 'A patient wide harbor arrival at blue hour with natural motion.',
  referenceBindings: [
    {
      projectMediaRefId: mediaFixture.id,
      globalAssetId: mediaFixture.globalAssetId,
      blobHash: HASH_A,
      role: 'video_reference',
      influence: 0.7,
    },
  ],
  provider: { providerId: 'provider.lucid', model: 'Lucid Video 1', reasoningStrength: null },
  assessmentIds: [],
} satisfies WireResult<'result.query'>['items'][number];

export const historyFixture = [
  {
    projectId: projectFixture.id,
    occurredAt: NOW,
    summary: 'Generated candidate recorded for Shot 04.',
    source: 'generated_result',
    resultId: resultFixture.resultRef.id,
    runId: runFixture.id,
    revision: 0,
    contentHash: resultFixture.resultRef.contentHash,
  },
] satisfies WireResult<'history.query'>['items'];

export type DesktopApiFixture = ReturnType<typeof createDesktopApiFixture>;

function ok<Method extends keyof ApiInputs>(
  method: Method,
  request: ApiInputs[Method],
  result: WireResult<Method>,
): DesktopResponseV1<Method> {
  return {
    wireVersion: 1,
    kind: 'success',
    requestId: request.requestId,
    method,
    result,
  } as Extract<WireSuccessV1, { method: Method }>;
}

type ApiInputs = {
  [Method in import('@lucid-fin/contracts').PublicWireMethodV1]: DesktopCallV1<Method>;
};

interface DesktopApiFixtureOptions {
  readonly includeDelivery?: boolean;
}

export function createDesktopApiFixture(options: DesktopApiFixtureOptions = {}) {
  const listeners = new Set<(push: import('@lucid-fin/contracts').WirePushV1) => void>();
  let currentProject = projectFixture;
  let globalMediaAssets: WireResult<'media.global.list'>['items'] = [globalMediaFixture];
  let pluginInstallation: WireResult<'plugin.query'>['packages'][number]['installation'] = null;
  let pluginAuditEvents: WireResult<'plugin.query'>['packages'][number]['auditEvents'] = [];
  let currentProtectionActive = false;
  let protectionRevision = 0;
  let decisionRevision = 0;
  let cancelNextExportPick = false;
  const cancelledOperationIds = new Set<string>();
  let pendingProtection: ApiInputs['decision.protect']['input'] | null = null;
  let currentDecisionValue:
    | { readonly state: 'selected'; readonly feedback: string }
    | { readonly state: 'rejected'; readonly feedback: string }
    | { readonly state: 'refine'; readonly instruction: string }
    | { readonly state: 'reference'; readonly feedback: string }
    | null = null;
  const shotRevision = () => 3 + decisionRevision + protectionRevision;
  const shotContentHash = () => (shotRevision() === 3 ? HASH_B : HASH_C);
  const calls = {
    windowMinimize: vi.fn(),
    windowToggleMaximize: vi.fn(),
    windowClose: vi.fn(),
    projectList: vi.fn(async (request: ApiInputs['project.list']) =>
      ok('project.list', request, {
        items: [
          {
            id: currentProject.id,
            name: currentProject.name,
            lifecycle: currentProject.lifecycle,
            revision: currentProject.revision,
            contentHash: currentProject.contentHash,
            updatedAt: currentProject.updatedAt,
          },
        ],
        nextCursor: null,
      }),
    ),
    projectCreate: vi.fn(async (request: ApiInputs['project.create']) =>
      ok('project.create', request, {
        project: projectFixture,
        settings: settingsFixture,
      }),
    ),
    projectGet: vi.fn(async (request: ApiInputs['project.get']) =>
      ok('project.get', request, currentProject),
    ),
    projectUpdate: vi.fn(async (request: ApiInputs['project.update']) => {
      const lifecycle = request.input.lifecycle ?? currentProject.lifecycle;
      currentProject = {
        ...currentProject,
        name: request.input.name ?? currentProject.name,
        lifecycle,
        revision: currentProject.revision + 1,
        contentHash: HASH_C,
        archivedAt:
          lifecycle === 'archived'
            ? NOW
            : lifecycle === 'active'
              ? null
              : currentProject.archivedAt,
        deletedAt: lifecycle === 'deleted' ? NOW : currentProject.deletedAt,
        updatedAt: NOW,
      };
      return ok('project.update', request, currentProject);
    }),
    settingsGet: vi.fn(async (request: ApiInputs['project.settings.get']) =>
      ok('project.settings.get', request, settingsFixture),
    ),
    settingsUpdate: vi.fn(async (request: ApiInputs['project.settings.update']) =>
      ok('project.settings.update', request, {
        ...settingsFixture,
        revision: settingsFixture.revision + 1,
        permission: request.input.permission,
        budget: request.input.budget,
        formatPolicy: request.input.formatPolicy,
        defaultProviderProfileId: request.input.defaultProviderProfileId,
        enabledSkills: request.input.enabledSkills,
      }),
    ),
    capabilitiesGet: vi.fn(async (request: ApiInputs['project.capabilities.get']) =>
      ok('project.capabilities.get', request, {
        projectId: projectFixture.id,
        providers: [
          {
            id: 'provider.lucid',
            displayName: 'Lucid Local',
            providerKind: 'local',
            model: 'Lucid Video 1',
            status: 'ready',
            revision: 0,
          },
        ],
        skills: [
          {
            id: 'skill.cinematography',
            name: 'Cinematography',
            description: 'Camera, coverage, and visual-language guidance.',
            version: '1.0.0',
            contentHash: HASH_A,
            provenance: 'built_in',
            trust: 'trusted',
            eligibility: 'available',
            quarantineReason: null,
            pluginPackage: null,
          },
          {
            id: 'skill.unreviewed',
            name: 'Unreviewed import',
            description: 'Quarantined capability evidence.',
            version: '1.0.0',
            contentHash: HASH_B,
            provenance: 'installed',
            trust: 'unreviewed',
            eligibility: 'quarantined',
            quarantineReason: 'Trust review is required.',
            pluginPackage: null,
          },
        ],
      }),
    ),
    pluginQuery: vi.fn(async (request: ApiInputs['plugin.query']) =>
      ok('plugin.query', request, {
        packages: [
          {
            manifest: pluginManifestFixture,
            installation: pluginInstallation,
            auditEvents: pluginAuditEvents,
          },
        ],
      }),
    ),
    pluginApply: vi.fn(async (request: ApiInputs['plugin.apply']) => {
      const previous = pluginInstallation;
      const installing = request.input.action === 'install';
      pluginInstallation = {
        packageId: pluginManifestFixture.packageId,
        version: pluginManifestFixture.version,
        manifestHash: pluginManifestFixture.manifestHash,
        state: installing ? 'installed' : 'removed',
        revision: previous === null ? 0 : previous.revision + 1,
        installedAt: previous?.installedAt ?? NOW,
        removedAt: installing ? null : NOW,
      };
      const auditEvent = {
        id: `plugin-audit.${pluginInstallation.revision + 1}`,
        sequence: pluginAuditEvents.length + 1,
        packageId: pluginManifestFixture.packageId,
        version: pluginManifestFixture.version,
        manifestHash: pluginManifestFixture.manifestHash,
        action: installing ? ('installed' as const) : ('removed' as const),
        installationRevision: pluginInstallation.revision,
        previousEventHash: pluginAuditEvents.at(-1)?.eventHash ?? null,
        eventHash: installing ? HASH_A : HASH_B,
        occurredAt: NOW,
      };
      pluginAuditEvents = [...pluginAuditEvents, auditEvent];
      return ok('plugin.apply', request, {
        manifest: pluginManifestFixture,
        installation: pluginInstallation,
        auditEvent,
      });
    }),
    overviewGet: vi.fn(async (request: ApiInputs['overview.get']) =>
      ok('overview.get', request, {
        project: projectFixture,
        activeRuns: [runFixture],
        taskLists: [
          {
            authority: 'task_list',
            id: 'tasks.opening',
            runId: runFixture.id,
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
        counts: {
          chats: 1,
          deliveryPlans: options.includeDelivery ? 1 : 0,
          media: 1,
          productionObjects: 2,
        },
      }),
    ),
    chatList: vi.fn(async (request: ApiInputs['chat.list']) =>
      ok('chat.list', request, { items: [chatFixture], nextCursor: null }),
    ),
    chatCreate: vi.fn(async (request: ApiInputs['chat.create']) =>
      ok('chat.create', request, chatFixture),
    ),
    messageList: vi.fn(async (request: ApiInputs['message.list']) =>
      ok('message.list', request, { items: messagesFixture, nextCursor: null }),
    ),
    messageSend: vi.fn(async (request: ApiInputs['message.send']) =>
      ok('message.send', request, {
        message: messagesFixture[0] as Extract<Message, { role: 'user' }>,
        chat: chatFixture,
        acceptedRun: runFixture,
      }),
    ),
    runGet: vi.fn(async (request: ApiInputs['run.get']) => ok('run.get', request, runFixture)),
    runEventsList: vi.fn(async (request: ApiInputs['run.events.list']) =>
      ok('run.events.list', request, { items: runEventsFixture, nextCursor: null }),
    ),
    runControl: vi.fn(async (request: ApiInputs['run.control']) =>
      ok('run.control', request, {
        ...runFixture,
        revision: runFixture.revision + 1,
        status: request.input.action === 'pause' ? 'paused' : 'running',
      } as Run),
    ),
    runSendFollowup: vi.fn(async (request: ApiInputs['run.sendFollowup']) =>
      ok('run.sendFollowup', request, {
        id: 'inbox.followup',
        runId: runFixture.id,
        sequence: 1,
        actor: 'user',
        source: {
          kind: 'message',
          messageId: 'message.followup',
          contentHash: HASH_B,
        },
        state: 'queued',
        selectedContext: request.input.selectedContext,
        exportDestinationGrant: request.input.exportDestinationGrant,
        contentHash: HASH_B,
        createdAt: NOW,
      }),
    ),
    canvasGet: vi.fn(async (request: ApiInputs['canvas.get']) =>
      ok('canvas.get', request, canvasFixture),
    ),
    canvasApply: vi.fn(async (request: ApiInputs['canvas.apply']) =>
      ok('canvas.apply', request, {
        ...canvasFixture,
        revision: canvasFixture.revision + 1,
        contentHash: HASH_C,
        placements: canvasFixture.placements.map((placement) =>
          request.input.command.action === 'move' &&
          placement.id === request.input.command.placementId
            ? {
                ...placement,
                position: request.input.command.position,
                revision: placement.revision + 1,
                updatedAt: NOW,
              }
            : placement,
        ),
      }),
    ),
    mediaProjectList: vi.fn(async (request: ApiInputs['media.project.list']) =>
      ok('media.project.list', request, { items: [mediaFixture], nextCursor: null }),
    ),
    mediaGlobalList: vi.fn(async (request: ApiInputs['media.global.list']) =>
      ok('media.global.list', request, { items: globalMediaAssets, nextCursor: null }),
    ),
    mediaGlobalImport: vi.fn(async (request: ApiInputs['media.global.import']) => {
      const imported = {
        ...globalMediaFixture,
        asset: {
          ...globalMediaFixture.asset,
          id: 'asset.new-reference',
          displayName: request.input.displayName ?? 'New reference',
          filename: 'new-reference.png',
          revision: 0,
          contentHash: HASH_C,
          blobHash: HASH_C,
          source: {
            kind: 'imported' as const,
            originalFileName: 'new-reference.png',
            importId: 'import.new-reference',
          },
          tags: request.input.tags,
        },
        byteLength: 128_000,
        mimeType: 'image/png',
      } satisfies WireResult<'media.global.import'>;
      globalMediaAssets = [imported, ...globalMediaAssets];
      return ok('media.global.import', request, imported);
    }),
    mediaGlobalRemove: vi.fn(async (request: ApiInputs['media.global.remove']) => {
      globalMediaAssets = globalMediaAssets.filter(
        (item) => item.asset.id !== request.input.globalAssetId,
      );
      return ok('media.global.remove', request, {
        globalAssetId: request.input.globalAssetId,
        removed: true,
        blobRetainedForGarbageCollection: true,
      });
    }),
    mediaPreviewIssue: vi.fn(async (request: ApiInputs['media.preview.issue']) => {
      const source = request.input.source;
      const artifact = source.kind === 'generated_result' ? source.artifact : null;
      let kind: 'image' | 'video' | 'audio' = 'image';
      let mimeType = 'image/jpeg';
      if (artifact !== null) {
        if (artifact.kind !== 'image' && artifact.kind !== 'video' && artifact.kind !== 'audio') {
          throw new Error('The media preview fixture received a non-previewable artifact.');
        }
        if (artifact.mimeType === null) {
          throw new Error('The media preview fixture received an artifact without a MIME type.');
        }
        kind = artifact.kind;
        mimeType = artifact.mimeType;
      }
      return ok('media.preview.issue', request, {
        url: `lucid-fin-media://preview/cap_fixture_${request.input.source.kind}`,
        expiresAt: '2099-01-01T00:00:00.000Z',
        kind,
        mimeType,
      });
    }),
    productionQuery: vi.fn(async (request: ApiInputs['production.query']) =>
      ok('production.query', request, {
        items: [
          {
            object: {
              authority: 'production',
              id: 'direction.main',
              projectId: projectFixture.id,
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
              createdBy: { kind: 'run', runId: runFixture.id },
              updatedBy: { kind: 'run', runId: runFixture.id },
              createdAt: NOW,
              updatedAt: NOW,
            },
            factSources: [],
            currentChoices: [],
          },
          {
            object: {
              authority: 'production',
              id: 'shot.04',
              projectId: projectFixture.id,
              revision: shotRevision(),
              contentHash: shotContentHash(),
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
              protections: currentProtectionActive
                ? [
                    {
                      field: {
                        owner: 'production',
                        objectId: 'shot.04',
                        field: 'resultDecision',
                        resultId: resultFixture.resultRef.id,
                      },
                      choiceId: 'choice.protection.result.opening.1',
                      protectedAt: NOW,
                    },
                  ]
                : [],
              resultDecisions:
                currentDecisionValue === null
                  ? []
                  : [
                      {
                        result: resultFixture.resultRef,
                        value: currentDecisionValue,
                        currentChoiceId: 'choice.result.opening.1',
                      },
                    ],
              createdBy: { kind: 'run', runId: runFixture.id },
              updatedBy: { kind: 'run', runId: runFixture.id },
              createdAt: NOW,
              updatedAt: NOW,
            },
            factSources: [],
            currentChoices:
              currentDecisionValue === null
                ? []
                : [
                    {
                      authority: 'user_choice',
                      id: 'choice.result.opening.1',
                      choiceHash: HASH_C,
                    },
                  ],
          },
        ],
        nextCursor: null,
      }),
    ),
    resultQuery: vi.fn(async (request: ApiInputs['result.query']) =>
      ok('result.query', request, { items: [resultFixture], nextCursor: null }),
    ),
    historyQuery: vi.fn(async (request: ApiInputs['history.query']) =>
      ok('history.query', request, { items: historyFixture, nextCursor: null }),
    ),
    deliveryQuery: vi.fn(async (request: ApiInputs['delivery.query']) =>
      ok('delivery.query', request, {
        plans: options.includeDelivery ? [deliveryPlanFixture] : [],
        manifests: [],
        operations: options.includeDelivery ? [deliveryOperationRefFixture] : [],
        nextCursor: null,
      }),
    ),
    operationGet: vi.fn(async (request: ApiInputs['operation.get']) =>
      ok('operation.get', request, {
        operations: request.input.operations.map((ref) => ({
          ref,
          state: 'running' as const,
          cancelRequested: cancelledOperationIds.has(ref.id),
          progressPercent: null,
          usage: null,
          publicErrorCode: null,
          resultRefs: [],
          artifacts: [],
        })),
      }),
    ),
    operationCancel: vi.fn(async (request: ApiInputs['operation.cancel']) => {
      for (const operation of request.input.operations) cancelledOperationIds.add(operation.ref.id);
      return ok('operation.cancel', request, {
        operations: request.input.operations.map(({ ref, expectedState }) => ({
          ref,
          state: expectedState,
          cancelRequested: true,
          progressPercent: null,
          usage: null,
          publicErrorCode: null,
          resultRefs: [],
          artifacts: [],
        })),
      });
    }),
    confirmationRespond: vi.fn(async (request: ApiInputs['confirmation.respond']) => {
      const command = pendingProtection;
      const approvedCommand = request.input.decision === 'approved' ? command : null;
      if (approvedCommand !== null) {
        currentProtectionActive = approvedCommand.mode === 'protect';
        protectionRevision += 1;
      }
      pendingProtection = null;
      return ok('confirmation.respond', request, {
        confirmationId: request.input.confirmationId,
        messageId: 'message.confirmation',
        decision: request.input.decision,
        effect:
          approvedCommand !== null
            ? {
                kind: 'decision_protection_changed',
                dispatchOperationId: 'dispatch.protection.1',
                choice: {
                  authority: 'user_choice',
                  id: 'choice.protection.result.opening.1',
                  choiceHash: HASH_C,
                },
                active: currentProtectionActive,
                owner: {
                  ...approvedCommand.owner,
                  revision: shotRevision(),
                  contentHash: shotContentHash(),
                },
                eventId: 'event.protection.1',
                outcomeHash: HASH_A,
              }
            : null,
      });
    }),
    interactionAnswer: vi.fn(async (request: ApiInputs['interaction.answer']) =>
      ok('interaction.answer', request, {
        interactionId: request.input.interactionId,
        messageId: 'message.answer',
        state: 'answered',
      }),
    ),
    decisionRecord: vi.fn(async (request: ApiInputs['decision.record']) => {
      const ownerBefore = {
        authority: 'production' as const,
        id: 'shot.04',
        revision: shotRevision(),
        contentHash: shotContentHash(),
      };
      if (request.input.action === 'undo') {
        if (currentDecisionValue === null)
          throw new Error('No current decision is available to undo.');
        const value = currentDecisionValue;
        currentDecisionValue = null;
        decisionRevision += 1;
        return ok('decision.record', request, {
          authority: 'user_choice',
          id: 'choice.result.undo.1',
          projectId: projectFixture.id,
          actor: 'user',
          authorization: {
            kind: 'direct_user',
            requestId: request.requestId,
            inputHash: HASH_A,
          },
          causation: { kind: 'direct_ui', actionId: request.requestId },
          subject: {
            kind: 'result_decision',
            shotId: 'shot.04',
            resultIds: [resultFixture.resultRef.id],
          },
          ownerBefore,
          ownerAfter: {
            authority: 'production',
            id: 'shot.04',
            revision: shotRevision(),
            contentHash: shotContentHash(),
          },
          choice: { kind: 'undo', targetChoiceId: request.input.targetChoice.id },
          beforeEffect: {
            kind: 'result_decisions',
            shotId: 'shot.04',
            entries: [{ resultId: resultFixture.resultRef.id, value }],
          },
          afterEffect: {
            kind: 'result_decisions',
            shotId: 'shot.04',
            entries: [{ resultId: resultFixture.resultRef.id, value: null }],
          },
          supersedesChoiceIds: [request.input.targetChoice.id],
          createdAt: NOW,
          choiceHash: HASH_A,
        });
      }
      const value =
        request.input.action === 'select'
          ? { state: 'selected' as const, feedback: request.input.feedback }
          : request.input.action === 'reject'
            ? { state: 'rejected' as const, feedback: request.input.feedback }
            : request.input.action === 'refine'
              ? { state: 'refine' as const, instruction: request.input.instruction }
              : { state: 'reference' as const, feedback: request.input.feedback };
      currentDecisionValue = value;
      decisionRevision += 1;
      return ok('decision.record', request, {
        authority: 'user_choice',
        id: 'choice.result.opening.1',
        projectId: projectFixture.id,
        actor: 'user',
        authorization: {
          kind: 'direct_user',
          requestId: request.requestId,
          inputHash: HASH_A,
        },
        causation: { kind: 'direct_ui', actionId: request.requestId },
        subject: {
          kind: 'result_decision',
          shotId: 'shot.04',
          resultIds: [resultFixture.resultRef.id],
        },
        ownerBefore,
        ownerAfter: {
          authority: 'production',
          id: 'shot.04',
          revision: shotRevision(),
          contentHash: shotContentHash(),
        },
        choice:
          request.input.action === 'select'
            ? {
                kind: 'select',
                resultId: resultFixture.resultRef.id,
                feedback: request.input.feedback,
              }
            : request.input.action === 'reject'
              ? {
                  kind: 'reject',
                  resultId: resultFixture.resultRef.id,
                  feedback: request.input.feedback,
                }
              : request.input.action === 'refine'
                ? {
                    kind: 'refine',
                    resultId: resultFixture.resultRef.id,
                    instruction: request.input.instruction,
                  }
                : {
                    kind: 'use_as_reference',
                    resultId: resultFixture.resultRef.id,
                    feedback: request.input.feedback,
                  },
        beforeEffect: {
          kind: 'result_decisions',
          shotId: 'shot.04',
          entries: [{ resultId: resultFixture.resultRef.id, value: null }],
        },
        afterEffect: {
          kind: 'result_decisions',
          shotId: 'shot.04',
          entries: [{ resultId: resultFixture.resultRef.id, value }],
        },
        supersedesChoiceIds: [],
        createdAt: NOW,
        choiceHash: HASH_C,
      });
    }),
    decisionProtect: vi.fn(async (request: ApiInputs['decision.protect']) => {
      pendingProtection = request.input;
      return {
        wireVersion: 1,
        kind: 'failure',
        requestId: request.requestId,
        method: 'decision.protect',
        error: {
          code: 'confirmation_required',
          publicSummary: 'Confirm the exact protection change.',
          retryable: false,
          correlationId: 'correlation.protection.1',
          confirmationId: 'confirmation.protection.1',
          immutableInputHash: HASH_A,
        },
      } as DesktopResponseV1<'decision.protect'>;
    }),
    mediaPick: vi.fn(async (request: ApiInputs['os.media.pick']) =>
      ok('os.media.pick', request, {
        capabilityToken: 'capability.global-media-picker',
        displayLabel: 'New reference.png',
        expiresAt: '2026-08-24T17:00:00.000Z',
      }),
    ),
    exportPick: vi.fn(async (request: ApiInputs['os.export.pick']) => {
      if (cancelNextExportPick) {
        cancelNextExportPick = false;
        return ok('os.export.pick', request, { state: 'cancelled' });
      }
      return ok('os.export.pick', request, {
        state: 'selected',
        grant: exportGrantFixture,
      });
    }),
  };

  const unavailable = async () => {
    throw new Error('Unexpected desktop API call in fixture');
  };
  const api = {
    project: {
      list: calls.projectList,
      create: calls.projectCreate,
      get: calls.projectGet,
      update: calls.projectUpdate,
      settingsGet: calls.settingsGet,
      settingsUpdate: calls.settingsUpdate,
      capabilitiesGet: calls.capabilitiesGet,
    },
    plugin: { query: calls.pluginQuery, apply: calls.pluginApply },
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
      onEventsAppended: (listener: (push: import('@lucid-fin/contracts').WirePushV1) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    canvas: { get: calls.canvasGet, apply: calls.canvasApply },
    media: {
      projectList: calls.mediaProjectList,
      globalList: calls.mediaGlobalList,
      globalImport: calls.mediaGlobalImport,
      globalRemove: calls.mediaGlobalRemove,
      projectAttach: unavailable,
      projectDetach: unavailable,
      projectLink: unavailable,
      previewIssue: calls.mediaPreviewIssue,
    },
    production: { query: calls.productionQuery, apply: unavailable },
    result: { query: calls.resultQuery },
    history: { query: calls.historyQuery },
    delivery: { query: calls.deliveryQuery, apply: unavailable },
    confirmation: { respond: calls.confirmationRespond },
    interaction: { answer: calls.interactionAnswer },
    decision: { record: calls.decisionRecord, protect: calls.decisionProtect },
    operation: { get: calls.operationGet, cancel: calls.operationCancel },
    os: { mediaPick: calls.mediaPick, exportPick: calls.exportPick },
    windowControls: {
      minimize: calls.windowMinimize,
      toggleMaximize: calls.windowToggleMaximize,
      close: calls.windowClose,
    },
  } as unknown as DesktopApiV1;

  return {
    api,
    calls,
    listeners,
    controls: {
      cancelNextExportPick(): void {
        cancelNextExportPick = true;
      },
    },
  };
}
