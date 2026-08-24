import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CodexAppServerClient, CodexNotification } from './codex-app-server.client.js';
import type { CodexServerRequest } from './codex-app-server.client.js';
import type { OAuthCapability } from '@lucid-fin/contracts';
import { CodexRuntime } from './codex-runtime.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

class FakeClient {
  account: unknown = {
    account: { type: 'chatgpt', email: 'never-render@example.com', planType: 'plus' },
    requiresOpenaiAuth: true,
  };
  readonly notifications = new Set<(notification: CodexNotification) => void>();
  readonly exits = new Set<(unexpected: boolean) => void>();
  readonly start = vi.fn(async () => undefined);
  readonly stop = vi.fn(async () => undefined);
  readonly readAccount = vi.fn(async () => this.account as never);
  readonly readCapabilities = vi.fn(async () => ({
    namespaceTools: false,
    imageGeneration: true,
    webSearch: false,
  }));
  readonly readRateLimits = vi.fn(async () => ({
    rateLimits: {
      primary: { usedPercent: 20, windowDurationMins: 300 },
    },
  }));
  readonly startChatGptLogin = vi.fn(async () => ({
    type: 'chatgpt',
    loginId: 'login-secret',
    authUrl: 'https://auth.openai.com/oauth/authorize?secret=hidden',
  }));
  readonly cancelLogin = vi.fn(async () => ({}));
  readonly logout = vi.fn(async () => ({}));
  readonly listSkills = vi.fn(async () => ({
    data: [
      {
        cwd: 'generated',
        errors: [],
        skills: [{ name: 'imagegen', enabled: true, path: 'C:\\skills\\imagegen\\SKILL.md' }],
      },
    ],
  }));
  readonly listModels = vi.fn(async () => ({
    data: [
      {
        id: 'gpt-5.6-sol',
        model: 'gpt-5.6-sol',
        supportedReasoningEfforts: [
          { reasoningEffort: 'high' },
          { reasoningEffort: 'xhigh' },
        ],
      },
    ],
    nextCursor: null,
  }));
  readonly startThread = vi.fn(async () => ({ thread: { id: 'thread-1' } }));
  readonly startTurn = vi.fn(async () => ({ turn: { id: 'turn-1' } }));
  readonly interruptTurn = vi.fn(async () => ({}));
  serverRequestHandler: ((request: CodexServerRequest) => Promise<unknown>) | null = null;

  setServerRequestHandler(
    handler: ((request: CodexServerRequest) => Promise<unknown>) | null,
  ): void {
    this.serverRequestHandler = handler;
  }

  onNotification(listener: (notification: CodexNotification) => void): () => void {
    this.notifications.add(listener);
    return () => this.notifications.delete(listener);
  }

  onExit(listener: (unexpected: boolean) => void): () => void {
    this.exits.add(listener);
    return () => this.exits.delete(listener);
  }

  emit(method: string, params: unknown): void {
    for (const listener of this.notifications) listener({ method, params });
  }
}

function createRuntime(
  client: FakeClient,
  generationTimeoutMs = 1_000,
  capability: OAuthCapability = 'image',
): {
  runtime: CodexRuntime;
  home: string;
} {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lucid-codex-runtime-'));
  temporaryDirectories.push(home);
  const runtime = new CodexRuntime({
    codexHome: home,
    binaryPath: 'unused-in-test',
    capability,
    generationTimeoutMs,
    clientFactory: () => client as unknown as CodexAppServerClient,
  });
  return { runtime, home };
}

