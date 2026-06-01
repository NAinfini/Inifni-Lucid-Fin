import type { RunIntent } from './types.js';

/**
 * First-turn intent classifier. Deterministic rules only — no LLM call,
 * no I/O. Runs once per agent run on the initial user message and
 * (optional) canvas state. Callers pass the result to the contract
 * registry to select the right `CompletionContract`.
 *
 * v3: Simplified. All tool loading now goes through expanded TIER_A
 * (no keyword/regex gating). This classifier only affects exit-contract
 * selection:
 *   1. Browse-catalogue phrases → `informational`
 *   2. Workflow hint detected → `execution` with workflow
 *   3. Everything else → `execution`
 */

export interface ClassifyIntentContext {
  /** First user-turn text. Trimmed but otherwise unmodified. */
  userMessage: string;
  /**
   * Whether the active canvas already has nodes.
   * Kept for API compatibility.
   */
  canvasHasNodes?: boolean;
}

const BROWSE_PHRASES: readonly RegExp[] = [
  /\bwhat can (you|commander) do\b/i,
  /\blist (the )?(tools|guides|workflows|skills|docs)\b/i,
  /\bshow (me )?(the )?(menu|catalogue|catalog|options)\b/i,
  /\bhow do i (start|begin)\b/i,
  /^help\b/i,
  /\b(browse|inventory) (the )?(tools|guides)\b/i,
  /你能(做|干)什么/,
  /(列出|展示|显示)(所有)?(工具|指南|工作流|流程|技能|文档|菜单|选项)/,
  /(怎么|如何)开始/,
  /^帮助$/,
];

const WORKFLOW_HINTS: ReadonlyArray<{ match: RegExp; workflow: string }> = [
  { match: /\b(story|script)[\s-]*(to)?[\s-]*(video|film|cut)\b/i, workflow: 'story-to-video' },
  { match: /\bshot[\s-]*list\b/i, workflow: 'shot-list' },
  { match: /\bstyle[\s-]*plate\b/i, workflow: 'style-plate' },
  { match: /\bstyle[\s-]*transfer\b/i, workflow: 'style-transfer' },
  { match: /\bcontinuity\b/i, workflow: 'continuity-check' },
  { match: /\b(audio|voice|lip[\s-]*sync)\b/i, workflow: 'audio-production' },
  { match: /\b(image|photo)[\s-]*analyz(e|is)\b/i, workflow: 'image-analyze' },
  {
    match: /\banalyz(e|ing) (the |this |these |an? )?(image|photo|images|photos|frame)/i,
    workflow: 'image-analyze',
  },
  { match: /(剧本|故事).*?(到|生成|转).*?视频/, workflow: 'story-to-video' },
  { match: /(镜头列表|分镜列表|分镜表)/, workflow: 'shot-list' },
  { match: /(风格板|风格样板)/, workflow: 'style-plate' },
  { match: /(风格迁移|风格转换)/, workflow: 'style-transfer' },
  { match: /(连续性|一致性检查)/, workflow: 'continuity-check' },
  { match: /(音频制作|配音|对口型|口型同步)/, workflow: 'audio-production' },
  { match: /(分析|解析)(这[张幅]|一[张幅])?(图片|图像|照片)/, workflow: 'image-analyze' },
];

function detectWorkflow(text: string): string | undefined {
  for (const { match, workflow } of WORKFLOW_HINTS) {
    if (match.test(text)) return workflow;
  }
  return undefined;
}

export function classifyIntent(ctx: ClassifyIntentContext): RunIntent {
  const msg = ctx.userMessage.trim();
  if (msg.length === 0) {
    return { kind: 'execution' };
  }

  if (BROWSE_PHRASES.some((p) => p.test(msg))) {
    return { kind: 'informational' };
  }

  const workflow = detectWorkflow(msg);
  if (workflow) {
    return { kind: 'execution', workflow };
  }

  return { kind: 'execution' };
}
