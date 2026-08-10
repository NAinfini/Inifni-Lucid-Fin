import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import http, { type Server } from 'node:http';
import type {
  OAuthCapability,
  OAuthProviderStatus,
  OAuthProviderTarget,
} from '@lucid-fin/contracts';

const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const GOOGLE_REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';
const GEMINI_SCOPE = 'https://www.googleapis.com/auth/generative-language.retriever';
const TOKEN_REFRESH_MARGIN_MS = 60_000;
const LOGIN_TIMEOUT_MS = 5 * 60_000;
const QUOTA_DASHBOARD_URL =
  'https://console.cloud.google.com/apis/api/generativelanguage.googleapis.com/quotas';

type KeychainLike = {
  getKey(account: string): Promise<string | null>;
  setKey(account: string, value: string): Promise<void>;
  deleteKey(account: string): Promise<boolean>;
};

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  cloudProject: string;
}

export interface GoogleOAuthBrokerOptions {
  keychain: KeychainLike;
  config?: Partial<GoogleOAuthConfig>;
  fetchImpl?: typeof fetch;
  loginTimeoutMs?: number;
}

interface StoredGoogleTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scope: string;
  tokenType: string;
}

interface ActiveLogin {
  server: Server;
  state: string;
  verifier: string;
  redirectUri: string;
  timer: NodeJS.Timeout;
}

type StatusListener = (status: OAuthProviderStatus) => void;

export class GoogleOAuthBroker {
  private readonly keychain: KeychainLike;
  private readonly config: Partial<GoogleOAuthConfig>;
  private readonly fetchImpl: typeof fetch;
  private readonly loginTimeoutMs: number;
  private readonly activeLogins = new Map<OAuthCapability, ActiveLogin>();
  private readonly refreshes = new Map<OAuthCapability, Promise<StoredGoogleTokens>>();
  private readonly listeners = new Set<StatusListener>();

  constructor(options: GoogleOAuthBrokerOptions) {
    this.keychain = options.keychain;
    this.config = options.config ?? readGoogleOAuthConfig(process.env);
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.loginTimeoutMs = options.loginTimeoutMs ?? LOGIN_TIMEOUT_MS;
  }

