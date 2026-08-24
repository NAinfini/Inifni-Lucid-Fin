import { getBuiltinProviderCapabilityProfile } from '@lucid-fin/contracts';
import { NO_TOOL_RESOURCE, toolResultSchema, type ToolDefinition } from '../tool-registry.js';
import { ok, fail, extractSet, warnExtraKeys } from './tool-result-helpers.js';
import {
  arraySchema,
  booleanSchema,
  enumSchema,
  nullableSchema,
  numberSchema,
  objectSchema,
  stringArraySchema,
  stringSchema,
  unionSchema,
} from './tool-runtime-schemas.js';

const providerInfoSchema = objectSchema({
  id: stringSchema,
  name: stringSchema,
  baseUrl: stringSchema,
  model: stringSchema,
  isCustom: booleanSchema,
  hasKey: booleanSchema,
});

const knownCapabilitySchema = objectSchema(
  {
    providerId: stringSchema,
    known: { const: true },
    audio: booleanSchema,
    type: enumSchema(['image', 'video']),
    supportsAudio: booleanSchema,
    qualityTiers: stringArraySchema,
    resolutions: stringArraySchema,
    aspectRatios: stringArraySchema,
    durationRange: arraySchema(numberSchema),
    styles: stringArraySchema,
    notes: stringSchema,
    maxDimension: numberSchema,
  },
  ['providerId', 'known', 'audio', 'type'],
);

const unknownCapabilitySchema = objectSchema({
  providerId: stringSchema,
  known: { const: false },
  message: stringSchema,
});

const providerManageDataSchema = unionSchema(
  objectSchema({
    total: numberSchema,
    offset: numberSchema,
    limit: numberSchema,
    providers: arraySchema(providerInfoSchema),
  }),
  objectSchema({ activeProvider: nullableSchema(stringSchema) }),
  objectSchema({ activated: stringSchema }),
  knownCapabilitySchema,
  unknownCapabilitySchema,
);

const providerUpdateDataSchema = objectSchema(
  {
    providerId: stringSchema,
    baseUrl: stringSchema,
    model: stringSchema,
    name: stringSchema,
    warnings: stringArraySchema,
  },
  ['providerId'],
);

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
  addCustomProvider: (
    group: string,
    id: string,
    name: string,
    baseUrl?: string,
    model?: string,
  ) => Promise<void>;
  removeCustomProvider: (group: string, providerId: string) => Promise<void>;
  setProviderApiKey?: (providerId: string, apiKey: string) => Promise<void>;
}

