/**
 * Node Generation Prompt Templates
 *
 * Prompt guidance for image, video, and audio node generation workflows.
 */

export interface NodePromptTemplate {
  id: string;
  nodeType: 'image' | 'video' | 'audio';
  workflow: string;
  description: string;
  promptStructure: string;
  tips: string[];
  negativePrompt?: string;
  recommendedProviders: string[];
}

// ---------------------------------------------------------------------------
// Image Node Templates
// ---------------------------------------------------------------------------

export const imageGenerationTemplates: NodePromptTemplate[] = [
  {
    id: 'image-cinematic-still',
    nodeType: 'image',
    workflow: 'cinematic-still',
    description: 'Single cinematic frame — use for storyboard shots',
    promptStructure: `{shot_type} of {subject}, {setting}, {lighting}, {mood},
cinematic composition, film still, {aspect_ratio} format,
{style_keywords}`,
    tips: [
      'Specify shot type: extreme close-up, close-up, medium, wide, establishing',
      'Include lighting: golden hour, rim light, low-key, high-key',
      'Add mood: tense, intimate, triumphant, ominous',
      'Use preset summary from node inspector for style keywords',
    ],
    negativePrompt: 'blurry, low quality, watermark, text, logo, oversaturated',
    recommendedProviders: ['google-imagen3', 'openai-image', 'stability-sd3'],
  },
  {
    id: 'image-concept-art',
    nodeType: 'image',
    workflow: 'concept-art',
    description: 'Concept art for characters, environments, or props',
    promptStructure: `Concept art of {subject}, {style} style,
{color_palette}, {lighting_setup},
professional concept art, detailed, {medium}`,
    tips: [
      'Specify art style: realistic, stylized, anime, painterly',
      'Include color palette: warm tones, cool blues, desaturated',
      'Medium: digital painting, oil painting, watercolor',
    ],
    negativePrompt: 'photo, photorealistic, 3D render, low quality',
    recommendedProviders: ['google-imagen3', 'midjourney'],
  },
];

// ---------------------------------------------------------------------------
// Video Node Templates
// ---------------------------------------------------------------------------

export const videoGenerationTemplates: NodePromptTemplate[] = [
  {
    id: 'video-text-to-video',
    nodeType: 'video',
    workflow: 'text-to-video',
    description: 'Generate video from text description',
    promptStructure: `{camera_movement} shot of {subject} {action},
{setting}, {lighting}, {mood},
cinematic quality, {duration}s clip`,
    tips: [
      'Camera movement: slow push-in, crane up, handheld, steadicam',
      'Be specific about subject action: "walking slowly", "turning to face camera"',
      'Keep duration 3-8 seconds for best quality',
      'Specify lighting conditions for consistency',
    ],
    negativePrompt: 'static, no movement, blurry, low quality, jump cuts',
    recommendedProviders: ['minimax-video', 'runway', 'luma', 'google-veo'],
  },
  {
    id: 'video-image-to-video',
    nodeType: 'video',
    workflow: 'image-to-video',
    description: 'Animate a reference image',
    promptStructure: `Animate: {motion_description},
subtle {camera_movement}, {duration}s,
maintain character/scene consistency`,
    tips: [
      'Describe only the motion, not the full scene (image provides context)',
      'Use subtle movements for realistic results',
      'Avoid drastic camera changes — they reduce consistency',
    ],
    recommendedProviders: ['runway', 'luma', 'minimax-video'],
  },
];

// ---------------------------------------------------------------------------
// Audio Node Templates
// ---------------------------------------------------------------------------

export const audioGenerationTemplates: NodePromptTemplate[] = [
  {
    id: 'audio-voice',
    nodeType: 'audio',
    workflow: 'voice',
    description: 'Character voice / narration',
    promptStructure: `{character_description} voice, {emotion}, {pace},
{accent} accent, {age} {gender}`,
    tips: [
      'Describe character personality for voice matching',
      'Emotion: calm, excited, fearful, authoritative',
      'Pace: slow and deliberate, fast and urgent',
    ],
    recommendedProviders: ['elevenlabs', 'openai-tts'],
  },
  {
    id: 'audio-music',
    nodeType: 'audio',
    workflow: 'music',
    description: 'Background score / soundtrack',
    promptStructure: `{genre} music, {mood}, {tempo} BPM,
{instruments}, {duration}s,
{scene_type} scene underscore`,
    tips: [
      'Genre: orchestral, electronic, ambient, jazz',
      'Match tempo to scene energy',
      'Specify instruments for tonal control',
    ],
    recommendedProviders: ['suno', 'udio'],
  },
];
