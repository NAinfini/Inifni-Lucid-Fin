import type { RunIntent } from './types.js';

/**
 * First-turn intent classifier. Deterministic rules only — no LLM call,
 * no I/O. Runs once per agent run on the initial user message and
 * (optional) canvas state. Callers pass the result to the contract
 * registry to select the right `CompletionContract`.
 *
 * Rule precedence (highest first):
 *   1. Browse-catalogue phrases → `browse`
 *   2. Pure-question phrases with no execution verbs → `informational`
 *   3. Execution verbs + workflow hint → `execution` with workflow
 *   4. Execution verbs without a hint → `execution`
 *   5. Anything else → `mixed`
 *
 * Phase B ships this as the sole classifier. Phase C may add a
 * workflow-hint vocabulary broader than the seed list below; Phase F
 * may add an LLM fallback for ambiguous inputs, but only as a last
 * resort behind the rule table.
 */

export interface ClassifyIntentContext {
  /** First user-turn text. Trimmed but otherwise unmodified. */
  userMessage: string;
  /**
   * Whether the active canvas already has nodes. Helps disambiguate
   * commands like "add a shot" (execution) from "what's on my canvas?"
   * (informational).
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
  // zh-CN browse phrasing.
  /你能(做|干)什么/,
  /(列出|展示|显示)(所有)?(工具|指南|工作流|流程|技能|文档|菜单|选项)/,
  /(怎么|如何)开始/,
  /^帮助$/,
];

const INFO_PREFIXES: readonly RegExp[] = [
  /^what('| i)?s\b/i,
  /^what are\b/i,
  /^how does\b/i,
  /^how do (you|i|we)\b/i,
  /^why (does|is|do)\b/i,
  /^explain\b/i,
  /^describe\b/i,
  /^tell me (about|how)\b/i,
  /^can you (explain|describe|tell me)\b/i,
  /^is (it|there|this|that)\b/i,
];

/**
 * CJK question cues. These appear anywhere in the message rather than
 * only as prefixes, matching how Chinese questions are actually formed
 * (sentence-final `吗/呢`, question particles, or trailing `?`/`？`).
 */
const CJK_INFO_CUES: readonly RegExp[] = [
  /什么/,
  /为什么/,
  /怎么(样|回事|办)?/,
  /如何/,
  /(解释|介绍|说明|描述|告诉我)/,
  /(是什么|有哪些|是不是|能不能|可不可以)/,
  /吗[？?。.!！]?$/,
  /呢[？?。.!！]?$/,
];

const EXECUTION_VERBS: readonly RegExp[] = [
  /\bcreate\b/i,
  /\bgenerate\b/i,
  /\bbuild\b/i,
  /\bmake\b/i,
  /\bwrite\b/i,
  /\bdraft\b/i,
  /\bseed\b/i,
  /\bexpand\b/i,
  /\badd\b/i,
  /\bset (up|the)\b/i,
  /\bstart (the )?pipeline\b/i,
  /\bstoryboard\b/i,
  /\brender\b/i,
  /\bshoot\b/i,
  /\bdirect\b/i,
  // zh-CN execution verbs. Kept conservative — must be a verb that
  // reasonably implies "persist / mutate", not a generic action.
  /(创建|生成|制作|构建|搭建|编写|起草|撰写|绘制|画一?[个张])/,
  /(添加|新增|加入|加上)/,
  /(开始|启动)(.{0,6})(流程|管道|工作流|渲染|拍摄)?/,
  /(渲染|执行|运行)/,
  /(帮我|请)(.{0,6})(创建|生成|制作|构建|搭建|写|画|做|添加|新增|开始|启动|渲染|执行|运行)/,
];

/**
 * CJK-heavy detection: true when the message contains any Han ideographs.
 * Used to gate CJK-specific classification rules without affecting English
 * behavior.
 */
const CJK_CHAR = /[㐀-鿿]/;

/**
 * Seed list of workflow hints. Keys match the `workflow-*` guide ids in
 * `docs/ai-skills/workflows/` minus the `workflow-` prefix. Phase C will
 * probably promote this to a registry-driven table; Phase B treats it as
 * a static seed because the classifier must not depend on registry state
 * (it runs before any contract is selected).
 */
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
  // zh-CN workflow aliases.
  { match: /(剧本|故事).*?(到|生成|转).*?视频/, workflow: 'story-to-video' },
  { match: /(镜头列表|分镜列表|分镜表)/, workflow: 'shot-list' },
  { match: /(风格板|风格样板)/, workflow: 'style-plate' },
  { match: /(风格迁移|风格转换)/, workflow: 'style-transfer' },
  { match: /(连续性|一致性检查)/, workflow: 'continuity-check' },
  { match: /(音频制作|配音|对口型|口型同步)/, workflow: 'audio-production' },
  { match: /(分析|解析)(这[张幅]|一[张幅])?(图片|图像|照片)/, workflow: 'image-analyze' },
];

function matchesAny(text: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((p) => p.test(text));
}

function detectWorkflow(text: string): string | undefined {
  for (const { match, workflow } of WORKFLOW_HINTS) {
    if (match.test(text)) return workflow;
  }
  return undefined;
}

export function classifyIntent(ctx: ClassifyIntentContext): RunIntent {
  const msg = ctx.userMessage.trim();
  if (msg.length === 0) {
    // An empty message is treated as mixed — the orchestrator will
    // likely ask something first. Classifier explicitly does not
    // throw: empty messages should not crash a run.
    return { kind: 'mixed' };
  }

  // 1. Browse intent — catalogue phrases dominate even over execution
  // verbs, because "list the tools I can use to create videos" is still
  // a browse ask.
  if (matchesAny(msg, BROWSE_PHRASES)) {
    return { kind: 'browse' };
  }

  const workflow = detectWorkflow(msg);
  const hasExecutionVerb = matchesAny(msg, EXECUTION_VERBS);
  const hasCjk = CJK_CHAR.test(msg);
  const startsAsQuestion =
    matchesAny(msg, INFO_PREFIXES) ||
    msg.trimEnd().endsWith('?') ||
    msg.trimEnd().endsWith('？') ||
    (hasCjk && matchesAny(msg, CJK_INFO_CUES));

  // 2. Pure question, no execution verb → informational.
  if (startsAsQuestion && !hasExecutionVerb) {
    return { kind: 'informational' };
  }

  // 3/4. Execution verb present (with or without a workflow hint).
  if (hasExecutionVerb) {
    return workflow ? { kind: 'execution', workflow } : { kind: 'execution' };
  }

  // Workflow mentioned but no execution verb (e.g. "I'm thinking about a
  // style plate") — treat as mixed, not execution. The LLM will likely
  // ask for direction before doing anything.
  if (workflow) {
    return { kind: 'mixed', workflow };
  }

  // CJK chat without execution verbs and without workflow hints is much
  // more likely to be casual Q&A than "please silently create nodes";
  // default to informational so the exit contract doesn't flag every
  // friendly Chinese message as `missing_commit`. English messages keep
  // their stricter `mixed` default — the English classifier already has
  // broad verb/prefix coverage, so a fall-through there is usually a
  // real ambiguity.
  if (hasCjk) {
    return { kind: 'informational' };
  }

  return { kind: 'mixed' };
}
