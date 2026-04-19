import type { AgentTool } from '../tool-registry.js';
import { ok, fail, requireString } from './tool-result-helpers.js';

export interface WorkflowToolDeps {
  pauseWorkflow: (id: string) => Promise<void>;
  resumeWorkflow: (id: string) => Promise<void>;
  cancelWorkflow: (id: string) => Promise<void>;
  retryWorkflow: (id: string) => Promise<void>;
}

export function createWorkflowTools(deps: WorkflowToolDeps): AgentTool[] {
  const context = ['canvas'];

  const control: AgentTool = {
    name: 'workflow.control',
    description: 'Control a workflow run: pause, resume, cancel, or retry by ID.',
    context,
    tier: 4,
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Workflow run ID.' },
        action: { type: 'string', description: 'Action to perform.', enum: ['pause', 'resume', 'cancel', 'retry'] },
      },
      required: ['id', 'action'],
    },
    async execute(args) {
      try {
        const id = requireString(args, 'id');
        const action = requireString(args, 'action');
        if (action === 'pause') {
          await deps.pauseWorkflow(id);
        } else if (action === 'resume') {
          await deps.resumeWorkflow(id);
        } else if (action === 'cancel') {
          await deps.cancelWorkflow(id);
        } else if (action === 'retry') {
          await deps.retryWorkflow(id);
        } else {
          throw new Error(`Unknown action: ${action}. Must be pause, resume, cancel, or retry.`);
        }
        return ok({ id, action });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const expandIdea: AgentTool = {
    name: 'workflow.expandIdea',
    description: 'Returns structured instructions and outline template for Commander to expand a one-liner idea into story text nodes on the canvas.',
    tags: ['workflow', 'story', 'generation'],
    context,
    tier: 1,
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'The one-liner idea to expand.' },
        genre: { type: 'string', description: 'Optional genre (e.g. anime, film noir, documentary).' },
        actCount: { type: 'number', description: 'Number of acts. Default 3.' },
      },
      required: ['prompt'],
    },
    async execute(args) {
      try {
        const prompt = requireString(args, 'prompt');
        const genre = typeof args.genre === 'string' ? args.genre : 'cinematic';
        const actCount = typeof args.actCount === 'number' && args.actCount > 0 ? Math.round(args.actCount) : 3;
        const instructions = [
          `Expand the idea "${prompt}" into a ${genre} story with ${actCount} acts and 2-4 scenes per act.`,
          '',
          'This tool only produces the outline scaffold. After the outline is approved, drive the full story-to-video pipeline phase by phase, confirming with the user before moving to the next phase:',
          '',
          'Phase 1 — Outline scene nodes.',
          '  For each scene: canvas.addNode { type: "text", title, data.content = 2-3 sentence summary }. Lay them out left-to-right along the X axis. After all nodes exist, present the outline and ask the user for approval.',
          '',
          'Phase 2 — Extract entities.',
          '  Read every scene summary and identify recurring characters, equipment, and locations. Call character.create / equipment.create / location.create for each. Prefer one shared entity over per-scene duplicates; merge when two descriptions match the same real entity.',
          '',
          'Phase 3 — Fill node asset stores.',
          '  For each scene, add media nodes (image first/last frames + video) via canvas.addNode. Populate each media node: prompt (from scene summary), preset tracks (canvas.setNodePresets), shot template and style presets, and character/equipment/location refs (canvas.setNodeRefs). Connect first-frame image → video → last-frame image with canvas.connectNodes.',
          '',
          'Phase 4 — Generate reference images.',
          '  For each character / equipment / location entity: character.generateRefImage (and the equivalent equipment/location tools). Wait for completion before moving on. These refs gate every downstream image/video generation — do not skip.',
          '',
          'Phase 5 — Generate first/last frames.',
          '  For each scene, canvas.generate on the image nodes. Wait for completion, then canvas.selectVariant for the user-preferred variant of each frame.',
          '',
          'Phase 6 — Generate videos.',
          '  For each video node, ensure canvas.setVideoFrames has been called with the first/last frame node IDs, then canvas.generate with nodeType="video". Wait, select variants, then finally render.start to produce the full cut.',
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
    },
  };

  return [control, expandIdea];
}
