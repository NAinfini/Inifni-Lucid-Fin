import { getBuiltinProviderCapabilityProfile } from '@lucid-fin/contracts';
import type { AgentTool, ToolResult } from '../tool-registry.js';

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
}

function ok(data: unknown): ToolResult {
  return { success: true, data };
}

function fail(error: unknown): ToolResult {
  return { success: false, error: error instanceof Error ? error.message : String(error) };
}

export function createProviderTools(deps: ProviderToolDeps): AgentTool[] {
  const listProviders: AgentTool = {
    name: 'provider.list',
    description: 'List all configured AI providers for a group (llm, image, video, audio). Returns provider name, base URL, model, and whether an API key is set. Does NOT return the API key itself.',
    tier: 1,
    parameters: {
      type: 'object',
      properties: {
        group: { type: 'string', description: 'Provider group: llm, image, video, or audio.', enum: ['llm', 'image', 'video', 'audio'] },
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
        group: { type: 'string', description: 'Provider group: llm, image, video, or audio.', enum: ['llm', 'image', 'video', 'audio'] },
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
      'Set the active provider for a group. This is only supported for llm; image, video, and audio providers are selected in their own generation UIs.',
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        group: { type: 'string', description: 'Provider group.', enum: ['llm', 'image', 'video', 'audio'] },
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

  const setBaseUrl: AgentTool = {
    name: 'provider.setBaseUrl',
    description: 'Update the base URL / API endpoint for a provider.',
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        group: { type: 'string', description: 'Provider group.', enum: ['llm', 'image', 'video', 'audio'] },
        providerId: { type: 'string', description: 'The provider ID.' },
        baseUrl: { type: 'string', description: 'The new base URL.' },
      },
      required: ['group', 'providerId', 'baseUrl'],
    },
    async execute(args) {
      try {
        await deps.setProviderBaseUrl(args.group as string, args.providerId as string, args.baseUrl as string);
        return ok({ updated: true });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const setModel: AgentTool = {
    name: 'provider.setModel',
    description: 'Update the model name for a provider.',
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        group: { type: 'string', description: 'Provider group.', enum: ['llm', 'image', 'video', 'audio'] },
        providerId: { type: 'string', description: 'The provider ID.' },
        model: { type: 'string', description: 'The new model name.' },
      },
      required: ['group', 'providerId', 'model'],
    },
    async execute(args) {
      try {
        await deps.setProviderModel(args.group as string, args.providerId as string, args.model as string);
        return ok({ updated: true });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const rename: AgentTool = {
    name: 'provider.rename',
    description: 'Rename a provider.',
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        group: { type: 'string', description: 'Provider group.', enum: ['llm', 'image', 'video', 'audio'] },
        providerId: { type: 'string', description: 'The provider ID.' },
        name: { type: 'string', description: 'The new display name.' },
      },
      required: ['group', 'providerId', 'name'],
    },
    async execute(args) {
      try {
        await deps.setProviderName(args.group as string, args.providerId as string, args.name as string);
        return ok({ renamed: true });
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
        group: { type: 'string', description: 'Provider group.', enum: ['llm', 'image', 'video', 'audio'] },
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
        group: { type: 'string', description: 'Provider group.', enum: ['llm', 'image', 'video', 'audio'] },
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

  return [listProviders, getActive, setActive, setBaseUrl, setModel, rename, addCustom, removeCustom, getCapabilities];
}