  onStatusChanged(listener: StatusListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async getStatus(capability: OAuthCapability): Promise<OAuthProviderStatus> {
    const target = googleTarget(capability);
    if (!this.hasRequiredConfig()) return configurationMissingStatus(target);
    if (this.activeLogins.has(capability)) return { target, state: 'signingIn' };
    const tokens = await this.readTokens(capability);
    if (!tokens) return { target, state: 'signedOut' };
    if (!tokens.refreshToken) {
      return {
        target,
        state: 'error',
        code: 'oauth_failed',
        message: 'Google OAuth credentials cannot be refreshed. Sign in again.',
        retryable: true,
      };
    }
    return readyStatus(target);
  }

  async login(
    capability: OAuthCapability,
  ): Promise<{ authUrl: string; status: OAuthProviderStatus }> {
    const target = googleTarget(capability);
    if (!this.hasRequiredConfig()) {
      throw new Error('Google OAuth is not configured for this application');
    }
    if (this.activeLogins.has(capability)) throw new Error('Google sign-in is already in progress');

    const state = randomBase64Url(32);
    const verifier = randomBase64Url(64);
    const server = http.createServer();
    await listenOnLoopback(server);
    const address = server.address();
    if (!address || typeof address === 'string') {
      server.close();
      throw new Error('Google OAuth callback listener did not start');
    }
    const redirectUri = `http://127.0.0.1:${address.port}/oauth2/callback`;
    const timer = setTimeout(() => {
      void this.failLogin(capability, 'Google sign-in timed out');
    }, this.loginTimeoutMs);
    timer.unref();
    const active: ActiveLogin = { server, state, verifier, redirectUri, timer };
    this.activeLogins.set(capability, active);
    server.on('request', (request, response) => {
      void this.handleCallback(capability, active, request, response);
    });

    const authUrl = new URL(GOOGLE_AUTH_ENDPOINT);
    authUrl.searchParams.set('client_id', this.config.clientId!);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', GEMINI_SCOPE);
    authUrl.searchParams.set('access_type', 'offline');
    authUrl.searchParams.set('prompt', 'consent');
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('code_challenge', sha256Base64Url(verifier));
    authUrl.searchParams.set('code_challenge_method', 'S256');
    const status: OAuthProviderStatus = { target, state: 'signingIn' };
    this.emit(status);
    return { authUrl: authUrl.href, status };
  }

  async cancelLogin(capability: OAuthCapability): Promise<OAuthProviderStatus> {
    await this.closeActiveLogin(capability);
    const status = await this.getStatus(capability);
    this.emit(status);
    return status;
  }

  async logout(capability: OAuthCapability): Promise<OAuthProviderStatus> {
    await this.closeActiveLogin(capability);
    const tokens = await this.readTokens(capability);
    if (tokens) {
      const token = tokens.refreshToken || tokens.accessToken;
      if (token) {
        await this.fetchImpl(GOOGLE_REVOKE_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ token }),
        }).catch(() => undefined);
      }
    }
    await this.keychain.deleteKey(credentialAccount(capability));
    const status: OAuthProviderStatus = { target: googleTarget(capability), state: 'signedOut' };
    this.emit(status);
    return status;
  }

  async getAuthorizationHeaders(capability: OAuthCapability): Promise<Record<string, string>> {
    if (!this.hasRequiredConfig()) throw new Error('Google OAuth is not configured');
    const current = await this.readTokens(capability);
    if (!current) throw new Error(`Google ${capability} OAuth is not signed in`);
    const tokens =
      current.expiresAt - Date.now() > TOKEN_REFRESH_MARGIN_MS
        ? current
        : await this.refreshTokens(capability, current);
    return {
      Authorization: `Bearer ${tokens.accessToken}`,
      'x-goog-user-project': this.config.cloudProject!,
    };
  }

  async dispose(): Promise<void> {
    await Promise.all(
      [...this.activeLogins.keys()].map((capability) => this.closeActiveLogin(capability)),
    );
    this.listeners.clear();
  }

  private async handleCallback(
    capability: OAuthCapability,
    active: ActiveLogin,
    request: http.IncomingMessage,
    response: http.ServerResponse,
  ): Promise<void> {
    const current = this.activeLogins.get(capability);
    if (current !== active) {
      sendBrowserResult(response, false, 'This sign-in request is no longer active.');
      return;
    }
    const url = new URL(request.url ?? '/', active.redirectUri);
    if (url.pathname !== '/oauth2/callback') {
      response.writeHead(404).end();
      return;
    }
    const returnedState = url.searchParams.get('state') ?? '';
    if (!constantTimeEqual(returnedState, active.state)) {
      sendBrowserResult(response, false, 'The sign-in request could not be verified.');
      await this.failLogin(capability, 'Google OAuth state validation failed');
      return;
    }
    const oauthError = url.searchParams.get('error');
    const code = url.searchParams.get('code');
    if (oauthError || !code) {
      sendBrowserResult(response, false, 'Google sign-in was cancelled or denied.');
      await this.failLogin(capability, 'Google sign-in was cancelled');
      return;
    }

    try {
      const tokens = await this.exchangeCode(code, active);
      await this.keychain.setKey(credentialAccount(capability), JSON.stringify(tokens));
      sendBrowserResult(response, true, 'Sign-in complete. You can return to Lucid Fin.');
      await this.closeActiveLogin(capability);
      this.emit(readyStatus(googleTarget(capability)));
    } catch {
      sendBrowserResult(response, false, 'Google sign-in failed. Return to Lucid Fin and retry.');
      await this.failLogin(capability, 'Google OAuth token exchange failed');
    }
  }

  private async exchangeCode(code: string, active: ActiveLogin): Promise<StoredGoogleTokens> {
    const response = await this.fetchImpl(GOOGLE_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.config.clientId!,
        client_secret: this.config.clientSecret!,
        code,
        code_verifier: active.verifier,
        grant_type: 'authorization_code',
        redirect_uri: active.redirectUri,
      }),
    });
    if (!response.ok) throw new Error('Google OAuth token exchange failed');
    const payload = (await response.json()) as Record<string, unknown>;
    return parseTokenResponse(payload);
  }

  private refreshTokens(
    capability: OAuthCapability,
    current: StoredGoogleTokens,
  ): Promise<StoredGoogleTokens> {
    const existing = this.refreshes.get(capability);
    if (existing) return existing;
    const refresh = this.performRefresh(capability, current).finally(() => {
      this.refreshes.delete(capability);
    });
    this.refreshes.set(capability, refresh);
    return refresh;
  }

  private async performRefresh(
    capability: OAuthCapability,
    current: StoredGoogleTokens,
  ): Promise<StoredGoogleTokens> {
    const response = await this.fetchImpl(GOOGLE_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.config.clientId!,
        client_secret: this.config.clientSecret!,
        refresh_token: current.refreshToken,
        grant_type: 'refresh_token',
      }),
    });
    if (!response.ok) throw new Error('Google OAuth token refresh failed');
    const payload = (await response.json()) as Record<string, unknown>;
    const next = parseTokenResponse(payload, current.refreshToken);
    await this.keychain.setKey(credentialAccount(capability), JSON.stringify(next));
    return next;
  }

  private async readTokens(capability: OAuthCapability): Promise<StoredGoogleTokens | null> {
    const raw = await this.keychain.getKey(credentialAccount(capability));
    if (!raw) return null;
    try {
      return parseStoredTokens(JSON.parse(raw));
    } catch {
      await this.keychain.deleteKey(credentialAccount(capability));
      return null;
    }
  }

  private async failLogin(capability: OAuthCapability, message: string): Promise<void> {
    await this.closeActiveLogin(capability);
    this.emit({
      target: googleTarget(capability),
      state: 'error',
      code: message.includes('cancelled') ? 'login_cancelled' : 'oauth_failed',
      message,
      retryable: true,
    });
  }

  private async closeActiveLogin(capability: OAuthCapability): Promise<void> {
    const active = this.activeLogins.get(capability);
    if (!active) return;
    this.activeLogins.delete(capability);
    clearTimeout(active.timer);
    await closeServer(active.server);
  }

  private hasRequiredConfig(): boolean {
    return Boolean(this.config.clientId && this.config.clientSecret && this.config.cloudProject);
  }

  private emit(status: OAuthProviderStatus): void {
    for (const listener of this.listeners) listener(status);
  }
}

