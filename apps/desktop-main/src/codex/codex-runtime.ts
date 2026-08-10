import fsp from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  GenerationRequest,
  GenerationResult,
  LLMMessage,
  LLMRequestOptions,
  LLMStreamEvent,
  LLMToolCall,
  OAuthCapability,
  OAuthProviderStatus,
  OAuthProviderTarget,
  OAuthUsage,
  SubscribeCallbacks,
} from '@lucid-fin/contracts';
import {
  CodexAppServerClient,
  type CodexAppServerClientOptions,
  type CodexNotification,
  type CodexServerRequest,
} from './codex-app-server.client.js';
import { CODEX_VERSION, resolveCodexBinary } from './codex-binary.js';

const MAX_RESULT_BASE64_LENGTH = 48 * 1024 * 1024;
const MAX_IMAGE_BYTES = 32 * 1024 * 1024;
const DEFAULT_GENERATION_TIMEOUT_MS = 5 * 60_000;

type ClientFactory = (options: CodexAppServerClientOptions) => CodexAppServerClient;

export interface CodexRuntimeOptions {
  codexHome: string;
  capability?: Exclude<OAuthCapability, 'video'>;
  binaryPath?: string;
  generationTimeoutMs?: number;
  clientFactory?: ClientFactory;
  binaryResolver?: () => string;
}

export interface CodexLoginStartResult {
  authUrl: string;
  status: OAuthProviderStatus;
}

interface ActiveGeneration {
  threadId: string;
  turnId: string | null;
  resolve: (item: ImageGenerationItem) => void;
  reject: (error: Error) => void;
  promise: Promise<ImageGenerationItem>;
  imageItem: ImageGenerationItem | null;
  imageItemCount: number;
  settled: boolean;
  timer: NodeJS.Timeout;
}

interface ActiveCompletion {
  threadId: string;
  turnId: string | null;
  queue: AsyncEventQueue<LLMStreamEvent>;
  bridge: NonNullable<LLMRequestOptions['providerToolBridge']>;
  allowedToolNames: ReadonlySet<string>;
  sawTextDelta: boolean;
  handledToolCall: boolean;
  temporaryImages: string[];
  settled: boolean;
  abortSignal?: AbortSignal;
  abortListener?: () => void;
}

interface ImageGenerationItem {
  type: 'imageGeneration';
  id: string;
  status: string;
  revisedPrompt: string | null;
  result: string;
  savedPath?: string;
}

export class CodexRuntime {
  private readonly codexHome: string;
  private readonly capability: Exclude<OAuthCapability, 'video'>;
  private readonly generatedImagesRoot: string;
  private readonly listeners = new Set<(status: OAuthProviderStatus) => void>();
  private client: CodexAppServerClient | null = null;
  private startPromise: Promise<void> | null = null;
  private unsubscribeNotification: (() => void) | null = null;
  private unsubscribeExit: (() => void) | null = null;
  private activeLoginId: string | null = null;
  private activeGeneration: ActiveGeneration | null = null;
  private activeCompletion: ActiveCompletion | null = null;
  private stopping = false;
  private status: OAuthProviderStatus;

  constructor(private readonly options: CodexRuntimeOptions) {
    this.capability = options.capability ?? 'image';
    this.status = {
      target: this.target,
      state: 'unavailable',
      reason: 'Codex App Server has not started.',
      version: CODEX_VERSION,
    };
    this.codexHome = path.resolve(options.codexHome);
    if (this.codexHome === path.parse(this.codexHome).root) {
      throw new Error('Codex home must not be a filesystem root');
    }
    this.generatedImagesRoot = path.join(this.codexHome, 'generated_images');
  }

  private get target(): OAuthProviderTarget {
    return { provider: 'chatgpt', capability: this.capability };
  }

  async start(): Promise<void> {
    if (this.startPromise) return this.startPromise;
    if (this.client) return;
    const operation = this.startInternal();
    this.startPromise = operation;
    try {
      await operation;
    } finally {
      if (this.startPromise === operation) this.startPromise = null;
    }
  }

