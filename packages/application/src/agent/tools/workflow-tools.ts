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
        return ok({
          instructions: `Expand the idea "${prompt}" into a ${genre} story with ${actCount} acts and 2-4 scenes per act. For each scene: call canvas.addNode with type "text", title = scene name, data.content = 2-3 sentence scene summary. After all nodes are created, present the full outline to the user and ask if they want to proceed to entity generation.`,
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