export function readGoogleOAuthConfig(source: NodeJS.ProcessEnv): Partial<GoogleOAuthConfig> {
  return {
    clientId: source.LUCID_GOOGLE_OAUTH_CLIENT_ID?.trim(),
    clientSecret: source.LUCID_GOOGLE_OAUTH_CLIENT_SECRET?.trim(),
    cloudProject: source.LUCID_GOOGLE_CLOUD_PROJECT?.trim(),
  };
}

function googleTarget(capability: OAuthCapability): OAuthProviderTarget {
  return { provider: 'gemini', capability };
}

function credentialAccount(capability: OAuthCapability): string {
  return `oauth:gemini:${capability}`;
}

function configurationMissingStatus(target: OAuthProviderTarget): OAuthProviderStatus {
  return {
    target,
    state: 'unavailable',
    reason:
      'Google OAuth requires an application client ID, client secret, and Google Cloud quota project.',
    setupUrl: 'https://ai.google.dev/gemini-api/docs/oauth',
  };
}

function readyStatus(target: OAuthProviderTarget): OAuthProviderStatus {
  return {
    target,
    state: 'ready',
    usage: {
      state: 'unavailable',
      reason: 'Gemini does not expose a reliable remaining-quota value to this OAuth scope.',
      dashboardUrl: QUOTA_DASHBOARD_URL,
    },
  };
}

function parseTokenResponse(
  payload: Record<string, unknown>,
  fallbackRefreshToken?: string,
): StoredGoogleTokens {
  const accessToken = stringValue(payload.access_token);
  const refreshToken = stringValue(payload.refresh_token) ?? fallbackRefreshToken;
  const expiresIn = numberValue(payload.expires_in);
  if (!accessToken || !refreshToken || !expiresIn || expiresIn <= 0) {
    throw new Error('Google OAuth returned incomplete credentials');
  }
  return {
    accessToken,
    refreshToken,
    expiresAt: Date.now() + expiresIn * 1000,
    scope: stringValue(payload.scope) ?? GEMINI_SCOPE,
    tokenType: stringValue(payload.token_type) ?? 'Bearer',
  };
}

function parseStoredTokens(value: unknown): StoredGoogleTokens {
  if (!value || typeof value !== 'object') throw new Error('Invalid stored Google credentials');
  const record = value as Record<string, unknown>;
  const accessToken = stringValue(record.accessToken);
  const refreshToken = stringValue(record.refreshToken);
  const expiresAt = numberValue(record.expiresAt);
  const scope = stringValue(record.scope);
  const tokenType = stringValue(record.tokenType);
  if (!accessToken || !refreshToken || !expiresAt || !scope || !tokenType) {
    throw new Error('Invalid stored Google credentials');
  }
  return { accessToken, refreshToken, expiresAt, scope, tokenType };
}

function randomBase64Url(bytes: number): string {
  return randomBytes(bytes).toString('base64url');
}

function sha256Base64Url(value: string): string {
  return createHash('sha256').update(value).digest('base64url');
}

function constantTimeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function listenOnLoopback(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error): void => reject(error);
    server.once('error', onError);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', onError);
      resolve();
    });
  });
}

function closeServer(server: Server): Promise<void> {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolve) => server.close(() => resolve()));
}

function sendBrowserResult(response: http.ServerResponse, success: boolean, message: string): void {
  response.writeHead(success ? 200 : 400, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(
    `<!doctype html><meta charset="utf-8"><title>Lucid Fin</title><p>${escapeHtml(message)}</p>`,
  );
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return entities[character];
  });
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