  private async startInternal(): Promise<void> {
    this.stopping = false;
    try {
      await fsp.mkdir(this.generatedImagesRoot, { recursive: true, mode: 0o700 });
      const binaryPath =
        this.options.binaryPath ?? this.options.binaryResolver?.() ?? resolveCodexBinary();
      const client = (this.options.clientFactory ?? ((opts) => new CodexAppServerClient(opts)))({
        binaryPath,
        codexHome: this.codexHome,
      });
      this.client = client;
      this.unsubscribeNotification = client.onNotification(this.handleNotification);
      this.unsubscribeExit = client.onExit(this.handleClientExit);
      await client.start();
      await this.refreshStatus();
    } catch {
      await this.disposeClient();
      this.updateStatus({
        target: this.target,
        state: 'unavailable',
        reason: 'Codex App Server could not be started.',
        version: CODEX_VERSION,
      });
      throw new Error('Codex App Server could not be started');
    }
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.activeGeneration) {
      await this.cancelGeneration(this.activeGeneration.turnId ?? '').catch(() => undefined);
    }
    if (this.activeCompletion) await this.interruptCompletion(this.activeCompletion);
    this.activeLoginId = null;
    await this.disposeClient();
    await this.startPromise?.catch(() => undefined);
  }

  getStatus(): OAuthProviderStatus {
    return structuredClone(this.status);
  }

  onStatusChanged(listener: (status: OAuthProviderStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async login(): Promise<CodexLoginStartResult> {
    await this.start();
    const client = this.requireClient();
    if (this.activeLoginId) throw new Error('Codex sign-in is already in progress');

    const response = await client.startChatGptLogin();
    if (
      response.type !== 'chatgpt' ||
      typeof response.loginId !== 'string' ||
      !response.loginId ||
      typeof response.authUrl !== 'string' ||
      !response.authUrl
    ) {
      this.updateStatus(protocolErrorStatus(this.target));
      throw new Error('Codex did not start a managed ChatGPT sign-in');
    }
    this.activeLoginId = response.loginId;
    this.updateStatus({ target: this.target, state: 'signingIn', version: CODEX_VERSION });
    return { authUrl: response.authUrl, status: this.getStatus() };
  }

  async cancelLogin(): Promise<OAuthProviderStatus> {
    const client = this.requireClient();
    const loginId = this.activeLoginId;
    this.activeLoginId = null;
    if (loginId) await client.cancelLogin(loginId);
    await this.refreshStatus();
    return this.getStatus();
  }

  async logout(): Promise<OAuthProviderStatus> {
    const client = this.requireClient();
    const loginId = this.activeLoginId;
    this.activeLoginId = null;
    if (loginId) await client.cancelLogin(loginId).catch(() => undefined);
    await client.logout();
    this.updateStatus({ target: this.target, state: 'signedOut', version: CODEX_VERSION });
    return this.getStatus();
  }

  async generateImage(
    request: GenerationRequest,
    callbacks?: SubscribeCallbacks,
  ): Promise<GenerationResult> {
    const client = this.requireClient();
    if (this.capability !== 'image') {
      throw new Error('This ChatGPT OAuth profile is not authorized for image generation');
    }
    if (this.status.state !== 'ready') {
      throw new Error('Codex ChatGPT image generation is not ready');
    }
    if (request.type !== 'image') throw new Error('Codex image generation only accepts images');
    if (!request.prompt.trim()) throw new Error('An image prompt is required');
    if (this.activeGeneration) throw new Error('Codex image generation is already running');

    callbacks?.onQueueUpdate?.({ status: 'processing', currentStep: 'preparing' });
    callbacks?.onProgress?.({ type: 'progress', percentage: 5, currentStep: 'preparing' });

    const input = await this.buildUserInput(request);
    const threadResponse = await client.startThread({
      cwd: this.generatedImagesRoot,
      approvalPolicy: 'never',
      sandbox: 'read-only',
      ephemeral: true,
      developerInstructions:
        'Act only as an image-generation executor. The existing user prompt is authoritative. Do not browse, search, run commands, inspect files, edit files, plan, or ask questions. Invoke image generation exactly once and preserve the supplied visual intent.',
    });
    const threadId = readNestedString(threadResponse, 'thread', 'id');
    if (!threadId) throw new Error('Codex did not create an image generation thread');

    const active = this.createActiveGeneration(threadId);
    this.activeGeneration = active;
    try {
      const turnResponse = await client.startTurn({ threadId, input });
      const turnId = readNestedString(turnResponse, 'turn', 'id');
      if (!turnId) throw new Error('Codex did not create an image generation turn');
      active.turnId = turnId;
      callbacks?.onQueueUpdate?.({
        status: 'processing',
        currentStep: 'generating',
        jobId: turnId,
      });
      callbacks?.onProgress?.({
        type: 'progress',
        percentage: 20,
        currentStep: 'generating',
        jobId: turnId,
      });

      const imageItem = await active.promise;
      const assetPath = await materializeImageResult(
        imageItem,
        this.generatedImagesRoot,
        randomUUID(),
      );
      callbacks?.onProgress?.({
        type: 'progress',
        percentage: 100,
        currentStep: 'completed',
        jobId: turnId,
      });
      callbacks?.onQueueUpdate?.({
        status: 'completed',
        currentStep: 'completed',
        jobId: turnId,
      });
      return {
        assetHash: '',
        assetPath,
        provider: 'codex-imagegen',
        cost: 0,
        metadata: {
          source: 'chatgpt-subscription',
          ...(imageItem.revisedPrompt ? { revisedPrompt: imageItem.revisedPrompt } : {}),
        },
      };
    } catch (error) {
      const jobId = active.turnId ?? undefined;
      callbacks?.onQueueUpdate?.({
        status: 'failed',
        currentStep: 'failed',
        ...(jobId ? { jobId } : {}),
      });
      if (isQuotaError(error)) {
        this.updateStatus({
          target: this.target,
          state: 'error',
          code: 'quota_exhausted',
          message: 'ChatGPT image generation quota is unavailable or exhausted.',
          retryable: true,
          version: CODEX_VERSION,
        });
        throw new Error('ChatGPT image generation quota is unavailable or exhausted', {
          cause: error,
        });
      }
      throw error;
    } finally {
      clearTimeout(active.timer);
      if (this.activeGeneration === active) this.activeGeneration = null;
    }
  }

  async completeWithTools(
    messages: LLMMessage[],
    options: LLMRequestOptions = {},
  ): Promise<AsyncIterable<LLMStreamEvent>> {
    if (this.capability === 'image') {
      throw new Error('The ChatGPT image OAuth profile cannot be used as an LLM');
    }
    await this.start();
    if (this.status.state !== 'ready') throw new Error('ChatGPT OAuth is not ready');
    if (this.activeCompletion) throw new Error('ChatGPT completion is already running');
    if (options.tools?.length && !options.providerToolBridge) {
      throw new Error('ChatGPT tool execution requires the Commander host bridge');
    }

    const client = this.requireClient();
    const prepared = await this.buildLLMInput(messages);
    const dynamicTools = (options.tools ?? []).map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.parameters,
    }));
    const forcedTool = typeof options.toolChoice === 'object' ? options.toolChoice.name : null;
    const threadTools = forcedTool
      ? dynamicTools.filter((tool) => tool.name === forcedTool)
      : dynamicTools;
    const thread = await client.startThread({
      cwd: this.codexHome,
      approvalPolicy: 'never',
      sandbox: 'read-only',
      ephemeral: true,
      dynamicTools: threadTools,
      developerInstructions: [
        'You are the Commander language model inside Lucid Fin.',
        'Use only the dynamic tools supplied by the host. Never run commands, edit files, browse, call MCP, or ask through a built-in request-user-input tool.',
        'The host owns approvals, persistent workflow state, user questions, and tool execution. Treat every returned dynamic-tool result as authoritative.',
        forcedTool ? `Call the only supplied dynamic tool (${forcedTool}) before continuing.` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    });
    const threadId = readNestedString(thread, 'thread', 'id');
    if (!threadId) {
      await cleanupFiles(prepared.temporaryImages);
      throw new Error('Codex did not create a Commander thread');
    }
    const active: ActiveCompletion = {
      threadId,
      turnId: null,
      queue: new AsyncEventQueue<LLMStreamEvent>(),
      bridge:
        options.providerToolBridge ??
        ({
          execute: async (call: LLMToolCall) => ({
            toolCallId: call.id,
            content: JSON.stringify({ success: false, error: 'No tools are available' }),
            success: false,
          }),
        } satisfies NonNullable<LLMRequestOptions['providerToolBridge']>),
      allowedToolNames: new Set(threadTools.map((tool) => tool.name)),
      sawTextDelta: false,
      handledToolCall: false,
      temporaryImages: prepared.temporaryImages,
      settled: false,
      abortSignal: options.signal,
    };
    this.activeCompletion = active;
    client.setServerRequestHandler((request) => this.handleProviderToolRequest(active, request));
    if (options.signal) {
      const abortListener = (): void => {
        void this.interruptCompletion(active);
      };
      active.abortListener = abortListener;
      options.signal.addEventListener('abort', abortListener, { once: true });
    }
    try {
      const turn = await client.startTurn({ threadId, input: prepared.input });
      const turnId = readNestedString(turn, 'turn', 'id');
      if (!turnId) throw new Error('Codex did not create a Commander turn');
      active.turnId = turnId;
      return active.queue;
    } catch (error) {
      await this.finishCompletion(
        active,
        error instanceof Error ? error : new Error(String(error)),
      );
      throw error;
    }
  }

  private async buildLLMInput(messages: LLMMessage[]): Promise<{
    input: Array<Record<string, unknown>>;
    temporaryImages: string[];
  }> {
    const system = messages
      .filter((message) => message.role === 'system')
      .map((message) => message.content);
    const toolNamesById = new Map(
      messages.flatMap((message) =>
        (message.toolCalls ?? []).map((call) => [call.id, call.name] as const),
      ),
    );
    const transcript = messages
      .filter((message) => message.role !== 'system')
      .map((message) => serializeCodexTranscriptMessage(message, toolNamesById))
      .join('\n\n');
    const input: Array<Record<string, unknown>> = [
      {
        type: 'text',
        text: [...system.map((content) => `SYSTEM: ${content}`), transcript]
          .filter(Boolean)
          .join('\n\n'),
        text_elements: [],
      },
    ];
    const temporaryImages: string[] = [];
    const images = messages.flatMap((message) => message.images ?? []);
    if (images.length > 0 && this.capability !== 'vision' && this.capability !== 'llm') {
      throw new Error('Use the ChatGPT vision OAuth profile for image analysis');
    }
    if (images.length > 8) throw new Error('ChatGPT vision accepts at most eight images per turn');
    const imageRoot = path.join(this.codexHome, 'vision_inputs');
    if (images.length) await fsp.mkdir(imageRoot, { recursive: true, mode: 0o700 });
    try {
      for (const image of images) {
        const decoded = decodeVisionImage(image.data, image.mimeType);
        const filePath = path.join(imageRoot, `${randomUUID()}.${decoded.extension}`);
        await fsp.writeFile(filePath, decoded.bytes, { flag: 'wx', mode: 0o600 });
        temporaryImages.push(filePath);
        input.push({ type: 'localImage', detail: 'original', path: filePath });
      }
    } catch (error) {
      await cleanupFiles(temporaryImages);
      throw error;
    }
    return { input, temporaryImages };
  }

  private async handleProviderToolRequest(
    active: ActiveCompletion,
    request: CodexServerRequest,
  ): Promise<Record<string, unknown>> {
    if (this.activeCompletion !== active || active.settled || request.method !== 'item/tool/call') {
      throw new Error('Stale Codex tool request');
    }
    const call = parseCodexToolCall(request.params);
    if (!call || call.threadId !== active.threadId) throw new Error('Invalid Codex tool request');
    if (!active.allowedToolNames.has(call.name)) {
      throw new Error('Codex requested a tool that was not registered for this step');
    }
    if (active.turnId && call.turnId && call.turnId !== active.turnId) {
      throw new Error('Codex tool request belongs to another turn');
    }
    const result = await active.bridge.execute({
      id: call.callId,
      name: call.name,
      arguments: call.arguments,
    });
    if (result.toolCallId !== call.callId)
      throw new Error('Host returned a mismatched tool result');
    active.handledToolCall = true;
    active.queue.push({
      kind: 'tool_call_complete',
      id: call.callId,
      name: call.name,
      arguments: call.arguments,
      handledByProviderLoop: true,
    });
    setTimeout(() => {
      if (this.activeCompletion === active && active.turnId) {
        void this.client?.interruptTurn(active.threadId, active.turnId).catch(() => undefined);
      }
    }, 0).unref();
    return {
      contentItems: [{ type: 'inputText', text: result.content }],
      success: result.success,
    };
  }

  async cancelGeneration(jobId: string): Promise<void> {
    const active = this.activeGeneration;
    if (!active || (jobId && active.turnId && active.turnId !== jobId)) return;
    if (active.turnId) {
      await this.client?.interruptTurn(active.threadId, active.turnId).catch(() => undefined);
    }
    this.rejectGeneration(active, new Error('Codex image generation was cancelled'));
  }

  isGenerationActive(jobId: string): boolean {
    return Boolean(this.activeGeneration && this.activeGeneration.turnId === jobId);
  }

  private async refreshStatus(): Promise<void> {
    const client = this.requireClient();
    const response = await client.readAccount();
    const account = response.account;
    if (!account) {
      this.updateStatus({ target: this.target, state: 'signedOut', version: CODEX_VERSION });
      return;
    }
    if (account.type !== 'chatgpt') {
      this.updateStatus({
        target: this.target,
        state: 'error',
        code: 'wrong_auth_mode',
        message: `Sign in with ChatGPT to use ${this.capability}.`,
        retryable: false,
        version: CODEX_VERSION,
      });
      return;
    }
    const capabilities = await client.readCapabilities();
    if (this.capability === 'image' && !capabilities.imageGeneration) {
      this.updateStatus({
        target: this.target,
        state: 'error',
        code: 'capability_unavailable',
        message: 'Image generation is not available for this ChatGPT account.',
        retryable: false,
        version: CODEX_VERSION,
      });
      return;
    }
    const usage = await client
      .readRateLimits()
      .then(parseCodexUsage)
      .catch((): OAuthUsage => ({
        state: 'unavailable',
        reason: 'ChatGPT did not return current usage limits.',
      }));
    this.updateStatus({
      target: this.target,
      state: 'ready',
      planType: account.planType,
      usage,
      version: CODEX_VERSION,
    });
  }

  private async buildUserInput(
    request: GenerationRequest,
  ): Promise<Array<Record<string, unknown>>> {
    const input: Array<Record<string, unknown>> = [];
    const skill = await this.findImagegenSkill();
    if (skill) input.push({ type: 'skill', name: 'imagegen', path: skill });
    input.push({
      type: 'text',
      text: buildImagegenPrompt(request),
      text_elements: [],
    });

    const referenceImages = orderedUnique([
      request.sourceImagePath,
      ...(request.referenceImages ?? []),
    ]);
    if (referenceImages.length > 4) {
      throw new Error('Codex image generation accepts at most four reference images');
    }
    for (const imagePath of referenceImages) {
      await assertReferenceImage(imagePath);
      input.push({ type: 'localImage', detail: 'original', path: imagePath });
    }
    return input;
  }

  private async findImagegenSkill(): Promise<string | null> {
    try {
      const response = await this.requireClient().listSkills(this.generatedImagesRoot);
      if (!isRecord(response) || !Array.isArray(response.data)) return null;
      for (const entry of response.data) {
        if (!isRecord(entry) || !Array.isArray(entry.skills)) continue;
        for (const skill of entry.skills) {
          if (
            isRecord(skill) &&
            skill.name === 'imagegen' &&
            skill.enabled === true &&
            typeof skill.path === 'string'
          ) {
            return skill.path;
          }
        }
      }
    } catch {
      // `$imagegen` remains the stable invocation marker when discovery is unavailable.
    }
    return null;
  }

  private createActiveGeneration(threadId: string): ActiveGeneration {
    let resolve!: (item: ImageGenerationItem) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<ImageGenerationItem>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    const active = {
      threadId,
      turnId: null,
      resolve,
      reject,
      promise,
      imageItem: null,
      imageItemCount: 0,
      settled: false,
      timer: setTimeout(() => undefined, 1),
    } satisfies ActiveGeneration;
    clearTimeout(active.timer);
    active.timer = setTimeout(() => {
      void this.interruptTimedOutGeneration(active);
    }, this.options.generationTimeoutMs ?? DEFAULT_GENERATION_TIMEOUT_MS);
    active.timer.unref();
    return active;
  }

  private async interruptTimedOutGeneration(active: ActiveGeneration): Promise<void> {
    if (active.settled || this.activeGeneration !== active) return;
    if (active.turnId) {
      await this.client?.interruptTurn(active.threadId, active.turnId).catch(() => undefined);
    }
    this.rejectGeneration(active, new Error('Codex image generation timed out'));
  }

  private readonly handleNotification = (notification: CodexNotification): void => {
    if (notification.method === 'account/updated') {
      void this.refreshStatus().catch(() => this.updateStatus(protocolErrorStatus(this.target)));
      return;
    }
    if (notification.method === 'account/rateLimits/updated' && this.status.state === 'ready') {
      this.updateStatus({ ...this.status, usage: parseCodexUsage(notification.params) });
      return;
    }
    if (notification.method === 'account/login/completed') {
      this.handleLoginCompleted(notification.params);
      return;
    }
    if (
      notification.method === 'item/agentMessage/delta' ||
      notification.method === 'item/reasoning/summaryTextDelta' ||
      notification.method === 'item/reasoning/textDelta'
    ) {
      this.handleCompletionDelta(notification);
      return;
    }
    if (notification.method === 'item/completed') {
      this.handleCompletionItem(notification.params);
      this.handleItemCompleted(notification.params);
      return;
    }
    if (notification.method === 'turn/completed') {
      this.handleCompletionTurnCompleted(notification.params);
      this.handleTurnCompleted(notification.params);
    }
    if (notification.method === 'lucid/serverRequestDenied') {
      this.handleDeniedServerRequest(notification.params);
    }
  };

  private handleCompletionDelta(notification: CodexNotification): void {
    const active = this.activeCompletion;
    if (!active || !isRecord(notification.params)) return;
    if (notification.params.threadId !== active.threadId) return;
    if (active.turnId && notification.params.turnId !== active.turnId) return;
    const delta =
      typeof notification.params.delta === 'string'
        ? notification.params.delta
        : typeof notification.params.text === 'string'
          ? notification.params.text
          : '';
    if (!delta) return;
    if (notification.method === 'item/agentMessage/delta') {
      active.sawTextDelta = true;
      active.queue.push({ kind: 'text_delta', delta });
    } else {
      active.queue.push({ kind: 'reasoning_delta', delta });
    }
  }

  private handleCompletionItem(params: unknown): void {
    const active = this.activeCompletion;
    if (
      !active ||
      active.sawTextDelta ||
      !isRecord(params) ||
      params.threadId !== active.threadId
    ) {
      return;
    }
    if (active.turnId && params.turnId !== active.turnId) return;
    if (!isRecord(params.item) || params.item.type !== 'agentMessage') return;
    const text =
      typeof params.item.text === 'string'
        ? params.item.text
        : typeof params.item.content === 'string'
          ? params.item.content
          : '';
    if (text) active.queue.push({ kind: 'text_delta', delta: text });
  }

  private handleCompletionTurnCompleted(params: unknown): void {
    const active = this.activeCompletion;
    if (!active || !isRecord(params) || params.threadId !== active.threadId) return;
    if (!isRecord(params.turn)) return;
    if (active.turnId && params.turn.id !== active.turnId) return;
    const status = params.turn.status;
    if (status === 'completed') {
      active.queue.push({ kind: 'finished', finishReason: 'stop' });
      void this.finishCompletion(active);
      return;
    }
    if (status === 'interrupted' && active.handledToolCall) {
      active.queue.push({ kind: 'finished', finishReason: 'tool_calls' });
      void this.finishCompletion(active);
      return;
    }
    const message = readNestedString(params.turn, 'error', 'message');
    void this.finishCompletion(
      active,
      new Error(
        message ||
          (status === 'interrupted' ? 'ChatGPT turn was interrupted' : 'ChatGPT turn failed'),
      ),
    );
  }

  private async interruptCompletion(active: ActiveCompletion): Promise<void> {
    if (active.turnId) {
      await this.client?.interruptTurn(active.threadId, active.turnId).catch(() => undefined);
    }
    await this.finishCompletion(active, new Error('ChatGPT completion was cancelled'));
  }

  private async finishCompletion(active: ActiveCompletion, error?: Error): Promise<void> {
    if (active.settled) return;
    active.settled = true;
    if (active.abortSignal && active.abortListener) {
      active.abortSignal.removeEventListener('abort', active.abortListener);
    }
    if (this.activeCompletion === active) {
      this.activeCompletion = null;
      this.client?.setServerRequestHandler(null);
    }
    await cleanupFiles(active.temporaryImages);
    if (error) active.queue.fail(error);
    else active.queue.close();
  }

  private handleDeniedServerRequest(params: unknown): void {
    if (!isRecord(params)) return;
    const completion = this.activeCompletion;
    if (
      completion &&
      (!params.threadId || params.threadId === completion.threadId) &&
      (!completion.turnId || !params.turnId || params.turnId === completion.turnId)
    ) {
      if (completion.turnId) {
        void this.client
          ?.interruptTurn(completion.threadId, completion.turnId)
          .catch(() => undefined);
      }
      void this.finishCompletion(
        completion,
        new Error('ChatGPT requested a forbidden host action'),
      );
      return;
    }
    const generation = this.activeGeneration;
    if (!generation) return;
    if (params.threadId && params.threadId !== generation.threadId) return;
    if (generation.turnId && params.turnId && params.turnId !== generation.turnId) return;
    if (generation.turnId) {
      void this.client
        ?.interruptTurn(generation.threadId, generation.turnId)
        .catch(() => undefined);
    }
    this.rejectGeneration(
      generation,
      new Error('Codex image generation requested a forbidden external action'),
    );
  }

  private handleLoginCompleted(params: unknown): void {
    if (!isRecord(params)) return;
    const loginId = typeof params.loginId === 'string' ? params.loginId : null;
    if (this.activeLoginId && loginId && loginId !== this.activeLoginId) return;
    this.activeLoginId = null;
    if (params.success === true) {
      void this.refreshStatus().catch(() => this.updateStatus(protocolErrorStatus(this.target)));
    } else {
      this.updateStatus({
        target: this.target,
        state: 'error',
        code: 'protocol_error',
        message: 'ChatGPT sign-in did not complete.',
        retryable: true,
        version: CODEX_VERSION,
      });
    }
  }

  private handleItemCompleted(params: unknown): void {
    const active = this.activeGeneration;
    if (!active || !isRecord(params) || params.threadId !== active.threadId) return;
    if (active.turnId && params.turnId !== active.turnId) return;
    if (!isRecord(params.item) || params.item.type !== 'imageGeneration') return;
    const item = parseImageGenerationItem(params.item);
    if (!item) return;
    active.imageItemCount += 1;
    if (active.imageItemCount > 1) {
      if (active.turnId) {
        void this.client?.interruptTurn(active.threadId, active.turnId).catch(() => undefined);
      }
      this.rejectGeneration(active, new Error('Codex returned more than one image result'));
      return;
    }
    if (!['completed', 'succeeded', 'success'].includes(item.status.toLowerCase())) {
      this.rejectGeneration(active, new Error('Codex returned an incomplete image result'));
      return;
    }
    active.imageItem = item;
  }

  private handleTurnCompleted(params: unknown): void {
    const active = this.activeGeneration;
    if (!active || !isRecord(params) || params.threadId !== active.threadId) return;
    if (!isRecord(params.turn)) return;
    if (active.turnId && params.turn.id !== active.turnId) return;
    const status = params.turn.status;
    if (status === 'completed' && active.imageItem) {
      this.resolveGeneration(active, active.imageItem);
      return;
    }
    if (status === 'failed') {
      const rawMessage = readNestedString(params.turn, 'error', 'message') ?? '';
      this.rejectGeneration(
        active,
        new Error(isQuotaError(rawMessage) ? 'quota_exhausted' : 'Codex image generation failed'),
      );
      return;
    }
    if (status === 'interrupted') {
      this.rejectGeneration(active, new Error('Codex image generation was interrupted'));
      return;
    }
    if (status === 'completed') {
      this.rejectGeneration(active, new Error('Codex completed without an image result'));
    }
  }

  private resolveGeneration(active: ActiveGeneration, item: ImageGenerationItem): void {
    if (active.settled) return;
    active.settled = true;
    clearTimeout(active.timer);
    active.resolve(item);
  }

  private rejectGeneration(active: ActiveGeneration, error: Error): void {
    if (active.settled) return;
    active.settled = true;
    clearTimeout(active.timer);
    active.reject(error);
  }

  private readonly handleClientExit = (unexpected: boolean): void => {
    this.client = null;
    this.unsubscribeNotification?.();
    this.unsubscribeNotification = null;
    this.unsubscribeExit?.();
    this.unsubscribeExit = null;
    if (!unexpected || this.stopping) return;
    if (this.activeGeneration) {
      this.rejectGeneration(this.activeGeneration, new Error('Codex App Server exited'));
    }
    if (this.activeCompletion) {
      void this.finishCompletion(this.activeCompletion, new Error('Codex App Server exited'));
    }
    this.updateStatus({
      target: this.target,
      state: 'error',
      code: 'process_exited',
      message: 'Codex App Server exited unexpectedly.',
      retryable: true,
      version: CODEX_VERSION,
    });
  };

  private updateStatus(status: OAuthProviderStatus): void {
    this.status = status;
    const snapshot = this.getStatus();
    for (const listener of this.listeners) listener(snapshot);
  }

  private requireClient(): CodexAppServerClient {
    if (!this.client) throw new Error('Codex App Server is unavailable');
    return this.client;
  }

  private async disposeClient(): Promise<void> {
    const client = this.client;
    this.client = null;
    this.unsubscribeNotification?.();
    this.unsubscribeNotification = null;
    this.unsubscribeExit?.();
    this.unsubscribeExit = null;
    if (client) await client.stop();
  }
}