describe('Codex runtime', () => {
  it('passes the configured model and non-empty reasoning effort to Codex', async () => {
    const client = new FakeClient();
    const { runtime } = createRuntime(client, 1_000, 'llm');
    await runtime.start();
    runtime.configureLLM({ model: 'gpt-5.6-sol', reasoningEffort: 'xhigh' });
    client.startTurn.mockImplementationOnce(async () => {
      setImmediate(() => {
        client.emit('turn/completed', {
          threadId: 'thread-1',
          turn: { id: 'turn-1', status: 'completed' },
        });
      });
      return { turn: { id: 'turn-1' } };
    });

    const stream = await runtime.completeWithTools([{ role: 'user', content: 'Plan it' }]);
    for await (const _event of stream) {
      // Drain the finite turn.
    }

    expect(client.startThread).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gpt-5.6-sol' }),
    );
    expect(client.startTurn).toHaveBeenCalledWith(
      expect.objectContaining({ effort: 'xhigh' }),
    );
    await runtime.stop();
  });

  it('bridges only registered dynamic tools through the host-owned Commander executor', async () => {
    const client = new FakeClient();
    const { runtime } = createRuntime(client, 1_000, 'llm');
    await runtime.start();
    const execute = vi.fn(async (call) => ({
      toolCallId: call.id,
      content: JSON.stringify({ success: true, value: 'approved result' }),
      success: true,
    }));
    client.startTurn.mockImplementationOnce(async () => {
      setImmediate(async () => {
        await client.serverRequestHandler?.({
          id: 1,
          method: 'item/tool/call',
          params: {
            threadId: 'thread-1',
            turnId: 'turn-1',
            callId: 'call-1',
            tool: 'canvas_read',
            arguments: { canvasId: 'canvas-1' },
          },
        });
        client.emit('turn/completed', {
          threadId: 'thread-1',
          turn: { id: 'turn-1', status: 'interrupted' },
        });
      });
      return { turn: { id: 'turn-1' } };
    });

    const stream = await runtime.completeWithTools(
      [{ role: 'user', content: 'Inspect the canvas' }],
      {
        tools: [
          {
            name: 'canvas_read',
            description: 'Read the canvas',
            parameters: { type: 'object', properties: {} },
          },
        ],
        providerToolBridge: { execute },
      },
    );
    const events = [];
    for await (const event of stream) events.push(event);

    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'call-1', name: 'canvas_read' }),
    );
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'tool_call_complete',
          handledByProviderLoop: true,
        }),
        { kind: 'finished', finishReason: 'tool_calls' },
      ]),
    );
    expect(client.startThread).toHaveBeenCalledWith(
      expect.objectContaining({
        approvalPolicy: 'never',
        sandbox: 'read-only',
        dynamicTools: [expect.objectContaining({ name: 'canvas_read' })],
      }),
    );
    await runtime.stop();
  });

  it('replays prior tool names, arguments, and results into each ephemeral Commander thread', async () => {
    const client = new FakeClient();
    const { runtime } = createRuntime(client, 1_000, 'llm');
    await runtime.start();

    await runtime.completeWithTools([
      { role: 'user', content: 'Inspect the canvas' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [
          {
            id: 'call-previous',
            name: 'canvas.read',
            arguments: { canvasId: 'canvas-1' },
          },
        ],
      },
      {
        role: 'tool',
        toolCallId: 'call-previous',
        content: '{"success":true,"nodeCount":4}',
      },
    ]);

    const turnInput = vi.mocked(client.startTurn).mock.calls[0][0] as {
      input: Array<Record<string, unknown>>;
    };
    const text = String(turnInput.input.find((item) => item.type === 'text')?.text ?? '');
    expect(text).toContain('TOOL CALL (canvas.read): {"canvasId":"canvas-1"}');
    expect(text).toContain('TOOL RESULT (canvas.read): {"success":true,"nodeCount":4}');

    await runtime.stop();
  });

  it('deduplicates startup so login waits for the in-flight App Server initialization', async () => {
    const client = new FakeClient();
    client.account = { account: null, requiresOpenaiAuth: true };
    let releaseStart: (() => void) | undefined;
    client.start.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releaseStart = resolve;
        }),
    );
    const { runtime } = createRuntime(client);

    const startup = runtime.start();
    const login = runtime.login();
    await vi.waitFor(() => expect(client.start).toHaveBeenCalledTimes(1));
    expect(client.startChatGptLogin).not.toHaveBeenCalled();

    releaseStart?.();
    await startup;
    await expect(login).resolves.toMatchObject({ status: { state: 'signingIn' } });
    expect(client.start).toHaveBeenCalledTimes(1);
    await runtime.stop();
  });

  it('exposes only redacted account state and starts managed ChatGPT login', async () => {
    const client = new FakeClient();
    client.account = { account: null, requiresOpenaiAuth: true };
    const { runtime } = createRuntime(client);
    await runtime.start();
    expect(runtime.getStatus()).toEqual({
      target: { provider: 'chatgpt', capability: 'image' },
      state: 'signedOut',
      version: '0.145.0',
    });

    const result = await runtime.login();
    expect(result.authUrl).toContain('auth.openai.com');
    expect(result.status).toEqual({
      target: { provider: 'chatgpt', capability: 'image' },
      state: 'signingIn',
      version: '0.145.0',
    });
    expect(JSON.stringify(result.status)).not.toContain('secret');
    expect(JSON.stringify(result.status)).not.toContain('example.com');
    await runtime.stop();
  });

  it('passes the existing prompt and ordered original references into an ephemeral read-only turn', async () => {
    const client = new FakeClient();
    const { runtime, home } = createRuntime(client);
    await runtime.start();
    const first = path.join(home, 'first.png');
    const second = path.join(home, 'second.jpg');
    fs.writeFileSync(first, pngBytes());
    fs.writeFileSync(second, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    const output = path.join(home, 'generated_images', 'result.png');
    fs.writeFileSync(output, pngBytes());

    client.startTurn.mockImplementationOnce(async () => {
      setImmediate(() => {
        client.emit('item/completed', {
          threadId: 'thread-1',
          turnId: 'turn-1',
          item: {
            type: 'imageGeneration',
            id: 'image-1',
            status: 'completed',
            revisedPrompt: null,
            result: '',
            savedPath: output,
          },
        });
        client.emit('turn/completed', {
          threadId: 'thread-1',
          turn: { id: 'turn-1', status: 'completed' },
        });
      });
      return { turn: { id: 'turn-1' } };
    });

    const prompt = 'Keep this exact prompt, including trailing space. ';
    const result = await runtime.generateImage({
      type: 'image',
      providerId: 'codex-imagegen',
      prompt,
      sourceImagePath: first,
      referenceImages: [second],
    });

    expect(result.assetPath).toBe(fs.realpathSync(output));
    expect(client.startThread).toHaveBeenCalledWith(
      expect.objectContaining({ approvalPolicy: 'never', sandbox: 'read-only', ephemeral: true }),
    );
    const turnInput = vi.mocked(client.startTurn).mock.calls[0][0] as {
      input: Array<Record<string, unknown>>;
    };
    const text = turnInput.input.find((item) => item.type === 'text');
    expect(text?.text).toContain(prompt);
    expect(turnInput.input.filter((item) => item.type === 'localImage')).toEqual([
      { type: 'localImage', detail: 'original', path: first },
      { type: 'localImage', detail: 'original', path: second },
    ]);
    await runtime.stop();
  });

  it('rejects multiple matching image results and interrupts the turn', async () => {
    const client = new FakeClient();
    const { runtime } = createRuntime(client);
    await runtime.start();
    client.startTurn.mockImplementationOnce(async () => {
      setImmediate(() => {
        const item = {
          type: 'imageGeneration',
          id: 'image',
          status: 'completed',
          revisedPrompt: null,
          result: pngBytes().toString('base64'),
        };
        client.emit('item/completed', { threadId: 'thread-1', turnId: 'turn-1', item });
        client.emit('item/completed', {
          threadId: 'thread-1',
          turnId: 'turn-1',
          item: { ...item, id: 'image-2' },
        });
      });
      return { turn: { id: 'turn-1' } };
    });

    await expect(
      runtime.generateImage({
        type: 'image',
        providerId: 'codex-imagegen',
        prompt: 'one image',
      }),
    ).rejects.toThrow('more than one image');
    expect(client.interruptTurn).toHaveBeenCalledWith('thread-1', 'turn-1');
    await runtime.stop();
  });

  it('interrupts a timed-out generation and accepts a bounded base64 fallback', async () => {
    const timeoutClient = new FakeClient();
    const { runtime: timeoutRuntime } = createRuntime(timeoutClient, 20);
    await timeoutRuntime.start();
    await expect(
      timeoutRuntime.generateImage({
        type: 'image',
        providerId: 'codex-imagegen',
        prompt: 'timeout',
      }),
    ).rejects.toThrow('timed out');
    expect(timeoutClient.interruptTurn).toHaveBeenCalledWith('thread-1', 'turn-1');
    await timeoutRuntime.stop();

    const base64Client = new FakeClient();
    const { runtime: base64Runtime, home } = createRuntime(base64Client);
    await base64Runtime.start();
    base64Client.startTurn.mockImplementationOnce(async () => {
      setImmediate(() => {
        base64Client.emit('item/completed', {
          threadId: 'thread-1',
          turnId: 'turn-1',
          item: {
            type: 'imageGeneration',
            id: 'image-1',
            status: 'completed',
            revisedPrompt: null,
            result: pngBytes().toString('base64'),
          },
        });
        base64Client.emit('turn/completed', {
          threadId: 'thread-1',
          turn: { id: 'turn-1', status: 'completed' },
        });
      });
      return { turn: { id: 'turn-1' } };
    });
    const result = await base64Runtime.generateImage({
      type: 'image',
      providerId: 'codex-imagegen',
      prompt: 'base64',
    });
    expect(path.dirname(result.assetPath)).toBe(path.join(home, 'generated_images'));
    expect(fs.readFileSync(result.assetPath)).toEqual(pngBytes());
    await base64Runtime.stop();
  });
});

function pngBytes(): Buffer {
  return Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
}
