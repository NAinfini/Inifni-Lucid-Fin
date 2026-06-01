/**
 * Post-session quality scoring. Inspects the final canvas state, tool call
 * trace, and evidence ledger to produce a structured quality breakdown.
 *
 * Scoring philosophy: a "good" session is one where Commander autonomously
 * produced a structurally complete video canvas — style locked, nodes created
 * with proper types and connections, reference images attached, audio present.
 * Each dimension is scored 0-1 and weighted into a composite score.
 */
import type { Canvas, CanvasNode, CanvasEdge } from '@lucid-fin/contracts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Subset of SessionResult fields used for quality scoring. */
export interface ScoringInput {
  outcome: string;
  error?: string;
  steps: number;
  toolCalls: Array<{ step: number; name: string; ok: boolean; errorMessage?: string }>;
  toolCallCounts: Record<string, number>;
  askUserCount: number;
  promptTokensEstimated: number;
  stylePlateLocked: boolean;
  contractSatisfied: boolean;
  exitOutcome: string | null;
  blocker: string | null;
}

export interface QualityDimension {
  name: string;
  score: number;
  maxScore: number;
  weight: number;
  details: string;
}

export interface QualityReport {
  /** Weighted composite score 0-100. */
  composite: number;
  /** Grade band: A (≥80), B (≥60), C (≥40), D (≥20), F (<20). */
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  dimensions: QualityDimension[];
  flags: QualityFlag[];
}

export interface QualityFlag {
  severity: 'critical' | 'warning' | 'info';
  code: string;
  message: string;
}

// ---------------------------------------------------------------------------
// Node type helpers
// ---------------------------------------------------------------------------

function nodesByType(nodes: CanvasNode[]): Record<string, CanvasNode[]> {
  const map: Record<string, CanvasNode[]> = {};
  for (const n of nodes) {
    (map[n.type] ??= []).push(n);
  }
  return map;
}

function nodeData(node: CanvasNode): Record<string, unknown> {
  return (node.data ?? {}) as Record<string, unknown>;
}

function hasPrompt(node: CanvasNode): boolean {
  const d = nodeData(node);
  return typeof d.prompt === 'string' && d.prompt.trim().length > 0;
}

function hasEntityRefs(node: CanvasNode): boolean {
  const d = nodeData(node);
  const charRefs = Array.isArray(d.characterRefs) ? d.characterRefs : [];
  const locRefs = Array.isArray(d.locationRefs) ? d.locationRefs : [];
  const eqRefs = Array.isArray(d.equipmentRefs) ? d.equipmentRefs : [];
  return charRefs.length + locRefs.length + eqRefs.length > 0;
}

function hasAnchorFrames(node: CanvasNode): boolean {
  const d = nodeData(node);
  return typeof d.firstFrameNodeId === 'string' || typeof d.lastFrameNodeId === 'string';
}

// ---------------------------------------------------------------------------
// Dimension scorers
// ---------------------------------------------------------------------------

function scoreStylePlate(result: ScoringInput, canvas: Canvas | null): QualityDimension {
  const weight = 15;
  const locked = result.stylePlateLocked ||
    (typeof canvas?.settings?.stylePlate === 'string' && canvas.settings.stylePlate.trim().length > 0);
  const hasNeg = typeof canvas?.settings?.negativePrompt === 'string' &&
    canvas.settings.negativePrompt.trim().length > 0;
  const hasAspect = typeof canvas?.settings?.aspectRatio === 'string' &&
    canvas.settings.aspectRatio.trim().length > 0;

  let score = 0;
  if (locked) score += 0.6;
  if (hasNeg) score += 0.2;
  if (hasAspect) score += 0.2;

  const parts: string[] = [];
  parts.push(locked ? 'stylePlate locked' : 'stylePlate NOT locked');
  if (hasNeg) parts.push('negativePrompt set');
  if (hasAspect) parts.push(`aspectRatio=${canvas!.settings!.aspectRatio}`);

  return { name: 'Style & Settings', score, maxScore: 1, weight, details: parts.join('; ') };
}

