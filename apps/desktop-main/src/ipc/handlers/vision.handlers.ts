import type { IpcMain } from 'electron';
import type { LLMAdapter } from '@lucid-fin/contracts';
import log from '../../logger.js';
import { getCachedProviders } from '../settings-cache.js';
import type {
  VisualAnalysisResult,
  VisualAnalyzer,
} from '../../services/visual-analyzer.service.js';

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

export async function describeImageAsset(
  analyzer: VisualAnalyzer,
  assetHash: string,
  style: 'prompt' | 'description' | 'style-analysis' = 'description',
  preferredLLMAdapter?: LLMAdapter,
  providerId?: string,
): Promise<string> {
  const systemPrompt = PROMPT_STYLE_MAP[style] ?? PROMPT_STYLE_MAP['prompt'];
  return (
    await analyzer.analyzeImageAsset(assetHash, {
      systemPrompt,
      preferredLLMAdapter,
      providerId,
    })
  ).text;
}

export type AnalyzeImageAssetResult = VisualAnalysisResult;

// ---------------------------------------------------------------------------
// Handler registration
// ---------------------------------------------------------------------------

export function registerVisionHandlers(
  ipcMain: IpcMain,
  deps: {
    visualAnalyzer: VisualAnalyzer;
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

      const result = await describeImageAsset(deps.visualAnalyzer, args.assetHash, style);

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
