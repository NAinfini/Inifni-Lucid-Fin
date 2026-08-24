import { spawn, type ChildProcessWithoutNullStreams, type SpawnOptions } from 'node:child_process';
import path from 'node:path';
import { CODEX_VERSION } from './codex-binary.js';

const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const MAX_JSONL_LINE_BYTES = 64 * 1024 * 1024;

export type CodexClientErrorCode = 'process_exited' | 'protocol_error' | 'timeout';

export class CodexClientError extends Error {
  constructor(
    readonly code: CodexClientErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'CodexClientError';
  }
}

export interface CodexNotification {
  method: string;
  params?: unknown;
}

export interface CodexServerRequest {
  id: string | number;
  method: string;
  params?: unknown;
}

export type CodexServerRequestHandler = (request: CodexServerRequest) => Promise<unknown>;

export interface CodexAccountResponse {
  account:
    | null
    | { type: 'apiKey' }
    | { type: 'chatgpt'; email: string | null; planType: string | null }
    | { type: 'amazonBedrock'; usesCodexManagedCredentials: boolean };
  requiresOpenaiAuth: boolean;
}

export interface CodexLoginResponse {
  type: string;
  loginId?: string;
  authUrl?: string;
}

export interface CodexCapabilitiesResponse {
  namespaceTools: boolean;
  imageGeneration: boolean;
  webSearch: boolean;
}

export interface CodexRateLimitsResponse {
  rateLimits?: unknown;
  credits?: unknown;
  [key: string]: unknown;
}

export interface CodexAppServerClientOptions {
  binaryPath: string;
  codexHome: string;
  requestTimeoutMs?: number;
  maxJsonlLineBytes?: number;
  spawnProcess?: typeof spawn;
  environment?: NodeJS.ProcessEnv;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

interface JsonRpcResponse {
  id: string | number;
  result?: unknown;
  error?: unknown;
}

export class CodexAppServerClient {
  private child: ChildProcessWithoutNullStreams | null = null;
  private nextRequestId = 1;
  private stdoutBuffer = '';
  private stdoutBufferBytes = 0;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly notificationListeners = new Set<(notification: CodexNotification) => void>();
  private readonly exitListeners = new Set<(unexpected: boolean) => void>();
  private serverRequestHandler: CodexServerRequestHandler | null = null;
  private stopping = false;
  private started = false;
  private terminationNotified = false;

  constructor(private readonly options: CodexAppServerClientOptions) {}

  async start(): Promise<void> {
    if (this.started) return;
    this.stopping = false;
    this.terminationNotified = false;
    const child = (this.options.spawnProcess ?? spawn)(
      this.options.binaryPath,
      ['app-server', '--stdio'],
      {
        cwd: path.resolve(this.options.codexHome),
        env: buildCodexEnvironment(this.options.codexHome, this.options.environment),
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      } satisfies SpawnOptions,
    ) as ChildProcessWithoutNullStreams;
    this.child = child;
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', this.handleStdout);
    // Stderr can contain upstream diagnostics. Drain it, but never retain or expose it.
    child.stderr.on('data', () => undefined);
    child.on('error', this.handleProcessError);
    child.once('exit', this.handleExit);

    try {
      await waitForSpawn(child);
      this.started = true;
      await this.request('initialize', {
        clientInfo: { name: 'lucid-fin', title: 'Lucid Fin', version: CODEX_VERSION },
        capabilities: {
          experimentalApi: true,
          requestAttestation: false,
          optOutNotificationMethods: [
            'rawResponseItem/completed',
            'rawResponse/completed',
            'command/exec/outputDelta',
            'process/outputDelta',
            'item/commandExecution/outputDelta',
            'item/fileChange/outputDelta',
            'turn/diff/updated',
            'turn/plan/updated',
          ],
        },
      });
      this.notify('initialized');
    } catch {
      await this.stop().catch(() => undefined);
      throw new CodexClientError('process_exited', 'Codex App Server failed to start');
    }
  }

  async stop(): Promise<void> {
    const child = this.child;
    if (!child) return;
    this.stopping = true;
    this.started = false;
    this.child = null;
    this.rejectPending(new CodexClientError('process_exited', 'Codex App Server stopped'));
    child.stdout.off('data', this.handleStdout);
    child.stdin.end();

    if (child.exitCode !== null || child.signalCode !== null) return;
    if (await waitForExit(child, 500)) return;
    child.kill();
    if (await waitForExit(child, 1_000)) return;
    child.kill('SIGKILL');
    await waitForExit(child, 500);
  }

  onNotification(listener: (notification: CodexNotification) => void): () => void {
    this.notificationListeners.add(listener);
    return () => this.notificationListeners.delete(listener);
  }

