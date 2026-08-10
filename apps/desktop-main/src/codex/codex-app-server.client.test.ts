import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { buildCodexEnvironment, CodexAppServerClient } from './codex-app-server.client.js';

class FakeChild extends EventEmitter {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  readonly writes: Array<Record<string, unknown>> = [];
  private buffer = '';

  constructor() {
    super();
    this.stdin.on('data', (chunk) => this.handleWrite(chunk.toString()));
    this.stdin.once('finish', () => this.exit());
    queueMicrotask(() => this.emit('spawn'));
  }

  readonly kill = vi.fn((_signal?: NodeJS.Signals | number) => {
    this.exit();
    return true;
  });

  send(message: Record<string, unknown>): void {
    this.stdout.write(`${JSON.stringify(message)}\n`);
  }

  sendChunked(message: Record<string, unknown>, chunkSize: number): void {
    const line = `${JSON.stringify(message)}\n`;
    for (let offset = 0; offset < line.length; offset += chunkSize) {
      this.stdout.write(line.slice(offset, offset + chunkSize));
    }
  }

  sendRaw(value: string): void {
    this.stdout.write(value);
  }

  private handleWrite(chunk: string): void {
    this.buffer += chunk;
    let newline = this.buffer.indexOf('\n');
    while (newline >= 0) {
      const message = JSON.parse(this.buffer.slice(0, newline)) as Record<string, unknown>;
      this.buffer = this.buffer.slice(newline + 1);
      this.writes.push(message);
      if (message.method === 'initialize') this.send({ id: message.id, result: {} });
      newline = this.buffer.indexOf('\n');
    }
  }

  private exit(): void {
    if (this.exitCode !== null) return;
    this.exitCode = 0;
    this.emit('exit', 0, null);
  }
}

describe('Codex App Server client', () => {
  it('spawns native app-server with isolated credentials and rejects approval requests', async () => {
    const child = new FakeChild();
    const spawnProcess = vi.fn(() => child as unknown as ChildProcessWithoutNullStreams);
    const client = new CodexAppServerClient({
      binaryPath: 'C:\\bundled\\codex.exe',
      codexHome: 'C:\\lucid\\codex-home',
      environment: {
        PATH: 'C:\\Windows',
        OPENAI_API_KEY: 'platform-secret',
        CODEX_ACCESS_TOKEN: 'oauth-secret',
        CHATGPT_REFRESH_TOKEN: 'refresh-secret',
      },
      spawnProcess: spawnProcess as unknown as typeof spawn,
    });

    await client.start();
    expect(spawnProcess).toHaveBeenCalledWith(
      'C:\\bundled\\codex.exe',
      ['app-server', '--stdio'],
      expect.objectContaining({ windowsHide: true }),
    );
    const environment = vi.mocked(spawnProcess).mock.calls[0][2]?.env;
    expect(environment?.OPENAI_API_KEY).toBeUndefined();
    expect(environment?.CODEX_ACCESS_TOKEN).toBeUndefined();
    expect(environment?.CHATGPT_REFRESH_TOKEN).toBeUndefined();
    expect(environment?.CODEX_HOME).toBe('C:\\lucid\\codex-home');
    expect(child.writes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ method: 'initialize' }),
        expect.objectContaining({ method: 'initialized' }),
      ]),
    );

    child.send({
      id: 99,
      method: 'item/commandExecution/requestApproval',
      params: { threadId: 'thread-1', turnId: 'turn-1', command: 'forbidden' },
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(child.writes).toContainEqual({ id: 99, result: { decision: 'decline' } });

    await client.stop();
    expect(child.kill).not.toHaveBeenCalled();
  });

  it('builds a copy of the environment without mutating the source', () => {
    const source = { OPENAI_API_KEY: 'secret', SAFE_VALUE: 'kept' };
    const environment = buildCodexEnvironment('C:\\isolated', source);
    expect(environment).toMatchObject({ SAFE_VALUE: 'kept', CODEX_HOME: 'C:\\isolated' });
    expect(environment.OPENAI_API_KEY).toBeUndefined();
    expect(source.OPENAI_API_KEY).toBe('secret');
  });

  it('handles a late process error without leaving a request pending', async () => {
    const child = new FakeChild();
    const client = new CodexAppServerClient({
      binaryPath: 'codex.exe',
      codexHome: 'C:\\lucid\\codex-home',
      spawnProcess: vi.fn(() => child) as unknown as typeof spawn,
    });
    const onExit = vi.fn();
    client.onExit(onExit);
    await client.start();

    const account = client.readAccount();
    child.emit('error', new Error('late failure with sensitive diagnostics'));
    await expect(account).rejects.toThrow('Codex App Server exited');
    expect(onExit).toHaveBeenCalledOnce();
    expect(onExit).toHaveBeenCalledWith(true);
    expect(child.kill).toHaveBeenCalledOnce();
  });

  it('parses a large JSONL response delivered in small chunks', async () => {
    const child = new FakeChild();
    const client = new CodexAppServerClient({
      binaryPath: 'codex.exe',
      codexHome: 'C:\\lucid\\codex-home',
      spawnProcess: vi.fn(() => child) as unknown as typeof spawn,
    });
    await client.start();

    const account = client.readAccount();
    await new Promise((resolve) => setImmediate(resolve));
    const request = child.writes.find((message) => message.method === 'account/read');
    child.sendChunked(
      {
        id: request?.id,
        result: {
          account: null,
          requiresOpenaiAuth: true,
          ignoredPadding: 'x'.repeat(512 * 1024),
        },
      },
      1_024,
    );

    await expect(account).resolves.toMatchObject({ account: null, requiresOpenaiAuth: true });
    await client.stop();
  });

  it('allows one large chunk containing many bounded JSONL lines', async () => {
    const child = new FakeChild();
    const notifications = vi.fn();
    const client = new CodexAppServerClient({
      binaryPath: 'codex.exe',
      codexHome: 'C:\\lucid\\codex-home',
      maxJsonlLineBytes: 128,
      spawnProcess: vi.fn(() => child) as unknown as typeof spawn,
    });
    client.onNotification(notifications);
    await client.start();
    child.sendRaw(
      Array.from({ length: 20 }, (_, index) =>
        JSON.stringify({ method: 'warning', params: { index } }),
      ).join('\n') + '\n',
    );
    await new Promise((resolve) => setImmediate(resolve));

    expect(notifications).toHaveBeenCalledTimes(20);
    expect(child.kill).not.toHaveBeenCalled();
    await client.stop();
  });

  it('terminates when one fragmented JSONL line exceeds the configured bound', async () => {
    const child = new FakeChild();
    const client = new CodexAppServerClient({
      binaryPath: 'codex.exe',
      codexHome: 'C:\\lucid\\codex-home',
      maxJsonlLineBytes: 128,
      spawnProcess: vi.fn(() => child) as unknown as typeof spawn,
    });
    await client.start();
    child.sendRaw(`{"method":"warning","params":{"text":"${'x'.repeat(80)}`);
    expect(child.kill).not.toHaveBeenCalled();
    child.sendRaw('x'.repeat(80));

    expect(child.kill).toHaveBeenCalledOnce();
  });
});
