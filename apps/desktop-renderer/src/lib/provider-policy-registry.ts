/**
 * Provider Policy Registry
 *
 * Centralized, typed registry of each AI provider's data retention,
 * training usage, content ownership, commercial use, and ToS information.
 *
 * This is informational only and does not constitute legal advice.
 * Policies may change at any time — verify current terms on each
 * provider's website.
 */

export interface ProviderPolicy {
  /** Provider identifier (matches provider IDs used in settings) */
  providerId: string;
  /** Human-readable provider name */
  displayName: string;

  // --- Privacy / Data retention ---
  /** Summary of data retention policy for API usage */
  dataRetention: string;
  /** Whether API data is used for model training */
  trainingUsage: string;

  // --- ToS / Content rights ---
  /** Whether generated content can be used commercially */
  commercialUse: 'yes' | 'no' | 'conditional';
  /** Additional details about commercial use conditions */
  commercialUseNote?: string;
  /** Who owns generated content */
  contentOwnership: string;
  /** Whether training opt-out is available */
  trainingOptOut: 'available' | 'not-available' | 'automatic';

  // --- Links ---
  /** URL to the provider's privacy policy */
  privacyPolicyUrl: string;
  /** URL to the provider's terms of service */
  tosUrl: string;

  // --- Metadata ---
  /** ISO-8601 date when this entry was last verified against official docs */
  lastVerified: string;
  /** Disclaimer text */
  disclaimer: string;
}

const STANDARD_DISCLAIMER =
  'Informational only. Not legal advice. Verify current terms on the provider website.';

