/**
 * Security policy: the OS-keychain-stored API key for a provider may only be
 * sent to that provider's canonical host(s). The renderer supplies the request
 * baseUrl, so without this guard a compromised renderer (e.g. XSS) could call
 * generate() with a real providerId and baseUrl='https://attacker.example' to
 * exfiltrate the user's stored key (Authorization header) to an arbitrary host.
 *
 * Rule enforced by callers (generation-context.ts):
 *   - No providerConfig / no custom baseUrl  -> stored key is used (normal path).
 *   - Custom baseUrl whose host is allowed for this provider -> stored key used.
 *   - Custom baseUrl to a non-allowed host -> stored key is NOT auto-filled;
 *     the caller must supply an explicit apiKey or the request fails loudly.
 *
 * Self-hosted adapters (ComfyUI, Ollama, SD WebUI, etc.) legitimately point at
 * loopback addresses, which are always allowed (a localhost endpoint cannot be
 * an external exfiltration target).
 */

import {
  getBuiltinMediaProvider,
  listBuiltinMediaProviders,
  type MediaProviderGroup,
} from '@lucid-fin/contracts';

/** Canonical hostnames for non-media and legacy providers. Media hosts come from the catalog. */
const PROVIDER_ALLOWED_HOSTS: Record<string, readonly string[]> = {
  // Legacy media IDs that are not exposed by the current built-in catalog.
  leonardo: ['cloud.leonardo.ai'],
  higgsfield: ['api.higgsfield.ai'],
  // Audio / voice / music / sfx
  cartesia: ['api.cartesia.ai'],
  elevenlabs: ['api.elevenlabs.io'],
  'elevenlabs-sfx': ['api.elevenlabs.io'],
  'fish-audio': ['api.fish.audio'],
  'openai-tts': ['api.openai.com'],
  playht: ['api.play.ht'],
  'stability-audio': ['api.stability.ai'],
  suno: ['studio-api.suno.ai'],
  udio: ['www.udio.com'],

  // LLM providers (commander chat) — known official hosts
  openai: ['api.openai.com'],
  'chatgpt-oauth': ['chatgpt.com'],
  claude: ['api.anthropic.com'],
  anthropic: ['api.anthropic.com'],
  gemini: ['generativelanguage.googleapis.com'],
  'chatgpt-vision-oauth': ['chatgpt.com'],
  cohere: ['api.cohere.com'],
  deepseek: ['api.deepseek.com'],
  grok: ['api.x.ai'],
  qwen: ['dashscope.aliyuncs.com'],
};

/**
 * True when a host is a loopback / link-local address. Self-hosted adapters use
 * these and they cannot be an external exfiltration target.
 */
function isLoopbackHost(host: string): boolean {
  const h = host.toLowerCase();
  return (
    h === 'localhost' ||
    h === '127.0.0.1' ||
    h === '::1' ||
    h === '[::1]' ||
    h.startsWith('127.') ||
    h.endsWith('.localhost')
  );
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function hostMatchesAllowed(host: string, allowedHost: string): boolean {
  const normalized = allowedHost.trim().toLowerCase();
  if (!normalized.startsWith('*.')) return host === normalized;
  const suffix = normalized.slice(1);
  return host.length > suffix.length && host.endsWith(suffix);
}

/**
 * Whether the stored keychain key for `providerId` is allowed to be sent to
 * `baseUrl`. Returns true when no custom baseUrl is supplied, when the host is
 * loopback, or when the host matches the provider's canonical allowlist.
 *
 * Providers absent from the allowlist (custom / user-added) are NOT trusted
 * with the stored key against an arbitrary host — only loopback is permitted.
 */
export function isStoredKeyAllowedForBaseUrl(
  providerId: string,
  baseUrl: string | undefined,
  group?: MediaProviderGroup,
): boolean {
  if (!baseUrl) return true; // normal path — adapter uses its own default host
  const host = hostOf(baseUrl);
  if (!host) return false; // unparseable URL — refuse to attach the stored key
  if (isLoopbackHost(host)) return true;
  const normalizedProviderId = providerId.trim().toLowerCase();
  const catalogAllowed = group
    ? (getBuiltinMediaProvider(group, normalizedProviderId)?.allowedHosts ??
      listBuiltinMediaProviders(group, { includeExcluded: true })
        .filter(
          (entry) =>
            entry.adapterId === normalizedProviderId || entry.credentialId === normalizedProviderId,
        )
        .flatMap((entry) => entry.allowedHosts))
    : listBuiltinMediaProviders(undefined, { includeExcluded: true })
        .filter(
          (entry) =>
            entry.providerId === normalizedProviderId ||
            entry.adapterId === normalizedProviderId ||
            entry.credentialId === normalizedProviderId,
        )
        .flatMap((entry) => entry.allowedHosts);
  const allowed = catalogAllowed?.length
    ? [...new Set(catalogAllowed)]
    : PROVIDER_ALLOWED_HOSTS[normalizedProviderId];
  if (!allowed) return false; // unknown/custom provider + remote host — not trusted
  return allowed.some((allowedHost) => hostMatchesAllowed(host, allowedHost));
}
