/**
 * Built-in workflow prompt guides.
 *
 * These were previously registered as instruction-only AgentTools (via
 * createUtilityWorkflowTools). They don't execute anything — they provide
 * step-by-step instructions for the Commander AI to follow using existing
 * tools. Hosting them as prompt guides (accessible via guide.get) avoids
 * wasting tool-schema budget.
 */

export interface PromptGuide {
  id: string;
  name: string;
  content: string;
}

export const WORKFLOW_GUIDES: PromptGuide[] = [
  {
    id: 'workflow-style-transfer',
    name: 'Style Transfer',
    content:
      'Extract visual style from a reference node and apply it to target nodes.\n\n' +
      'Steps:\n' +
      '1. Call canvas.getNode to read the reference node prompt.\n' +
      '2. Extract style descriptors: rendering technique, color palette, lighting logic, texture.\n' +
      '3. For each target node: call canvas.getNode to read its prompt, prepend [STYLE: <extracted descriptors>] to the prompt, call canvas.updateNodes to write it back.\n' +
      '4. Report which nodes were updated.',
  },
  {
    id: 'workflow-shot-list',
    name: 'Shot List',
    content:
      'Decompose scene text nodes into a shot list and create one text node per shot.\n\n' +
      'Steps:\n' +
      '1. If sceneNodeIds provided, read each via canvas.getNode. Otherwise call canvas.listNodes(type="text") to find all text nodes.\n' +
      '2. For each scene node: decompose into 1-3 shots. Each shot needs: shotType (ECU/CU/MS/LS/ELS), subject, action (state-flow verb), setting, duration (seconds), cameraMove, mood.\n' +
      '3. Create one text node per shot via canvas.addNode(type="text", title="Shot: <shotType> - <subject>", content=<shot details>).\n' +
      '4. Present the shot list to the user.\n\n' +
      'Shot schema: { shotType: "ECU|CU|MS|LS|ELS", subject, action, setting, duration: 5, cameraMove, mood }',
  },
  {
    id: 'workflow-batch-reprompt',
    name: 'Batch Re-Prompt',
    content:
      'Rewrite multiple node prompts to match a target style while preserving content.\n\n' +
      'Steps:\n' +
      '1. For each target node: call canvas.getNode to read the current prompt.\n' +
      '2. Rewrite the prompt: keep subject/action/content, apply the target style (rendering, color, lighting vocabulary).\n' +
      '3. Show diff (BEFORE/AFTER truncated to 80 chars).\n' +
      '4. Call commander.askUser to confirm before writing.\n' +
      '5. On approval: call canvas.updateNodes to write the rewritten prompt.',
  },
  {
    id: 'workflow-continuity-check',
    name: 'Continuity Check',
    content:
      'Check visual continuity across canvas nodes and report inconsistencies.\n\n' +
      'Steps:\n' +
      '1. For each node: call canvas.getNode to read prompt, characterRefs, lighting descriptors.\n' +
      '2. Extract: characters (clothing/hair), lighting direction + temperature, color palette, environment.\n' +
      '3. Compare across all nodes.\n' +
      '4. Report inconsistencies by severity:\n' +
      '   - CRITICAL: character clothing/appearance changes\n' +
      '   - MAJOR: light source switches sides\n' +
      '   - MINOR: slight color shift\n' +
      '5. For each critical/major issue: suggest which node to regenerate or which prompt field to fix.',
  },
  {
    id: 'workflow-storyboard-export',
    name: 'Storyboard Export',
    content:
      'Arrange canvas nodes in story order and output a markdown storyboard.\n\n' +
      'Steps:\n' +
      '1. If nodeIds not provided, call canvas.listNodes(type="image") to get all image nodes.\n' +
      '2. Resolve story order: follow directed edges first, then sort by canvas position (left-to-right, top-to-bottom), then by title numbering.\n' +
      '3. For each node call canvas.getNode to read title, prompt, status.\n' +
      '4. Output a markdown table: | # | Node ID | Shot Type | Duration | Action Summary | Status |. Skip nodes with status "empty" and mark them PENDING.\n' +
      '5. Present the storyboard to the user.',
  },
  {
    id: 'workflow-image-analyze',
    name: 'Image Analyze',
    content:
      'Analyze a generated canvas image node to extract characters, equipment, and scene details.\n\n' +
      'Steps:\n' +
      '1. Call canvas.getNode to read the node.\n' +
      '2. Use vision.describeImage to analyze the image (assetHash from node data).\n' +
      '3. Extract: characters (appearance, clothing, role), equipment (props, tools, vehicles), scene (location type, time of day, lighting, mood).\n' +
      '4. For each extracted entity: call character.create / equipment.create / scene.create with the extracted details.\n' +
      '5. Report what was extracted and created.\n\n' +
      'Extraction schema: { characters: [{ name, appearance, clothing, role }], equipment: [{ name, type, description }], scene: { locationType, timeOfDay, lighting, mood, description } }',
  },
  {
    id: 'workflow-video-clone',
    name: 'Video Clone',
    content:
      'Guide the user through cloning and remaking a video with AI.\n\n' +
      'Steps:\n' +
      '1. Ask the user to select a video file.\n' +
      '2. Call video.clone(filePath, threshold=0.4) to analyze and split the video.\n' +
      '3. The result is a new canvas with auto-described video nodes.\n' +
      '4. Review the generated prompts — use vision.describeImage with style="style-analysis" on key nodes to extract a unified style.\n' +
      '5. Apply the extracted style to all nodes via the Batch Re-Prompt workflow (guide: workflow-batch-reprompt).\n' +
      '6. Set up the Style Guide with the extracted art style, lighting, and color palette.\n' +
      '7. Regenerate individual shots or batch generate all.\n' +
      '8. Cross-frame continuity is automatic — each completed video chains its last frame to the next node.',
  },
  {
    id: 'workflow-lip-sync',
    name: 'Lip Sync Setup',
    content:
      'Set up lip sync for a video node with dialogue audio.\n\n' +
      'Steps:\n' +
      '1. Create an audio node: canvas.addNode(type="audio", title="VO: <dialogue>") with data: { audioType: "voice", prompt: "<dialogue text>", emotionVector: { <dominant emotion>: 0.8, neutral: 0.2 } }.\n' +
      '2. Connect the audio node to the video node: canvas.connectNodes(sourceId=audioNodeId, targetId=videoNodeId).\n' +
      '3. Enable lip sync on the video node: canvas.updateNodes(nodeId=videoNodeId, lipSyncEnabled=true).\n' +
      '4. Generate the audio node first, then generate/regenerate the video — lip sync processing runs automatically after video generation completes.',
  },
  {
    id: 'workflow-emotion-voice',
    name: 'Emotion Voice',
    content:
      'Create emotionally expressive voice-over audio nodes for a scene.\n\n' +
      'Steps:\n' +
      'For each dialogue line:\n' +
      '1. Map the emotion name to the 8-dimensional vector: { happy, sad, angry, fearful, surprised, disgusted, contemptuous, neutral }. Set the named emotion to the given intensity (default 0.8), set neutral to fill remaining weight.\n' +
      '2. Call canvas.addNode(type="audio", title="VO: [first 30 chars of text]") with data: { audioType: "voice", prompt: "<text>", emotionVector: <computed vector> }.\n' +
      '3. After all nodes are created, present the list with emotion assignments for user review.\n\n' +
      'Emotion presets:\n' +
      '- happy: { happy: 0.8, neutral: 0.2 }\n' +
      '- sad: { sad: 0.8, neutral: 0.2 }\n' +
      '- angry: { angry: 0.7, contemptuous: 0.2, neutral: 0.1 }\n' +
      '- fearful: { fearful: 0.8, neutral: 0.2 }\n' +
      '- surprised: { surprised: 0.8, neutral: 0.2 }\n' +
      '- calm: { neutral: 0.9, happy: 0.1 }\n' +
      '- sarcastic: { contemptuous: 0.5, happy: 0.3, neutral: 0.2 }',
  },
  {
    id: 'workflow-dual-prompt',
    name: 'Dual Prompt Setup',
    content:
      'Set up dual prompts (image vs video) for nodes that need different descriptions for stills and motion.\n\n' +
      'Steps:\n' +
      'For each node:\n' +
      '1. Read the current prompt via canvas.getNode.\n' +
      '2. Generate an imagePrompt variant: emphasize environment detail, texture, lighting, static composition — remove motion verbs.\n' +
      '3. Generate a videoPrompt variant: add motion verbs (pan, track, dolly), camera movement, temporal transitions — keep subject consistent.\n' +
      '4. Call canvas.updateNodes to set imagePrompt and videoPrompt.\n' +
      '5. The original prompt field is kept as fallback. Show the user: ORIGINAL → IMAGE → VIDEO for each node.',
  },
];