function scoreNodeCreation(result: ScoringInput, canvas: Canvas | null): QualityDimension {
  const weight = 25;
  const nodes = canvas?.nodes ?? [];
  const byType = nodesByType(nodes);
  const imageCount = (byType.image ?? []).length;
  const videoCount = (byType.video ?? []).length;
  const audioCount = (byType.audio ?? []).length;
  const totalVisual = imageCount + videoCount;

  let score = 0;
  if (totalVisual >= 1) score += 0.2;
  if (totalVisual >= 3) score += 0.2;
  if (totalVisual >= 5) score += 0.1;
  if (videoCount >= 1) score += 0.2;
  if (audioCount >= 1) score += 0.15;
  if (imageCount >= 1 && videoCount >= 1) score += 0.15;
  score = Math.min(score, 1);

  const parts = [`${nodes.length} total nodes`, `${imageCount} image`, `${videoCount} video`, `${audioCount} audio`];
  return { name: 'Node Creation', score, maxScore: 1, weight, details: parts.join(', ') };
}

function scorePromptQuality(canvas: Canvas | null): QualityDimension {
  const weight = 15;
  const nodes = canvas?.nodes ?? [];
  const generatable = nodes.filter((n) => n.type === 'image' || n.type === 'video' || n.type === 'audio');
  if (generatable.length === 0) {
    return { name: 'Prompt Quality', score: 0, maxScore: 1, weight, details: 'no generatable nodes' };
  }

  const withPrompt = generatable.filter(hasPrompt);
  const promptRatio = withPrompt.length / generatable.length;

  const avgLen = withPrompt.length > 0
    ? withPrompt.reduce((sum, n) => sum + String((nodeData(n).prompt as string)).length, 0) / withPrompt.length
    : 0;

  let score = promptRatio * 0.5;
  if (avgLen >= 50) score += 0.2;
  if (avgLen >= 150) score += 0.15;
  if (avgLen >= 300) score += 0.15;
  score = Math.min(score, 1);

  const parts = [`${withPrompt.length}/${generatable.length} nodes have prompts`, `avg length ${Math.round(avgLen)} chars`];
  return { name: 'Prompt Quality', score, maxScore: 1, weight, details: parts.join('; ') };
}

function scoreEntityBindings(canvas: Canvas | null): QualityDimension {
  const weight = 10;
  const nodes = canvas?.nodes ?? [];
  const visual = nodes.filter((n) => n.type === 'image' || n.type === 'video');
  if (visual.length === 0) {
    return { name: 'Entity Bindings', score: 0, maxScore: 1, weight, details: 'no visual nodes' };
  }

  const withRefs = visual.filter(hasEntityRefs);
  const ratio = withRefs.length / visual.length;
  const score = Math.min(ratio, 1);

  return {
    name: 'Entity Bindings',
    score,
    maxScore: 1,
    weight,
    details: `${withRefs.length}/${visual.length} visual nodes have entity refs`,
  };
}

function scoreEdgeConnectivity(canvas: Canvas | null): QualityDimension {
  const weight = 10;
  const nodes = canvas?.nodes ?? [];
  const edges = canvas?.edges ?? [];
  const videoNodes = nodes.filter((n) => n.type === 'video');

  if (nodes.length <= 1) {
    return { name: 'Edge Connectivity', score: 0, maxScore: 1, weight, details: '≤1 node, no edges expected' };
  }

  const nodeIds = new Set(nodes.map((n) => n.id));
  const validEdges = edges.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target));
  const connectedNodes = new Set<string>();
  for (const edge of validEdges) {
    connectedNodes.add(edge.source);
    connectedNodes.add(edge.target);
  }

  const connectRatio = connectedNodes.size / nodes.length;
  const videosWithAnchors = videoNodes.filter(hasAnchorFrames).length;
  const anchorRatio = videoNodes.length > 0 ? videosWithAnchors / videoNodes.length : 0;

  let score = connectRatio * 0.6 + anchorRatio * 0.4;
  score = Math.min(score, 1);

  const parts = [
    `${validEdges.length} edges`,
    `${connectedNodes.size}/${nodes.length} nodes connected`,
    `${videosWithAnchors}/${videoNodes.length} videos with anchor frames`,
  ];
  return { name: 'Edge Connectivity', score, maxScore: 1, weight, details: parts.join('; ') };
}