export const PROVIDER_POLICIES: Record<string, ProviderPolicy> = {
  // ── OpenAI ─────────────────────────────────────────────────────
  openai: {
    providerId: 'openai',
    displayName: 'OpenAI',
    dataRetention:
      '30-day retention for abuse monitoring; no storage for Zero Data Retention eligible endpoints',
    trainingUsage: 'API data is not used for training by default',
    commercialUse: 'yes',
    contentOwnership: 'User owns input and output; OpenAI assigns all rights to user',
    trainingOptOut: 'automatic',
    privacyPolicyUrl: 'https://openai.com/policies/privacy-policy',
    tosUrl: 'https://openai.com/policies/terms-of-use',
    lastVerified: '2026-05-06',
    disclaimer: STANDARD_DISCLAIMER,
  },

  // ── Anthropic ──────────────────────────────────────────────────
  claude: {
    providerId: 'claude',
    displayName: 'Anthropic',
    dataRetention:
      'API inputs/outputs not stored beyond request processing unless flagged for Trust & Safety',
    trainingUsage: 'API data is not used for training models',
    commercialUse: 'yes',
    contentOwnership: 'User retains all rights to input and output content',
    trainingOptOut: 'automatic',
    privacyPolicyUrl: 'https://www.anthropic.com/policies/privacy',
    tosUrl: 'https://www.anthropic.com/policies/terms',
    lastVerified: '2026-05-06',
    disclaimer: STANDARD_DISCLAIMER,
  },

  // ── Google (Gemini) ────────────────────────────────────────────
  gemini: {
    providerId: 'gemini',
    displayName: 'Google (Gemini)',
    dataRetention:
      'Paid API: data not retained beyond request processing. Free tier: prompts may be retained',
    trainingUsage:
      'Paid API data is not used for training. Free tier data may be used to improve products',
    commercialUse: 'yes',
    contentOwnership: 'User retains IP rights to content created with Gemini API',
    trainingOptOut: 'automatic',
    commercialUseNote: 'Commercial use allowed under API ToS; restrictions apply to free tier',
    privacyPolicyUrl: 'https://policies.google.com/privacy',
    tosUrl: 'https://ai.google.dev/gemini-api/terms',
    lastVerified: '2026-05-06',
    disclaimer: STANDARD_DISCLAIMER,
  },

  // ── Stability AI ───────────────────────────────────────────────
  'stability-audio': {
    providerId: 'stability-audio',
    displayName: 'Stability AI',
    dataRetention: 'API data not retained after generation completes',
    trainingUsage: 'API data is not used for training',
    commercialUse: 'conditional',
    commercialUseNote: 'Commercial use allowed for paid plans; free tier outputs have restrictions',
    contentOwnership: 'User owns generated content under paid plans',
    trainingOptOut: 'automatic',
    privacyPolicyUrl: 'https://stability.ai/privacy-policy',
    tosUrl: 'https://stability.ai/terms-of-service',
    lastVerified: '2026-05-06',
    disclaimer: STANDARD_DISCLAIMER,
  },

  // ── Replicate ──────────────────────────────────────────────────
  replicate: {
    providerId: 'replicate',
    displayName: 'Replicate',
    dataRetention: 'Inputs/outputs temporarily cached; automatically deleted after a short period',
    trainingUsage: 'User data is not used for training Replicate models',
    commercialUse: 'conditional',
    commercialUseNote: 'Commercial rights depend on the individual model license (varies by model)',
    contentOwnership: 'User retains rights subject to underlying model license',
    trainingOptOut: 'automatic',
    privacyPolicyUrl: 'https://replicate.com/privacy',
    tosUrl: 'https://replicate.com/terms',
    lastVerified: '2026-05-06',
    disclaimer: STANDARD_DISCLAIMER,
  },

  // ── Runway ─────────────────────────────────────────────────────
  runway: {
    providerId: 'runway',
    displayName: 'Runway',
    dataRetention: 'API outputs available for download; storage duration depends on plan',
    trainingUsage: 'API data is not used for training',
    commercialUse: 'conditional',
    commercialUseNote: 'Commercial use allowed on paid plans; free/trial has restrictions',
    contentOwnership: 'User owns generated content under paid plans',
    trainingOptOut: 'automatic',
    privacyPolicyUrl: 'https://runwayml.com/privacy-policy',
    tosUrl: 'https://runwayml.com/terms-of-service',
    lastVerified: '2026-05-06',
    disclaimer: STANDARD_DISCLAIMER,
  },

  // ── Luma ───────────────────────────────────────────────────────
  luma: {
    providerId: 'luma',
    displayName: 'Luma AI',
    dataRetention: 'API data processed transiently; no long-term retention stated',
    trainingUsage: 'API data usage for training not explicitly excluded in ToS',
    commercialUse: 'conditional',
    commercialUseNote: 'Commercial use allowed on paid plans',
    contentOwnership: 'User retains rights to generated content',
    trainingOptOut: 'not-available',
    privacyPolicyUrl: 'https://lumalabs.ai/legal/privacy-policy',
    tosUrl: 'https://lumalabs.ai/legal/terms',
    lastVerified: '2026-05-06',
    disclaimer: STANDARD_DISCLAIMER,
  },

  // ── ElevenLabs ─────────────────────────────────────────────────
  elevenlabs: {
    providerId: 'elevenlabs',
    displayName: 'ElevenLabs',
    dataRetention: 'Audio outputs stored per account settings; can be deleted by user',
    trainingUsage: 'User audio not used for training without explicit consent',
    commercialUse: 'conditional',
    commercialUseNote:
      'Commercial use allowed on paid plans; free tier has attribution requirements',
    contentOwnership: 'User owns generated audio on paid plans',
    trainingOptOut: 'available',
    privacyPolicyUrl: 'https://elevenlabs.io/privacy',
    tosUrl: 'https://elevenlabs.io/terms',
    lastVerified: '2026-05-06',
    disclaimer: STANDARD_DISCLAIMER,
  },

  // ── DeepSeek ───────────────────────────────────────────────────
  deepseek: {
    providerId: 'deepseek',
    displayName: 'DeepSeek',
    dataRetention:
      'API data retained for up to 30 days for service improvement and abuse prevention',
    trainingUsage: 'API data may be used for model improvement unless opted out',
    commercialUse: 'yes',
    contentOwnership: 'User retains rights to output content',
    trainingOptOut: 'available',
    privacyPolicyUrl: 'https://chat.deepseek.com/policy/privacy',
    tosUrl: 'https://chat.deepseek.com/policy/terms',
    lastVerified: '2026-05-06',
    disclaimer: STANDARD_DISCLAIMER,
  },

  // ── xAI (Grok) ────────────────────────────────────────────────
  grok: {
    providerId: 'grok',
    displayName: 'xAI',
    dataRetention: 'API data retained per API data policy; duration not publicly specified',
    trainingUsage: 'API data may be used to improve services',
    commercialUse: 'yes',
    contentOwnership: 'User retains rights to input and output content',
    trainingOptOut: 'not-available',
    privacyPolicyUrl: 'https://x.ai/legal/privacy-policy',
    tosUrl: 'https://x.ai/legal/terms-of-service',
    lastVerified: '2026-05-06',
    disclaimer: STANDARD_DISCLAIMER,
  },

  // ── Cohere ─────────────────────────────────────────────────────
  cohere: {
    providerId: 'cohere',
    displayName: 'Cohere',
    dataRetention: 'API data not retained after processing for production endpoints',
    trainingUsage: 'Production API data is not used for training',
    commercialUse: 'yes',
    contentOwnership: 'User retains all rights to output content',
    trainingOptOut: 'automatic',
    privacyPolicyUrl: 'https://cohere.com/privacy',
    tosUrl: 'https://cohere.com/terms-of-use',
    lastVerified: '2026-05-06',
    disclaimer: STANDARD_DISCLAIMER,
  },

  // ── Mistral ────────────────────────────────────────────────────
  mistral: {
    providerId: 'mistral',
    displayName: 'Mistral AI',
    dataRetention: 'Paid API: no data retention. Free tier may retain data for 30 days',
    trainingUsage: 'Paid API data is not used for training. Free tier data may be used',
    commercialUse: 'yes',
    contentOwnership: 'User owns output content',
    trainingOptOut: 'automatic',
    commercialUseNote: 'Automatic opt-out on paid plans',
    privacyPolicyUrl: 'https://mistral.ai/terms/#privacy-policy',
    tosUrl: 'https://mistral.ai/terms/#terms-of-use',
    lastVerified: '2026-05-06',
    disclaimer: STANDARD_DISCLAIMER,
  },

  // ── Pika ───────────────────────────────────────────────────────
  pika: {
    providerId: 'pika',
    displayName: 'Pika',
    dataRetention: 'Generated content stored per account; can be deleted by user',
    trainingUsage: 'Content may be used to improve the service unless opted out',
    commercialUse: 'conditional',
    commercialUseNote: 'Commercial use allowed on paid plans',
    contentOwnership: 'User retains rights to generated content on paid plans',
    trainingOptOut: 'available',
    privacyPolicyUrl: 'https://pika.art/privacy-policy',
    tosUrl: 'https://pika.art/terms-of-service',
    lastVerified: '2026-05-06',
    disclaimer: STANDARD_DISCLAIMER,
  },

  // ── Kling ──────────────────────────────────────────────────────
  kling: {
    providerId: 'kling',
    displayName: 'Kling AI',
    dataRetention: 'Data retention policy follows Kuaishou platform terms',
    trainingUsage: 'Platform data may be used for service improvement',
    commercialUse: 'conditional',
    commercialUseNote: 'Commercial use subject to platform terms and regional restrictions',
    contentOwnership: 'User retains rights subject to platform ToS',
    trainingOptOut: 'not-available',
    privacyPolicyUrl: 'https://klingai.com/privacy',
    tosUrl: 'https://klingai.com/terms',
    lastVerified: '2026-05-06',
    disclaimer: STANDARD_DISCLAIMER,
  },

  // ── MiniMax ────────────────────────────────────────────────────
  minimax: {
    providerId: 'minimax',
    displayName: 'MiniMax',
    dataRetention: 'API data processed per service terms; retention period not publicly specified',
    trainingUsage: 'Data usage for training governed by service agreement',
    commercialUse: 'conditional',
    commercialUseNote: 'Commercial use subject to service agreement',
    contentOwnership: 'User retains rights subject to service terms',
    trainingOptOut: 'not-available',
    privacyPolicyUrl: 'https://platform.minimaxi.com/privacy',
    tosUrl: 'https://platform.minimaxi.com/terms',
    lastVerified: '2026-05-06',
    disclaimer: STANDARD_DISCLAIMER,
  },

  // ── OpenRouter (Hub) ───────────────────────────────────────────
  openrouter: {
    providerId: 'openrouter',
    displayName: 'OpenRouter',
    dataRetention: 'Prompts routed to upstream providers; OpenRouter may log metadata',
    trainingUsage: 'OpenRouter does not train on user data; upstream provider policies apply',
    commercialUse: 'conditional',
    commercialUseNote: 'Depends on the upstream provider selected for each request',
    contentOwnership: 'Governed by upstream provider ToS',
    trainingOptOut: 'not-available',
    privacyPolicyUrl: 'https://openrouter.ai/privacy',
    tosUrl: 'https://openrouter.ai/terms',
    lastVerified: '2026-05-06',
    disclaimer: STANDARD_DISCLAIMER,
  },

  // ── Together AI (Hub) ──────────────────────────────────────────
  together: {
    providerId: 'together',
    displayName: 'Together AI',
    dataRetention: 'API data not retained after processing for serverless endpoints',
    trainingUsage: 'Serverless API data is not used for training',
    commercialUse: 'conditional',
    commercialUseNote: 'Commercial rights depend on the individual model license',
    contentOwnership: 'User retains rights subject to model license',
    trainingOptOut: 'automatic',
    privacyPolicyUrl: 'https://www.together.ai/privacy',
    tosUrl: 'https://www.together.ai/terms-of-service',
    lastVerified: '2026-05-06',
    disclaimer: STANDARD_DISCLAIMER,
  },

  // ── Groq (Hub) ─────────────────────────────────────────────────
  groq: {
    providerId: 'groq',
    displayName: 'Groq',
    dataRetention: 'API data not stored beyond request processing',
    trainingUsage: 'API data is not used for training',
    commercialUse: 'conditional',
    commercialUseNote: 'Commercial rights depend on the individual model license',
    contentOwnership: 'User retains rights subject to model license',
    trainingOptOut: 'automatic',
    privacyPolicyUrl: 'https://groq.com/privacy-policy/',
    tosUrl: 'https://groq.com/terms-of-use/',
    lastVerified: '2026-05-06',
    disclaimer: STANDARD_DISCLAIMER,
  },

  // ── fal (Hub) ──────────────────────────────────────────────────
  fal: {
    providerId: 'fal',
    displayName: 'fal',
    dataRetention: 'Inputs/outputs temporarily cached; automatically purged',
    trainingUsage: 'User data is not used for training',
    commercialUse: 'conditional',
    commercialUseNote: 'Commercial rights depend on the individual model license',
    contentOwnership: 'User retains rights subject to model license',
    trainingOptOut: 'automatic',
    privacyPolicyUrl: 'https://fal.ai/privacy',
    tosUrl: 'https://fal.ai/terms',
    lastVerified: '2026-05-06',
    disclaimer: STANDARD_DISCLAIMER,
  },

  // ── Qwen (Alibaba) ────────────────────────────────────────────
  qwen: {
    providerId: 'qwen',
    displayName: 'Qwen (Alibaba)',
    dataRetention: 'API data processed per Alibaba Cloud service terms',
    trainingUsage: 'Data usage governed by Alibaba Cloud Model Studio agreement',
    commercialUse: 'yes',
    contentOwnership: 'User retains rights to output content per service agreement',
    trainingOptOut: 'not-available',
    privacyPolicyUrl:
      'https://terms.alicdn.com/legal-agreement/terms/privacy_policy_full/20231109180545349/20231109180545349.html',
    tosUrl: 'https://help.aliyun.com/document_detail/2846853.html',
    lastVerified: '2026-05-06',
    disclaimer: STANDARD_DISCLAIMER,
  },

  // ── SiliconFlow (Hub) ──────────────────────────────────────────
  siliconflow: {
    providerId: 'siliconflow',
    displayName: 'SiliconFlow',
    dataRetention: 'API data processed per service terms',
    trainingUsage: 'Data usage governed by service agreement',
    commercialUse: 'conditional',
    commercialUseNote: 'Commercial rights depend on the individual model license',
    contentOwnership: 'User retains rights subject to model license',
    trainingOptOut: 'not-available',
    privacyPolicyUrl: 'https://docs.siliconflow.cn',
    tosUrl: 'https://docs.siliconflow.cn',
    lastVerified: '2026-05-06',
    disclaimer: STANDARD_DISCLAIMER,
  },

  // ── Cartesia ───────────────────────────────────────────────────
  cartesia: {
    providerId: 'cartesia',
    displayName: 'Cartesia',
    dataRetention: 'API data not retained after processing',
    trainingUsage: 'API data is not used for training',
    commercialUse: 'yes',
    contentOwnership: 'User owns generated audio content',
    trainingOptOut: 'automatic',
    privacyPolicyUrl: 'https://cartesia.ai/privacy',
    tosUrl: 'https://cartesia.ai/terms',
    lastVerified: '2026-05-06',
    disclaimer: STANDARD_DISCLAIMER,
  },

  // ── PlayHT ─────────────────────────────────────────────────────
  playht: {
    providerId: 'playht',
    displayName: 'PlayHT',
    dataRetention: 'Audio outputs stored per account; user controls deletion',
    trainingUsage: 'User data not used for training without consent',
    commercialUse: 'conditional',
    commercialUseNote: 'Commercial use allowed on paid plans',
    contentOwnership: 'User owns generated audio on paid plans',
    trainingOptOut: 'available',
    privacyPolicyUrl: 'https://play.ht/privacy-policy/',
    tosUrl: 'https://play.ht/terms-of-service/',
    lastVerified: '2026-05-06',
    disclaimer: STANDARD_DISCLAIMER,
  },

  // ── Fish Audio ─────────────────────────────────────────────────
  'fish-audio': {
    providerId: 'fish-audio',
    displayName: 'Fish Audio',
    dataRetention: 'API data processed per service terms',
    trainingUsage: 'Data usage governed by service agreement',
    commercialUse: 'conditional',
    commercialUseNote: 'Commercial use subject to plan and model license',
    contentOwnership: 'User retains rights per service terms',
    trainingOptOut: 'not-available',
    privacyPolicyUrl: 'https://fish.audio/privacy',
    tosUrl: 'https://fish.audio/terms',
    lastVerified: '2026-05-06',
    disclaimer: STANDARD_DISCLAIMER,
  },

  // ── Ideogram ───────────────────────────────────────────────────
  ideogram: {
    providerId: 'ideogram',
    displayName: 'Ideogram',
    dataRetention: 'API data processed per developer terms',
    trainingUsage: 'API data usage governed by developer agreement',
    commercialUse: 'conditional',
    commercialUseNote: 'Commercial use allowed per developer plan',
    contentOwnership: 'User retains rights to generated images per plan',
    trainingOptOut: 'not-available',
    privacyPolicyUrl: 'https://ideogram.ai/privacy',
    tosUrl: 'https://ideogram.ai/terms',
    lastVerified: '2026-05-06',
    disclaimer: STANDARD_DISCLAIMER,
  },

  // ── Recraft ────────────────────────────────────────────────────
  recraft: {
    providerId: 'recraft',
    displayName: 'Recraft',
    dataRetention: 'API data processed transiently',
    trainingUsage: 'API data not used for training',
    commercialUse: 'yes',
    contentOwnership: 'User owns generated images',
    trainingOptOut: 'automatic',
    privacyPolicyUrl: 'https://www.recraft.ai/legal/privacy',
    tosUrl: 'https://www.recraft.ai/legal/terms',
    lastVerified: '2026-05-06',
    disclaimer: STANDARD_DISCLAIMER,
  },
};

