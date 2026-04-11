import type { AgentTool, CanvasToolDeps } from './canvas-tool-utils.js';
import {
  CANVAS_CONTEXT,
  ok,
  fail,
  requireString,
} from './canvas-tool-utils.js';

export function createCanvasSettingsTools(deps: CanvasToolDeps): AgentTool[] {
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

  return [setProviderKey];
}
