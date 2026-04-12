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
          instructions: `1. Call canvas.getNode(canvasId="${args.canvasId}", nodeId="${args.referenceNodeId}") to read the reference node prompt. 2. Extract style descriptors: rendering technique, color palette, lighting logic, texture. 3. For each nodeId in ${JSON.stringify(args.targetNodeIds)}: call canvas.getNode to read its prompt, prepend [STYLE: <extracted descriptors>] to the prompt, call canvas.updateNodes to write it back. 4. Report which nodes were updated.`,
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
    async execute(_args) {
      try {
        return ok({
          instructions: `1. If sceneNodeIds provided, read each via canvas.getNode. Otherwise call canvas.listNodes(type="text") to find all text nodes. 2. For each scene node: decompose into 1-3 shots. Each shot needs: shotType (ECU/CU/MS/LS/ELS), subject, action (state-flow verb), setting, duration (seconds), cameraMove, mood. 3. Create one text node per shot via canvas.addNode(type="text", title="Shot: <shotType> - <subject>", data.content=<shot details>). 4. Present the shot list to the user.`,
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
          instructions: `Style target: "${args.styleTarget}". For each nodeId in ${JSON.stringify(args.nodeIds)}: 1. Call canvas.getNode to read current prompt. 2. Rewrite prompt: keep subject/action/content, apply style target (rendering, color, lighting vocabulary). 3. Show diff (BEFORE/AFTER truncated to 80 chars). 4. Call commander.askUser to confirm before writing. 5. On approval: call canvas.updateNodes to write rewritten prompt.`,
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
          instructions: `1. If nodeIds not provided, call canvas.listNodes(canvasId="${args.canvasId}", type="image") to get all image nodes. 2. Resolve story order: follow directed edges first, then sort by canvas position (left-to-right, top-to-bottom), then by title numbering. 3. For each node call canvas.getNode to read title, prompt, status. 4. Output a markdown table: | # | Node ID | Shot Type | Duration | Action Summary | Status |. Skip nodes with status "empty" and mark them PENDING. 5. Present the storyboard to the user.`,
        });
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

  const videoCloneWorkflow: AgentTool = {
    name: 'workflow.videoClone',
    description: 'Guide the user through cloning and remaking a video with AI.',
    tags: ['workflow', 'video'],
    tier: 1,
    parameters: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Project ID.' },
      },
      required: ['projectId'],
    },
    async execute(args) {
      try {
        return ok({
          instructions: `Video Clone Workflow: 1. Ask the user to select a video file. 2. Call video.clone(filePath, projectId="${args.projectId}", threshold=0.4) to analyze and split the video. 3. The result is a new canvas with auto-described video nodes. 4. Review the generated prompts — use vision.describeImage with style="style-analysis" on key nodes to extract a unified style. 5. Apply the extracted style to all nodes via workflow.batchRePrompt. 6. Set up the Style Guide with the extracted art style, lighting, and color palette. 7. Regenerate individual shots or batch generate all. 8. Cross-frame continuity is automatic — each completed video chains its last frame to the next node.`,
        });
      } catch (error) { return fail(error); }
    },
  };

  const lipSyncWorkflow: AgentTool = {
    name: 'workflow.lipSync',
    description: 'Set up lip sync for a video node with dialogue audio.',
    tags: ['workflow', 'audio', 'video'],
    tier: 1,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'Canvas ID.' },
        videoNodeId: { type: 'string', description: 'Video node ID.' },
        dialogue: { type: 'string', description: 'Dialogue text for TTS.' },
        emotion: { type: 'string', description: 'Dominant emotion for TTS (e.g. happy, sad, angry).' },
      },
      required: ['canvasId', 'videoNodeId'],
    },
    async execute(args) {
      try {
        const emotion = typeof args.emotion === 'string' ? args.emotion : 'neutral';
        return ok({
          instructions: `Lip Sync Setup for node ${args.videoNodeId} on canvas ${args.canvasId}: 1. Create an audio node: canvas.addNode(canvasId="${args.canvasId}", type="audio", data={ audioType: "voice", prompt: "${args.dialogue || '[dialogue text]'}", emotionVector: { ${emotion}: 0.8, neutral: 0.2 } }). 2. Connect the audio node to the video node: canvas.connectNodes(canvasId="${args.canvasId}", sourceId=audioNodeId, targetId="${args.videoNodeId}"). 3. Enable lip sync on the video node: canvas.updateNodes(canvasId="${args.canvasId}", nodeId="${args.videoNodeId}", lipSyncEnabled=true). 4. Generate the audio node first, then generate/regenerate the video — lip sync processing runs automatically after video generation completes.`,
        });
      } catch (error) { return fail(error); }
    },
  };

  const emotionVoiceWorkflow: AgentTool = {
    name: 'workflow.emotionVoice',
    description: 'Create emotionally expressive voice-over audio nodes for a scene.',
    tags: ['workflow', 'audio'],
    tier: 1,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'Canvas ID.' },
        lines: { type: 'array', description: 'Dialogue lines with emotion.', items: {
          type: 'object',
          description: 'A dialogue line with emotion.',
          properties: {
            text: { type: 'string', description: 'Dialogue text.' },
            emotion: { type: 'string', description: 'Primary emotion.' },
            intensity: { type: 'number', description: 'Emotion intensity 0-1.' },
          },
        }},
      },
      required: ['canvasId', 'lines'],
    },
    async execute(args) {
      try {
        return ok({
          instructions: `Emotion Voice Workflow on canvas "${args.canvasId}": For each line in the provided list: 1. Map the emotion name to the 8-dimensional vector: { happy, sad, angry, fearful, surprised, disgusted, contemptuous, neutral }. Set the named emotion to the given intensity (default 0.8), set neutral to fill remaining weight. 2. Call canvas.addNode(canvasId="${args.canvasId}", type="audio", title="VO: [first 30 chars of text]", data={ audioType: "voice", prompt: "[text]", emotionVector: [computed vector] }). 3. After all nodes are created, present the list with emotion assignments for user review.`,
          emotionMap: {
            happy: { happy: 0.8, neutral: 0.2 },
            sad: { sad: 0.8, neutral: 0.2 },
            angry: { angry: 0.7, contemptuous: 0.2, neutral: 0.1 },
            fearful: { fearful: 0.8, neutral: 0.2 },
            surprised: { surprised: 0.8, neutral: 0.2 },
            calm: { neutral: 0.9, happy: 0.1 },
            sarcastic: { contemptuous: 0.5, happy: 0.3, neutral: 0.2 },
          },
        });
      } catch (error) { return fail(error); }
    },
  };

  const dualPromptWorkflow: AgentTool = {
    name: 'workflow.dualPrompt',
    description: 'Set up dual prompts (image vs video) for nodes that need different descriptions for stills and motion.',
    tags: ['workflow', 'canvas'],
    tier: 1,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'Canvas ID.' },
        nodeIds: { type: 'array', description: 'Node IDs to configure.', items: { type: 'string', description: 'Node ID.' } },
      },
      required: ['canvasId', 'nodeIds'],
    },
    async execute(args) {
      try {
        return ok({
          instructions: `Dual Prompt Setup on canvas "${args.canvasId}" for nodes ${JSON.stringify(args.nodeIds)}: For each node: 1. Read the current prompt via canvas.getNode. 2. Generate an imagePrompt variant: emphasize environment detail, texture, lighting, static composition — remove motion verbs. 3. Generate a videoPrompt variant: add motion verbs (pan, track, dolly), camera movement, temporal transitions — keep subject consistent. 4. Call canvas.updateNodes to set imagePrompt and videoPrompt. 5. The original prompt field is kept as fallback. Show the user: ORIGINAL → IMAGE → VIDEO for each node.`,
        });
      } catch (error) { return fail(error); }
    },
  };

  return [styleTransfer, shotList, batchRePrompt, continuityCheck, storyboardExport, imageAnalyze, videoCloneWorkflow, lipSyncWorkflow, emotionVoiceWorkflow, dualPromptWorkflow];
}
