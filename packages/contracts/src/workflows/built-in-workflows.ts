/**
 * Built-in Workflow Definitions
 *
 * Two preset workflows for common production scenarios.
 */

export interface WorkflowStep {
  id: string;
  title: string;
  description: string;
  commanderPrompt: string;
  guidesUsed?: string[];
}

export interface WorkflowDefinition {
  id: string;
  name: { 'zh-CN': string; 'en-US': string };
  description: { 'zh-CN': string; 'en-US': string };
  builtIn: boolean;
  steps: WorkflowStep[];
}

export const BUILT_IN_WORKFLOWS: WorkflowDefinition[] = [
  {
    id: 'workflow-story-idea-to-video',
    name: {
      'zh-CN': '故事创意 → 视频',
      'en-US': 'Story Idea → Video',
    },
    description: {
      'zh-CN': '从一个简短的故事创意出发，扩展为完整的视频制作流程',
      'en-US': 'Start from a short story idea and expand into a full video production pipeline',
    },
    builtIn: true,
    steps: [
      {
        id: 'step-expand-story',
        title: 'Expand Story Concept',
        description: 'Commander AI expands the story idea into scenes, characters, and settings',
        commanderPrompt: `I have a story idea: "{user_input}"

Please expand this into:
1. A brief synopsis (3-5 sentences)
2. Main characters with physical descriptions (hair, eyes, clothing, distinctive features)
3. Key locations/settings
4. 5-8 key scenes that tell the story

For each scene, describe: the setting, characters present, key action, and emotional tone.`,
        guidesUsed: ['01-prompt-structure', '04-motion-and-emotion'],
      },
      {
        id: 'step-create-entities',
        title: 'Create Characters & Locations',
        description: 'Create character and location entities with detailed descriptions',
        commanderPrompt: `Based on the story breakdown, create entities:

For each character:
- Use character.create with full physical description (15-20 specific traits)
- Include: gender, age, hair color/style, eye color, skin tone, build, clothing, distinctive features

For each location:
- Use location.create with atmospheric description
- Include: time of day, lighting conditions, key landmarks, mood`,
        guidesUsed: ['14-reference-image-generation'],
      },
      {
        id: 'step-generate-references',
        title: 'Generate Reference Images',
        description: 'Generate turnaround reference sheets for characters and locations',
        commanderPrompt: `Generate reference images for all characters and locations:

For characters: Generate the single \`full-sheet\` reference — a six-panel composite in a 2×3 grid with unequal row heights. The top row (~70% of sheet height) holds three full-body panels at identical scale: front, left profile, rear. The bottom row (~30%) holds three head-and-shoulders expression panels: neutral, happy, angry. Solid white background, flat even studio lighting, single character, no props or environment.

For locations: Generate the \`bible\` reference — a five-tile model sheet with a wide establishing panel on the top half and four equal tiles on the bottom half (interior detail, atmosphere, key angle 1, key angle 2). Consistent time of day, weather, and lighting across every tile. No characters in the frame.

Use google-imagen3 or openai-image provider for best quality.`,
        guidesUsed: ['14-reference-image-generation', '05-style-and-aesthetics'],
      },
      {
        id: 'step-build-shot-list',
        title: 'Build Shot List',
        description: 'Break scenes into individual shots with camera, lighting, and timing',
        commanderPrompt: `Break each scene into individual shots following this schema:
[SHOT_TYPE] [CAMERA_ANGLE]: [SUBJECT] [ACTION/STATE], [LOCATION], [LIGHTING], [DURATION]s

Rules:
- One action = one shot (don't combine two actions)
- 1 narrative beat = 1-3 shots (establish, action, reaction)
- Open each scene with wide shot before close-ups
- Use action verbs: "turns" not "is turning"
- Describe mid-action state, not sequences
- Mark B-roll/atmosphere shots explicitly

Create image nodes for each shot on the canvas.`,
        guidesUsed: ['10-shot-list-from-script', '02-camera-and-composition'],
      },
      {
        id: 'step-apply-presets',
        title: 'Apply Shot Templates & Presets',
        description: 'Apply appropriate shot templates and presets to each node',
        commanderPrompt: `For each image/video node, apply appropriate shot templates:

- Establishing shots → use "Establishing Shot" template
- Dialogue scenes → use "Intimate Dialogue" template
- Action sequences → use "Chase Sequence" or "Action Wide" template
- Emotional moments → match emotion preset (tense, intimate, triumphant)

Set intensity levels:
- Only one category at 90+ per shot
- Dialogue: lens 70, composition 65, emotion 60
- Action: camera 85, flow 90, emotion 80
- Establishing: camera 90, lens 80, technical 100`,
        guidesUsed: ['03-lighting-and-atmosphere', '04-motion-and-emotion'],
      },
      {
        id: 'step-generate-images',
        title: 'Generate Key Frames',
        description: 'Generate images for all shot nodes',
        commanderPrompt: `Generate images for all image nodes:

- Use character reference images for consistency
- Apply the style guide settings for visual coherence
- Generate 2-3 variants per shot, pick the best
- Lock seed on good results for consistency
- Use google-imagen3 for photorealistic, openai-image for stylized`,
        guidesUsed: ['12-continuity-check', '09-style-transfer'],
      },
      {
        id: 'step-generate-video',
        title: 'Generate Video Clips',
        description: 'Convert key frames to video clips using image-to-video',
        commanderPrompt: `For each key frame image, create a video node and generate:

- Use image-to-video workflow (connect image node → video node)
- Describe only the motion, not the full scene
- Keep camera movements subtle for consistency
- Duration: 3-5 seconds per clip
- Use runway or luma for best image-to-video quality

Motion descriptions should be specific:
- "slow push-in, character blinks and turns head slightly"
- "camera drifts right, rain intensifies"`,
        guidesUsed: ['06-workflow-methods', '04-motion-and-emotion'],
      },
    ],
  },
  {
    id: 'workflow-novel-to-video',
    name: {
      'zh-CN': '小说/书籍 → 视频改编',
      'en-US': 'Novel/Book → Video Adaptation',
    },
    description: {
      'zh-CN': '将长篇小说或书籍改编为视频，包括角色提取、场景分割和镜头规划',
      'en-US': 'Adapt a novel or book into video, including character extraction, scene segmentation, and shot planning',
    },
    builtIn: true,
    steps: [
      {
        id: 'step-parse-text',
        title: 'Parse & Analyze Text',
        description: 'Analyze the novel structure — chapters, scenes, key moments',
        commanderPrompt: `Analyze this text and extract:

1. **Chapter/section breakdown** — list each chapter with a 1-sentence summary
2. **Key dramatic moments** — the 10-15 most visual/cinematic moments
3. **Timeline** — chronological order of events
4. **Tone map** — emotional arc per chapter (tense, hopeful, dark, triumphant)

Focus on moments that translate well to visual media. Skip internal monologue and exposition that can't be shown.`,
        guidesUsed: ['10-shot-list-from-script'],
      },
      {
        id: 'step-extract-characters',
        title: 'Extract Characters & Equipment',
        description: 'Isolate all characters with physical descriptions and key equipment/props',
        commanderPrompt: `From the text, extract:

**Characters:**
- Name, role (protagonist/antagonist/supporting)
- Physical description: 15-20 specific traits (age, gender, hair, eyes, skin, build, clothing, scars, accessories)
- Personality keywords for voice/expression guidance

**Equipment/Props:**
- Key objects that appear in multiple scenes
- Weapons, vehicles, tools, symbolic items
- Physical description for each

Create all entities using character.create and equipment.create.`,
        guidesUsed: ['14-reference-image-generation'],
      },
      {
        id: 'step-extract-locations',
        title: 'Extract Locations',
        description: 'Identify and describe all unique locations',
        commanderPrompt: `From the text, extract all unique locations:

For each location:
- Name and type (interior/exterior)
- Physical description: architecture, materials, colors, scale
- Atmospheric details: lighting, weather, time of day
- Mood/feeling the location evokes

Create all locations using location.create.`,
        guidesUsed: ['03-lighting-and-atmosphere'],
      },
      {
        id: 'step-generate-novel-refs',
        title: 'Generate Reference Images',
        description: 'Generate turnaround sheets for all characters, equipment, and locations',
        commanderPrompt: `Generate reference images for all extracted entities:

Characters: main/front slot should be a two-row model sheet with full-body front, left, right, and back panels plus enlarged facial expression studies, white background, even studio lighting
Equipment: orthographic views (front, side, top), technical drawing style
Locations: establishing shot + 2-3 key angles, consistent atmosphere

Generate 3 variants each, select the best for consistency.`,
        guidesUsed: ['14-reference-image-generation'],
      },
      {
        id: 'step-scene-segmentation',
        title: 'Scene Segmentation & Shot Planning',
        description: 'Cut the key moments into individual shots',
        commanderPrompt: `For each of the key dramatic moments identified earlier:

1. Define the scene context (location, time, characters present)
2. Break into 3-8 shots per moment:
   - Opening establishing shot (ELS/LS)
   - Action shots (MS/MCU)
   - Reaction shots (CU/ECU)
   - Closing shot or transition

Use this format per shot:
[SHOT_TYPE] [ANGLE]: [SUBJECT] [MID-ACTION STATE], [LOCATION], [LIGHTING], [DURATION]s

Create image nodes on canvas for each shot. Group by scene.`,
        guidesUsed: ['10-shot-list-from-script', '02-camera-and-composition'],
      },
      {
        id: 'step-novel-presets',
        title: 'Apply Templates & Style Guide',
        description: 'Apply consistent visual style across all shots',
        commanderPrompt: `Apply a consistent visual style:

1. Set project-wide style guide (color palette, lighting style, era)
2. Apply shot templates per scene type:
   - Dialogue → "Intimate Dialogue" template
   - Action → "Chase Sequence" or "Action Wide"
   - Establishing → "Establishing Shot"
   - Flashback → "Dreamy Flashback"
   - Suspense → "Horror Suspense"

3. Ensure character reference images are linked to all relevant nodes
4. Set consistent lighting per location (don't mix lighting styles within a scene)`,
        guidesUsed: ['05-style-and-aesthetics', '09-style-transfer'],
      },
      {
        id: 'step-novel-batch-generate',
        title: 'Batch Generate & Review',
        description: 'Generate all shots, review for consistency, regenerate as needed',
        commanderPrompt: `Generate all image nodes in sequence:

1. Generate establishing shots first (they set the visual tone)
2. Generate character close-ups next (lock seeds on good results)
3. Generate remaining shots

Review checklist:
- Character appearance consistent across shots?
- Lighting consistent within each scene?
- Color palette matches style guide?
- No anachronistic elements?

Regenerate any inconsistent shots with locked seed from a good variant.
Then create video nodes for key moments using image-to-video.`,
        guidesUsed: ['12-continuity-check', '11-batch-re-prompt'],
      },
    ],
  },
];
