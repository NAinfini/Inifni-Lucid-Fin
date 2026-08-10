import electron from 'electron';
import type { BrowserWindow, IpcMain } from 'electron';
import {
  providerOAuthCancelLoginChannel,
  providerOAuthChangedChannel,
  providerOAuthLoginChannel,
  providerOAuthLogoutChannel,
  providerOAuthStatusChannel,
} from '@lucid-fin/contracts-parse';
import type { OAuthProviderTarget } from '@lucid-fin/contracts';
import type { ProviderOAuthManager } from '../../oauth/provider-oauth-manager.js';
import { registerInvoke, registerPush, type RegistrarDeps } from '../../features/ipc/registrar.js';

const { shell } = electron;

export function registerProviderOAuthHandlers(
  ipcMain: IpcMain,
  getWindow: () => BrowserWindow | null,
  manager: ProviderOAuthManager,
): () => void {
  const deps: RegistrarDeps = { ipcMain, getWindow };
  const emitChanged = registerPush(deps, providerOAuthChangedChannel);
  const unsubscribe = manager.onStatusChanged(emitChanged);

  registerInvoke(deps, providerOAuthStatusChannel, (_context, { target }) =>
    manager.getStatus(target),
  );
  registerInvoke(deps, providerOAuthLoginChannel, async (_context, { target }) => {
    const { authUrl } = await manager.login(target);
    try {
      await shell.openExternal(validateProviderOAuthUrl(authUrl, target));
    } catch {
      await manager.cancelLogin(target).catch(() => undefined);
      throw new Error('Could not open the provider sign-in page');
    }
    return manager.getStatus(target);
  });
  registerInvoke(deps, providerOAuthCancelLoginChannel, (_context, { target }) =>
    manager.cancelLogin(target),
  );
  registerInvoke(deps, providerOAuthLogoutChannel, (_context, { target }) =>
    manager.logout(target),
  );

  return unsubscribe;
}

export function validateProviderOAuthUrl(value: string, target: OAuthProviderTarget): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('Provider returned an invalid OAuth URL');
  }
  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, '');
  const trusted =
    target.provider === 'gemini' ? hostname === 'accounts.google.com' : isOpenAIOwnedHost(hostname);
  if (parsed.protocol !== 'https:' || !trusted) {
    throw new Error('Provider returned an untrusted OAuth URL');
  }
  return parsed.href;
}

function isOpenAIOwnedHost(hostname: string): boolean {
  return (
    hostname === 'openai.com' ||
    hostname.endsWith('.openai.com') ||
    hostname === 'chatgpt.com' ||
    hostname.endsWith('.chatgpt.com')
  );
}
