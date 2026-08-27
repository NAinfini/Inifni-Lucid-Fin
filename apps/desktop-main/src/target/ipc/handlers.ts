import type { Run, WireRequestV1, WireSuccessV1 } from '@lucid-fin/target-contracts';
import type {
  MessageSendAcceptanceSeed,
  TargetCommandContext,
  TargetDataAccess,
} from '@lucid-fin/target-storage';
import type {
  HostConfirmationAuthority,
  HostInteractionAuthority,
} from '@lucid-fin/target-storage/host';
import type { TargetMediaPreviewCapabilityGateway } from '../media-preview.js';
import type { TargetWireHandler, TargetWireHandlers } from './router.js';

type SeededRunRequest = Extract<
  WireRequestV1,
  { readonly method: 'message.send' | 'run.sendFollowup' }
>;
export interface TargetWireUseCaseDependencies {
  readonly data: TargetDataAccess;
  readonly interaction: HostInteractionAuthority;
  readonly confirmation: HostConfirmationAuthority;
  readonly acceptanceSeedFor: (
    request: SeededRunRequest,
    context: TargetCommandContext,
  ) => MessageSendAcceptanceSeed | Promise<MessageSendAcceptanceSeed>;
  readonly pickExportDestination: TargetWireHandler<'os.export.pick'>;
  readonly pickMedia: TargetWireHandler<'os.media.pick'>;
  readonly mediaPreview: TargetMediaPreviewCapabilityGateway;
  readonly notifyDurableRunWork: () => void;
  readonly publishPersistedRunHead: (run: Run) => void;
}

export function createTargetWireUseCaseHandlers(
  dependencies: TargetWireUseCaseDependencies,
): TargetWireHandlers {
  const { data } = dependencies;
  const notify = <Result>(result: Result, run?: Run): Result => {
    if (run !== undefined) dependencies.publishPersistedRunHead(run);
    dependencies.notifyDurableRunWork();
    return result;
  };

  return Object.freeze({
    'canvas.apply': (request, context) => data.canvas.apply(request, context),
    'canvas.get': (request) => data.canvas.get(request),
    'chat.archive': (request, context) => data.conversations.archiveChat(request, context),
    'chat.create': (request, context) => data.conversations.createChat(request, context),
    'chat.delete': (request, context) => data.conversations.deleteChat(request, context),
    'chat.list': (request) => data.conversations.listChats(request),
    'chat.rename': (request, context) => data.conversations.renameChat(request, context),
    'confirmation.respond': (request, context) =>
      notify(dependencies.confirmation.respond(request, context)),
    'decision.protect': (request, context) => data.userChoices.setProtection(request, context),
    'decision.record': (request, context) =>
      request.input.action === 'undo'
        ? data.userChoices.undoChoice(
            request as Parameters<TargetDataAccess['userChoices']['undoChoice']>[0],
            context,
          )
        : data.userChoices.recordResultDecision(
            request as Parameters<TargetDataAccess['userChoices']['recordResultDecision']>[0],
            context,
          ),
    'delivery.apply': (request, context) => data.delivery.apply(request, context),
    'delivery.query': (request) => data.delivery.query(request),
    'history.query': (request) =>
      ({
        wireVersion: 1,
        kind: 'success',
        requestId: request.requestId,
        method: 'history.query',
        result: data.history.query(
          request.input.projectId,
          request.input.query,
          request.input.order,
        ),
      }) as Extract<WireSuccessV1, { readonly method: 'history.query' }>,
    'interaction.answer': (request, context) =>
      notify(dependencies.interaction.answer(request, context)),
    'media.global.import': (request, context) => data.globalMedia.importGlobal(request, context),
    'media.global.list': (request) => data.globalMedia.listGlobal(request),
    'media.global.remove': (request, context) => data.globalMedia.removeGlobal(request, context),
    'media.project.attach': (request, context) => data.projectMedia.attach(request, context),
    'media.project.detach': (request, context) => data.projectMedia.detach(request, context),
    'media.project.link': (request, context) => data.projectMedia.link(request, context),
    'media.project.list': (request) => data.projectMedia.list(request),
    'media.preview.issue': (request) =>
      ({
        wireVersion: 1,
        kind: 'success',
        requestId: request.requestId,
        method: 'media.preview.issue',
        result: dependencies.mediaPreview.issue(request.input),
      }) as Extract<WireSuccessV1, { readonly method: 'media.preview.issue' }>,
    'message.list': (request) => data.conversations.listMessages(request),
    'message.send': async (request, context) => {
      const seed = await dependencies.acceptanceSeedFor(request, context);
      const result = data.conversations.sendMessage(request, context, seed);
      return notify(result, result.result.acceptedRun);
    },
    'operation.cancel': (request, context) => notify(data.operations.cancel(request, context)),
    'operation.get': (request) => data.operations.get(request),
    'os.export.pick': dependencies.pickExportDestination,
    'os.media.pick': dependencies.pickMedia,
    'overview.get': (request) => data.overview.get(request),
    'plugin.apply': (request, context) => data.plugins.apply(request, context),
    'plugin.query': (request) => data.plugins.query(request),
    'production.apply': (request, context) => data.production.apply(request, context),
    'production.query': (request) => data.production.query(request),
    'project.capabilities.get': (request) =>
      ({
        wireVersion: 1,
        kind: 'success',
        requestId: request.requestId,
        method: 'project.capabilities.get',
        result: data.projectCapabilities.get(request.input.projectId),
      }) as Extract<WireSuccessV1, { readonly method: 'project.capabilities.get' }>,
    'project.create': (request, context) => data.projects.create(request, context),
    'project.get': (request) => data.projects.get(request),
    'project.list': (request) => data.projects.list(request),
    'project.settings.get': (request) => data.projects.getSettings(request),
    'project.settings.update': (request, context) => data.projects.updateSettings(request, context),
    'project.update': (request, context) => data.projects.update(request, context),
    'result.query': (request) =>
      ({
        wireVersion: 1,
        kind: 'success',
        requestId: request.requestId,
        method: 'result.query',
        result: data.results.query(request.input.projectId, request.input.query),
      }) as Extract<WireSuccessV1, { readonly method: 'result.query' }>,
    'run.control': (request, context) => {
      const result = data.runs.control(request, context);
      return notify(result, result.result);
    },
    'run.events.list': (request) => data.runs.listPublicEvents(request),
    'run.get': (request) => data.runs.get(request),
    'run.sendFollowup': async (request, context) => {
      const seed = await dependencies.acceptanceSeedFor(request, context);
      const result = data.runs.sendFollowup(request, context, seed);
      const run = data.runs.get({
        wireVersion: 1,
        kind: 'request',
        requestId: request.requestId,
        method: 'run.get',
        input: { runId: request.input.runId },
      }).result;
      return notify(result, run);
    },
  } satisfies TargetWireHandlers);
}