  onExit(listener: (unexpected: boolean) => void): () => void {
    this.exitListeners.add(listener);
    return () => this.exitListeners.delete(listener);
  }

  setServerRequestHandler(handler: CodexServerRequestHandler | null): void {
    this.serverRequestHandler = handler;
  }

  readAccount(): Promise<CodexAccountResponse> {
    return this.request('account/read', { refreshToken: false });
  }

  startChatGptLogin(): Promise<CodexLoginResponse> {
    return this.request('account/login/start', {
      type: 'chatgpt',
      useHostedLoginSuccessPage: true,
      appBrand: 'chatgpt',
    });
  }

  cancelLogin(loginId: string): Promise<Record<string, never>> {
    return this.request('account/login/cancel', { loginId });
  }

  logout(): Promise<Record<string, never>> {
    return this.request('account/logout', undefined);
  }

  readCapabilities(): Promise<CodexCapabilitiesResponse> {
    return this.request('modelProvider/capabilities/read', {});
  }

  listModels(params: { cursor?: string; limit?: number; includeHidden?: boolean } = {}): Promise<unknown> {
    return this.request('model/list', params);
  }

  readRateLimits(): Promise<CodexRateLimitsResponse> {
    return this.request('account/rateLimits/read', {});
  }

  listSkills(cwd: string): Promise<unknown> {
    return this.request('skills/list', { cwds: [cwd], forceReload: false });
  }

  startThread(params: Record<string, unknown>): Promise<unknown> {
    return this.request('thread/start', params);
  }

  startTurn(params: Record<string, unknown>): Promise<unknown> {
    return this.request('turn/start', params);
  }

  interruptTurn(threadId: string, turnId: string): Promise<unknown> {
    return this.request('turn/interrupt', { threadId, turnId });
  }

  private request<T>(method: string, params: unknown, timeoutMs?: number): Promise<T> {
    if (!this.started || !this.child?.stdin.writable) {
      return Promise.reject(
        new CodexClientError('process_exited', 'Codex App Server is not running'),
      );
    }
    const id = this.nextRequestId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(
        () => {
          this.pending.delete(id);
          reject(new CodexClientError('timeout', `Codex request timed out: ${method}`));
        },
        timeoutMs ?? this.options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
      );
      timer.unref();
      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
      });
      try {
        this.child?.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
      } catch {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new CodexClientError('process_exited', 'Codex App Server is not writable'));
      }
    });
  }

  private notify(method: string, params?: unknown): void {
    if (!this.child?.stdin.writable) return;
    this.child.stdin.write(
      `${JSON.stringify({ method, ...(params === undefined ? {} : { params }) })}\n`,
    );
  }

  private readonly handleStdout = (chunk: string | Buffer): void => {
    const text = chunk.toString();
    this.stdoutBuffer += text;
    this.stdoutBufferBytes += Buffer.byteLength(text, 'utf8');

    let consumedCharacters = 0;
    let newline = this.stdoutBuffer.indexOf('\n', consumedCharacters);
    while (newline >= 0) {
      const consumed = this.stdoutBuffer.slice(consumedCharacters, newline + 1);
      const line = consumed.slice(0, -1).trim();
      const consumedBytes = Buffer.byteLength(consumed, 'utf8');
      this.stdoutBufferBytes -= consumedBytes;
      if (consumedBytes - 1 > (this.options.maxJsonlLineBytes ?? MAX_JSONL_LINE_BYTES)) {
        this.failProtocol();
        return;
      }
      if (line) this.handleLine(line);
      consumedCharacters = newline + 1;
      newline = this.stdoutBuffer.indexOf('\n', consumedCharacters);
    }
    if (consumedCharacters > 0) {
      this.stdoutBuffer = this.stdoutBuffer.slice(consumedCharacters);
    }
    if (this.stdoutBufferBytes > (this.options.maxJsonlLineBytes ?? MAX_JSONL_LINE_BYTES)) {
      this.failProtocol();
    }
  };

  private handleLine(line: string): void {
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      this.failProtocol();
      return;
    }
    if (!isRecord(message)) return;

    if ((typeof message.id === 'number' || typeof message.id === 'string') && !message.method) {
      const response = message as unknown as JsonRpcResponse;
      const numericId =
        typeof response.id === 'number' ? response.id : Number.parseInt(response.id, 10);
      const pending = this.pending.get(numericId);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(numericId);
      if (response.error !== undefined) {
        pending.reject(new CodexClientError('protocol_error', 'Codex App Server request failed'));
      } else {
        pending.resolve(response.result);
      }
      return;
    }

    if (typeof message.method !== 'string') return;
    if (message.id !== undefined) {
      void this.handleServerRequest(message.id, message.method, message.params);
      return;
    }
    const notification: CodexNotification = { method: message.method, params: message.params };
    queueMicrotask(() => {
      for (const listener of this.notificationListeners) listener(notification);
    });
  }

  private async handleServerRequest(id: unknown, method: string, params: unknown): Promise<void> {
    if (!this.child?.stdin.writable || (typeof id !== 'number' && typeof id !== 'string')) return;
    const handler = this.serverRequestHandler;
    if (!handler || method !== 'item/tool/call') {
      this.denyServerRequest(id, method, params);
      return;
    }
    try {
      const result = await handler({ id, method, params });
      if (this.child?.stdin.writable) {
        this.child.stdin.write(`${JSON.stringify({ id, result })}\n`);
      }
    } catch {
      if (this.child?.stdin.writable) {
        this.child.stdin.write(
          `${JSON.stringify({ id, error: { code: -32000, message: 'Host tool execution failed' } })}\n`,
        );
      }
    }
  }

  private denyServerRequest(id: unknown, method: string, params: unknown): void {
    if (!this.child?.stdin.writable || (typeof id !== 'number' && typeof id !== 'string')) return;
    const result = deniedServerRequestResult(method);
    this.child.stdin.write(`${JSON.stringify({ id, ...result })}\n`);

    const identifiers = isRecord(params)
      ? {
          ...(typeof params.threadId === 'string' ? { threadId: params.threadId } : {}),
          ...(typeof params.turnId === 'string' ? { turnId: params.turnId } : {}),
        }
      : {};
    queueMicrotask(() => {
      const notification: CodexNotification = {
        method: 'lucid/serverRequestDenied',
        params: identifiers,
      };
      for (const listener of this.notificationListeners) listener(notification);
    });
  }

  private failProtocol(): void {
    this.stdoutBuffer = '';
    this.stdoutBufferBytes = 0;
    this.rejectPending(new CodexClientError('protocol_error', 'Codex App Server protocol error'));
    this.child?.kill();
  }

  private readonly handleExit = (): void => {
    this.handleTermination(!this.stopping);
  };

  private readonly handleProcessError = (): void => {
    const child = this.child;
    this.handleTermination(!this.stopping);
    if (child && child.exitCode === null && child.signalCode === null) {
      try {
        child.kill();
      } catch {
        // The process error is already reflected through the sanitized exit state.
      }
    }
  };

  private handleTermination(unexpected: boolean): void {
    if (this.terminationNotified) return;
    this.terminationNotified = true;
    this.started = false;
    this.child = null;
    this.rejectPending(new CodexClientError('process_exited', 'Codex App Server exited'));
    for (const listener of this.exitListeners) listener(unexpected);
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}

