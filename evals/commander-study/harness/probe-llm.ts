import { getCodexPlus, getCodexTeam } from './provider-config.js';
import { buildCodexAdapter } from './llm-factory.js';

async function pingOne(spec: ReturnType<typeof getCodexPlus>, model?: string) {
  const adapter = await buildCodexAdapter(spec);
  const label = model ? `${spec.name} model=${model}` : spec.name;
  console.log(`[${label}] complete...`);
  const t0 = Date.now();
  try {
    const out = await adapter.complete(
      [{ role: 'user', content: 'Reply with one word: pong' }],
      { maxTokens: 16, temperature: 0, ...(model ? { model } : {}) },
    );
    console.log(`  -> ${JSON.stringify(out)}  (${Date.now() - t0}ms)`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`  FAILED after ${Date.now() - t0}ms: ${msg}`);
  }
}

async function main() {
  await pingOne(getCodexTeam());
  await pingOne(getCodexTeam(), 'gpt-5.3-codex');
  await pingOne(getCodexPlus());
  await pingOne(getCodexPlus(), 'gpt-5.3-codex');
}

main();
