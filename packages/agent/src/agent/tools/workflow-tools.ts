import type { AgentTool } from '../tool-registry.js';
import {
  ok,
  fail,
  requireString,
  TypedToolError,
  formatValidationError,
} from './tool-result-helpers.js';

export interface WorkflowToolDeps {
  pauseWorkflow: (id: string) => Promise<void>;
  resumeWorkflow: (id: string) => Promise<void>;
  cancelWorkflow: (id: string) => Promise<void>;
  retryWorkflow: (id: string) => Promise<void>;
}

export function createWorkflowTools(deps: WorkflowToolDeps): AgentTool[] {
  const context = ['canvas'];

  const manage: AgentTool = {
    name: 'workflow.manage',
    description:
      'Manage workflows: control a running workflow or expand an idea into a story outline.',
    context,
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: 'Action to perform.',
          enum: ['control', 'expandIdea'],
        },
        id: { type: 'string', description: 'Workflow run ID.' },
        controlAction: {
          type: 'string',
          description: 'Action to perform on the workflow.',
          enum: ['pause', 'resume', 'cancel', 'retry'],
        },
        prompt: {
          type: 'string',
          description: 'REQUIRED. The one-liner idea to expand. Must be a non-empty string.',
        },
        genre: {
          type: 'string',
          description: 'Optional genre (e.g. anime, film noir, documentary).',
        },
        actCount: { type: 'number', description: 'Number of acts. Default 3.' },
      },
      required: ['action'],
    },
    async execute(args) {
      const action = args.action as string;
      if (action === 'control') {
        try {
          const id = requireString(args, 'id');
          const controlAction = requireString(args, 'controlAction');
          if (controlAction === 'pause') {
            await deps.pauseWorkflow(id);
          } else if (controlAction === 'resume') {
            await deps.resumeWorkflow(id);
          } else if (controlAction === 'cancel') {
            await deps.cancelWorkflow(id);
          } else if (controlAction === 'retry') {
            await deps.retryWorkflow(id);
          } else {
            throw new Error(
              `Unknown action: ${controlAction}. Must be pause, resume, cancel, or retry.`,
            );
          }
          return ok({ id, action: controlAction });
        } catch (error) {
          return fail(error);
        }
      } else if (action === 'expandIdea') {
        try {
          const rawPrompt = args.prompt;
          if (typeof rawPrompt !== 'string' || rawPrompt.trim().length === 0) {
            throw new TypedToolError(
              formatValidationError(
                'workflow.manage { action: \'expandIdea\' }',
                'prompt',
                'is required and must be a non-empty string',
                args,
                'Correct call: { prompt: "<your creative concept as a single string>" }.',
              ),
              'validation',
            );
          }
          const prompt = rawPrompt.trim();
          const genre = typeof args.genre === 'string' ? args.genre : 'cinematic';
          const actCount =
            typeof args.actCount === 'number' && args.actCount > 0
              ? Math.round(args.actCount)
              : 3;
          const instructions = [
            `Expand the idea "${prompt}" into a ${genre} story with ${actCount} acts and 2-4 scenes per act.`,
            '',
            'This tool only produces the outline scaffold. After the outline is approved, drive the full story-to-video pipeline phase by phase, confirming with the user before moving to the next phase:',
            '',
            'Phase 1 — Outline scene nodes.',
            '  For each scene: canvas.createNodes { nodes: [{ type: "text", title, content: "2-3 sentence summary" }] }. Lay them out left-to-right along the X axis. After all nodes exist, present the outline and ask the user for approval.',
            '',
            'Phase 2 — Extract entities.',
            '  Read every scene summary and identify recurring characters, equipment, and locations. Call entity.create { type: "character" } / entity.create { type: "equipment" } / entity.create { type: "location" } for each. Prefer one shared entity over per-scene duplicates; merge when two descriptions match the same real entity.',
            '',
            'Phase 3 — Fill node asset stores.',
            '  For each scene, add media nodes (image first/last frames + video) via canvas.createNodes. Populate each media node: prompt (from scene summary), preset tracks (canvas.presetTracks), shot template and style presets, and character/equipment/location refs (canvas.setNodeRefs). Connect first-frame image → video → last-frame image with canvas.connectNodes.',
            '',
            'Phase 4 — Generate reference images.',
            '  For each entity: entity.generateRefImage { type: "character" | "location" | "equipment" }. Wait for completion before moving on. These refs gate every downstream image/video generation — do not skip.',
            '',
            'Phase 5 — Generate first/last frames.',
            '  For each scene, canvas.generation { action: \'start\' } on the image nodes. Wait for completion, then canvas.selectVariant for the user-preferred variant of each frame.',
            '',
            'Phase 6 — Generate videos.',
            '  For each video node, ensure canvas.setVideoFrames has been called with the first/last frame node IDs, then canvas.generation { action: \'start\' } with nodeType="video". Wait, select variants, then finally render.start to produce the full cut.',
            '',
            'At the end of each phase, summarize what was done and ask the user "ready for the next phase?" before proceeding. Never chain phases silently.',
          ].join('\n');

          return ok({
            instructions,
            outlineFormat: {
              title: '<story title>',
              genre,
              logline: '<one sentence summary>',
              acts: Array.from({ length: actCount }, (_, i) => ({
                name: `Act ${i + 1}`,
                scenes: [{ title: '<scene title>', summary: '<2-3 sentence summary>' }],
              })),
            },
          });
        } catch (error) {
          return fail(error);
        }
      } else {
        return fail(new Error(`Unknown action: ${action}`));
      }
    },
  };

  return [manage];
}
