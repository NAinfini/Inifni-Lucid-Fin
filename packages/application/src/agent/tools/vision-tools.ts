import type { AgentTool } from '../tool-registry.js';
import { tryProviderId } from '@lucid-fin/contracts-parse';
import { ok, fail } from './tool-result-helpers.js';

export interface VisionToolDeps {
  describeImage: (
    assetHash: string,
    assetType: 'image' | 'video',
    style?: string,
    providerId?: string,
  ) => Promise<{ prompt: string }>;
  getNodeAssetHash?: (nodeId: string, canvasId?: string) => Promise<string | null>;
  writeNodeField?: (nodeId: string, field: string, value: string, canvasId?: string) => Promise<void>;
}

export function createVisionTools(deps: VisionToolDeps): AgentTool[] {
  const describeImage: AgentTool = {
    name: 'vision.describeImage',
    description:
      'Analyze a node\'s current image asset using a vision AI model and return a detailed text prompt describing its style, content, and cinematic qualities. Optionally write the result to a node field. Use provider.list(group=\'vision\') to see available providers.',
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        canvasId: {
          type: 'string',
          description: 'The canvas ID containing the node (for consistency — asset resolution is global).',
        },
        nodeId: {
          type: 'string',
          description: 'The canvas node ID whose asset should be analyzed.',
        },
        style: {
          type: 'string',
          enum: ['prompt', 'description', 'style-analysis'],
          description:
            'Analysis mode: "prompt" generates a recreatable AI prompt, "style-analysis" extracts structured style characteristics.',
        },
        providerId: {
          type: 'string',
          description:
            'Optional: vision provider ID to use (e.g. "openai-vision", "gemini-vision"). Defaults to the first configured provider. Use provider.list(group=\'vision\') to see available options.',
        },
        writeField: {
          type: 'string',
          enum: ['prompt'],
          description:
            'Optional: if set, writes the result back to the prompt field on the node.',
        },
      },
      required: ['nodeId'],
    },
    async execute(args) {
      try {
        const nodeId = typeof args.nodeId === 'string' ? args.nodeId.trim() : '';
        if (!nodeId) throw new Error('nodeId is required');

        const canvasId = typeof args.canvasId === 'string' ? args.canvasId.trim() : undefined;
        const style = typeof args.style === 'string' ? args.style : 'prompt';
        const providerId = tryProviderId(args.providerId);

        // Resolve asset hash from node
        let assetHash: string | null = null;
        if (deps.getNodeAssetHash) {
          assetHash = await deps.getNodeAssetHash(nodeId, canvasId);
        }
        if (!assetHash) {
          throw new Error(`No image asset found on node: ${nodeId}`);
        }

        const result = await deps.describeImage(assetHash, 'image', style, providerId);

        // Optionally write back to node field
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
    },
  };

  return [describeImage];
}
