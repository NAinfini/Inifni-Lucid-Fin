/**
 * One-shot diagnostic: verify we can resolve both Codex custom providers via
 * settings.json and read their API keys from the OS keychain in a Node CLI
 * context (no Electron). Run before each study to confirm the environment.
 *
 *   npx tsx evals/commander-study/harness/probe-keychain.ts
 */
import keytar from 'keytar';
import { getCodexProviders } from './provider-config.js';

const SERVICE_NAME = 'lucid-fin';

async function main() {
  const specs = getCodexProviders();
  console.log(`Resolved ${specs.length} Codex provider(s) from settings.json:\n`);
  for (const s of specs) {
    console.log(`  ${s.name}  id=${s.id}  base=${s.baseUrl}  model=${s.model}`);
  }
  console.log('');

  let ok = 0;
  for (const spec of specs) {
    try {
      const key = await keytar.getPassword(SERVICE_NAME, spec.id);
      if (key) {
        console.log(`  [ok] ${spec.name} -> ${key.length} chars`);
        ok++;
      } else {
        console.log(`  [MISSING] ${spec.name} (id=${spec.id}) - no key under service '${SERVICE_NAME}'`);
      }
    } catch (err) {
      console.log(`  [ERROR] ${spec.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  console.log(`\n${ok}/${specs.length} provider keys accessible.`);
  if (ok < specs.length) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
