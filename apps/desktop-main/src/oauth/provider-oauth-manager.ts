import path from 'node:path';
import type {
  OAuthCapability,
  OAuthProviderStatus,
  OAuthProviderTarget,
} from '@lucid-fin/contracts';
import type { Keychain } from '@lucid-fin/storage';
import { CodexRuntime } from '../codex/codex-runtime.js';
import { GoogleOAuthBroker, type GoogleOAuthBrokerOptions } from './google-oauth-broker.js';

type StatusListener = (status: OAuthProviderStatus) => void;

export interface ProviderOAuthManagerOptions {
  userDataPath: string;
  keychain: Keychain;
  google?: Omit<GoogleOAuthBrokerOptions, 'keychain'>;
  codexRuntimeFactory?: (
    capability: Exclude<OAuthCapability, 'video'>,
    home: string,
  ) => CodexRuntime;
}

export class ProviderOAuthManager {
  private readonly codexRuntimes = new Map<Exclude<OAuthCapability, 'video'>, CodexRuntime>();
  private readonly google: GoogleOAuthBroker;
  private readonly listeners = new Set<StatusListener>();
  private readonly unsubscribers: Array<() => void> = [];

  constructor(options: ProviderOAuthManagerOptions) {
    const root = path.join(options.userDataPath, 'codex-home');
    const createRuntime =
      options.codexRuntimeFactory ??
      ((capability: Exclude<OAuthCapability, 'video'>, home: string) =>
        new CodexRuntime({ capability, codexHome: home }));
    for (const capability of ['llm', 'image', 'vision'] as const) {
      const runtime = createRuntime(capability, path.join(root, `capability-${capability}`));
      this.codexRuntimes.set(capability, runtime);
      this.unsubscribers.push(runtime.onStatusChanged((status) => this.emit(status)));
    }
    this.google = new GoogleOAuthBroker({ keychain: options.keychain, ...options.google });
    this.unsubscribers.push(this.google.onStatusChanged((status) => this.emit(status)));
  }

  getCodexRuntime(capability: Exclude<OAuthCapability, 'video'>): CodexRuntime {
    const runtime = this.codexRuntimes.get(capability);
    if (!runtime) throw new Error(`ChatGPT OAuth does not support ${capability}`);
    return runtime;
  }

  onStatusChanged(listener: StatusListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async getStatus(target: OAuthProviderTarget): Promise<OAuthProviderStatus> {
    assertSupportedTarget(target);
    if (target.provider === 'gemini') return this.google.getStatus(target.capability);
    const runtime = this.getCodexRuntime(target.capability as Exclude<OAuthCapability, 'video'>);
    await runtime.start().catch(() => undefined);
    return runtime.getStatus();
  }

  async login(
    target: OAuthProviderTarget,
  ): Promise<{ authUrl: string; status: OAuthProviderStatus }> {
    assertSupportedTarget(target);
    if (target.provider === 'gemini') return this.google.login(target.capability);
    return this.getCodexRuntime(target.capability as Exclude<OAuthCapability, 'video'>).login();
  }

  async cancelLogin(target: OAuthProviderTarget): Promise<OAuthProviderStatus> {
    assertSupportedTarget(target);
    if (target.provider === 'gemini') return this.google.cancelLogin(target.capability);
    return this.getCodexRuntime(
      target.capability as Exclude<OAuthCapability, 'video'>,
    ).cancelLogin();
  }

  async logout(target: OAuthProviderTarget): Promise<OAuthProviderStatus> {
    assertSupportedTarget(target);
    if (target.provider === 'gemini') return this.google.logout(target.capability);
    return this.getCodexRuntime(target.capability as Exclude<OAuthCapability, 'video'>).logout();
  }

  getGoogleAuthorizationHeaders(capability: OAuthCapability): Promise<Record<string, string>> {
    return this.google.getAuthorizationHeaders(capability);
  }

  async stop(): Promise<void> {
    for (const unsubscribe of this.unsubscribers.splice(0)) unsubscribe();
    this.listeners.clear();
    await Promise.all([
      this.google.dispose(),
      ...[...this.codexRuntimes.values()].map((runtime) => runtime.stop()),
    ]);
  }

  private emit(status: OAuthProviderStatus): void {
    for (const listener of this.listeners) listener(status);
  }
}

function assertSupportedTarget(target: OAuthProviderTarget): void {
  if (target.provider === 'chatgpt' && target.capability === 'video') {
    throw new Error('ChatGPT OAuth video generation is not supported');
  }
}
