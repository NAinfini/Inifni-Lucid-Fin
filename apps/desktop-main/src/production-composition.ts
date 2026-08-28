import { createHash, randomUUID } from 'node:crypto';
import {
  CapabilityCatalogSnapshotV1Schema,
  PARSER_POLICY_VERSION,
  TOOL_DEFINITIONS,
  capabilityCatalogHashInput,
  capabilityIndexDigestInput,
  canonicalJson,
  skillCatalogDigestInput,
  toolCatalogDigestInput,
  toolSchemaDigestInput,
  type ProviderModel,
  type WireRequestV1,
} from '@lucid-fin/contracts';
import {
  createFilesystemMediaCas,
  type DataAccess,
  type DataAccessOptions,
  type MediaCas,
  type MessageSendAcceptanceSeed,
  type Store,
} from '@lucid-fin/storage';
import { createHostCatalogProvisioning } from '@lucid-fin/storage/host';
import type { ModelAdapter } from '@lucid-fin/runtime';
import { z } from 'zod';
import type { DesktopRuntimeController, DesktopStartupState } from './composition-root.js';
import type { WireUseCaseDependencies } from './ipc/handlers.js';
import type { PersistedRunEventPublisher } from './ipc/push-gateway.js';
import { canonicalUserDataLayout, type CanonicalUserDataLayout } from './production-paths.js';
import {
  LOCAL_OLLAMA_PROVIDER_ID,
  createCanonicalRecoveryCodec,
  createOllamaModelAdapter,
  type OllamaModelAdapterOptions,
  type RecoveryKeyStore,
} from './production-adapters.js';
import {
  createProductionHostPorts,
  type ProductionDataAccessPorts,
} from './production-host-ports.js';
import type { LocalMediaPicker } from './production-local-adapters.js';
import { createRuntimeController } from './runtime-controller.js';

const DEFAULT_LOCAL_MODEL_LIMITS = Object.freeze({
  maxInputTokens: 8_000,
  maxOutputTokens: 1_000,
});

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function schemaDigest(schema: z.ZodType) {
  const value = JSON.parse(
    JSON.stringify(z.toJSONSchema(schema, { io: 'output', unrepresentable: 'throw' })),
  ) as unknown;
  const canonical = canonicalJson(value);
  return Object.freeze({ canonicalJson: canonical, sha256: sha256(canonical) });
}

function valueDigest(value: unknown) {
  const canonical = canonicalJson(value);
  return Object.freeze({ canonicalJson: canonical, sha256: sha256(canonical) });
}

function canonicalToolRoot() {
  const tools = TOOL_DEFINITIONS.map((definition) => {
    const inputSchema = schemaDigest(definition.inputSchema);
    const successSchema = schemaDigest(definition.successSchema);
    const outcomeSchema = schemaDigest(definition.outcomeSchema);
    const examples = valueDigest(definition.examples);
    return Object.freeze({
      description: definition.description,
      examples,
      id: definition.id,
      inputSchema,
      metadata: definition.metadata,
      metadataHash: sha256(canonicalJson(definition.metadata)),
      outcomeSchema,
      schemaDigest: sha256(
        toolSchemaDigestInput({ inputSchema, successSchema, outcomeSchema, examples }),
      ),
      successSchema,
      version: definition.version,
    });
  });
  const skills: [] = [];
  const capabilityIndex = tools.map((tool) =>
    Object.freeze({
      availability:
        tool.metadata.confirmation.mode === 'none'
          ? ('available' as const)
          : ('confirmation_required' as const),
      domain: tool.metadata.domain,
      name: tool.id,
      purpose: tool.description,
      schemaDigest: tool.schemaDigest,
      version: tool.version,
    }),
  );
  const withoutHash = {
    capabilityIndex,
    capabilityIndexDigest: sha256(capabilityIndexDigestInput(capabilityIndex)),
    parentCatalogHash: null,
    parserPolicyVersion: PARSER_POLICY_VERSION,
    skillCatalogDigest: sha256(skillCatalogDigestInput(skills)),
    skills,
    toolCatalogDigest: sha256(toolCatalogDigestInput(tools)),
    tools,
    version: 1 as const,
  };
  return CapabilityCatalogSnapshotV1Schema.parse({
    ...withoutHash,
    catalogHash: sha256(capabilityCatalogHashInput(withoutHash)),
  });
}

const CANONICAL_TOOL_ROOT = canonicalToolRoot();

type SeededRunRequest = Extract<
  WireRequestV1,
  { readonly method: 'message.send' | 'run.sendFollowup' }
>;