function protocolErrorStatus(target: OAuthProviderTarget): OAuthProviderStatus {
  return {
    target,
    state: 'error',
    code: 'protocol_error',
    message: 'Codex App Server returned an invalid response.',
    retryable: true,
    version: CODEX_VERSION,
  };
}

export function parseCodexUsage(value: unknown): OAuthUsage {
  const response = isRecord(value) ? value : {};
  const rateLimits = isRecord(response.rateLimits) ? response.rateLimits : response;
  const windows: Array<{
    id: string;
    label: string;
    usedPercent: number;
    remainingPercent: number;
    windowDurationMinutes?: number;
    resetsAt?: number;
  }> = [];
  for (const [id, label] of [
    ['primary', 'Primary window'],
    ['secondary', 'Secondary window'],
  ] as const) {
    const raw = rateLimits[id];
    if (!isRecord(raw) || typeof raw.usedPercent !== 'number') continue;
    const usedPercent = clampPercent(raw.usedPercent);
    const windowDurationMinutes =
      typeof raw.windowDurationMins === 'number' && raw.windowDurationMins > 0
        ? raw.windowDurationMins
        : undefined;
    const resetValue =
      typeof raw.resetsAt === 'number' && raw.resetsAt > 0 ? raw.resetsAt : undefined;
    windows.push({
      id,
      label,
      usedPercent,
      remainingPercent: clampPercent(100 - usedPercent),
      ...(windowDurationMinutes ? { windowDurationMinutes } : {}),
      ...(resetValue
        ? { resetsAt: resetValue < 1_000_000_000_000 ? resetValue * 1000 : resetValue }
        : {}),
    });
  }
  if (windows.length === 0) {
    return { state: 'unavailable', reason: 'ChatGPT did not return current usage limits.' };
  }
  const creditsValue = isRecord(response.credits)
    ? response.credits
    : isRecord(rateLimits.credits)
      ? rateLimits.credits
      : null;
  return {
    state: 'available',
    windows,
    ...(creditsValue
      ? {
          credits: {
            hasCredits: creditsValue.hasCredits === true,
            unlimited: creditsValue.unlimited === true,
            ...(typeof creditsValue.balance === 'string' || typeof creditsValue.balance === 'number'
              ? { balance: String(creditsValue.balance) }
              : {}),
          },
        }
      : {}),
  };
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value));
}

