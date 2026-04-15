import type { Series } from '@lucid-fin/contracts';
import type { AgentTool } from '../tool-registry.js';
import { defineToolModule } from '../tool-module.js';
import { ok, fail, requireString, requireStringArray, extractSet, warnExtraKeys } from './tool-result-helpers.js';

export interface SeriesEpisode {
  id: string;
  seriesId: string;
  title: string;
  order: number;
  status: string;
  createdAt: number;
  updatedAt: number;
}

export interface SeriesToolDeps {
  getSeries: () => Promise<Series | null>;
  saveSeries: (series: Record<string, unknown>) => Promise<unknown>;
  listEpisodes: () => Promise<Array<{ id: string; title: string; canvasId?: string }>>;
  addEpisode: (title: string, canvasId?: string) => Promise<{ id: string }>;
  removeEpisode: (episodeId: string) => Promise<void>;
  reorderEpisodes?: (episodeIds: string[]) => Promise<SeriesEpisode[]>;
}

export function createSeriesTools(deps: SeriesToolDeps): AgentTool[] {
  const get: AgentTool = {
    name: 'series.get',
    description: 'Get the current project series.',
    tier: 1,
    parameters: { type: 'object', properties: {}, required: [] },
    async execute() {
      try {
        return ok(await deps.getSeries());
      } catch (error) {
        return fail(error);
      }
    },
  };

  const update: AgentTool = {
    name: 'series.update',
    description: 'Update the current project series definition. Wrap fields to change inside "set": { ... }. Only fields present in "set" will be applied — omitted fields are left untouched.',
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        set: {
          type: 'object',
          description: 'Fields to change. Only include the ones you want to update.',
          properties: {
            title: { type: 'string', description: 'Series title.' },
            description: { type: 'string', description: 'Series description.' },
          },
        },
      },
      required: ['set'],
    },
    async execute(args) {
      try {
        const set = extractSet(args);
        const warnings = warnExtraKeys(args);

        const current = await deps.getSeries();
        const next: Record<string, unknown> = current ? { ...current } : {};

        if (typeof set.title === 'string') {
          next.title = set.title;
        }
        if (typeof set.description === 'string') {
          next.description = set.description;
        }

        const saved = await deps.saveSeries(next);
        return { success: true, data: saved, ...(warnings.length > 0 && { warnings }) };
      } catch (error) {
        return fail(error);
      }
    },
  };

  const listEpisodes: AgentTool = {
    name: 'series.listEpisodes',
    description: 'List episodes in the current series.',
    tier: 1,
    parameters: {
      type: 'object',
      properties: {
        offset: { type: 'number', description: 'Start index (0-based). Default 0.' },
        limit: { type: 'number', description: 'Max items to return. Default 50.' },
      },
      required: [],
    },
    async execute(args) {
      try {
        const episodes = await deps.listEpisodes();
        const offset = typeof args.offset === 'number' && args.offset >= 0 ? Math.floor(args.offset) : 0;
        const limit = typeof args.limit === 'number' && args.limit > 0 ? Math.floor(args.limit) : 50;
        return ok({ total: episodes.length, offset, limit, episodes: episodes.slice(offset, offset + limit) });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const addEpisode: AgentTool = {
    name: 'series.addEpisode',
    description: 'Add a new episode to the current series.',
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'The episode title.' },
        canvasId: { type: 'string', description: 'Optional canvas ID linked to the episode.' },
      },
      required: ['title'],
    },
    async execute(args) {
      try {
        const title = requireString(args, 'title');
        const canvasId =
          typeof args.canvasId === 'string' && args.canvasId.trim().length > 0
            ? args.canvasId.trim()
            : undefined;
        return ok(await deps.addEpisode(title, canvasId));
      } catch (error) {
        return fail(error);
      }
    },
  };

  const removeEpisode: AgentTool = {
    name: 'series.removeEpisode',
    description: 'Remove an episode from the current series.',
    tier: 3,
    parameters: {
      type: 'object',
      properties: {
        episodeId: { type: 'string', description: 'The episode ID to remove.' },
      },
      required: ['episodeId'],
    },
    async execute(args) {
      try {
        const episodeId = requireString(args, 'episodeId');
        await deps.removeEpisode(episodeId);
        return ok({ episodeId });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const reorderEpisodes: AgentTool = {
    name: 'series.reorderEpisodes',
    description: 'Reorder episodes in the current series by episode ID.',
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        episodeIds: {
          type: 'array',
          description: 'Episode IDs in their new order.',
          items: { type: 'string', description: 'An episode ID.' },
        },
      },
      required: ['episodeIds'],
    },
    async execute(args) {
      if (!deps.reorderEpisodes) {
        return fail('Episode reordering not available');
      }
      try {
        return ok(await deps.reorderEpisodes(requireStringArray(args, 'episodeIds')));
      } catch (error) {
        return fail(error);
      }
    },
  };

  return [get, update, listEpisodes, addEpisode, removeEpisode, reorderEpisodes];
}

export const seriesToolModule = defineToolModule({
  name: 'series',
  createTools: createSeriesTools,
});
