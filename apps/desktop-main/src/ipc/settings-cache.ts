import type { LLMProviderProtocol, LLMProviderAuthStyle } from '@lucid-fin/contracts';

interface ProviderInfo {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  isCustom: boolean;
  hasKey: boolean;
  protocol?: LLMProviderProtocol;
  authStyle?: LLMProviderAuthStyle;
}

interface SettingsCache {
  llm: { providers: ProviderInfo[] };
  image: { providers: ProviderInfo[] };
  video: { providers: ProviderInfo[] };
  audio: { providers: ProviderInfo[] };
  vision: { providers: ProviderInfo[] };
}

let cache: SettingsCache | null = null;

export function updateSettingsCache(settings: Record<string, unknown>): void {
  cache = {
    llm: extractProviderGroup(settings, 'llm'),
    image: extractProviderGroup(settings, 'image'),
    video: extractProviderGroup(settings, 'video'),
    audio: extractProviderGroup(settings, 'audio'),
    vision: extractProviderGroup(settings, 'vision'),
  };
}

const VALID_PROTOCOLS = new Set<string>([
  'openai-compatible', 'openai-responses', 'anthropic', 'gemini', 'cohere',
]);
const VALID_AUTH_STYLES = new Set<string>([
  'bearer', 'x-api-key', 'x-goog-api-key', 'none',
]);

function extractProviderGroup(settings: Record<string, unknown>, group: string): { providers: ProviderInfo[] } {
  const groupData = settings[group] as Record<string, unknown> | undefined;
  if (!groupData || !Array.isArray(groupData.providers)) return { providers: [] };
  return {
    providers: (groupData.providers as Array<Record<string, unknown>>).map(p => ({
      id: String(p.id ?? ''),
      name: String(p.name ?? ''),
      baseUrl: String(p.baseUrl ?? ''),
      model: String(p.model ?? ''),
      isCustom: Boolean(p.isCustom),
      hasKey: Boolean(p.hasKey),
      protocol: typeof p.protocol === 'string' && VALID_PROTOCOLS.has(p.protocol)
        ? p.protocol as LLMProviderProtocol
        : undefined,
      authStyle: typeof p.authStyle === 'string' && VALID_AUTH_STYLES.has(p.authStyle)
        ? p.authStyle as LLMProviderAuthStyle
        : undefined,
    })),
  };
}

export function getCachedProviders(group: string): ProviderInfo[] {
  if (!cache) return [];
  return (cache as unknown as Record<string, { providers: ProviderInfo[] }>)[group]?.providers ?? [];
}

export function getSettingsCache(): SettingsCache | null {
  return cache;
}