function buildImagegenPrompt(request: GenerationRequest): string {
  const hasReferences = Boolean(request.sourceImagePath || request.referenceImages?.length);
  const constraints = [
    request.width && request.height ? `Canvas: ${request.width}x${request.height}.` : null,
    request.quality ? `Quality: ${request.quality}.` : null,
    request.negativePrompt ? `Avoid: ${request.negativePrompt}` : null,
    hasReferences
      ? 'Attached images are ordered: the first is the source image when one is present, followed by character, scene, and style references. Preserve identity, wardrobe, and the approved visual continuity; do not redesign them.'
      : null,
  ].filter((value): value is string => Boolean(value));
  return [
    '$imagegen',
    'Generate exactly one image. Continue from this existing approved generator prompt; do not replace or broadly reinterpret it:',
    request.prompt,
    ...constraints,
  ].join('\n\n');
}

async function assertReferenceImage(filePath: string): Promise<void> {
  const stat = await fsp.lstat(filePath);
  if (!stat.isFile() || stat.isSymbolicLink())
    throw new Error('A Codex reference image is invalid');
  if (!['.png', '.jpg', '.jpeg', '.webp'].includes(path.extname(filePath).toLowerCase())) {
    throw new Error('Codex reference images must be PNG, JPEG, or WebP');
  }
}

