import type { AgentTool } from '../tool-registry.js';

export interface WorkflowToolDeps {
  pauseWorkflow: (id: string) => Promise<void>;
  resumeWorkflow: (id: string) => Promise<void>;
  cancelWorkflow: (id: string) => Promise<void>;
  retryWorkflow: (id: string) => Promise<void>;
}

type ToolResult = { success: true; data?: unknown } | { success: false; error: string };

function ok(data?: unknown): ToolResult {
  return data === undefined ? { success: true } : { success: true, data };
}

function fail(error: unknown): ToolResult {
  return { success: false, error: error instanceof Error ? error.message : String(error) };
}

function requireString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${key} is required`);
  }
  return value.trim();
}

export function createWorkflowTools(deps: WorkflowToolDeps): AgentTool[] {
  const context = ['canvas'];

  const pause: AgentTool = {
    name: 'workflow.pause',
    description: 'Pause a workflow run by ID.',
    context,
    tier: 4,
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Workflow run ID.' },
      },
      required: ['id'],
    },
    async execute(args) {
      try {
        const id = requireString(args, 'id');
        await deps.pauseWorkflow(id);
        return ok({ id });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const resume: AgentTool = {
    name: 'workflow.resume',
    description: 'Resume a paused workflow run by ID.',
    context,
    tier: 4,
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Workflow run ID.' },
      },
      required: ['id'],
    },
    async execute(args) {
      try {
        const id = requireString(args, 'id');
        await deps.resumeWorkflow(id);
        return ok({ id });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const cancel: AgentTool = {
    name: 'workflow.cancel',
    description: 'Cancel a workflow run by ID.',
    context,
    tier: 4,
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Workflow run ID.' },
      },
      required: ['id'],
    },
    async execute(args) {
      try {
        const id = requireString(args, 'id');
        await deps.cancelWorkflow(id);
        return ok({ id });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const retry: AgentTool = {
    name: 'workflow.retry',
    description: 'Retry a workflow run by ID.',
    context,
    tier: 4,
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Workflow run ID.' },
      },
      required: ['id'],
    },
    async execute(args) {
      try {
        const id = requireString(args, 'id');
        await deps.retryWorkflow(id);
        return ok({ id });
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

  return [pause, resume, cancel, retry, expandIdea];
}

export function createUtilityWorkflowTools(): AgentTool[] {
  function ok(data?: unknown): ToolResult { return data === undefined ? { success: true } : { success: true, data }; }
  function fail(error: unknown): ToolResult { return { success: false, error: error instanceof Error ? error.message : String(error) }; }

  const styleTransfer: AgentTool = {
    name: 'workflow.styleTransfer',
    description: 'Extract visual style from a reference node and apply it to target nodes.',
    tags: ['workflow', 'style'],
    tier: 1,
    parameters: {
      type: 'object',
      properties: {
        referenceNodeId: { type: 'string', description: 'Node ID to extract style from.' },
        targetNodeIds: { type: 'array', description: 'Node IDs to apply style to.', items: { type: 'string', description: 'Node ID.' } },
        canvasId: { type: 'string', description: 'Canvas ID.' },
      },
      required: ['referenceNodeId', 'targetNodeIds', 'canvasId'],
    },
    async execute(args) {
      try {
        return ok({
          instructions: `1. Call canvas.getNode(canvasId="${args.canvasId}", nodeId="${args.referenceNodeId}") to read the reference node prompt. 2. Extract style descriptors: rendering technique, color palette, lighting logic, texture. 3. For each nodeId in ${JSON.stringify(args.targetNodeIds)}: call canvas.getNode to read its prompt, prepend [STYLE: <extracted descriptors>] to the prompt, call canvas.updateNodeData to write it back. 4. Report which nodes were updated.`,
        });
      } catch (error) { return fail(error); }
    },
  };

  const shotList: AgentTool = {
    name: 'workflow.shotList',
    description: 'Decompose scene text nodes into a shot list and create one text node per shot.',
    tags: ['workflow', 'script'],
    tier: 1,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'Canvas ID.' },
        sceneNodeIds: { type: 'array', description: 'Scene node IDs to decompose.', items: { type: 'string', description: 'Node ID.' } },
      },
      required: ['canvasId'],
    },
    async execute(args) {
      try {
        return ok({
          instructions: `1. If sceneNodeIds provided, read each via canvas.getNode. Otherwise call canvas.searchNodes(type="text") to find all text nodes. 2. For each scene node: decompose into 1-3 shots. Each shot needs: shotType (ECU/CU/MS/LS/ELS), subject, action (state-flow verb), setting, duration (seconds), cameraMove, mood. 3. Create one text node per shot via canvas.addNode(type="text", title="Shot: <shotType> - <subject>", data.content=<shot details>). 4. Present the shot list to the user.`,
          shotSchema: { shotType: 'ECU|CU|MS|LS|ELS', subject: '', action: '', setting: '', duration: 5, cameraMove: '', mood: '' },
        });
      } catch (error) { return fail(error); }
    },
  };

  const batchRePrompt: AgentTool = {
    name: 'workflow.batchRePrompt',
    description: 'Rewrite multiple node prompts to match a target style while preserving content.',
    tags: ['workflow', 'canvas'],
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'Canvas ID.' },
        nodeIds: { type: 'array', description: 'Node IDs to rewrite.', items: { type: 'string', description: 'Node ID.' } },
        styleTarget: { type: 'string', description: 'Style descriptor to apply to all nodes.' },
      },
      required: ['canvasId', 'nodeIds', 'styleTarget'],
    },
    async execute(args) {
      try {
        return ok({
          instructions: `Style target: "${args.styleTarget}". For each nodeId in ${JSON.stringify(args.nodeIds)}: 1. Call canvas.getNode to read current prompt. 2. Rewrite prompt: keep subject/action/content, apply style target (rendering, color, lighting vocabulary). 3. Show diff (BEFORE/AFTER truncated to 80 chars). 4. Call commander.askUser to confirm before writing. 5. On approval: call canvas.updateNodeData to write rewritten prompt.`,
        });
      } catch (error) { return fail(error); }
    },
  };

  const continuityCheck: AgentTool = {
    name: 'workflow.continuityCheck',
    description: 'Check visual continuity across canvas nodes and report inconsistencies.',
    tags: ['workflow', 'vision'],
    tier: 1,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'Canvas ID.' },
        nodeIds: { type: 'array', description: 'Node IDs to check.', items: { type: 'string', description: 'Node ID.' } },
      },
      required: ['canvasId', 'nodeIds'],
    },
    async execute(args) {
      try {
        return ok({
          instructions: `For each nodeId in ${JSON.stringify(args.nodeIds)}: 1. Call canvas.getNode to read prompt, characterRefs, lighting descriptors. 2. Extract: characters (clothing/hair), lighting direction+temperature, color palette, environment. 3. Compare across all nodes. 4. Report inconsistencies by severity: CRITICAL (character clothing/appearance changes), MAJOR (light source switches sides), MINOR (slight color shift). 5. For each critical/major issue: suggest which node to regenerate or which prompt field to fix.`,
          severityLevels: { critical: 'must fix', major: 'should fix', minor: 'flag only' },
        });
      } catch (error) { return fail(error); }
    },
  };

  const storyboardExport: AgentTool = {
    name: 'workflow.storyboardExport',
    description: 'Arrange canvas nodes in story order and output a markdown storyboard.',
    tags: ['workflow', 'export'],
    tier: 1,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'Canvas ID.' },
        nodeIds: { type: 'array', description: 'Optional node IDs. If omitted, uses all image nodes.', items: { type: 'string', description: 'Node ID.' } },
      },
      required: ['canvasId'],
    },
    async execute(args) {
      try {
        return ok({
          instructions: `1. If nodeIds not provided, call canvas.searchNodes(canvasId="${args.canvasId}", type="image") to get all image nodes. 2. Resolve story order: follow directed edges first, then sort by canvas position (left-to-right, top-to-bottom), then by title numbering. 3. For each node call canvas.getNode to read title, prompt, status. 4. Output a markdown table: | # | Node ID | Shot Type | Duration | Action Summary | Status |. Skip nodes with status "empty" and mark them PENDING. 5. Present the storyboard to the user.`,
        });
      } catch (error) { return fail(error); }
    },
  };

  const fileClassify: AgentTool = {
    name: 'file.classify',
    description: 'Classify uploaded file content to determine how Commander should handle it.',
    tags: ['workflow', 'meta'],
    tier: 1,
    parameters: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'File content to classify.' },
        filename: { type: 'string', description: 'Optional filename for extension hints.' },
      },
      required: ['content'],
    },
    async execute(args) {
      try {
        const content = String(args.content);
        const filename = typeof args.filename === 'string' ? args.filename.toLowerCase() : '';
        const isScript = /\b(INT\.|EXT\.)\s/.test(content) || filename.endsWith('.fountain') || filename.endsWith('.fdx');
        const isPrompt = /^(#|You are|system:|SYSTEM:)/.test(content.trim());
        const isWorkflow = /\b(workflow:|skill:)\s/.test(content);
        const detectedType = isScript ? 'script' : isPrompt ? 'prompt' : isWorkflow ? 'workflow' : 'unknown';
        const confidence = (isScript || isPrompt || isWorkflow) ? 'high' : 'low';
        const suggestions: Record<string, string> = {
          script: 'Call script.import to parse this as a script, then use workflow.expandIdea pattern to create text nodes.',
          prompt: 'Offer to replace an existing prompt template via guide.list + guide.get, or create a new one.',
          workflow: 'Inform user that workflow/skill management is in Settings > Workflows & Skills.',
          unknown: 'Ask user what they want to do with this file.',
        };
        return ok({ detectedType, confidence, suggestion: suggestions[detectedType] });
      } catch (error) { return fail(error); }
    },
  };

  const imageAnalyze: AgentTool = {
    name: 'workflow.imageAnalyze',
    description: 'Analyze a generated canvas image node to extract characters, equipment, and scene details.',
    tags: ['workflow', 'vision'],
    tier: 1,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'Canvas ID.' },
        nodeId: { type: 'string', description: 'Image node ID to analyze.' },
      },
      required: ['canvasId', 'nodeId'],
    },
    async execute(args) {
      try {
        return ok({
          instructions: `1. Call canvas.getNode(canvasId="${args.canvasId}", nodeId="${args.nodeId}") to read the node. 2. Use vision capabilities to analyze the image (assetHash from node data). 3. Extract: characters (appearance, clothing, role), equipment (props, tools, vehicles), scene (location type, time of day, lighting, mood). 4. For each extracted entity: call character.create / equipment.create / scene.create with the extracted details. 5. Report what was extracted and created.`,
          extractionSchema: {
            characters: [{ name: '', appearance: '', clothing: '', role: '' }],
            equipment: [{ name: '', type: '', description: '' }],
            scene: { locationType: '', timeOfDay: '', lighting: '', mood: '', description: '' },
          },
        });
      } catch (error) { return fail(error); }
    },
  };

  return [styleTransfer, shotList, batchRePrompt, continuityCheck, storyboardExport, fileClassify, imageAnalyze];
}