function scoreToolUsage(result: ScoringInput): QualityDimension {
  const weight = 10;
  const counts = result.toolCallCounts;
  const usedCreateNodes = (counts['canvas.createNodes'] ?? 0) > 0;
  const usedGenerate = (counts['canvas.generation'] ?? 0) > 0;
  const usedSetSettings = (counts['canvas.setSettings'] ?? 0) > 0;
  const usedRefImage = (counts['entity.generateRefImage'] ?? 0) > 0;

  let score = 0;
  if (usedCreateNodes) score += 0.25;
  if (usedGenerate) score += 0.25;
  if (usedSetSettings) score += 0.2;
  if (usedRefImage) score += 0.15;
  if (result.askUserCount > 0 && result.askUserCount <= 5) score += 0.15;
  score = Math.min(score, 1);

  const toolNames = Object.keys(counts);
  const parts = [`${toolNames.length} distinct tools used`, `${result.steps} steps`];
  if (usedCreateNodes) parts.push('createNodes ✓');
  if (usedGenerate) parts.push('generate ✓');
  if (usedSetSettings) parts.push('setSettings ✓');
  if (usedRefImage) parts.push('refImage ✓');
  return { name: 'Tool Usage', score, maxScore: 1, weight, details: parts.join('; ') };
}

function scoreContractOutcome(result: ScoringInput): QualityDimension {
  const weight = 15;
  let score = 0;
  if (result.contractSatisfied) score = 1;
  else if (result.outcome === 'completed') score = 0.3;
  else if (result.outcome === 'budget-exceeded') score = 0.1;

  const parts: string[] = [];
  parts.push(`outcome=${result.outcome}`);
  parts.push(`contract=${result.contractSatisfied ? 'satisfied' : 'unsatisfied'}`);
  if (result.exitOutcome) parts.push(`exitOutcome=${result.exitOutcome}`);
  if (result.blocker) parts.push(`blocker=${result.blocker}`);
  return { name: 'Contract Outcome', score, maxScore: 1, weight, details: parts.join('; ') };
}

// ---------------------------------------------------------------------------
// Flags
// ---------------------------------------------------------------------------

