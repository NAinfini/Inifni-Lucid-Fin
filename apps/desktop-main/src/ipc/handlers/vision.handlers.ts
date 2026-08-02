import fs from 'node:fs';
import type { IpcMain } from 'electron';
import type { CAS, Keychain } from '@lucid-fin/storage';
import { buildRuntimeLLMAdapter } from '@lucid-fin/adapters-ai';
import {
  normalizeLLMProviderRuntimeConfig,
  getBuiltinVisionProviderPreset,
} from '@lucid-fin/contracts';
import log from '../../logger.js';
import { getCachedProviders } from '../settings-cache.js';

// ---------------------------------------------------------------------------
// System prompts
// ---------------------------------------------------------------------------

const PROMPT_STYLE_MAP: Record<string, string> = {
  prompt: `You are an expert at describing images for AI generation. Analyze this image and write a detailed prompt that could be used to recreate it with an AI image generator.

Include: subject/scene description, art style, lighting quality and direction, color palette, mood/atmosphere, camera angle/lens, composition, texture/material details, and any notable cinematic or photographic techniques.

Output ONLY the prompt text, no explanations or labels. Write in English.`,

  'style-analysis': `You are a visual style analyst for AI filmmaking. Analyze this image and extract its visual style characteristics.

Report in this exact format:
Art Style: [style name]
Lighting: [lighting description]
Color Palette: [primary colors and mood]
Mood: [emotional atmosphere]
Composition: [framing and arrangement]
Camera: [angle, lens, movement if applicable]
Texture: [surface quality, grain, post-processing]
Reference: [closest cinematic/artistic reference]

Be specific and technical. Output ONLY the analysis, no explanations.`,

  description: `You are an expert at describing images for AI generation. Analyze this image and write a detailed prompt that could be used to recreate it with an AI image generator.

Include: subject/scene description, art style, lighting quality and direction, color palette, mood/atmosphere, camera angle/lens, composition, texture/material details, and any notable cinematic or photographic techniques.

Output ONLY the prompt text, no explanations or labels. Write in English.`,
};

// ---------------------------------------------------------------------------
// Image file resolution
// ---------------------------------------------------------------------------

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp'];

const MIME_MAP: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

function resolveAssetFilePath(
  cas: CAS,
  assetHash: string,
): { filePath: string; ext: string } | null {
  for (const ext of IMAGE_EXTENSIONS) {
    const filePath = cas.getAssetPath(assetHash, 'image', ext);
    if (fs.existsSync(filePath)) {
      return { filePath, ext };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Exported core function (reusable by embedding handler)
// ---------------------------------------------------------------------------

export interface AnalyzeImageAssetOptions {
  systemPrompt: string;
  userPrompt?: string;
  providerId?: string;
}

export interface AnalyzeImageAssetResult {
  text: string;
  providerId: string;
  model: string;
}

export async function analyzeImageAsset(
  cas: CAS,
  keychain: Keychain,
  assetHash: string,
  options: AnalyzeImageAssetOptions,
): Promise<AnalyzeImageAssetResult> {
  return analyzeImageAssets(cas, keychain, [assetHash], options);
}

/** Analyze a bounded ordered set of stills in one vision request. */
export async function analyzeImageAssets(
  cas: CAS,
  keychain: Keychain,
  assetHashes: string[],
  options: AnalyzeImageAssetOptions,
): Promise<AnalyzeImageAssetResult> {
  if (assetHashes.length === 0) throw new Error('At least one image asset is required');
  if (assetHashes.length > 12) throw new Error('At most 12 image assets may be analyzed together');
  if (assetHashes.some((hash) => typeof hash !== 'string' || hash.trim().length === 0)) {
    throw new Error('Every image asset hash must be a non-empty string');
  }
  const visionProviders = getCachedProviders('vision');
  const providerInfo = options.providerId
    ? visionProviders.find((provider) => provider.id === options.providerId)
    : visionProviders[0];
  if (!providerInfo?.id) {
    throw new Error(
      options.providerId
        ? `Configured vision provider not found: ${options.providerId}`
        : 'Vision provider not configured. Go to Settings → Vision.',
    );
  }

  const apiKey = await keychain.getKey(providerInfo.id);
  const preset = getBuiltinVisionProviderPreset(providerInfo.id);
  const runtimeConfig = normalizeLLMProviderRuntimeConfig({
    id: providerInfo.id,
    name: providerInfo.name || preset?.name || providerInfo.id,
    baseUrl: providerInfo.baseUrl || preset?.baseUrl || '',
    model: providerInfo.model || preset?.model || '',
    protocol: providerInfo.protocol ?? preset?.protocol,
    authStyle: providerInfo.authStyle ?? preset?.authStyle,
  });
  const adapter = buildRuntimeLLMAdapter(runtimeConfig);
  adapter.configure(apiKey ?? '', {
    baseUrl: runtimeConfig.baseUrl,
    model: runtimeConfig.model,
  });

  const images = assetHashes.map((assetHash) => {
    const resolved = resolveAssetFilePath(cas, assetHash);
    if (!resolved) throw new Error(`Asset file not found for hash: ${assetHash}`);
    return {
      data: fs.readFileSync(resolved.filePath).toString('base64'),
      mimeType: MIME_MAP[resolved.ext] ?? 'image/jpeg',
    };
  });
  const text = await adapter.complete([
    { role: 'system', content: options.systemPrompt },
    {
      role: 'user',
      content: options.userPrompt ?? 'Analyze this image.',
      images,
    },
  ]);
  return { text, providerId: providerInfo.id, model: runtimeConfig.model };
}

export async function describeImageAsset(
  cas: CAS,
  keychain: Keychain,
  assetHash: string,
  style: 'prompt' | 'description' | 'style-analysis' = 'description',
): Promise<string> {
  const systemPrompt = PROMPT_STYLE_MAP[style] ?? PROMPT_STYLE_MAP['prompt'];
  return (await analyzeImageAsset(cas, keychain, assetHash, { systemPrompt })).text;
}

// ---------------------------------------------------------------------------
// Handler registration
// ---------------------------------------------------------------------------

export function registerVisionHandlers(
  ipcMain: IpcMain,
  deps: {
    cas: CAS;
    keychain: Keychain;
  },
): void {
  ipcMain.handle(
    'vision:describeImage',
    async (
      _event,
      args: {
        assetHash: string;
        assetType: 'image' | 'video';
        style?: 'prompt' | 'description' | 'style-analysis';
      },
    ) => {
      if (!args?.assetHash || typeof args.assetHash !== 'string') {
        throw new Error('assetHash is required');
      }

      const style = args.style ?? 'prompt';

      log.info('Vision describe image request', {
        category: 'vision',
        assetHash: args.assetHash,
        style,
        providerId: getCachedProviders('vision')[0]?.id,
      });

      const result = await describeImageAsset(deps.cas, deps.keychain, args.assetHash, style);

      log.info('Vision describe image complete', {
        category: 'vision',
        assetHash: args.assetHash,
        style,
        resultChars: result.length,
      });

      return { prompt: result };
    },
  );
}
