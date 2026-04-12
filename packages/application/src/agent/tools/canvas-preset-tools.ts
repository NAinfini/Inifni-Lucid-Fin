import {
  PRESET_CATEGORIES,
  createEmptyPresetTrackSet,
  type PresetCategory,
  type PresetDefinition,
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
  requireMoveDirection,
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
      'Set or modify preset entries and intensity for a specific category on an image or video node. ' +
      'Provide "intensity" (0-100) to set category-level intensity. ' +
      'Provide "entries" to replace the category entries (each entry needs presetId, optional intensity 0-100, optional direction).',
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
          description: 'Category-level intensity (0-100). Controls overall strength of this category.',
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
        const track = trackSet[category] ?? {
          category,
          entries: [],
        };

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

  const addPresetTrackEntry: AgentTool = {
    name: 'canvas.addPresetTrackEntry',
    description: 'Add a preset entry to a specific preset track on image/video nodes. Supports batch: pass nodeIds array to apply the same preset to multiple nodes at once.',
    context: CANVAS_CONTEXT,
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        nodeId: { type: 'string', description: 'Single node ID to update.' },
        nodeIds: { type: 'array', items: { type: 'string', description: 'Node ID.' }, description: 'Batch: array of node IDs to update with the same preset.' },
        category: {
          type: 'string',
          description: 'The preset category to modify.',
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
        const nodeIds = Array.isArray(args.nodeIds) && args.nodeIds.length > 0
          ? (args.nodeIds as string[]).map(String)
          : [requireString(args, 'nodeId')];
        const category = requirePresetCategory(args);
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
      } catch (error) {
        return fail(error);
      }
    },
  };

  const removePresetTrackEntry: AgentTool = {
    name: 'canvas.removePresetTrackEntry',
    description: 'Remove a single preset entry from a specific preset track on an image or video node.',
    context: CANVAS_CONTEXT,
    tier: 3,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        nodeId: { type: 'string', description: 'The node ID to update.' },
        category: {
          type: 'string',
          description: 'The preset category to modify.',
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

  const updatePresetTrackEntry: AgentTool = {
    name: 'canvas.updatePresetTrackEntry',
    description: 'Update fields on a single preset entry within a specific preset track.',
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
          enum: [...PRESET_CATEGORIES],
        },
        entryId: { type: 'string', description: 'The preset track entry ID to update.' },
        changes: {
          type: 'object',
          description: 'Changes to apply to the preset track entry.',
          properties: {
            intensity: { type: 'number', description: 'Optional entry-level intensity (0-100).' },
            presetId: { type: 'string', description: 'Optional replacement preset ID.' },
            direction: { type: 'string', description: 'Optional camera direction.' },
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
      } catch (error) {
        return fail(error);
      }
    },
  };

  const movePresetTrackEntry: AgentTool = {
    name: 'canvas.movePresetTrackEntry',
    description: 'Move a single preset entry up or down within a specific preset track.',
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
          enum: [...PRESET_CATEGORIES],
        },
        entryId: { type: 'string', description: 'The preset track entry ID to move.' },
        direction: {
          type: 'string',
          description: 'The move direction.',
          enum: ['up', 'down'],
        },
      },
      required: ['canvasId', 'nodeId', 'category', 'entryId', 'direction'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const nodeId = requireString(args, 'nodeId');
        const category = requirePresetCategory(args);
        const entryId = requireString(args, 'entryId');
        const direction = requireMoveDirection(args);
        const { node } = await requireNode(deps, canvasId, nodeId);
        const trackSet = clonePresetTrackSet(node);
        const track = trackSet[category];
        requirePresetTrackEntry(track, entryId);

        const index = track.entries.findIndex((entry) => entry.id === entryId);
        const targetIndex = direction === 'up' ? index - 1 : index + 1;
        if (targetIndex >= 0 && targetIndex < track.entries.length) {
          const [entry] = track.entries.splice(index, 1);
          track.entries.splice(targetIndex, 0, entry);
        }

        normalizeTrackOrders(track);
        await deps.setNodePresets(canvasId, nodeId, trackSet as PresetTrackSet);
        return ok({ nodeId, category, entryId, direction });
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

  const autoFillEmptyTracks: AgentTool = {
    name: 'canvas.autoFillEmptyTracks',
    description:
      'Analyze an image or video node and return its context (prompt, characters, locations) plus a list of empty preset categories. ' +
      'Use this to understand what the node needs, then call canvas.writeNodePresetTracks for each category you want to fill.',
    context: CANVAS_CONTEXT,
    tier: 1,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        nodeId: { type: 'string', description: 'The node ID to analyze.' },
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

        const data = node.data as {
          prompt?: string;
          characterRefs?: Array<{ characterId: string; loadoutId?: string }>;
          locationRefs?: Array<{ locationId: string }>;
          presetTracks?: PresetTrackSet;
        };

        const tracks = data.presetTracks ?? createEmptyPresetTrackSet();
        const emptyCategories: PresetCategory[] = [];
        const filledCategories: PresetCategory[] = [];

        for (const cat of PRESET_CATEGORIES) {
          const track = (tracks as TrackMap)[cat];
          if (!track || track.entries.length === 0) {
            emptyCategories.push(cat);
          } else {
            filledCategories.push(cat);
          }
        }

        return ok({
          nodeId,
          nodeType: node.type,
          title: node.title,
          prompt: data.prompt ?? '',
          characterRefs: data.characterRefs ?? [],
          locationRefs: data.locationRefs ?? [],
          emptyCategories,
          filledCategories,
          currentTracks: tracks,
        });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const createCustomPreset: AgentTool = {
    name: 'canvas.createCustomPreset',
    description:
      'Create a new custom preset definition in the project library. The preset becomes available for use on any node.',
    context: CANVAS_CONTEXT,
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Display name for the preset (e.g., "Shaky Handheld").' },
        category: {
          type: 'string',
          description: 'The preset category.',
          enum: [
            'camera', 'lens', 'look', 'scene',
            'composition', 'emotion', 'flow', 'technical',
          ],
        },
        description: { type: 'string', description: 'Short description of the visual effect.' },
        prompt: {
          type: 'string',
          description: 'The prompt fragment that describes the visual effect for AI generation.',
        },
      },
      required: ['name', 'category', 'description', 'prompt'],
    },
    async execute(args) {
      try {
        const name = requireString(args, 'name');
        const category = requirePresetCategory(args);
        const description = requireString(args, 'description');
        const prompt = requireString(args, 'prompt');

        const preset: PresetDefinition = {
          id: `custom-${crypto.randomUUID()}`,
          category,
          name,
          description,
          prompt,
          builtIn: false,
          modified: false,
          params: [],
          defaults: {},
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };

        const saved = await deps.savePreset(preset);
        return ok(saved);
      } catch (error) {
        return fail(error);
      }
    },
  };

  return [
    readNodePresetTracks, writeNodePresetTracks,
    addPresetTrackEntry, removePresetTrackEntry, updatePresetTrackEntry, movePresetTrackEntry,
    applyShotTemplate, autoFillEmptyTracks, createCustomPreset,
  ];
}