export function createProviderTools(deps: ProviderToolDeps): ToolDefinition[] {
  const manage: ToolDefinition = {
    name: 'provider.manage',
    process: 'provider-management',
    category: 'query',
    contextReplay: 'status_only',
    resource: NO_TOOL_RESOURCE,
    description:
      'Manage AI providers: list available providers, get/set the active provider, or get provider capabilities.',
    tier: 1,
    outputSchema: toolResultSchema(providerManageDataSchema),
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: 'Action to perform.',
          enum: ['list', 'getActive', 'setActive', 'getCapabilities'],
        },
        group: {
          type: 'string',
          description: 'Provider group: llm, image, video, audio, or vision.',
          enum: ['llm', 'image', 'video', 'audio', 'vision'],
        },
        providerId: { type: 'string', description: 'The provider ID.' },
        offset: { type: 'number', description: 'Start index (0-based). Default 0.' },
        limit: { type: 'number', description: 'Max items to return. Default 50.' },
      },
      required: ['action'],
    },
    async execute(args) {
      const action = args.action as string;
      if (action === 'list') {
        try {
          const group = args.group as string;
          const providers = await deps.listProviders(group);
          const offset =
            typeof args.offset === 'number' && args.offset >= 0 ? Math.floor(args.offset) : 0;
          const limit =
            typeof args.limit === 'number' && args.limit > 0 ? Math.floor(args.limit) : 50;
          return ok({
            total: providers.length,
            offset,
            limit,
            providers: providers.slice(offset, offset + limit),
          });
        } catch (error) {
          return fail(error);
        }
      } else if (action === 'getActive') {
        try {
          const active = await deps.getActiveProvider(args.group as string);
          return ok({ activeProvider: active });
        } catch (error) {
          return fail(error);
        }
      } else if (action === 'setActive') {
        try {
          await deps.setActiveProvider(args.group as string, args.providerId as string);
          return ok({ activated: args.providerId });
        } catch (error) {
          return fail(error);
        }
      } else if (action === 'getCapabilities') {
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
          type: caps.type,
          ...(caps.supportsAudio === undefined ? {} : { supportsAudio: caps.supportsAudio }),
          ...(caps.qualityTiers === undefined ? {} : { qualityTiers: caps.qualityTiers }),
          ...(caps.resolutions === undefined ? {} : { resolutions: caps.resolutions }),
          ...(caps.aspectRatios === undefined ? {} : { aspectRatios: caps.aspectRatios }),
          ...(caps.durationRange === undefined ? {} : { durationRange: caps.durationRange }),
          ...(caps.styles === undefined ? {} : { styles: caps.styles }),
          ...(caps.notes === undefined ? {} : { notes: caps.notes }),
          ...(caps.maxDimension === undefined ? {} : { maxDimension: caps.maxDimension }),
        });
      } else {
        return fail(new Error(`Unknown action: ${action}`));
      }
    },
  };

  const update: ToolDefinition = {
    name: 'provider.update',
    process: 'provider-management',
    category: 'mutation',
    contextReplay: 'status_only',
    resource: NO_TOOL_RESOURCE,
    description:
      'Update provider configuration. Wrap fields to change inside "set": { ... }. Only fields present in "set" will be applied — omitted fields are left untouched.',
    tier: 2,
    outputSchema: toolResultSchema(providerUpdateDataSchema),
    inputSchema: {
      type: 'object',
      properties: {
        group: {
          type: 'string',
          description: 'Provider group.',
          enum: ['llm', 'image', 'video', 'audio', 'vision'],
        },
        providerId: { type: 'string', description: 'The provider ID.' },
        set: {
          type: 'object',
          description:
            'Fields to update. ONLY include the fields you want to change — omitted fields are left untouched.',
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

  const setKey: ToolDefinition = {
    name: 'provider.setKey',
    process: 'provider-management',
    category: 'mutation',
    contextReplay: 'status_only',
    resource: NO_TOOL_RESOURCE,
    description:
      'Set the API key for any configured provider. The key will be securely stored in the system keychain.',
    tier: 4,
    outputSchema: toolResultSchema(objectSchema({ providerId: stringSchema, message: stringSchema })),
    inputSchema: {
      type: 'object',
      properties: {
        providerId: {
          type: 'string',
          description: 'Provider ID (e.g., "openai", "claude", "runway").',
        },
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
        return ok({
          providerId: providerId.trim(),
          message: `API key set for ${providerId.trim()}`,
        });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const addCustom: ToolDefinition = {
    name: 'provider.addCustom',
    process: 'provider-management',
    category: 'mutation',
    contextReplay: 'status_only',
    resource: NO_TOOL_RESOURCE,
    description:
      'Add a new custom provider to a group. Optionally provide baseUrl and model if known. The user will need to set the API key separately in Settings.',
    tier: 2,
    outputSchema: toolResultSchema(
      objectSchema(
        {
          id: stringSchema,
          name: stringSchema,
          baseUrl: stringSchema,
          model: stringSchema,
        },
        ['id', 'name'],
      ),
    ),
    inputSchema: {
      type: 'object',
      properties: {
        group: {
          type: 'string',
          description: 'Provider group.',
          enum: ['llm', 'image', 'video', 'audio', 'vision'],
        },
        name: { type: 'string', description: 'Display name for the new provider.' },
        baseUrl: {
          type: 'string',
          description: 'Optional: API base URL (e.g., https://api.example.com/v1).',
        },
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
        return ok({
          id,
          name,
          ...(baseUrl === undefined ? {} : { baseUrl }),
          ...(model === undefined ? {} : { model }),
        });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const removeCustom: ToolDefinition = {
    name: 'provider.removeCustom',
    process: 'provider-management',
    category: 'mutation',
    contextReplay: 'status_only',
    resource: NO_TOOL_RESOURCE,
    description: 'Remove a custom provider from a group. Only custom providers can be removed.',
    tier: 3,
    outputSchema: toolResultSchema(objectSchema({ removed: stringSchema })),
    inputSchema: {
      type: 'object',
      properties: {
        group: {
          type: 'string',
          description: 'Provider group.',
          enum: ['llm', 'image', 'video', 'audio', 'vision'],
        },
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

  return [manage, update, setKey, addCustom, removeCustom];
}