/**
 * Mapping from variant provider IDs (e.g. 'openai-image', 'google-video')
 * to the canonical policy key. This avoids duplicating policy entries for
 * providers that appear under multiple IDs in different groups.
 */
const PROVIDER_POLICY_ALIASES: Record<string, string> = {
  // OpenAI variants
  'openai-image': 'openai',
  'openai-tts': 'openai',
  'openai-vision': 'openai',

  // Google variants
  'google-image': 'gemini',
  'google-video': 'gemini',
  'gemini-vision': 'gemini',

  // Anthropic variants
  'claude-vision': 'claude',

  // DeepSeek variants
  'deepseek-vision': 'deepseek',

  // xAI variants
  'grok-vision': 'grok',

  // Mistral variants
  'mistral-vision': 'mistral',

  // Qwen variants
  'qwen-vision': 'qwen',

  // SiliconFlow variants
  'siliconflow-image': 'siliconflow',
  'siliconflow-video': 'siliconflow',
  'siliconflow-tts': 'siliconflow',
  'siliconflow-vision': 'siliconflow',

  // Together variants
  'together-vision': 'together',

  // OpenRouter variants
  'openrouter-vision': 'openrouter',

  // Stability variants
  'stability-v2': 'stability-audio',

  // Other image providers with identical parent
  'zhipu-image': 'zhipu',
  'zhipu-video': 'zhipu',
  'zhipu-vision': 'zhipu',

  // Doubao / Volcengine
  'doubao-tts': 'doubao',
  'doubao-vision': 'doubao',
  'volcengine-image': 'volcengine',
  'volcengine-video': 'volcengine',

  // Moonshot
  'moonshot-vision': 'moonshot',

  // StepFun
  'stepfun-image': 'stepfun',
  'stepfun-video': 'stepfun',
  'stepfun-vision': 'stepfun',

  // MiniMax
  'minimax-tts': 'minimax',
};

/**
 * Look up the provider policy for a given provider ID.
 * Handles aliases (e.g. 'openai-image' resolves to the 'openai' policy).
 * Returns undefined if no policy exists for the provider.
 */
export function getProviderPolicy(providerId: string): ProviderPolicy | undefined {
  const canonical = PROVIDER_POLICY_ALIASES[providerId] ?? providerId;
  return PROVIDER_POLICIES[canonical];
}

/**
 * Returns all unique provider policies (deduplicated by canonical key).
 */
export function listProviderPolicies(): ProviderPolicy[] {
  return Object.values(PROVIDER_POLICIES);
}

/**
 * Check if a provider policy entry may be outdated (older than 6 months).
 */
export function isPolicyOutdated(policy: ProviderPolicy): boolean {
  if (policy.lastVerified === 'unverified') return true;
  const verifiedDate = new Date(policy.lastVerified);
  if (isNaN(verifiedDate.getTime())) return true;
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  return verifiedDate < sixMonthsAgo;
}
