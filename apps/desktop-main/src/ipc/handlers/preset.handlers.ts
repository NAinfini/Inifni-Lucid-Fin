import type { IpcMain } from 'electron';
import log from 'electron-log';
import {
  BUILT_IN_PRESET_LIBRARY,
  type PresetCategory,
  type PresetDefinition,
  type PresetLibraryExportPayload,
  type PresetLibraryExportRequest,
  type PresetLibraryImportPayload,
  type PresetResetRequest,
} from '@lucid-fin/contracts';
import type { SqliteIndex } from '@lucid-fin/storage';
import { getCurrentProjectId } from '../project-context.js';

interface ProjectPresetState {
  builtInOverrides: Map<string, PresetDefinition>;
  userPresets: Map<string, PresetDefinition>;
}

const builtInMap = new Map<string, Readonly<PresetDefinition>>(
  BUILT_IN_PRESET_LIBRARY.map((preset) => [preset.id, Object.freeze(structuredClone(preset))]),
);
const projectCache = new Map<string, ProjectPresetState>();
let _db: SqliteIndex | null = null;

function requireProjectId(): string {
  const projectId = getCurrentProjectId();
  if (!projectId) throw new Error('No project open');
  return projectId;
}

function getProjectState(projectId: string): ProjectPresetState {
  const existing = projectCache.get(projectId);
  if (existing) return existing;
  const created: ProjectPresetState = {
    builtInOverrides: new Map(),
    userPresets: new Map(),
  };
  // Hydrate from SQLite
  if (_db) {
    const overrides = _db.listPresetOverrides(projectId);
    for (const row of overrides) {
      const preset: PresetDefinition = {
        id: row.isUser ? row.id : row.presetId,
        category: row.category as PresetCategory,
        name: row.name,
        description: row.description,
        prompt: row.prompt,
        builtIn: !row.isUser,
        modified: !row.isUser,
        params: row.params as PresetDefinition['params'],
        defaults: row.defaults as Record<string, number | string>,
        projectId,
      };
      if (row.isUser) {
        created.userPresets.set(preset.id, preset);
      } else {
        created.builtInOverrides.set(row.presetId, preset);
      }
    }
  }
  projectCache.set(projectId, created);
  return created;
}

function persistOverride(projectId: string, preset: PresetDefinition, isUser: boolean): void {
  if (!_db) return;
  const now = Date.now();
  _db.upsertPresetOverride({
    id: isUser ? preset.id : `override:${projectId}:${preset.id}`,
    projectId,
    presetId: preset.id,
    category: preset.category,
    name: preset.name,
    description: preset.description ?? '',
    prompt: preset.prompt ?? '',
    params: preset.params as unknown[],
    defaults: preset.defaults as Record<string, unknown>,
    isUser,
    createdAt: now,
    updatedAt: now,
  });
}

function removePersistedOverride(projectId: string, presetId: string, isUser: boolean): void {
  if (!_db) return;
  const id = isUser ? presetId : `override:${projectId}:${presetId}`;
  _db.deletePresetOverride(id);
}

function clonePreset(preset: PresetDefinition): PresetDefinition {
  return structuredClone(preset);
}

function ensurePresetDefinition(input: unknown, opName: string): PresetDefinition {
  if (!input || typeof input !== 'object') {
    throw new Error(`${opName}: preset object is required`);
  }
  const candidate = input as Partial<PresetDefinition>;
  if (typeof candidate.id !== 'string' || !candidate.id.trim()) {
    throw new Error(`${opName}: preset id is required`);
  }
  if (typeof candidate.name !== 'string' || !candidate.name.trim()) {
    throw new Error(`${opName}: preset name is required`);
  }
  if (typeof candidate.category !== 'string' || !candidate.category.trim()) {
    throw new Error(`${opName}: preset category is required`);
  }
  if (typeof candidate.prompt !== 'string' || !candidate.prompt.trim()) {
    throw new Error(`${opName}: preset prompt is required`);
  }
  if (!Array.isArray(candidate.params)) {
    throw new Error(`${opName}: preset params must be an array`);
  }
  if (!candidate.defaults || typeof candidate.defaults !== 'object' || Array.isArray(candidate.defaults)) {
    throw new Error(`${opName}: preset defaults must be an object`);
  }
  return clonePreset(candidate as PresetDefinition);
}