async function materializeImageResult(
  item: ImageGenerationItem,
  generatedImagesRoot: string,
  outputId: string,
): Promise<string> {
  if (item.savedPath) return validateSavedImagePath(item.savedPath, generatedImagesRoot);
  const decoded = decodeImageBase64(item.result);
  const outputPath = path.join(generatedImagesRoot, `${outputId}.${decoded.extension}`);
  await fsp.writeFile(outputPath, decoded.bytes, { flag: 'wx', mode: 0o600 });
  return outputPath;
}

async function validateSavedImagePath(savedPath: string, root: string): Promise<string> {
  const rootRealPath = await fsp.realpath(root);
  const candidate = path.resolve(savedPath);
  const lstat = await fsp.lstat(candidate);
  if (
    !lstat.isFile() ||
    lstat.isSymbolicLink() ||
    lstat.size <= 0 ||
    lstat.size > MAX_IMAGE_BYTES
  ) {
    throw new Error('Codex returned an invalid saved image');
  }
  const realPath = await fsp.realpath(candidate);
  const relative = path.relative(rootRealPath, realPath);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Codex returned an image outside its managed output directory');
  }
  const prefix = Buffer.alloc(16);
  const file = await fsp.open(realPath, 'r');
  try {
    await file.read(prefix, 0, prefix.length, 0);
  } finally {
    await file.close();
  }
  detectImageFormat(prefix);
  return realPath;
}

