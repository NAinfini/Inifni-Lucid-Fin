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

  // ---------------------------------------------------------------------------
  // canvas.writeNodePresetTracks — single-category preset track write
  // ---------------------------------------------------------------------------

  const writeNodePresetTracks: AgentTool = {
    name: 'canvas.writeNodePresetTracks',
    description:
      'Set or modify preset entries and intensity for a single category on an image or video node. ' +
      'Provide "category", optional "intensity" (0-100), and optional "entries" array. ' +
      'For writing multiple categories at once, use canvas.writePresetTracksBatch.',
    context: CANVAS_CONTEXT,
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        nodeId: { type: 'string', description: 'The node ID to update.' },
        category: {
          type: 'string',
          description: 'The preset category to modify.',
          enum: [
            'camera', 'lens', 'look', 'scene',
            'composition', 'emotion', 'flow', 'technical',
          ],
        },
        intensity: {
          type: 'number',
          description: 'Category-level intensity (0-100).',
        },
        entries: {
          type: 'array',
          description: 'Replacement entries for this category.',
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
      },
      required: ['canvasId', 'nodeId', 'category'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const nodeId = requireString(args, 'nodeId');
        const category = requirePresetCategory(args);

        const { node } = await requireNode(deps, canvasId, nodeId);
        if (node.type !== 'image' && node.type !== 'video') {
          throw new Error(`Node type "${node.type}" does not support presets`);
        }

        const existing =
          (node.data as { presetTracks?: PresetTrackSet }).presetTracks ??
          createEmptyPresetTrackSet();
        const trackSet = structuredClone(existing) as TrackMap;

        const track = trackSet[category] ?? { category, entries: [] };

        const categoryIntensity = clampIntensity(args.intensity);
        if (categoryIntensity !== undefined) {
          track.intensity = categoryIntensity;
        }

        if (Array.isArray(args.entries)) {
          const rawEntries = args.entries as Array<Record<string, unknown>>;
          const entries: Array<PresetTrackEntry> = rawEntries.map((raw, idx) => {
            const presetId = typeof raw.presetId === 'string' ? raw.presetId.trim() : '';
            if (!presetId) throw new Error(`entries[${idx}].presetId is required`);
            return {
              id: crypto.randomUUID(),
              category,
              presetId,
              params: {},
              order: idx,
              intensity: clampIntensity(raw.intensity),
              direction: parseOptionalCameraDirection(raw.direction),
            };
          });
          track.entries = entries;
        }

        trackSet[category] = track;
        await deps.setNodePresets(canvasId, nodeId, trackSet as PresetTrackSet);

        return ok({ nodeId, category, track });
      } catch (error) {
        return fail(error);
      }
    },
  };

  // ---------------------------------------------------------------------------
  // canvas.writePresetTracksBatch — multi-category preset track write
  // ---------------------------------------------------------------------------

  const writePresetTracksBatch: AgentTool = {
    name: 'canvas.writePresetTracksBatch',
    description:
      'Set or modify preset entries and intensity for multiple categories on an image or video node in one call. ' +
      'Provide "tracks" object keyed by category name, each with optional "intensity" (0-100) and optional "entries" array.',
    context: CANVAS_CONTEXT,
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        nodeId: { type: 'string', description: 'The node ID to update.' },
        tracks: {
          type: 'object',
          description:
            'Object keyed by category name. Each value has optional "intensity" (0-100) and optional "entries" array.',
        },
      },
      required: ['canvasId', 'nodeId', 'tracks'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const nodeId = requireString(args, 'nodeId');

        if (args.tracks == null || typeof args.tracks !== 'object' || Array.isArray(args.tracks)) {
          throw new Error('tracks must be an object keyed by category name.');
        }

        const { node } = await requireNode(deps, canvasId, nodeId);
        if (node.type !== 'image' && node.type !== 'video') {
          throw new Error(`Node type "${node.type}" does not support presets`);
        }

        const existing =
          (node.data as { presetTracks?: PresetTrackSet }).presetTracks ??
          createEmptyPresetTrackSet();
        const trackSet = structuredClone(existing) as TrackMap;

        const tracksObj = args.tracks as Record<string, Record<string, unknown>>;
        const validCategories = new Set(PRESET_CATEGORIES as readonly string[]);
        const results: Array<{ category: string; track: PresetTrack }> = [];

        for (const [cat, val] of Object.entries(tracksObj)) {
          if (!validCategories.has(cat)) {
            throw new Error(`Invalid category "${cat}". Valid: ${PRESET_CATEGORIES.join(', ')}`);
          }
          const category = cat as PresetCategory;
          const track = trackSet[category] ?? { category, entries: [] };

          const categoryIntensity = clampIntensity(val?.intensity);
          if (categoryIntensity !== undefined) {
            track.intensity = categoryIntensity;
          }

          if (Array.isArray(val?.entries)) {
            const rawEntries = val.entries as Array<Record<string, unknown>>;
            const entries: Array<PresetTrackEntry> = rawEntries.map((raw, idx) => {
              const presetId = typeof raw.presetId === 'string' ? raw.presetId.trim() : '';
              if (!presetId) throw new Error(`${category}.entries[${idx}].presetId is required`);
              return {
                id: crypto.randomUUID(),
                category,
                presetId,
                params: {},
                order: idx,
                intensity: clampIntensity(raw.intensity),
                direction: parseOptionalCameraDirection(raw.direction),
              };
            });
            track.entries = entries;
          }

          trackSet[category] = track;
          results.push({ category, track });
        }

        if (results.length === 0) {
          throw new Error('tracks object must contain at least one category.');
        }

        await deps.setNodePresets(canvasId, nodeId, trackSet as PresetTrackSet);

        return ok({ nodeId, tracks: results });
      } catch (error) {
        return fail(error);
      }
    },
  };

  // ---------------------------------------------------------------------------
  // canvas.addPresetEntry — add a preset entry to a track
  // ---------------------------------------------------------------------------

  const addPresetEntry: AgentTool = {
    name: 'canvas.addPresetEntry',
    description: 'Add a preset entry to a specific preset track on image/video nodes. Supports batch via nodeIds.',
    context: CANVAS_CONTEXT,
    tier: 3,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        nodeId: { type: 'string', description: 'Single node ID to update.' },
        nodeIds: { type: 'array', items: { type: 'string', description: 'Node ID.' }, description: 'Batch: array of node IDs.' },
        category: {
          type: 'string',
          description: 'The preset category.',
          enum: [...PRESET_CATEGORIES],
        },
        presetId: { type: 'string', description: 'The preset definition ID to add.' },
        intensity: { type: 'number', description: 'Optional entry-level intensity (0-100).' },
      },
      required: ['canvasId', 'category', 'presetId'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const category = requirePresetCategory(args);
        const presetId = requireString(args, 'presetId');
        const nodeIds = Array.isArray(args.nodeIds) && args.nodeIds.length > 0
          ? (args.nodeIds as string[]).map(String)
          : [requireString(args, 'nodeId')];

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
      } catch (error) {
        return fail(error);
      }
    },
  };

  // ---------------------------------------------------------------------------
  // canvas.removePresetEntry — remove a preset entry from a track
  // ---------------------------------------------------------------------------

  const removePresetEntry: AgentTool = {
    name: 'canvas.removePresetEntry',
    description: 'Remove a preset entry from a preset track by entry ID.',
    context: CANVAS_CONTEXT,
    tier: 3,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        nodeId: { type: 'string', description: 'The node ID to update.' },
        category: {
          type: 'string',
          description: 'The preset category.',
          enum: [...PRESET_CATEGORIES],
        },
        entryId: { type: 'string', description: 'The preset track entry ID to remove.' },
      },
      required: ['canvasId', 'nodeId', 'category', 'entryId'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const nodeId = requireString(args, 'nodeId');
        const category = requirePresetCategory(args);
        const entryId = requireString(args, 'entryId');
        const { node } = await requireNode(deps, canvasId, nodeId);
        const trackSet = clonePresetTrackSet(node);
        const track = trackSet[category];
        requirePresetTrackEntry(track, entryId);
        track.entries = track.entries.filter((entry) => entry.id !== entryId);
        normalizeTrackOrders(track);
        await deps.setNodePresets(canvasId, nodeId, trackSet as PresetTrackSet);
        return ok({ nodeId, category, entryId });
      } catch (error) {
        return fail(error);
      }
    },
  };

  // ---------------------------------------------------------------------------
  // canvas.updatePresetEntry — update fields on an existing preset entry
  // ---------------------------------------------------------------------------

  const updatePresetEntry: AgentTool = {
    name: 'canvas.updatePresetEntry',
    description: 'Update fields on an existing preset entry (intensity, presetId, direction).',
    context: CANVAS_CONTEXT,
    tier: 3,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        nodeId: { type: 'string', description: 'The node ID to update.' },
        category: {
          type: 'string',
          description: 'The preset category.',
          enum: [...PRESET_CATEGORIES],
        },
        entryId: { type: 'string', description: 'The preset track entry ID to update.' },
        changes: {
          type: 'object',
          description: 'Changes to apply.',
          properties: {
            intensity: { type: 'number', description: 'Entry-level intensity (0-100).' },
            presetId: { type: 'string', description: 'Replacement preset ID.' },
            direction: { type: 'string', description: 'Camera direction.' },
          },
        },
      },
      required: ['canvasId', 'nodeId', 'category', 'entryId', 'changes'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const nodeId = requireString(args, 'nodeId');
        const category = requirePresetCategory(args);
        const entryId = requireString(args, 'entryId');
        const changes = requirePresetTrackEntryChanges(args);
        const { node } = await requireNode(deps, canvasId, nodeId);
        const trackSet = clonePresetTrackSet(node);
        const track = trackSet[category];
        const entry = requirePresetTrackEntry(track, entryId);

        if (changes.intensity !== undefined) entry.intensity = changes.intensity;
        if (changes.presetId !== undefined) entry.presetId = changes.presetId;
        if (changes.direction !== undefined) entry.direction = changes.direction;

        normalizeTrackOrders(track);
        await deps.setNodePresets(canvasId, nodeId, trackSet as PresetTrackSet);
        return ok({ nodeId, category, entryId });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const applyShotTemplate: AgentTool = {
    name: 'canvas.applyShotTemplate',
    description: `Apply shot templates to image/video nodes. Two modes:
1. Same template for multiple nodes: use nodeId/nodeIds + templateName.
2. Different templates per node: use "nodes": [{ nodeId, templateName }, ...] — preferred for efficiency when each node needs a different template.
Overwrites preset tracks defined in the template; leaves other categories unchanged.`,
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
          description: 'The template name to search for (case-insensitive partial match). Used with nodeId/nodeIds.',
        },
        nodes: {
          type: 'array',
          description: 'Per-node template assignments with different templates. Each entry has nodeId + templateName.',
          items: {
            type: 'object',
            description: 'A per-node template assignment.',
            properties: {
              nodeId: { type: 'string', description: 'Node ID.' },
              templateName: { type: 'string', description: 'Template name for this node (case-insensitive partial match).' },
            },
          },
        },
      },
      required: ['canvasId'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const templates = await deps.listShotTemplates();

        function findTemplate(name: string) {
          const lower = name.toLowerCase();
          return (
            templates.find((t) => t.name.toLowerCase() === lower) ??
            templates.find((t) => t.name.toLowerCase().includes(lower))
          );
        }

        // Build work items: either from "nodes" array or from nodeId/nodeIds + templateName
        type TemplateWorkItem = { nodeId: string; templateName: string };
        let workItems: TemplateWorkItem[];

        if (Array.isArray(args.nodes) && args.nodes.length > 0) {
          workItems = (args.nodes as Array<Record<string, unknown>>).map((entry) => ({
            nodeId: String(entry.nodeId ?? ''),
            templateName: String(entry.templateName ?? ''),
          }));
        } else {
          const nodeIds = Array.isArray(args.nodeIds) && args.nodeIds.length > 0
            ? (args.nodeIds as string[]).map(String)
            : [requireString(args, 'nodeId')];
          const templateName = requireString(args, 'templateName');
          workItems = nodeIds.map((id) => ({ nodeId: id, templateName }));
        }

        const results: Array<{ nodeId: string; success: boolean; templateName?: string; templateId?: string; appliedCategories?: string[]; error?: string }> = [];

        for (const { nodeId, templateName } of workItems) {
          try {
            const match = findTemplate(templateName);
            if (!match) {
              results.push({ nodeId, success: false, error: `Shot template "${templateName}" not found. Available: ${templates.map((t) => t.name).join(', ')}` });
              continue;
            }

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
            const appliedCategories = Object.keys(match.tracks).filter((k) => match.tracks[k as PresetCategory]);
            results.push({ nodeId, success: true, templateName: match.name, templateId: match.id, appliedCategories });
          } catch (error) {
            results.push({ nodeId, success: false, error: error instanceof Error ? error.message : String(error) });
          }
        }

        if (results.length === 1) {
          const r = results[0];
          if (!r.success) return fail(r.error!);
          return ok({ nodeId: r.nodeId, templateId: r.templateId, templateName: r.templateName, appliedCategories: r.appliedCategories });
        }
        return ok({ updated: results.filter((r) => r.success).length, total: workItems.length, results });
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

  // ---------------------------------------------------------------------------
  // Helper: build tracks from entries array
  // ---------------------------------------------------------------------------

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

  // ---------------------------------------------------------------------------
  // shotTemplate.create — create a new custom shot template
  // ---------------------------------------------------------------------------

  const createShotTemplate: AgentTool = {
    name: 'shotTemplate.create',
    description: 'Create a new custom shot template — a reusable bundle of preset entries across categories.',
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Display name for the template.' },
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
          description: 'Preset entries to bundle.',
        },
      },
      required: ['name', 'description', 'entries'],
    },
    async execute(args) {
      try {
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
      } catch (error) {
        return fail(error);
      }
    },
  };

  // ---------------------------------------------------------------------------
  // shotTemplate.update — update an existing custom shot template
  // ---------------------------------------------------------------------------

  const updateShotTemplate: AgentTool = {
    name: 'shotTemplate.update',
    description: 'Update an existing custom shot template. Cannot modify built-in templates.',
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        templateId: { type: 'string', description: 'The template ID to update.' },
        name: { type: 'string', description: 'New display name.' },
        description: { type: 'string', description: 'New description.' },
        entries: {
          type: 'array',
          items: {
            type: 'object',
            description: 'A preset entry.',
            properties: {
              category: { type: 'string', description: 'Preset category.', enum: ['camera', 'lens', 'look', 'scene', 'composition', 'emotion', 'flow', 'technical'] },
              presetId: { type: 'string', description: 'The preset ID.' },
              intensity: { type: 'number', description: 'Intensity 0-100. Default 75.' },
            },
            required: true,
          },
          description: 'Replacement preset entries (replaces all existing entries).',
        },
      },
      required: ['templateId'],
    },
    async execute(args) {
      try {
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
    readNodePresetTracks, writeNodePresetTracks, writePresetTracksBatch,
    addPresetEntry, removePresetEntry, updatePresetEntry,
    applyShotTemplate,
    listShotTemplates, createShotTemplate, updateShotTemplate, deleteShotTemplate,
  ];
}
