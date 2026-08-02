import type { AgentTool } from '../tool-registry.js';
import { ok, fail, requireString } from './tool-result-helpers.js';

export interface RenderToolDeps {
  startRender: (input: {
    canvasId: string;
    workflowRunId: string;
    expectedManifestRevision: number;
    expectedManifestHash: string;
    outputPath?: string;
    retry?: boolean;
  }) => Promise<{ renderId: string }>;
  cancelRender: (renderId: string) => Promise<void>;
  exportBundle: (canvasId: string, format: string, outputPath: string) => Promise<{ path: string }>;
}

export function createRenderTools(deps: RenderToolDeps): AgentTool[] {
  const context = ['canvas'];

  const renderStart: AgentTool = {
    name: 'render.start',
    description:
      'Execute the exact host-approved Final Export manifest. Media inputs and output settings are reconstructed by the host; this tool cannot replace them.',
    context,
    tier: 4,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The canvas ID to render.' },
        workflowRunId: { type: 'string', description: 'Persistent movie workflow run ID.' },
        expectedManifestRevision: {
          type: 'number',
          description: 'Exact approved Final Export manifest revision.',
        },
        expectedManifestHash: {
          type: 'string',
          description: 'Exact approved Final Export manifest SHA-256.',
        },
        outputPath: { type: 'string', description: 'Optional output file path.' },
        retry: {
          type: 'boolean',
          description: 'Explicitly consume one bounded retry after a recorded failed execution.',
        },
      },
      required: ['canvasId', 'workflowRunId', 'expectedManifestRevision', 'expectedManifestHash'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const workflowRunId = requireString(args, 'workflowRunId');
        if (
          typeof args.expectedManifestRevision !== 'number' ||
          !Number.isInteger(args.expectedManifestRevision) ||
          args.expectedManifestRevision <= 0
        ) {
          throw new Error('expectedManifestRevision must be a positive integer');
        }
        const expectedManifestHash = requireString(args, 'expectedManifestHash');
        if (!/^[a-f0-9]{64}$/i.test(expectedManifestHash)) {
          throw new Error('expectedManifestHash must be a SHA-256 hex digest');
        }
        const outputPath = typeof args.outputPath === 'string' ? args.outputPath.trim() : undefined;
        const result = await deps.startRender({
          canvasId,
          workflowRunId,
          expectedManifestRevision: args.expectedManifestRevision,
          expectedManifestHash,
          ...(outputPath ? { outputPath } : {}),
          ...(args.retry === true ? { retry: true } : {}),
        });
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
        renderId: { type: 'string', description: 'Persistent Final Export execution ID.' },
      },
      required: ['renderId'],
    },
    async execute(args) {
      try {
        const renderId = requireString(args, 'renderId');
        await deps.cancelRender(renderId);
        return ok({ renderId });
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
