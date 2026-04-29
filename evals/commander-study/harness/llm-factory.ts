/**
 * Wrap a Codex spec (resolved from settings.json) + its keychain key into a
 * ready-to-use `LLMAdapter`. Uses the same `buildRuntimeLLMAdapter` pipeline
 * the app itself uses, so behavior (streaming, tool calling, retries) is
 * identical to what a real user would trigger from the chat panel.
 */
import keytar from 'keytar';
import type { LLMAdapter } from '@lucid-fin/contracts';
import { buildRuntimeLLMAdapter } from '@lucid-fin/adapters-ai';
import { toRuntimeConfig, type CodexProviderSpec } from './provider-config.js';

const SERVICE_NAME = 'lucid-fin';

export async function buildCodexAdapter(spec: CodexProviderSpec): Promise<LLMAdapter> {
  const apiKey = await keytar.getPassword(SERVICE_NAME, spec.id);
  if (!apiKey) {
    throw new Error(
      `No API key in keychain for provider "${spec.name}" (id=${spec.id}). ` +
        `Open Lucid Fin → Settings and (re-)paste the key.`,
    );
  }
  const adapter = buildRuntimeLLMAdapter(toRuntimeConfig(spec));
  adapter.configure(apiKey);
  return adapter;
}
