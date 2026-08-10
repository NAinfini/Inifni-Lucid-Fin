import fs from 'node:fs';
import type { LLMRegistry } from '@lucid-fin/adapters-ai';
import type { LLMAdapter } from '@lucid-fin/contracts';
import type { CAS } from '@lucid-fin/storage';
import { getCachedProviders } from '../ipc/settings-cache.js';

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp'] as const;
const MIME_BY_EXTENSION: Record<(typeof IMAGE_EXTENSIONS)[number], string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

export interface VisualAnalysisOptions {
  systemPrompt: string;
  userPrompt?: string;
  /** Commander-selected adapter. A visual-capable adapter is the only provider attempted. */
  preferredLLMAdapter?: LLMAdapter;
  /** Dedicated provider selection, considered only when the selected LLM is text-only. */
  providerId?: string;
}

export interface VisualAnalysisResult {
  text: string;
  providerId: string;
  model: string;
}

export interface VisualAnalyzer {
  analyzeImageAsset(
    assetHash: string,
    options: VisualAnalysisOptions,
  ): Promise<VisualAnalysisResult>;
  analyzeImageAssets(
    assetHashes: string[],
    options: VisualAnalysisOptions,
  ): Promise<VisualAnalysisResult>;
}

type ProviderList = typeof getCachedProviders;

export function createVisualAnalyzer(deps: {
  cas: CAS;
  llmRegistry: Pick<LLMRegistry, 'get'>;
  getProviders?: ProviderList;
}): VisualAnalyzer {
  const getProviders = deps.getProviders ?? getCachedProviders;

  const analyzeImageAssets = async (
    assetHashes: string[],
    options: VisualAnalysisOptions,
  ): Promise<VisualAnalysisResult> => {
    assertAssetHashes(assetHashes);
    const selection = await resolveVisualAdapter(deps.llmRegistry, getProviders, options);
    const images = assetHashes.map((assetHash) => {
      const resolved = resolveAssetFilePath(deps.cas, assetHash);
      if (!resolved) throw new Error(`Asset file not found for hash: ${assetHash}`);
      return {
        data: fs.readFileSync(resolved.filePath).toString('base64'),
        mimeType: MIME_BY_EXTENSION[resolved.extension],
      };
    });
    const text = await selection.adapter.complete([
      { role: 'system', content: options.systemPrompt },
      {
        role: 'user',
        content: options.userPrompt ?? 'Analyze this image.',
        images,
      },
    ]);
    return {
      text,
      providerId: selection.adapter.id,
      model: selection.model,
    };
  };

  return {
    analyzeImageAsset: (assetHash, options) => analyzeImageAssets([assetHash], options),
    analyzeImageAssets,
  };
}

async function resolveVisualAdapter(
  registry: Pick<LLMRegistry, 'get'>,
  getProviders: ProviderList,
  options: Pick<VisualAnalysisOptions, 'preferredLLMAdapter' | 'providerId'>,
): Promise<{ adapter: LLMAdapter; model: string }> {
  const preferred = options.preferredLLMAdapter;
  if (preferred?.capabilities.includes('image-understanding')) {
    return { adapter: preferred, model: configuredModel(getProviders, preferred.id) };
  }

  if (!preferred) {
    const activeLLM = getProviders('llm')[0];
    if (activeLLM?.supportsVision) {
      return requireRegisteredReadyVisualAdapter(registry, activeLLM.id, activeLLM.model);
    }
  }

  const visionProviders = getProviders('vision');
  const fallback = options.providerId
    ? visionProviders.find((provider) => provider.id === options.providerId)
    : visionProviders[0];
  if (!fallback) {
    throw new Error(
      options.providerId
        ? `Configured vision provider not found: ${options.providerId}`
        : 'The selected LLM cannot analyze images and no fallback vision provider is configured.',
    );
  }
  return requireRegisteredReadyVisualAdapter(registry, fallback.id, fallback.model);
}

async function requireRegisteredReadyVisualAdapter(
  registry: Pick<LLMRegistry, 'get'>,
  providerId: string,
  model: string,
): Promise<{ adapter: LLMAdapter; model: string }> {
  const adapter = registry.get(providerId);
  if (!adapter) {
    throw new Error(`Visual provider is not registered in the main process: ${providerId}`);
  }
  if (!adapter.capabilities.includes('image-understanding')) {
    throw new Error(`Registered provider does not support image understanding: ${providerId}`);
  }
  let ready = false;
  try {
    ready = await adapter.validate();
  } catch (error) {
    throw new Error(`Visual provider readiness check failed: ${providerId}`, { cause: error });
  }
  if (!ready) throw new Error(`Visual provider is not ready: ${providerId}`);
  return { adapter, model: model || adapter.name };
}

function configuredModel(getProviders: ProviderList, providerId: string): string {
  return (
    [...getProviders('llm'), ...getProviders('vision')].find(
      (provider) => provider.id === providerId,
    )?.model || providerId
  );
}

function assertAssetHashes(assetHashes: string[]): void {
  if (assetHashes.length === 0) throw new Error('At least one image asset is required');
  if (assetHashes.length > 12) throw new Error('At most 12 image assets may be analyzed together');
  if (assetHashes.some((hash) => typeof hash !== 'string' || hash.trim().length === 0)) {
    throw new Error('Every image asset hash must be a non-empty string');
  }
}

function resolveAssetFilePath(
  cas: CAS,
  assetHash: string,
): { filePath: string; extension: (typeof IMAGE_EXTENSIONS)[number] } | null {
  for (const extension of IMAGE_EXTENSIONS) {
    const filePath = cas.getAssetPath(assetHash, 'image', extension);
    if (fs.existsSync(filePath)) return { filePath, extension };
  }
  return null;
}