export function buildCodexEnvironment(
  codexHome: string,
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const environment = { ...source };
  for (const key of Object.keys(environment)) {
    if (/^(?:OPENAI|CODEX|CHATGPT)_(?:.*(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIALS?))$/i.test(key)) {
      delete environment[key];
    }
  }
  environment.CODEX_HOME = path.resolve(codexHome);
  return environment;
}

function waitForSpawn(child: ChildProcessWithoutNullStreams): Promise<void> {
  return new Promise((resolve, reject) => {
    const onSpawn = (): void => {
      child.off('error', onError);
      resolve();
    };
    const onError = (): void => {
      child.off('spawn', onSpawn);
      reject(new CodexClientError('process_exited', 'Codex App Server failed to spawn'));
    };
    child.once('spawn', onSpawn);
    child.once('error', onError);
  });
}

function waitForExit(child: ChildProcessWithoutNullStreams, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    const onExit = (): void => {
      clearTimeout(timer);
      resolve(true);
    };
    const timer = setTimeout(() => {
      child.off('exit', onExit);
      resolve(false);
    }, timeoutMs);
    timer.unref();
    child.once('exit', onExit);
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function deniedServerRequestResult(method: string): Record<string, unknown> {
  switch (method) {
    case 'item/commandExecution/requestApproval':
    case 'item/fileChange/requestApproval':
      return { result: { decision: 'decline' } };
    case 'applyPatchApproval':
    case 'execCommandApproval':
      return {
        result: { decision: { denied: { rejection: 'Image generation cannot approve actions' } } },
      };
    case 'item/tool/requestUserInput':
      return { result: { answers: {} } };
    case 'mcpServer/elicitation/request':
      return { result: { action: 'decline', content: null, _meta: null } };
    case 'item/permissions/requestApproval':
      return { result: { permissions: {}, scope: 'turn', strictAutoReview: true } };
    case 'item/tool/call':
      return { result: { contentItems: [], success: false } };
    default:
      return { error: { code: -32601, message: 'Unsupported server request' } };
  }
}
