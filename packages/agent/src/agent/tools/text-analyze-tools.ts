import type { AgentTool } from '../tool-registry.js';
import { tryProviderId } from '@lucid-fin/contracts-parse';
import { ok, fail, requireText } from './tool-result-helpers.js';
import type { VisionToolDeps } from './vision-tools.js';
import type { CopywritingToolDeps } from './copywriting-tools.js';

export interface TextAnalyzeToolDeps extends VisionToolDeps, CopywritingToolDeps {}

const MODES: Record<string, string> = {
  expand:
    'Expand and elaborate on this text with more vivid, detailed descriptions. Keep the same meaning but make it more descriptive for AI image/video generation.',
  condense:
    'Condense this text to its essential elements. Remove redundancy and keep only the most important visual/cinematic details.',
  refine:
    'Refine and polish this text for use as an AI generation prompt. Improve clarity, specificity, and artistic quality.',
  viralHook:
    'Add a compelling, attention-grabbing opening hook to this text that would make viewers want to keep watching.',
};

export function createTextAnalyzeTools(deps: TextAnalyzeToolDeps): AgentTool[] {
  const textAnalyze: AgentTool = {
    name: 'text.analyze',
    description:
      'Analyze images with vision AI or transform text with LLM. Use action to select the operation.',
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: 'Operation to perform.',
          enum: ['describeImage', 'transform'],
        },
        // describeImage params
        canvasId: { type: 'string', description: 'Canvas ID (for describeImage).' },
        nodeId: {
          type: 'string',
          description: 'Node ID whose asset to analyze (for describeImage).',
        },
        style: {
          type: 'string',
          description: 'For describeImage: analysis mode. For transform/refine: style direction.',
        },
        providerId: { type: 'string', description: 'Vision provider ID (for describeImage).' },
        writeField: {
          type: 'string',
          enum: ['prompt'],
          description: 'Write result to node field (for describeImage).',
        },
        // transform params
        text: { type: 'string', description: 'Text to transform (for transform action).' },
        mode: {
          type: 'string',
          description: 'Transformation mode (for transform action).',
          enum: ['expand', 'condense', 'refine', 'viralHook'],
        },
        targetLength: { type: 'string', description: 'Target length hint for expand mode.' },
      },
      required: ['action'],
    },
    async execute(args) {
      const action = args.action as string;

      if (action === 'describeImage') {
        // VERBATIM from vision-tools.ts describeImage execute body
        try {
          const nodeId = typeof args.nodeId === 'string' ? args.nodeId.trim() : '';
          if (!nodeId) throw new Error('nodeId is required');
          const canvasId = typeof args.canvasId === 'string' ? args.canvasId.trim() : undefined;
          const style = typeof args.style === 'string' ? args.style : 'prompt';
          const providerId = tryProviderId(args.providerId);
          let assetHash: string | null = null;
          if (deps.getNodeAssetHash) {
            assetHash = await deps.getNodeAssetHash(nodeId, canvasId);
          }
          if (!assetHash) {
            throw new Error(`No image asset found on node: ${nodeId}`);
          }
          const result = await deps.describeImage(assetHash, 'image', style, providerId);
          if (
            typeof args.writeField === 'string' &&
            args.writeField.trim().length > 0 &&
            deps.writeNodeField
          ) {
            await deps.writeNodeField(nodeId, args.writeField.trim(), result.prompt, canvasId);
          }
          return ok({ prompt: result.prompt, nodeId, style, providerId });
        } catch (error) {
          return fail(error);
        }
      }

      if (action === 'transform') {
        // VERBATIM from copywriting-tools.ts transform execute body
        try {
          const text = requireText(args, 'text');
          const mode = args.mode as string;
          const basePrompt = MODES[mode];
          if (!basePrompt) {
            throw new Error(
              `Unknown mode: ${mode}. Must be expand, condense, refine, or viralHook.`,
            );
          }
          let systemPrompt = basePrompt;
          if (
            mode === 'expand' &&
            typeof args.targetLength === 'string' &&
            args.targetLength.trim().length > 0
          ) {
            systemPrompt += ` Target length: ${args.targetLength.trim()}.`;
          }
          if (mode === 'refine' && typeof args.style === 'string' && args.style.trim().length > 0) {
            systemPrompt += ` Apply a ${args.style.trim()} style.`;
          }
          const result = await deps.callLLM(systemPrompt, text);
          return ok({ result, mode });
        } catch (error) {
          return fail(error);
        }
      }

      return fail(`Unknown action: ${action}. Must be describeImage or transform.`);
    },
  };

  return [textAnalyze];
}