function decodeImageBase64(value: string): { bytes: Buffer; extension: 'png' | 'jpg' | 'webp' } {
  if (!value || value.length > MAX_RESULT_BASE64_LENGTH) {
    throw new Error('Codex returned an invalid image payload');
  }
  let encoded = value;
  let declaredMime: string | null = null;
  const dataUrl = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]*={0,2})$/i.exec(value);
  if (dataUrl) {
    declaredMime = dataUrl[1].toLowerCase();
    encoded = dataUrl[2];
  } else if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    throw new Error('Codex returned an invalid image payload');
  }
  if (!encoded || encoded.length % 4 !== 0) {
    throw new Error('Codex returned an invalid image payload');
  }
  const bytes = Buffer.from(encoded, 'base64');
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) {
    throw new Error('Codex returned an invalid image payload');
  }
  const extension = detectImageFormat(bytes);
  if (
    declaredMime &&
    !(
      (declaredMime === 'image/png' && extension === 'png') ||
      (declaredMime === 'image/jpeg' && extension === 'jpg') ||
      (declaredMime === 'image/webp' && extension === 'webp')
    )
  ) {
    throw new Error('Codex returned a mismatched image payload');
  }
  return { bytes, extension };
}

function detectImageFormat(bytes: Uint8Array): 'png' | 'jpg' | 'webp' {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'jpg';
  }
  if (
    bytes.length >= 12 &&
    Buffer.from(bytes.subarray(0, 4)).toString('ascii') === 'RIFF' &&
    Buffer.from(bytes.subarray(8, 12)).toString('ascii') === 'WEBP'
  ) {
    return 'webp';
  }
  throw new Error('Codex returned an unsupported image format');
}