function projectMediaSelections(request: SeededRunRequest) {
  const selections =
    request.method === 'message.send'
      ? request.input.attachments.map((attachment) => ({
          projectMediaRefId: attachment.projectMediaRefId,
          role: attachment.role === 'input' ? ('input' as const) : ('reference' as const),
        }))
      : request.input.selectedContext
          .filter(({ ref }) => ref.authority === 'project_media_ref')
          .map(({ ref }) => ({ projectMediaRefId: ref.id, role: 'reference' as const }));
  const seen = new Set<string>();
  return selections
    .sort((left, right) =>
      `${left.projectMediaRefId}\0${left.role}`.localeCompare(
        `${right.projectMediaRefId}\0${right.role}`,
      ),
    )
    .filter((selection) => {
      const key = `${selection.projectMediaRefId}\0${selection.role}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function localeAndTimeZone(): { readonly locale: string; readonly timeZone: string } {
  const options = Intl.DateTimeFormat().resolvedOptions();
  return Object.freeze({
    locale: options.locale || 'en-US',
    timeZone: options.timeZone || 'UTC',
  });
}

function projectIdFor(data: DataAccess, request: SeededRunRequest, requestId: string): string {
  if (request.method === 'message.send') {
    return data.conversations.getChat(request.input.chatId).projectId;
  }
  return data.runs.get({
    wireVersion: 1,
    kind: 'request',
    requestId,
    method: 'run.get',
    input: { runId: request.input.runId },
  }).result.projectId;
}

export interface CreateProductionCompositionOptionsInput {
  readonly userDataPath: string;
  readonly recoveryKeyStore: RecoveryKeyStore;
  readonly model: OllamaModelAdapterOptions;
  readonly mediaPicker?: LocalMediaPicker;
  readonly now?: () => string;
  readonly createId?: DataAccessOptions['createId'];
}

export interface ProductionCompositionOptions {
  readonly layout: CanonicalUserDataLayout;
  readonly mediaCas: MediaCas;
  readonly dataAccess: ProductionDataAccessPorts & {
    readonly mediaCas: MediaCas;
    readonly privateRecoveryCodec: DataAccessOptions['privateRecoveryCodec'];
  };
  readonly model: ModelAdapter;
  readonly pickMedia: ReturnType<typeof createProductionHostPorts>['pickMedia'];
  provisionHost(store: Store): void;
  createAcceptanceSeedFor(data: DataAccess): WireUseCaseDependencies['acceptanceSeedFor'];
  createRuntime(data: DataAccess, events: PersistedRunEventPublisher): DesktopRuntimeController;
  contextForRequest(request: WireRequestV1): {
    readonly actor: 'user';
    readonly causation: { readonly kind: 'direct_ui'; readonly actionId: string };
    readonly correlationId: string;
  };
  createPushRequestId(): string;
  reportStartup(state: DesktopStartupState): void;
  onInternalError(cause: unknown): void;
}

export async function createProductionCompositionOptions(
  input: CreateProductionCompositionOptionsInput,
): Promise<ProductionCompositionOptions> {
  const layout = canonicalUserDataLayout(input.userDataPath);
  const mediaCas = createFilesystemMediaCas(layout.mediaRoot);
  const hostPorts = createProductionHostPorts({
    model: input.model.provider,
    mediaCas,
    scratchRoot: `${layout.root}/work`,
    mediaPicker: input.mediaPicker,
    now: input.now,
    createId: input.createId,
  });
  const recoveryCodec = await createCanonicalRecoveryCodec(input.recoveryKeyStore);
  const model = createOllamaModelAdapter(input.model);
  const profile: ProviderModel = input.model.provider;
  const onInternalError = (_cause: unknown) => console.error('[desktop] internal_error');
  const reportStartup = (state: DesktopStartupState) => {
    if (state.status === 'failed') console.error(`[desktop] startup failed at ${state.stage}`);
  };
  return Object.freeze({
    layout,
    mediaCas,
    dataAccess: Object.freeze({
      ...hostPorts.dataAccessPorts,
      mediaCas,
      privateRecoveryCodec: recoveryCodec,
    }),
    model,
    pickMedia: hostPorts.pickMedia,
    provisionHost(store: Store): void {
      createHostCatalogProvisioning(store).registerProviderProfile({
        id: profile.providerId,
        displayName: 'Local Ollama',
        providerKind: LOCAL_OLLAMA_PROVIDER_ID,
        model: profile.model,
        status: 'ready',
      });
    },
    createAcceptanceSeedFor(data: DataAccess) {
      return async (
        request: Parameters<WireUseCaseDependencies['acceptanceSeedFor']>[0],
        context: Parameters<WireUseCaseDependencies['acceptanceSeedFor']>[1],
      ): Promise<MessageSendAcceptanceSeed> => {
        const { locale, timeZone } = localeAndTimeZone();
        const projectId = projectIdFor(data, request, context.correlationId);
        if (projectId.length === 0) throw new Error('Accepted Run has no Project.');
        return Object.freeze({
          model: profile,
          locale,
          timeZone,
          capabilityCatalog: CANONICAL_TOOL_ROOT,
          projectMediaSelections: projectMediaSelections(request),
          citedMemoryEntryIds: [],
        });
      };
    },
    createRuntime(data: DataAccess, events: PersistedRunEventPublisher): DesktopRuntimeController {
      return createRuntimeController({
        data,
        model,
        createId: (kind) => `${kind}.${randomUUID()}`,
        limitsForRun: () => DEFAULT_LOCAL_MODEL_LIMITS,
        onBackgroundError: onInternalError,
        publishPersistedRunHead: (run) => events.publishHead(run),
      });
    },
    contextForRequest(request: WireRequestV1) {
      return Object.freeze({
        actor: 'user' as const,
        causation: { kind: 'direct_ui' as const, actionId: request.requestId },
        correlationId: request.requestId,
      });
    },
    createPushRequestId: () => `request.push.${randomUUID()}`,
    reportStartup,
    onInternalError,
  });
}