function resolvePresetForProject(
  state: ProjectPresetState,
  projectId: string,
  id: string,
): PresetDefinition | undefined {
  const builtIn = builtInMap.get(id);
  if (builtIn) {
    const override = state.builtInOverrides.get(id);
    const base = clonePreset(builtIn as PresetDefinition);
    if (!override) {
      return {
        ...base,
        projectId,
        modified: false,
      };
    }
    return {
      ...base,
      ...clonePreset(override),
      id: builtIn.id,
      category: builtIn.category,
      builtIn: true,
      projectId,
      modified: true,
      defaultPrompt: builtIn.defaultPrompt ?? builtIn.prompt,
      defaultParams: builtIn.defaultParams ?? builtIn.defaults,
    };
  }
  const userPreset = state.userPresets.get(id);
  if (!userPreset) return undefined;
  return clonePreset(userPreset);
}

function listPresets(
  state: ProjectPresetState,
  projectId: string,
  filter?: {
    includeBuiltIn?: boolean;
    category?: PresetCategory;
  },
): PresetDefinition[] {
  const includeBuiltIn = filter?.includeBuiltIn ?? true;
  const category = filter?.category;
  const result: PresetDefinition[] = [];

  if (includeBuiltIn) {
    for (const preset of BUILT_IN_PRESET_LIBRARY) {
      const resolved = resolvePresetForProject(state, projectId, preset.id);
      if (!resolved) continue;
      if (category && resolved.category !== category) continue;
      result.push(resolved);
    }
  }

  for (const preset of state.userPresets.values()) {
    if (category && preset.category !== category) continue;
    result.push(clonePreset(preset));
  }

  result.sort((a, b) => {
    if (a.category !== b.category) {
      return a.category.localeCompare(b.category);
    }
    return a.name.localeCompare(b.name);
  });

  return result;
}

function savePreset(projectId: string, state: ProjectPresetState, input: PresetDefinition): PresetDefinition {
  const builtIn = builtInMap.get(input.id);
  if (builtIn) {
    const override: PresetDefinition = {
      ...clonePreset(input),
      id: builtIn.id,
      category: builtIn.category,
      builtIn: true,
      projectId,
      modified: true,
      defaultPrompt: builtIn.defaultPrompt ?? builtIn.prompt,
      defaultParams: builtIn.defaultParams ?? builtIn.defaults,
    };
    state.builtInOverrides.set(override.id, override);
    persistOverride(projectId, override, false);
    return clonePreset(override);
  }

  const userPreset: PresetDefinition = {
    ...clonePreset(input),
    builtIn: false,
    modified: false,
    projectId,
  };
  state.userPresets.set(userPreset.id, userPreset);
  persistOverride(projectId, userPreset, true);
  return clonePreset(userPreset);
}

function ensureResetRequest(input: unknown): PresetResetRequest {
  if (!input || typeof input !== 'object') {
    throw new Error('preset:reset request is required');
  }
  const request = input as Partial<PresetResetRequest>;
  if (typeof request.id !== 'string' || !request.id.trim()) {
    throw new Error('preset:reset id is required');
  }
  if (
    request.scope !== undefined &&
    request.scope !== 'all' &&
    request.scope !== 'prompt' &&
    request.scope !== 'params'
  ) {
    throw new Error('preset:reset scope must be one of: all, prompt, params');
  }
  return { id: request.id.trim(), scope: request.scope };
}

function resetPreset(
  state: ProjectPresetState,
  projectId: string,
  request: PresetResetRequest,
): PresetDefinition {
  const base = builtInMap.get(request.id);
  if (!base) {
    throw new Error('preset:reset supports built-in presets only');
  }
  const override = state.builtInOverrides.get(request.id);
  if (!override || request.scope === 'all' || !request.scope) {
    state.builtInOverrides.delete(request.id);
    removePersistedOverride(projectId, request.id, false);
    return {
      ...clonePreset(base as PresetDefinition),
      projectId,
      modified: false,
    };
  }

  if (request.scope === 'prompt') {
    override.prompt = base.prompt;
    override.defaultPrompt = base.defaultPrompt ?? base.prompt;
  }

  if (request.scope === 'params') {
    override.params = clonePreset(base as PresetDefinition).params;
    override.defaults = clonePreset(base as PresetDefinition).defaults;
    override.defaultParams = clonePreset(base as PresetDefinition).defaultParams;
    override.sphericalPositions = clonePreset(base as PresetDefinition).sphericalPositions;
  }

  state.builtInOverrides.set(request.id, override);
  persistOverride(projectId, override, false);
  return resolvePresetForProject(state, projectId, request.id) as PresetDefinition;
}