function parseImageGenerationItem(value: Record<string, unknown>): ImageGenerationItem | null {
  if (
    value.type !== 'imageGeneration' ||
    typeof value.id !== 'string' ||
    typeof value.status !== 'string' ||
    typeof value.result !== 'string'
  ) {
    return null;
  }
  return {
    type: 'imageGeneration',
    id: value.id,
    status: value.status,
    revisedPrompt: typeof value.revisedPrompt === 'string' ? value.revisedPrompt : null,
    result: value.result,
    ...(typeof value.savedPath === 'string' ? { savedPath: value.savedPath } : {}),
  };
}

function readNestedString(value: unknown, ...keys: string[]): string | null {
  let current = value;
  for (const key of keys) {
    if (!isRecord(current)) return null;
    current = current[key];
  }
  return typeof current === 'string' ? current : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isQuotaError(value: unknown): boolean {
  const message = value instanceof Error ? value.message : String(value);
  return /quota|rate.?limit|usage.?limit|credit/i.test(message);
}

function serializeCodexTranscriptMessage(
  message: LLMMessage,
  toolNamesById: ReadonlyMap<string, string>,
): string {
  if (message.role === 'tool') {
    const toolName = toolNamesById.get(message.toolCallId ?? '') ?? message.toolCallId ?? 'unknown';
    return `TOOL RESULT (${toolName}): ${message.content}`;
  }

  const lines = [`${message.role.toUpperCase()}: ${message.content}`];
  for (const call of message.toolCalls ?? []) {
    lines.push(`TOOL CALL (${call.name}): ${JSON.stringify(call.arguments)}`);
  }
  return lines.join('\n');
}

function orderedUnique(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const normalized = value?.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    output.push(normalized);
  }
  return output;
}

