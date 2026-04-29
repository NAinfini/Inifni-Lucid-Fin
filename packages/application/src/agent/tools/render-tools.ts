import type { AgentTool } from '../tool-registry.js';
import { ok, fail, requireString } from './tool-result-helpers.js';

export interface RenderToolDeps {
  startRender: (
    canvasId: string,
    format: string,
    outputPath?: string,
  ) => Promise<{ renderId: string }>;
  cancelRender: (canvasId: string) => Promise<void>;
  exportBundle: (canvasId: string, format: string, outputPath: string) => Promise<{ path: string }>;
}

export function createRenderTools(deps: RenderToolDeps): AgentTool[] {
  const context = ['canvas'];

  const renderStart: AgentTool = {
    name: 'render.start',
    description: 'Start rendering a canvas to the requested output format.',
    context,
    tier: 4,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The canvas ID to render.' },
        format: { type: 'string', description: 'Requested render format, such as mp4 or mov.' },
        outputPath: { type: 'string', description: 'Optional output file path.' },
      },
      required: ['canvasId', 'format'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const format = requireString(args, 'format');
        const outputPath = typeof args.outputPath === 'string' ? args.outputPath.trim() : undefined;
        const result = await deps.startRender(canvasId, format, outputPath);
        return ok(result);
      } catch (error) {
        return fail(error);
      }
    },
  };

  const renderCancel: AgentTool = {
    name: 'render.cancel',
    description: 'Cancel an active render for a canvas.',
    context,
    tier: 4,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The canvas ID to cancel rendering for.' },
      },
      required: ['canvasId'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        await deps.cancelRender(canvasId);
        return ok({ canvasId });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const exportBundle: AgentTool = {
    name: 'render.exportBundle',
    description: 'Export a canvas bundle for an editing format like FCPXML or EDL.',
    context,
    tier: 4,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The canvas ID to export.' },
        format: {
          type: 'string',
          description: 'Bundle format to export.',
          enum: ['fcpxml', 'edl'],
        },
        outputPath: { type: 'string', description: 'Target output file path.' },
      },
      required: ['canvasId', 'format', 'outputPath'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const format = requireString(args, 'format');
        if (format !== 'fcpxml' && format !== 'edl') {
          throw new Error('format must be "fcpxml" or "edl"');
        }
        const outputPath = requireString(args, 'outputPath');
        const result = await deps.exportBundle(canvasId, format, outputPath);
        return ok(result);
      } catch (error) {
        return fail(error);
      }
    },
  };

  return [renderStart, renderCancel, exportBundle];
}