function ensureImportPayload(input: unknown): PresetLibraryImportPayload {
  if (!input || typeof input !== 'object') {
    throw new Error('preset:import payload is required');
  }
  const payload = input as Partial<PresetLibraryImportPayload>;
  if (!Array.isArray(payload.presets)) {
    throw new Error('preset:import presets array is required');
  }
  return {
    presets: payload.presets.map((preset, index) =>
      ensurePresetDefinition(preset, `preset:import[${index}]`),
    ),
    includeBuiltIn: payload.includeBuiltIn,
    source: payload.source,
  };
}

function ensureExportRequest(input: unknown): PresetLibraryExportRequest | undefined {
  if (input === undefined || input === null) return undefined;
  if (typeof input !== 'object') {
    throw new Error('preset:export request must be an object');
  }
  const request = input as Partial<PresetLibraryExportRequest>;
  if (
    request.categories !== undefined &&
    (!Array.isArray(request.categories) ||
      request.categories.some((category) => typeof category !== 'string'))
  ) {
    throw new Error('preset:export categories must be an array of strings');
  }
  return request as PresetLibraryExportRequest;
}

function exportPayload(
  state: ProjectPresetState,
  projectId: string,
  request?: PresetLibraryExportRequest,
): PresetLibraryExportPayload {
  const includeBuiltIn = request?.includeBuiltIn ?? true;
  const categories = request?.categories;
  const all = listPresets(state, projectId, { includeBuiltIn });

  const filtered =
    categories && categories.length > 0
      ? all.filter((preset) => categories.includes(preset.category))
      : all;

  return {
    version: 1,
    exportedAt: Date.now(),
    presets: filtered,
  };
}

export function registerPresetHandlers(ipcMain: IpcMain, db: SqliteIndex): void {
  _db = db;
  ipcMain.handle('preset:list', async (_event, args?: unknown) => {
    const projectId = requireProjectId();
    const state = getProjectState(projectId);
    const request = (args ?? {}) as Partial<PresetLibraryExportRequest> & {
      category?: PresetCategory;
    };
    return listPresets(state, projectId, {
      includeBuiltIn: request.includeBuiltIn,
      category: request.category,
    });
  });

  ipcMain.handle('preset:save', async (_event, args: unknown) => {
    const projectId = requireProjectId();
    const state = getProjectState(projectId);
    const preset = ensurePresetDefinition(args, 'preset:save');
    const saved = savePreset(projectId, state, preset);
    log.info('[preset] saved', { id: saved.id, category: saved.category, builtIn: saved.builtIn });
    return saved;
  });

  ipcMain.handle('preset:delete', async (_event, args: unknown) => {
    const projectId = requireProjectId();
    const state = getProjectState(projectId);
    if (!args || typeof args !== 'object' || typeof (args as { id?: unknown }).id !== 'string') {
      throw new Error('preset:delete id is required');
    }
    const id = (args as { id: string }).id.trim();
    if (!id) throw new Error('preset:delete id is required');

    if (builtInMap.has(id)) {
      state.builtInOverrides.delete(id);
      removePersistedOverride(projectId, id, false);
      return;
    }
    if (!state.userPresets.has(id)) {
      throw new Error(`preset:delete preset not found: ${id}`);
    }
    state.userPresets.delete(id);
    removePersistedOverride(projectId, id, true);
  });

  ipcMain.handle('preset:reset', async (_event, args: unknown) => {
    const projectId = requireProjectId();
    const state = getProjectState(projectId);
    const request = ensureResetRequest(args);
    const reset = resetPreset(state, projectId, request);
    log.info('[preset] reset', { id: reset.id, scope: request.scope ?? 'all' });
    return reset;
  });

  ipcMain.handle('preset:import', async (_event, args: unknown) => {
    const projectId = requireProjectId();
    const state = getProjectState(projectId);
    const payload = ensureImportPayload(args);
    for (const preset of payload.presets) {
      savePreset(projectId, state, preset);
    }
    return exportPayload(state, projectId, {
      includeBuiltIn: payload.includeBuiltIn ?? true,
    });
  });

  ipcMain.handle('preset:export', async (_event, args?: unknown) => {
    const projectId = requireProjectId();
    const state = getProjectState(projectId);
    const request = ensureExportRequest(args);
    return exportPayload(state, projectId, request);
  });
}
