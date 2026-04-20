/**
 * Aggregate + markdown-ify a set of SessionResults. Output is oriented toward
 * "what does Commander do with a dumb over-cooperative user" — coverage of
 * guides, process prompts, tool calls; frequency of ask-user; where sessions
 * abort; style-plate compliance.
 */
import type { SessionResult } from './run-single.js';
import type { CodexProviderSpec } from './provider-config.js';
import { MOCKED_TOOL_NAMES } from './mock-generation.js';

interface ReportOptions {
  totalMs: number;
  specs: CodexProviderSpec[];
}

export function renderMarkdownReport(results: SessionResult[], options: ReportOptions): string {
  const n = results.length;
  const outcome: Record<string, number> = {};
  const archetypeOutcome: Record<string, Record<string, number>> = {};
  const allToolCounts: Record<string, number> = {};
  const guideGetAll: Record<string, number> = {};
  const processAll: Record<string, number> = {};
  const errorsByType: Record<string, number> = {};
  let totalSteps = 0;
  let totalAskUser = 0;
  let totalAskUserFallbacks = 0;
  let totalNodes = 0;
  let plateLocked = 0;
  let totalPromptTokens = 0;

  for (const r of results) {
    outcome[r.outcome] = (outcome[r.outcome] ?? 0) + 1;
    archetypeOutcome[r.archetype] ??= {};
    archetypeOutcome[r.archetype][r.outcome] = (archetypeOutcome[r.archetype][r.outcome] ?? 0) + 1;
    for (const [k, v] of Object.entries(r.toolCallCounts)) allToolCounts[k] = (allToolCounts[k] ?? 0) + v;
    for (const k of r.promptGuidesLoadedViaGuideGet) guideGetAll[k] = (guideGetAll[k] ?? 0) + 1;
    for (const k of r.processPromptsInjected) processAll[k] = (processAll[k] ?? 0) + 1;
    totalSteps += r.steps;
    totalAskUser += r.askUserCount;
    totalAskUserFallbacks += r.askUserFallbacksUsed;
    totalNodes += r.finalNodeCount;
    if (r.stylePlateLocked) plateLocked++;
    totalPromptTokens += r.promptTokensEstimated;
    for (const call of r.toolCalls) {
      if (!call.ok && call.errorMessage) {
        const key = call.errorMessage.split('\n')[0].slice(0, 80);
        errorsByType[key] = (errorsByType[key] ?? 0) + 1;
      }
    }
  }

  const sortedTools = Object.entries(allToolCounts).sort((a, b) => b[1] - a[1]);
  const mockedSet = new Set<string>(MOCKED_TOOL_NAMES);

  const lines: string[] = [];
  const pct = (k: number, total: number) => total > 0 ? `${((k / total) * 100).toFixed(1)}%` : '0%';

  lines.push(`# Commander Study — ${n} sessions`);
  lines.push('');
  lines.push(`Total wall time: ${(options.totalMs / 1000 / 60).toFixed(1)} min`);
  lines.push(`Providers: ${options.specs.map((s) => `${s.name} (${s.model})`).join(', ')}`);
  lines.push('');
  lines.push('## Outcomes');
  lines.push('');
  lines.push('| outcome | count | % |');
  lines.push('|---|---|---|');
  for (const [k, v] of Object.entries(outcome).sort((a, b) => b[1] - a[1])) {
    lines.push(`| ${k} | ${v} | ${pct(v, n)} |`);
  }
  lines.push('');
  lines.push('## Outcomes × archetype');
  lines.push('');
  lines.push('| archetype | completed | budget | aborted | error |');
  lines.push('|---|---|---|---|---|');
  for (const [arch, counts] of Object.entries(archetypeOutcome)) {
    lines.push(`| ${arch} | ${counts.completed ?? 0} | ${counts['budget-exceeded'] ?? 0} | ${counts.aborted ?? 0} | ${counts.error ?? 0} |`);
  }
  lines.push('');
  lines.push('## Headline stats');
  lines.push('');
  lines.push('| metric | value |');
  lines.push('|---|---|');
  lines.push(`| avg steps per session | ${(totalSteps / Math.max(1, n)).toFixed(1)} |`);
  lines.push(`| avg canvas nodes at end | ${(totalNodes / Math.max(1, n)).toFixed(1)} |`);
  lines.push(`| sessions with stylePlate locked | ${plateLocked} / ${n} (${pct(plateLocked, n)}) |`);
  lines.push(`| total askUser invocations | ${totalAskUser} |`);
  lines.push(`| askUser fallback rate (no scripted reply left) | ${pct(totalAskUserFallbacks, Math.max(1, totalAskUser))} |`);
  lines.push(`| avg estimated prompt tokens peak | ${Math.round(totalPromptTokens / Math.max(1, n))} |`);
  lines.push('');
  lines.push('## Tool call frequency (top 40, mocked tools flagged)');
  lines.push('');
  lines.push('| tool | calls | mocked? |');
  lines.push('|---|---|---|');
  for (const [name, count] of sortedTools.slice(0, 40)) {
    lines.push(`| ${name} | ${count} | ${mockedSet.has(name) ? 'yes' : ''} |`);
  }
  lines.push('');
  lines.push('## Guides loaded via guide.get');
  lines.push('');
  if (Object.keys(guideGetAll).length === 0) {
    lines.push('_(No guide.get calls recorded across all sessions. Commander never pulled a guide on demand — check the MASTER INDEX is actually injected.)_');
  } else {
    lines.push('| guide id | sessions fetched |');
    lines.push('|---|---|');
    for (const [k, v] of Object.entries(guideGetAll).sort((a, b) => b[1] - a[1])) {
      lines.push(`| ${k} | ${v} |`);
    }
  }
  lines.push('');
  lines.push('## Process prompts injected');
  lines.push('');
  if (Object.keys(processAll).length === 0) {
    lines.push('_(No process-prompt injections observed. Either no tool triggered one, or the stream event name differs from what the harness listens for.)_');
  } else {
    lines.push('| processKey | injections |');
    lines.push('|---|---|');
    for (const [k, v] of Object.entries(processAll).sort((a, b) => b[1] - a[1])) {
      lines.push(`| ${k} | ${v} |`);
    }
  }
  lines.push('');
  lines.push('## Top tool-error shapes (top 20)');
  lines.push('');
  if (Object.keys(errorsByType).length === 0) {
    lines.push('_(No tool errors.)_');
  } else {
    lines.push('| error (first line) | count |');
    lines.push('|---|---|');
    for (const [k, v] of Object.entries(errorsByType).sort((a, b) => b[1] - a[1]).slice(0, 20)) {
      lines.push(`| \`${k.replace(/\|/g, '\\|')}\` | ${v} |`);
    }
  }
  lines.push('');
  lines.push('## Per-session summary');
  lines.push('');
  lines.push('| # | archetype | slug | outcome | steps | nodes | plate | askUser | tools | ms |');
  lines.push('|---|---|---|---|---|---|---|---|---|---|');
  for (const r of results) {
    const tools = Object.keys(r.toolCallCounts).length;
    lines.push(
      `| ${r.personaIndex} | ${r.archetype} | ${r.personaSlug} | ${r.outcome}${r.error ? ` _(${r.error.slice(0, 40)})_` : ''} | ${r.steps} | ${r.finalNodeCount} | ${r.stylePlateLocked ? 'Y' : 'N'} | ${r.askUserCount} | ${tools} | ${r.ms} |`,
    );
  }
  lines.push('');
  return lines.join('\n') + '\n';
}