function parseCodexToolCall(value: unknown): {
  threadId: string;
  turnId?: string;
  callId: string;
  name: string;
  arguments: Record<string, unknown>;
} | null {
  if (!isRecord(value) || typeof value.threadId !== 'string') return null;
  const item = isRecord(value.item) ? value.item : value;
  const callId =
    typeof item.callId === 'string'
      ? item.callId
      : typeof item.id === 'string'
        ? item.id
        : typeof value.callId === 'string'
          ? value.callId
          : null;
  const tool = isRecord(item.tool) ? item.tool : null;
  const name =
    typeof item.name === 'string'
      ? item.name
      : typeof item.tool === 'string'
        ? item.tool
        : typeof tool?.name === 'string'
          ? tool.name
          : null;
  const rawArguments = item.arguments ?? item.input ?? value.arguments;
  let args: Record<string, unknown> | null = isRecord(rawArguments) ? rawArguments : null;
  if (!args && typeof rawArguments === 'string') {
    try {
      const parsed: unknown = JSON.parse(rawArguments);
      args = isRecord(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  if (!callId || !name || !args) return null;
  return {
    threadId: value.threadId,
    ...(typeof value.turnId === 'string' ? { turnId: value.turnId } : {}),
    callId,
    name,
    arguments: args,
  };
}

function decodeVisionImage(
  value: string,
  mimeType: string,
): { bytes: Buffer; extension: 'png' | 'jpg' | 'webp' } {
  const normalizedMime = mimeType.toLowerCase();
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(normalizedMime)) {
    throw new Error('ChatGPT vision images must be PNG, JPEG, or WebP');
  }
  const encoded = value.replace(/^data:[^;]+;base64,/, '');
  if (
    !encoded ||
    encoded.length > MAX_RESULT_BASE64_LENGTH ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)
  ) {
    throw new Error('ChatGPT vision received an invalid image payload');
  }
  const bytes = Buffer.from(encoded, 'base64');
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) {
    throw new Error('ChatGPT vision received an invalid image payload');
  }
  const extension = detectImageFormat(bytes);
  const expected = normalizedMime === 'image/jpeg' ? 'jpg' : normalizedMime.slice('image/'.length);
  if (extension !== expected) throw new Error('ChatGPT vision received a mismatched image payload');
  return { bytes, extension };
}

async function cleanupFiles(paths: string[]): Promise<void> {
  await Promise.all(paths.map((filePath) => fsp.unlink(filePath).catch(() => undefined)));
}

class AsyncEventQueue<T> implements AsyncIterable<T> {
  private readonly values: T[] = [];
  private readonly waiters: Array<{
    resolve: (value: IteratorResult<T>) => void;
    reject: (error: Error) => void;
  }> = [];
  private closed = false;
  private error: Error | null = null;

  push(value: T): void {
    if (this.closed) return;
    const waiter = this.waiters.shift();
    if (waiter) waiter.resolve({ value, done: false });
    else this.values.push(value);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) waiter.resolve({ value: undefined, done: true });
  }

  fail(error: Error): void {
    if (this.closed) return;
    this.error = error;
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) waiter.reject(error);
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        const value = this.values.shift();
        if (value !== undefined) return Promise.resolve({ value, done: false });
        if (this.error) return Promise.reject(this.error);
        if (this.closed) return Promise.resolve({ value: undefined, done: true });
        return new Promise<IteratorResult<T>>((resolve, reject) => {
          this.waiters.push({ resolve, reject });
        });
      },
    };
  }
}
