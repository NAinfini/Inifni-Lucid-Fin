import type { AgentTool, CanvasToolDeps } from './canvas-tool-utils.js';
import {
  CANVAS_CONTEXT,
  ok,
  fail,
  requireString,
} from './canvas-tool-utils.js';

export function createCanvasSettingsTools(deps: CanvasToolDeps): AgentTool[] {
  const listLLMProviders: AgentTool = {
    name: 'settings.listLLMProviders',
    description: 'List available LLM providers and their configuration status (which have API keys set).',
    context: CANVAS_CONTEXT,
    tier: 1,
    parameters: { type: 'object', properties: {}, required: [] },
    execute: async () => {
      if (!deps.listLLMProviders) return fail('LLM provider listing not available');
      try {
        const providers = await deps.listLLMProviders();
        return ok(providers);
      } catch (error) {
        return fail(error);
      }
    },
  };

  const setActiveLLM: AgentTool = {
    name: 'settings.setActiveLLMProvider',
    description: 'Set the active LLM provider for Commander AI. Use after confirming the provider has an API key configured.',
    context: CANVAS_CONTEXT,
    tier: 4,
    parameters: {
      type: 'object',
      properties: {
        providerId: { type: 'string', description: 'Provider ID (e.g., "openai", "claude", "gemini", "deepseek")' },
      },
      required: ['providerId'],
    },
    execute: async (args) => {
      if (!deps.setActiveLLMProvider) return fail('LLM provider switching not available');
      try {
        const providerId = requireString(args, 'providerId');
        await deps.setActiveLLMProvider(providerId);
        return ok({ providerId, message: `Active LLM provider set to ${providerId}` });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const setProviderKey: AgentTool = {
    name: 'settings.setProviderKey',
    description: 'Set the API key for any configured provider. The key will be securely stored in the system keychain.',
    context: CANVAS_CONTEXT,
    tier: 4,
    parameters: {
      type: 'object',
      properties: {
        providerId: { type: 'string', description: 'Provider ID (e.g., "openai", "claude", "runway")' },
        apiKey: { type: 'string', description: 'The API key to store' },
      },
      required: ['providerId', 'apiKey'],
    },
    execute: async (args) => {
      if (!deps.setLLMProviderApiKey) return fail('API key management not available');
      try {
        const providerId = requireString(args, 'providerId');
        const apiKey = requireString(args, 'apiKey');
        await deps.setLLMProviderApiKey(providerId, apiKey);
        return ok({ providerId, message: `API key set for ${providerId}` });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const setLLMApiKey: AgentTool = {
    ...setProviderKey,
    name: 'settings.setLLMApiKey',
    description: 'Set the API key for a provider. Kept for backward compatibility with older Commander prompts.',
  };

  const deleteProviderKey: AgentTool = {
    name: 'settings.deleteProviderKey',
    description: 'Delete a stored provider API key from the system keychain.',
    context: CANVAS_CONTEXT,
    tier: 4,
    parameters: {
      type: 'object',
      properties: {
        providerId: { type: 'string', description: 'Provider ID whose key should be deleted.' },
      },
      required: ['providerId'],
    },
    execute: async (args) => {
      if (!deps.deleteProviderKey) return fail('API key deletion not available');
      try {
        const providerId = requireString(args, 'providerId');
        await deps.deleteProviderKey(providerId);
        return ok({ providerId, message: `API key deleted for ${providerId}` });
      } catch (error) {
        return fail(error);
      }
    },
  };

  return [listLLMProviders, setActiveLLM, setProviderKey, setLLMApiKey, deleteProviderKey];
}
