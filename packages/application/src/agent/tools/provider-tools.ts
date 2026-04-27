import { getBuiltinProviderCapabilityProfile } from '@lucid-fin/contracts';
import type { AgentTool } from '../tool-registry.js';
import { ok, fail, extractSet, warnExtraKeys } from './tool-result-helpers.js';

export interface ProviderInfo {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  isCustom: boolean;
  hasKey: boolean;
}

export interface ProviderToolDeps {
  listProviders: (group: string) => Promise<ProviderInfo[]>;
  getActiveProvider: (group: string) => Promise<string | null>;
  setActiveProvider: (group: string, providerId: string) => Promise<void>;
  setProviderBaseUrl: (group: string, providerId: string, baseUrl: string) => Promise<void>;
  setProviderModel: (group: string, providerId: string, model: string) => Promise<void>;
  setProviderName: (group: string, providerId: string, name: string) => Promise<void>;
  addCustomProvider: (group: string, id: string, name: string, baseUrl?: string, model?: string) => Promise<void>;
  removeCustomProvider: (group: string, providerId: string) => Promise<void>;
  setProviderApiKey?: (providerId: string, apiKey: string) => Promise<void>;
}

export function createProviderTools(deps: ProviderToolDeps): AgentTool[] {
  const listProviders: AgentTool = {
    name: 'provider.list',
    description: 'List all configured AI providers for a group (llm, image, video, audio, vision). Returns provider name, base URL, model, and whether an API key is set. Does NOT return the API key itself.',
    tier: 1,
    parameters: {
      type: 'object',
      properties: {
        group: { type: 'string', description: 'Provider group: llm, image, video, audio, or vision.', enum: ['llm', 'image', 'video', 'audio', 'vision'] },
        offset: { type: 'number', description: 'Start index (0-based). Default 0.' },
        limit: { type: 'number', description: 'Max items to return. Default 50.' },
      },
      required: ['group'],
    },
    async execute(args) {
      try {
        const group = args.group as string;
        const providers = await deps.listProviders(group);
        const offset = typeof args.offset === 'number' && args.offset >= 0 ? Math.floor(args.offset) : 0;
        const limit = typeof args.limit === 'number' && args.limit > 0 ? Math.floor(args.limit) : 50;
        return ok({ total: providers.length, offset, limit, providers: providers.slice(offset, offset + limit) });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const getActive: AgentTool = {
    name: 'provider.getActive',
    description:
      'Get the current provider selection for a group. For llm this returns the Commander session provider. For image, video, and audio it may return null because those providers are selected in generation UIs instead of global settings.',
    tier: 1,
    parameters: {
      type: 'object',
      properties: {
        group: { type: 'string', description: 'Provider group: llm, image, video, audio, or vision.', enum: ['llm', 'image', 'video', 'audio', 'vision'] },
      },
      required: ['group'],
    },
    async execute(args) {
      try {
        const active = await deps.getActiveProvider(args.group as string);
        return ok({ activeProvider: active });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const setActive: AgentTool = {
    name: 'provider.setActive',
    description:
      'Set the active (default) provider for a group. This is only supported for llm; image, video, and audio providers are selected in their own generation UIs. Use this for project-wide provider defaults; for per-node provider override, use canvas.setNodeProvider instead.',
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        group: { type: 'string', description: 'Provider group.', enum: ['llm', 'image', 'video', 'audio', 'vision'] },
        providerId: { type: 'string', description: 'The provider ID to activate.' },
      },
      required: ['group', 'providerId'],
    },
    async execute(args) {
      try {
        await deps.setActiveProvider(args.group as string, args.providerId as string);
        return ok({ activated: args.providerId });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const update: AgentTool = {
    name: 'provider.update',
    description: 'Update provider configuration. Wrap fields to change inside "set": { ... }. Only fields present in "set" will be applied — omitted fields are left untouched.',
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        group: { type: 'string', description: 'Provider group.', enum: ['llm', 'image', 'video', 'audio', 'vision'] },
        providerId: { type: 'string', description: 'The provider ID.' },
        set: {
          type: 'object',
          description: 'Fields to update. ONLY include the fields you want to change — omitted fields are left untouched.',
          properties: {
            baseUrl: { type: 'string', description: 'New base URL / API endpoint.' },
            model: { type: 'string', description: 'New model name.' },
            name: { type: 'string', description: 'New display name.' },
          },
        },
      },
      required: ['group', 'providerId', 'set'],
    },
    async execute(args) {
      try {
        const group = args.group as string;
        const providerId = args.providerId as string;
        const set = extractSet(args);
        const warnings = warnExtraKeys(args);
        const updated: Record<string, unknown> = {};
        if (typeof set.baseUrl === 'string') {
          await deps.setProviderBaseUrl(group, providerId, set.baseUrl as string);
          updated.baseUrl = set.baseUrl;
        }
        if (typeof set.model === 'string') {
          await deps.setProviderModel(group, providerId, set.model as string);
          updated.model = set.model;
        }
        if (typeof set.name === 'string') {
          await deps.setProviderName(group, providerId, set.name as string);
          updated.name = set.name;
        }
        if (Object.keys(updated).length === 0) {
          throw new Error('At least one of baseUrl, model, or name must be provided in set');
        }
        return ok({ providerId, ...updated, ...(warnings.length > 0 && { warnings }) });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const setKey: AgentTool = {
    name: 'provider.setKey',
    description: 'Set the API key for any configured provider. The key will be securely stored in the system keychain.',
    tier: 4,
    parameters: {
      type: 'object',
      properties: {
        providerId: { type: 'string', description: 'Provider ID (e.g., "openai", "claude", "runway").' },
        apiKey: { type: 'string', description: 'The API key to store.' },
      },
      required: ['providerId', 'apiKey'],
    },
    async execute(args) {
      if (!deps.setProviderApiKey) return fail('API key management not available');
      try {
        const providerId = args.providerId as string;
        if (!providerId || !providerId.trim()) throw new Error('providerId is required');
        const apiKey = args.apiKey as string;
        if (!apiKey || !apiKey.trim()) throw new Error('apiKey is required');
        await deps.setProviderApiKey(providerId.trim(), apiKey.trim());
        return ok({ providerId: providerId.trim(), message: `API key set for ${providerId.trim()}` });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const addCustom: AgentTool = {
    name: 'provider.addCustom',
    description: 'Add a new custom provider to a group. Optionally provide baseUrl and model if known. The user will need to set the API key separately in Settings.',
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        group: { type: 'string', description: 'Provider group.', enum: ['llm', 'image', 'video', 'audio', 'vision'] },
        name: { type: 'string', description: 'Display name for the new provider.' },
        baseUrl: { type: 'string', description: 'Optional: API base URL (e.g., https://api.example.com/v1).' },
        model: { type: 'string', description: 'Optional: Default model name.' },
      },
      required: ['group', 'name'],
    },
    async execute(args) {
      try {
        const group = args.group as string;
        const name = args.name as string;
        const baseUrl = args.baseUrl as string | undefined;
        const model = args.model as string | undefined;
        const id = `custom-${group}-${Date.now()}`;
        await deps.addCustomProvider(group, id, name, baseUrl, model);
        return ok({ id, name, baseUrl, model });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const removeCustom: AgentTool = {
    name: 'provider.removeCustom',
    description: 'Remove a custom provider from a group. Only custom providers can be removed.',
    tier: 3,
    parameters: {
      type: 'object',
      properties: {
        group: { type: 'string', description: 'Provider group.', enum: ['llm', 'image', 'video', 'audio', 'vision'] },
        providerId: { type: 'string', description: 'The custom provider ID to remove.' },
      },
      required: ['group', 'providerId'],
    },
    async execute(args) {
      try {
        await deps.removeCustomProvider(args.group as string, args.providerId as string);
        return ok({ removed: args.providerId });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const getCapabilities: AgentTool = {
    name: 'provider.getCapabilities',
    description:
      'Get the known capabilities and constraints for a video or image provider. Returns supported features (audio, quality tiers), resolution limits, duration limits, and provider-specific notes. Use this before setting node media config to ensure correct parameters.',
    tier: 1,
    parameters: {
      type: 'object',
      properties: {
        providerId: { type: 'string', description: 'The provider ID to query.' },
      },
      required: ['providerId'],
    },
    async execute(args) {
      const providerId = args.providerId as string;
      const caps = getBuiltinProviderCapabilityProfile(providerId);
      if (!caps) {
        return ok({
          providerId,
          known: false,
          message: `No built-in capability data for "${providerId}". Use default settings.`,
        });
      }
      return ok({
        providerId,
        known: true,
        audio: Boolean(caps.supportsAudio),
        ...caps,
      });
    },
  };

  return [listProviders, getActive, setActive, update, setKey, addCustom, removeCustom, getCapabilities];
}
