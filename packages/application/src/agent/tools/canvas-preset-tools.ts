import {
  PRESET_CATEGORIES,
  createEmptyPresetTrackSet,
  type PresetCategory,
  type PresetTrack,
  type PresetTrackEntry,
  type PresetTrackSet,
} from '@lucid-fin/contracts';
import type { AgentTool, CanvasToolDeps, TrackMap } from './canvas-tool-utils.js';
import {
  CANVAS_CONTEXT,
  ok,
  fail,
  requireString,
  requirePresetCategory,
  requireNode,
  clampIntensity,
  parseOptionalCameraDirection,
  clonePresetTrackSet,
  requirePresetTrackEntry,
  normalizeTrackOrders,
  requirePresetTrackEntryChanges,
} from './canvas-tool-utils.js';

export function createCanvasPresetTools(deps: CanvasToolDeps): AgentTool[] {
  const readNodePresetTracks: AgentTool = {
    name: 'canvas.readNodePresetTracks',
    description:
      'Read all preset tracks, entries, and intensities for an image or video node. Returns the full PresetTrackSet with per-category and per-entry details.',
    context: CANVAS_CONTEXT,
    tier: 1,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        nodeId: { type: 'string', description: 'The node ID to read.' },
      },
      required: ['canvasId', 'nodeId'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const nodeId = requireString(args, 'nodeId');
        const { node } = await requireNode(deps, canvasId, nodeId);
        if (node.type !== 'image' && node.type !== 'video') {
          throw new Error(`Node type "${node.type}" does not support presets`);
        }
        const tracks =
          (node.data as { presetTracks?: PresetTrackSet }).presetTracks ??
          createEmptyPresetTrackSet();
        return ok({ nodeId, presetTracks: tracks });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const writeNodePresetTracks: AgentTool = {
    name: 'canvas.writeNodePresetTracks',
    description:
      'Set or modify preset entries and intensity for one or more categories on an image or video node. ' +
      'Single-category mode: provide "category", optional "intensity" (0-100), and optional "entries". ' +
      'Multi-category mode: provide "tracks" object keyed by category name, each with optional intensity and entries. ' +
      'Do not mix both modes.',
    context: CANVAS_CONTEXT,
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        nodeId: { type: 'string', description: 'The node ID to update.' },
        category: {
          type: 'string',
          description: 'Single-category mode: the preset category to modify.',
          enum: [
            'camera', 'lens', 'look', 'scene',
            'composition', 'emotion', 'flow', 'technical',
          ],
        },
        intensity: {
          type: 'number',
          description: 'Single-category mode: category-level intensity (0-100).',
        },
        entries: {
          type: 'array',
          description: 'Single-category mode: replacement entries for this category.',
          items: {
            type: 'object',
            description: 'A preset entry.',
            properties: {
              presetId: { type: 'string', description: 'The preset definition ID.' },
              intensity: { type: 'number', description: 'Entry-level intensity (0-100).' },
              direction: {
                type: 'string',
                description: 'Camera direction (only for camera category).',
              },
            },
          },
        },
        tracks: {
          type: 'object',
          description:
            'Multi-category mode: object keyed by category name. Each value has optional "intensity" (0-100) and optional "entries" array.',
        },
      },
      required: ['canvasId', 'nodeId'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const nodeId = requireString(args, 'nodeId');
        const hasSingleCategory = typeof args.category === 'string';
        const hasMultiTracks = args.tracks != null && typeof args.tracks === 'object' && !Array.isArray(args.tracks);

        if (hasSingleCategory && hasMultiTracks) {
          throw new Error('Provide either "category" (single) or "tracks" (multi), not both.');
        }
        if (!hasSingleCategory && !hasMultiTracks) {
          throw new Error('Provide "category" for single-category mode or "tracks" for multi-category mode.');
        }

        const { node } = await requireNode(deps, canvasId, nodeId);
        if (node.type !== 'image' && node.type !== 'video') {
          throw new Error(`Node type "${node.type}" does not support presets`);
        }

        const existing =
          (node.data as { presetTracks?: PresetTrackSet }).presetTracks ??
          createEmptyPresetTrackSet();
        const trackSet = structuredClone(existing) as TrackMap;

        // Build list of category operations to apply
        type CategoryOp = { category: PresetCategory; intensity?: unknown; entries?: unknown };
        const ops: CategoryOp[] = [];

        if (hasSingleCategory) {
          const category = requirePresetCategory(args);
          ops.push({ category, intensity: args.intensity, entries: args.entries });
        } else {
          const tracksObj = args.tracks as Record<string, Record<string, unknown>>;
          const validCategories = new Set(PRESET_CATEGORIES as readonly string[]);
          for (const [cat, val] of Object.entries(tracksObj)) {
            if (!validCategories.has(cat)) {
              throw new Error(`Invalid category "${cat}". Valid: ${PRESET_CATEGORIES.join(', ')}`);
            }
            ops.push({
              category: cat as PresetCategory,
              intensity: val?.intensity,
              entries: val?.entries,
            });
          }
          if (ops.length === 0) {
            throw new Error('tracks object must contain at least one category.');
          }
        }

        const results: Array<{ category: string; track: PresetTrack }> = [];

        for (const op of ops) {
          const track = trackSet[op.category] ?? {
            category: op.category,
            entries: [],
          };

          const categoryIntensity = clampIntensity(op.intensity);
          if (categoryIntensity !== undefined) {
            track.intensity = categoryIntensity;
          }

          if (Array.isArray(op.entries)) {
            const rawEntries = op.entries as Array<Record<string, unknown>>;
            const entries: Array<PresetTrackEntry> = rawEntries.map((raw, idx) => {
              const presetId = typeof raw.presetId === 'string' ? raw.presetId.trim() : '';
              if (!presetId) throw new Error(`${op.category}.entries[${idx}].presetId is required`);
              return {
                id: crypto.randomUUID(),
                category: op.category,
                presetId,
                params: {},
                order: idx,
                intensity: clampIntensity(raw.intensity),
                direction: parseOptionalCameraDirection(raw.direction),
              };
            });
            track.entries = entries;
          }

          trackSet[op.category] = track;
          results.push({ category: op.category, track });
        }

        await deps.setNodePresets(canvasId, nodeId, trackSet as PresetTrackSet);

        // Single-category mode returns flat shape for backward compat
        if (results.length === 1) {
          return ok({ nodeId, category: results[0]!.category, track: results[0]!.track });
        }
        return ok({ nodeId, tracks: results });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const presetEntry: AgentTool = {
    name: 'canvas.presetEntry',
    description: 'Add, remove, or update a preset entry on a specific preset track on image/video nodes. Use action="add" to add (supports batch via nodeIds), action="remove" to remove by entryId, action="update" to update entry fields.',
    context: CANVAS_CONTEXT,
    tier: 3,
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['add', 'remove', 'update'], description: 'The operation to perform.' },
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        nodeId: { type: 'string', description: 'Single node ID to update.' },
        nodeIds: { type: 'array', items: { type: 'string', description: 'Node ID.' }, description: 'Batch: array of node IDs to update with the same preset (for action=add).' },
        category: {
          type: 'string',
          description: 'The preset category to modify.',
          enum: [...PRESET_CATEGORIES],
        },
        presetId: { type: 'string', description: 'The preset definition ID to add (required for action=add).' },
        entryId: { type: 'string', description: 'The preset track entry ID (required for action=remove and action=update).' },
        intensity: { type: 'number', description: 'Optional entry-level intensity (0-100) for action=add and action=update.' },
        changes: {
          type: 'object',
          description: 'Changes to apply to the preset track entry (for action=update).',
          properties: {
            intensity: { type: 'number', description: 'Optional entry-level intensity (0-100).' },
            presetId: { type: 'string', description: 'Optional replacement preset ID.' },
            direction: { type: 'string', description: 'Optional camera direction.' },
          },
        },
      },
      required: ['action', 'canvasId', 'category'],
    },
    async execute(args) {
      try {
        const action = requireString(args, 'action');
        const canvasId = requireString(args, 'canvasId');
        const category = requirePresetCategory(args);

        if (action === 'add') {
          const nodeIds = Array.isArray(args.nodeIds) && args.nodeIds.length > 0
            ? (args.nodeIds as string[]).map(String)
            : [requireString(args, 'nodeId')];
          const presetId = requireString(args, 'presetId');
          const results: Array<{ nodeId: string; success: boolean; entry?: PresetTrackEntry; error?: string }> = [];
          for (const nodeId of nodeIds) {
            try {
              const { node } = await requireNode(deps, canvasId, nodeId);
              const trackSet = clonePresetTrackSet(node);
              const track = trackSet[category];
              const entry: PresetTrackEntry = {
                id: crypto.randomUUID(),
                category,
                presetId,
                params: {},
                order: track.entries.length,
                intensity: clampIntensity(args.intensity),
              };
              track.entries.push(entry);
              normalizeTrackOrders(track);
              await deps.setNodePresets(canvasId, nodeId, trackSet as PresetTrackSet);
              results.push({ nodeId, success: true, entry });
            } catch (error) {
              results.push({ nodeId, success: false, error: error instanceof Error ? error.message : String(error) });
            }
          }
          if (results.length === 1) return ok({ nodeId: nodeIds[0], category, entry: results[0]?.entry });
          return ok({ updated: results.filter((r) => r.success).length, total: nodeIds.length, category, results });
        }

        if (action === 'remove') {
          const nodeId = requireString(args, 'nodeId');
          const entryId = requireString(args, 'entryId');
          const { node } = await requireNode(deps, canvasId, nodeId);
          const trackSet = clonePresetTrackSet(node);
          const track = trackSet[category];
          requirePresetTrackEntry(track, entryId);
          track.entries = track.entries.filter((entry) => entry.id !== entryId);
          normalizeTrackOrders(track);
          await deps.setNodePresets(canvasId, nodeId, trackSet as PresetTrackSet);
          return ok({ nodeId, category, entryId });
        }

        if (action === 'update') {
          const nodeId = requireString(args, 'nodeId');
          const entryId = requireString(args, 'entryId');
          const changes = requirePresetTrackEntryChanges(args);
          const { node } = await requireNode(deps, canvasId, nodeId);
          const trackSet = clonePresetTrackSet(node);
          const track = trackSet[category];
          const entry = requirePresetTrackEntry(track, entryId);

          if (changes.intensity !== undefined) {
            entry.intensity = changes.intensity;
          }
          if (changes.presetId !== undefined) {
            entry.presetId = changes.presetId;
          }
          if (changes.direction !== undefined) {
            entry.direction = changes.direction;
          }

          normalizeTrackOrders(track);
          await deps.setNodePresets(canvasId, nodeId, trackSet as PresetTrackSet);
          return ok({ nodeId, category, entryId });
        }

        throw new Error(`Invalid action "${action}". Must be one of: add, remove, update.`);
      } catch (error) {
        return fail(error);
      }
    },
  };

  const applyShotTemplate: AgentTool = {
    name: 'canvas.applyShotTemplate',
    description:
      'Apply a shot template to image/video nodes by name. Supports batch: pass nodeIds array to apply the same template to multiple nodes at once. ' +
      'Overwrites preset tracks defined in the template; leaves other categories unchanged.',
    context: CANVAS_CONTEXT,
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        nodeId: { type: 'string', description: 'Single node ID to apply the template to.' },
        nodeIds: { type: 'array', items: { type: 'string', description: 'Node ID.' }, description: 'Batch: array of node IDs to apply the same template to.' },
        templateName: {
          type: 'string',
          description: 'The template name to search for (case-insensitive partial match).',
        },
      },
      required: ['canvasId', 'templateName'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const nodeIds = Array.isArray(args.nodeIds) && args.nodeIds.length > 0
          ? (args.nodeIds as string[]).map(String)
          : [requireString(args, 'nodeId')];
        const templateName = requireString(args, 'templateName').toLowerCase();

        const templates = await deps.listShotTemplates();
        const match =
          templates.find((t) => t.name.toLowerCase() === templateName) ??
          templates.find((t) => t.name.toLowerCase().includes(templateName));
        if (!match) {
          throw new Error(
            `Shot template "${args.templateName}" not found. Available: ${templates.map((t) => t.name).join(', ')}`,
          );
        }

        const results: Array<{ nodeId: string; success: boolean; error?: string }> = [];
        const appliedCategories = Object.keys(match.tracks).filter((k) => match.tracks[k as PresetCategory]);

        for (const nodeId of nodeIds) {
          try {
            const { node } = await requireNode(deps, canvasId, nodeId);
            if (node.type !== 'image' && node.type !== 'video') {
              results.push({ nodeId, success: false, error: `Node type "${node.type}" does not support presets` });
              continue;
            }

            const existing =
              (node.data as { presetTracks?: PresetTrackSet }).presetTracks ??
              createEmptyPresetTrackSet();
            const trackSet = structuredClone(existing) as TrackMap;

            for (const [cat, track] of Object.entries(match.tracks)) {
              if (track) {
                trackSet[cat as PresetCategory] = structuredClone(track);
              }
            }

            await deps.setNodePresets(canvasId, nodeId, trackSet as PresetTrackSet);
            await deps.updateNodeData(canvasId, nodeId, {
              appliedShotTemplateId: match.id,
              appliedShotTemplateName: match.name,
            });
            results.push({ nodeId, success: true });
          } catch (error) {
            results.push({ nodeId, success: false, error: error instanceof Error ? error.message : String(error) });
          }
        }

        if (results.length === 1) {
          return ok({ nodeId: nodeIds[0], templateId: match.id, templateName: match.name, appliedCategories });
        }
        return ok({ templateId: match.id, templateName: match.name, appliedCategories, updated: results.filter((r) => r.success).length, total: nodeIds.length, results });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const listShotTemplates: AgentTool = {
    name: 'shotTemplate.list',
    description: 'List all available shot templates (built-in + custom).',
    tier: 1,
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Optional search query to filter templates by name (case-insensitive).' },
      },
    },
    async execute(args) {
      try {
        const templates = await deps.listShotTemplates();
        const query = typeof args.query === 'string' ? args.query.toLowerCase() : '';
        const filtered = query ? templates.filter((t) => t.name.toLowerCase().includes(query)) : templates;
        return ok({
          total: filtered.length,
          templates: filtered.map((t) => ({
            id: t.id,
            name: t.name,
            description: t.description,
            builtIn: t.builtIn,
            categories: Object.keys(t.tracks),
            entryCount: Object.values(t.tracks).reduce((sum, track) => sum + (track?.entries.length ?? 0), 0),
          })),
        });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const saveShotTemplate: AgentTool = {
    name: 'shotTemplate.save',
    description:
      'Create or update a custom shot template — a reusable bundle of preset entries across categories. ' +
      'If templateId is provided, update mode: load existing template, patch fields, save. ' +
      'If templateId is omitted, create mode: generate a new template from scratch. ' +
      'Cannot modify built-in templates.',
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        templateId: { type: 'string', description: 'If provided, update the existing template with this ID. If omitted, create a new template.' },
        name: { type: 'string', description: 'Display name for the template. Required for create mode.' },
        description: { type: 'string', description: 'Short description of the shot type.' },
        entries: {
          type: 'array',
          items: {
            type: 'object',
            description: 'A preset entry in the template.',
            properties: {
              category: { type: 'string', description: 'Preset category.', enum: ['camera', 'lens', 'look', 'scene', 'composition', 'emotion', 'flow', 'technical'] },
              presetId: { type: 'string', description: 'The preset ID to include.' },
              intensity: { type: 'number', description: 'Intensity 0-100. Default 75.' },
            },
            required: true,
          },
          description: 'Preset entries to bundle. Required for create mode; replaces all entries in update mode.',
        },
      },
    },
    async execute(args) {
      try {
        const isUpdate = typeof args.templateId === 'string' && args.templateId.length > 0;

        const buildTracksFromEntries = (entries: Array<{ category: string; presetId: string; intensity?: number }>) => {
          const tracks: Partial<Record<PresetCategory, PresetTrack>> = {};
          for (const entry of entries) {
            const cat = entry.category as PresetCategory;
            if (!PRESET_CATEGORIES.includes(cat)) {
              throw new Error(`Invalid category "${entry.category}". Valid: ${PRESET_CATEGORIES.join(', ')}`);
            }
            const intensity = typeof entry.intensity === 'number' ? Math.max(0, Math.min(100, entry.intensity)) : 75;
            if (!tracks[cat]) {
              tracks[cat] = { category: cat, entries: [], intensity };
            }
            tracks[cat]!.entries.push({
              id: `tmpl-${cat}-${crypto.randomUUID().slice(0, 8)}`,
              category: cat,
              presetId: entry.presetId,
              params: {},
              order: tracks[cat]!.entries.length,
              intensity,
            });
          }
          return tracks;
        };

        if (isUpdate) {
          const templateId = requireString(args, 'templateId');
          const templates = await deps.listShotTemplates();
          const existing = templates.find((t) => t.id === templateId);
          if (!existing) throw new Error(`Template "${templateId}" not found.`);
          if (existing.builtIn) throw new Error('Cannot modify built-in templates.');

          const updated = structuredClone(existing);
          if (typeof args.name === 'string') updated.name = args.name;
          if (typeof args.description === 'string') updated.description = args.description;

          if (Array.isArray(args.entries) && args.entries.length > 0) {
            updated.tracks = buildTracksFromEntries(args.entries as Array<{ category: string; presetId: string; intensity?: number }>);
          }

          const saved = await deps.saveShotTemplate(updated);
          return ok({ id: saved.id, name: saved.name, description: saved.description });
        } else {
          const name = requireString(args, 'name');
          const description = requireString(args, 'description');
          const entries = args.entries as Array<{ category: string; presetId: string; intensity?: number }>;
          if (!Array.isArray(entries) || entries.length === 0) {
            throw new Error('entries must be a non-empty array of { category, presetId, intensity? }');
          }

          const tracks = buildTracksFromEntries(entries);

          const template: import('@lucid-fin/contracts').ShotTemplate = {
            id: `custom-tmpl-${crypto.randomUUID()}`,
            name,
            description,
            builtIn: false,
            tracks,
            createdAt: Date.now(),
          };

          const saved = await deps.saveShotTemplate(template);
          return ok({
            id: saved.id,
            name: saved.name,
            description: saved.description,
            categories: Object.keys(saved.tracks),
            entryCount: Object.values(saved.tracks).reduce((sum, track) => sum + (track?.entries.length ?? 0), 0),
          });
        }
      } catch (error) {
        return fail(error);
      }
    },
  };

  const deleteShotTemplate: AgentTool = {
    name: 'shotTemplate.delete',
    description: 'Delete a custom shot template. Cannot delete built-in templates.',
    tier: 3,
    parameters: {
      type: 'object',
      properties: {
        templateId: { type: 'string', description: 'The template ID to delete.' },
      },
      required: ['templateId'],
    },
    async execute(args) {
      try {
        const templateId = requireString(args, 'templateId');
        const templates = await deps.listShotTemplates();
        const existing = templates.find((t) => t.id === templateId);
        if (!existing) throw new Error(`Template "${templateId}" not found.`);
        if (existing.builtIn) throw new Error('Cannot delete built-in templates.');
        await deps.deleteShotTemplate(templateId);
        return ok({ deleted: templateId });
      } catch (error) {
        return fail(error);
      }
    },
  };

  return [
    readNodePresetTracks, writeNodePresetTracks,
    presetEntry,
    applyShotTemplate,
    listShotTemplates, saveShotTemplate, deleteShotTemplate,
  ];
}
