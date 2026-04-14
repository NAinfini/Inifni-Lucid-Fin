import type { AgentTool } from '@lucid-fin/application';

export interface VideoToolDeps {
  cloneVideo: (filePath: string, threshold?: number) => Promise<{ canvasId: string; nodeCount: number }>;
}

export function createVideoTools(deps: VideoToolDeps): AgentTool[] {
  const cloneTool: AgentTool = {
    name: 'video.clone',
    description: 'Analyze a video file by detecting scene cuts, extracting keyframes, and auto-describing them. Creates a new canvas with one video node per scene, ready for re-generation.',
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'Path to the source video file' },
        threshold: { type: 'number', description: 'Scene detection sensitivity (0-1, default 0.4)' },
      },
      required: ['filePath'],
    },
    async execute(args) {
      try {
        const result = await deps.cloneVideo(
          String(args.filePath),
          typeof args.threshold === 'number' ? args.threshold : undefined,
        );
        return { success: true, data: result };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
  };
  return [cloneTool];
}
