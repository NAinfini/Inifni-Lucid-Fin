import type { Series } from '@lucid-fin/contracts';
import type { AgentTool, ToolResult } from '../tool-registry.js';

export interface SeriesEpisode {
  id: string;
  seriesId: string;
  title: string;
  order: number;
  projectId: string | null;
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

function ok(data?: unknown): ToolResult {
  return data === undefined ? { success: true } : { success: true, data };
}

function fail(error: unknown): ToolResult {
  return {
    success: false,
    error: error instanceof Error ? error.message : String(error),
  };
}

function requireString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${key} is required`);
  }
  return value.trim();
}

function requireStringArray(args: Record<string, unknown>, key: string): string[] {
  const value = args[key];
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${key} must be a non-empty array`);
  }
  return value.map((entry, index) => {
    if (typeof entry !== 'string' || entry.trim().length === 0) {
      throw new Error(`${key}[${index}] must be a non-empty string`);
    }
    return entry.trim();
  });
}

function requireSeries(args: Record<string, unknown>): Series {
  const value = args.series;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('series is required');
  }
  return value as Series;
}

function parseOptionalString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new Error(`${key} must be a string`);
  }
  return value;
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

  const save: AgentTool = {
    name: 'series.save',
    description: 'Save the current project series definition.',
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        series: { type: 'object', description: 'Optional full series definition to save.' },
        title: { type: 'string', description: 'Optional series title update.' },
        description: { type: 'string', description: 'Optional series description update.' },
      },
      required: [],
    },
    async execute(args) {
      try {
        if (args.series !== undefined) {
          return ok(await deps.saveSeries(requireSeries(args) as unknown as Record<string, unknown>));
        }

        const current = await deps.getSeries();
        const title = parseOptionalString(args, 'title');
        const description = parseOptionalString(args, 'description');
        const next: Record<string, unknown> = current ? { ...current } : {};

        if (title !== undefined) {
          next.title = title;
        }
        if (description !== undefined) {
          next.description = description;
        }

        return ok(await deps.saveSeries(next));
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

  return [get, save, listEpisodes, addEpisode, removeEpisode, reorderEpisodes];
}
