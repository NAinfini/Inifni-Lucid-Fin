#!/usr/bin/env node
/**
 * Entry point for the fake-user study. Wires the electron shim FIRST (so any
 * subsequent import of desktop-main modules resolves 'electron' to the stub),
 * then drives N sessions end-to-end.
 *
 * Usage:
 *   npx tsx evals/commander-study/harness/run-all.ts              # default 50
 *   npx tsx evals/commander-study/harness/run-all.ts --count 2    # smoke
 *   npx tsx evals/commander-study/harness/run-all.ts --count 5 --persona 3
 *   npx tsx evals/commander-study/harness/run-all.ts --count 50 --concurrency 3
 */
import './electron-shim.js';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildPersonas } from './personas.js';
import { getCodexPlus, getCodexTeam, getHiCode, type CodexProviderSpec } from './provider-config.js';
import type { SessionResult } from './run-single.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface Args {
  count: number;
  persona?: number;
  concurrency: number;
  outDir: string;
  maxSteps: number;
  maxPromptTokens: number;
  teamIfWorking: boolean;
  provider?: 'plus' | 'team' | 'hi-code' | 'all';
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const args: Args = {
    count: 50,
    concurrency: 1,
    outDir: path.resolve(__dirname, '..', 'reports', new Date().toISOString().replace(/[:.]/g, '-')),
    maxSteps: 200,
    maxPromptTokens: 400_000,
    teamIfWorking: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--count' && argv[i + 1]) { args.count = Number(argv[++i]); continue; }
    if (a === '--persona' && argv[i + 1]) { args.persona = Number(argv[++i]); continue; }
    if (a === '--concurrency' && argv[i + 1]) { args.concurrency = Number(argv[++i]); continue; }
    if (a === '--out' && argv[i + 1]) { args.outDir = path.resolve(argv[++i]); continue; }
    if (a === '--max-steps' && argv[i + 1]) { args.maxSteps = Number(argv[++i]); continue; }
    if (a === '--max-prompt-tokens' && argv[i + 1]) { args.maxPromptTokens = Number(argv[++i]); continue; }
    if (a === '--team-if-working') { args.teamIfWorking = true; continue; }
    if (a === '--provider' && argv[i + 1]) {
      const val = argv[++i];
      if (val !== 'plus' && val !== 'team' && val !== 'hi-code' && val !== 'all') {
        throw new Error(`--provider must be one of: plus, team, hi-code, all. Got: ${val}`);
      }
      args.provider = val;
      continue;
    }
  }
  return args;
}

/**
 * Select providers for this run. Priority: --provider flag > --team-if-working > default (Plus only).
 *   plus     → [Codex Plus]
 *   team     → [Codex Team] (often broken; use at your own risk)
 *   hi-code  → [Hi code]
 *   all      → [Codex Team, Codex Plus, Hi code] round-robin
 *   default  → [Codex Plus] for baseline parity
 */
function getActiveSpecs(args: Args): CodexProviderSpec[] {
  if (args.provider === 'plus') return [getCodexPlus()];
  if (args.provider === 'team') return [getCodexTeam()];
  if (args.provider === 'hi-code') return [getHiCode()];
  if (args.provider === 'all') return [getCodexTeam(), getCodexPlus(), getHiCode()];
  if (args.teamIfWorking) return [getCodexTeam(), getCodexPlus()];
  return [getCodexPlus()];
}

async function main() {
  const args = parseArgs();
  fs.mkdirSync(args.outDir, { recursive: true });
  console.log(`Report dir: ${args.outDir}`);

  const allPersonas = buildPersonas();
  const personas = args.persona !== undefined
    ? [allPersonas[args.persona]].filter(Boolean)
    : allPersonas.slice(0, args.count);

  const specs = getActiveSpecs(args);
  console.log(`Providers in rotation: ${specs.map((s) => s.name).join(', ')}`);

  // Lazy import so the electron shim is registered before desktop-main loads.
  const { runSingle } = await import('./run-single.js');

  const results: SessionResult[] = [];
  const perUserDir = path.join(args.outDir, 'per-user');
  const summaryFile = path.join(args.outDir, 'summary.json');
  const rawFile = path.join(args.outDir, 'raw.ndjson');
  fs.mkdirSync(perUserDir, { recursive: true });
  const rawStream = fs.createWriteStream(rawFile, { flags: 'w' });

  // Process sequentially when concurrency=1 (default) to stay under rate
  // limits and avoid better-sqlite3 file locking between users (each gets
  // its own dir, but the keychain + global log handlers are process-wide).
  const queue = personas.map((persona, i) => ({
    persona,
    spec: specs[i % specs.length],
  }));

  const globalStart = Date.now();

  async function worker() {
    while (queue.length > 0) {
      const next = queue.shift();
      if (!next) break;
      const t0 = Date.now();
      console.log(`[${new Date().toISOString()}] [${next.persona.index}] ${next.persona.archetype.padEnd(12)} ${next.persona.slug}  via=${next.spec.name}  starting...`);
      let result: SessionResult;
      try {
        result = await runSingle({
          persona: next.persona,
          spec: next.spec,
          outDir: perUserDir,
          maxSteps: args.maxSteps,
          maxPromptTokens: args.maxPromptTokens,
        });
      } catch (err) {
        result = {
          personaIndex: next.persona.index,
          personaSlug: next.persona.slug,
          archetype: next.persona.archetype,
          providerName: next.spec.name,
          outcome: 'error',
          error: err instanceof Error ? err.message : String(err),
          steps: 0,
          toolCalls: [],
          toolCallCounts: {},
          mockCallCounts: {},
          askUserCount: 0,
          askUserAnswersConsumed: 0,
          askUserFallbacksUsed: 0,
          promptTokensEstimated: 0,
          finalNodeCount: 0,
          finalEdgeCount: 0,
          stylePlateLocked: false,
          promptGuidesLoadedViaGuideGet: [],
          processPromptsInjected: [],
          preflightDecisions: [],
          evidenceLedger: [],
          exitDecision: null,
          logFile: '(no log)',
          ms: Date.now() - t0,
        };
      }
      results.push(result);
      rawStream.write(JSON.stringify(result) + '\n');
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(
        `[${new Date().toISOString()}] [${next.persona.index}] ${next.persona.slug}  ${result.outcome.padEnd(16)} steps=${result.steps} nodes=${result.finalNodeCount} plate=${result.stylePlateLocked ? 'Y' : 'N'} askUser=${result.askUserCount}  ${elapsed}s`,
      );
      // Persist per-user json (full log is in the ndjson written by runSingle).
      fs.writeFileSync(
        path.join(perUserDir, `${String(result.personaIndex).padStart(2, '0')}-${result.personaSlug}.json`),
        JSON.stringify(result, null, 2),
      );
    }
  }

  const workers = Array.from({ length: Math.max(1, args.concurrency) }, () => worker());
  await Promise.all(workers);

  rawStream.end();
  fs.writeFileSync(summaryFile, JSON.stringify(results, null, 2));

  const totalMs = Date.now() - globalStart;
  console.log(`\nAll sessions done in ${(totalMs / 1000 / 60).toFixed(1)}min.`);
  console.log(`Summary JSON: ${summaryFile}`);
  console.log(`Raw NDJSON:   ${rawFile}`);

  // Generate markdown report.
  const { renderMarkdownReport } = await import('./report.js');
  const mdFile = path.join(args.outDir, 'summary.md');
  fs.writeFileSync(mdFile, renderMarkdownReport(results, { totalMs, specs }));
  console.log(`Markdown:     ${mdFile}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