function collectFlags(result: ScoringInput, canvas: Canvas | null): QualityFlag[] {
  const flags: QualityFlag[] = [];
  const nodes = canvas?.nodes ?? [];
  const byType = nodesByType(nodes);

  if (result.outcome === 'error') {
    flags.push({ severity: 'critical', code: 'SESSION_ERROR', message: `Session errored: ${result.error ?? 'unknown'}` });
  }

  if (nodes.length === 0 && result.outcome === 'completed') {
    flags.push({ severity: 'critical', code: 'EMPTY_CANVAS', message: 'Session completed but produced zero nodes' });
  }

  if (!result.stylePlateLocked && nodes.length > 0) {
    flags.push({ severity: 'warning', code: 'NO_STYLE_PLATE', message: 'Nodes created without locking a style plate first' });
  }

  const videoNodes = byType.video ?? [];
  const audioNodes = byType.audio ?? [];
  if (videoNodes.length > 0 && audioNodes.length === 0) {
    flags.push({ severity: 'warning', code: 'NO_AUDIO', message: `${videoNodes.length} video node(s) but no audio nodes` });
  }

  const generatable = nodes.filter((n) => n.type === 'image' || n.type === 'video' || n.type === 'audio');
  const withoutPrompt = generatable.filter((n) => !hasPrompt(n));
  if (withoutPrompt.length > 0) {
    flags.push({ severity: 'warning', code: 'MISSING_PROMPTS', message: `${withoutPrompt.length} generatable node(s) lack prompts` });
  }

  const toolErrors = result.toolCalls.filter((tc) => !tc.ok);
  if (toolErrors.length > 5) {
    flags.push({ severity: 'warning', code: 'HIGH_ERROR_RATE', message: `${toolErrors.length} tool call errors in session` });
  }

  if (result.askUserCount > 5) {
    flags.push({ severity: 'warning', code: 'EXCESSIVE_QUESTIONS', message: `Asked user ${result.askUserCount} times (may indicate confusion)` });
  }

  if (result.steps > 50 && nodes.length < 3) {
    flags.push({ severity: 'warning', code: 'LOW_PRODUCTIVITY', message: `${result.steps} steps but only ${nodes.length} nodes` });
  }

  const videoWithoutAnchors = videoNodes.filter((n) => !hasAnchorFrames(n));
  if (videoWithoutAnchors.length > 0) {
    flags.push({ severity: 'info', code: 'VIDEO_NO_ANCHORS', message: `${videoWithoutAnchors.length} video node(s) without anchor frame references` });
  }

  if (result.promptTokensEstimated > 300_000) {
    flags.push({ severity: 'info', code: 'HIGH_TOKEN_USAGE', message: `Estimated ${Math.round(result.promptTokensEstimated / 1000)}k prompt tokens` });
  }

  return flags;
}

// ---------------------------------------------------------------------------
// Composite scoring
// ---------------------------------------------------------------------------

function computeGrade(composite: number): QualityReport['grade'] {
  if (composite >= 80) return 'A';
  if (composite >= 60) return 'B';
  if (composite >= 40) return 'C';
  if (composite >= 20) return 'D';
  return 'F';
}

/**
 * Score a completed session. Pass the final canvas snapshot for structural
 * analysis (available via `canvasStore.get(canvasId)` in run-single).
 */
export function scoreSession(result: ScoringInput, canvas: Canvas | null): QualityReport {
  const dimensions = [
    scoreStylePlate(result, canvas),
    scoreNodeCreation(result, canvas),
    scorePromptQuality(canvas),
    scoreEntityBindings(canvas),
    scoreEdgeConnectivity(canvas),
    scoreToolUsage(result),
    scoreContractOutcome(result),
  ];

  const totalWeight = dimensions.reduce((sum, d) => sum + d.weight, 0);
  const weightedSum = dimensions.reduce((sum, d) => sum + (d.score / d.maxScore) * d.weight, 0);
  const composite = totalWeight > 0 ? (weightedSum / totalWeight) * 100 : 0;

  const flags = collectFlags(result, canvas);

  return {
    composite: Math.round(composite * 10) / 10,
    grade: computeGrade(composite),
    dimensions,
    flags,
  };
}

/**
 * Render a quality report as a compact markdown snippet for per-session logs.
 */
export function renderQualitySnippet(report: QualityReport): string {
  const lines: string[] = [];
  lines.push(`**Quality: ${report.composite}/100 (${report.grade})**`);
  lines.push('');
  lines.push('| dimension | score | weight | details |');
  lines.push('|---|---|---|---|');
  for (const d of report.dimensions) {
    const pct = Math.round((d.score / d.maxScore) * 100);
    lines.push(`| ${d.name} | ${pct}% | ${d.weight} | ${d.details} |`);
  }
  if (report.flags.length > 0) {
    lines.push('');
    lines.push('**Flags:**');
    for (const f of report.flags) {
      const icon = f.severity === 'critical' ? 'X' : f.severity === 'warning' ? '!' : 'i';
      lines.push(`- [${icon}] \`${f.code}\`: ${f.message}`);
    }
  }
  return lines.join('\n');
}
