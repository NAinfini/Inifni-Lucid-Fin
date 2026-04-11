import { describe, expect, it, vi } from "vitest";
import { BUILT_IN_PRESET_LIBRARY } from "@lucid-fin/contracts";

const logger = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: vi.fn(),
}));

const getCurrentProjectId = vi.hoisted(() => vi.fn(() => "preset-project-default"));

vi.mock("../../logger.js", () => ({
  default: logger,
  debug: logger.debug,
  info: logger.info,
  warn: logger.warn,
  error: logger.error,
  fatal: logger.fatal,
}));

vi.mock("../project-context.js", () => ({
  getCurrentProjectId,
}));

import { registerPresetHandlers } from "./preset.handlers.js";

const builtInPreset =
  BUILT_IN_PRESET_LIBRARY.find((preset) => preset.category === "look") ??
  BUILT_IN_PRESET_LIBRARY[0];
const alternateBuiltInPreset =
  BUILT_IN_PRESET_LIBRARY.find((preset) => preset.category !== builtInPreset.category) ??
  BUILT_IN_PRESET_LIBRARY[1];

function resetCommon(projectId: string) {
  vi.clearAllMocks();
  getCurrentProjectId.mockReset();
  getCurrentProjectId.mockReturnValue(projectId);
}

function makeUserPreset(id: string, category = "look") {
  return {
    id,
    category,
    name: `User ${id}`,
    description: `Description for ${id}`,
    prompt: `Prompt for ${id}`,
    builtIn: false,
    modified: false,
    params: [],
    defaults: {},
  };
}

function makeDb(overrides?: Array<Record<string, unknown>>) {
  return {
    listPresetOverrides: vi.fn(() => overrides ?? []),
    upsertPresetOverride: vi.fn(),
    deletePresetOverride: vi.fn(),
  };
}

function registerHandlers(db: Record<string, unknown>) {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();

  registerPresetHandlers(
    {
      handle(channel: string, handler: (...args: unknown[]) => unknown) {
        handlers.set(channel, handler);
      },
    } as never,
    db as never,
  );

  return handlers;
}

describe("registerPresetHandlers", () => {
  it("registers all preset IPC handlers", () => {
    resetCommon("preset-project-register");
    const handlers = registerHandlers(makeDb());

    expect([...handlers.keys()].sort()).toEqual([
      "preset:delete",
      "preset:export",
      "preset:import",
      "preset:list",
      "preset:reset",
      "preset:save",
    ]);
  });

  it("requires an open project before listing presets", async () => {
    resetCommon("preset-project-list");
    getCurrentProjectId.mockReturnValue(null);
    const handlers = registerHandlers(makeDb());

    await expect(handlers.get("preset:list")?.({})).rejects.toThrow("No project open");
  });

  it("saves a built-in preset override, persists it as a non-user override, and logs the save", async () => {
    const projectId = "preset-project-override";
    resetCommon(projectId);
    const db = makeDb();
    const handlers = registerHandlers(db);
    const save = handlers.get("preset:save");

    const result = await save?.({}, {
      ...builtInPreset,
      name: `${builtInPreset.name} Custom`,
      prompt: `${builtInPreset.prompt} plus custom detail`,
      defaults: { ...builtInPreset.defaults, intensity: 0.5 },
      params: [...builtInPreset.params],
    });

    expect(result).toEqual(
      expect.objectContaining({
        id: builtInPreset.id,
        builtIn: true,
        modified: true,
        projectId,
        defaultPrompt: builtInPreset.defaultPrompt ?? builtInPreset.prompt,
        defaultParams: builtInPreset.defaultParams ?? builtInPreset.defaults,
      }),
    );
    expect(db.upsertPresetOverride).toHaveBeenCalledWith(
      expect.objectContaining({
        id: `override:${projectId}:${builtInPreset.id}`,
        projectId,
        presetId: builtInPreset.id,
        isUser: false,
      }),
    );
    expect(logger.info).toHaveBeenCalledWith(
      "[preset] saved",
      expect.objectContaining({
        id: builtInPreset.id,
        category: builtInPreset.category,
        builtIn: true,
      }),
    );
  });

  it("saves and deletes a user preset via sqlite user override records", async () => {
    const projectId = "preset-project-user";
    resetCommon(projectId);
    const db = makeDb();
    const handlers = registerHandlers(db);
    const save = handlers.get("preset:save");
    const remove = handlers.get("preset:delete");
    const payload = makeUserPreset("user-preset-1");

    const saved = await save?.({}, payload);
    await expect(remove?.({}, { id: "user-preset-1" })).resolves.toBeUndefined();

    expect(saved).toEqual(
      expect.objectContaining({
        id: "user-preset-1",
        builtIn: false,
        modified: false,
        projectId,
      }),
    );
    expect(db.upsertPresetOverride).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "user-preset-1",
        projectId,
        presetId: "user-preset-1",
        isUser: true,
      }),
    );
    expect(db.deletePresetOverride).toHaveBeenCalledWith("user-preset-1");
  });

  it("resets prompt-only built-in overrides without deleting the whole override", async () => {
    const projectId = "preset-project-reset-prompt";
    resetCommon(projectId);
    const db = makeDb();
    const handlers = registerHandlers(db);
    const save = handlers.get("preset:save");
    const reset = handlers.get("preset:reset");

    await save?.({}, {
      ...builtInPreset,
      prompt: "custom prompt",
      defaults: { ...builtInPreset.defaults, custom: "yes" },
      params: [...builtInPreset.params],
    });

    const result = await reset?.({}, { id: builtInPreset.id, scope: "prompt" });

    expect(result).toEqual(
      expect.objectContaining({
        id: builtInPreset.id,
        prompt: builtInPreset.prompt,
        modified: true,
      }),
    );
    expect(db.deletePresetOverride).not.toHaveBeenCalled();
    expect(db.upsertPresetOverride).toHaveBeenCalledTimes(2);
    expect(logger.info).toHaveBeenCalledWith(
      "[preset] reset",
      expect.objectContaining({
        id: builtInPreset.id,
        scope: "prompt",
      }),
    );
  });

  it("hydrates existing built-in overrides and user presets from sqlite and filters preset lists", async () => {
    const projectId = "preset-project-hydrate";
    resetCommon(projectId);
    const db = makeDb([
      {
        id: `override:${projectId}:${builtInPreset.id}`,
        projectId,
        presetId: builtInPreset.id,
        category: builtInPreset.category,
        name: `${builtInPreset.name} Override`,
        description: builtInPreset.description,
        prompt: "override prompt",
        params: builtInPreset.params,
        defaults: builtInPreset.defaults,
        isUser: false,
      },
      {
        id: "user-hydrated-1",
        projectId,
        presetId: "user-hydrated-1",
        category: alternateBuiltInPreset.category,
        name: "Hydrated User",
        description: "hydrated",
        prompt: "hydrated prompt",
        params: [],
        defaults: {},
        isUser: true,
      },
    ]);
    const handlers = registerHandlers(db);
    const list = handlers.get("preset:list");

    const lookPresets = await list?.({}, {
      category: builtInPreset.category,
      includeBuiltIn: true,
    });
    const userOnly = await list?.({}, {
      includeBuiltIn: false,
      category: alternateBuiltInPreset.category,
    });

    expect(lookPresets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: builtInPreset.id,
          modified: true,
          prompt: "override prompt",
        }),
      ]),
    );
    expect(userOnly).toEqual([
      expect.objectContaining({
        id: "user-hydrated-1",
        builtIn: false,
      }),
    ]);
  });

  it("imports preset payloads and exports filtered libraries", async () => {
    const projectId = "preset-project-import-export";
    resetCommon(projectId);
    const db = makeDb();
    const handlers = registerHandlers(db);
    const importPresets = handlers.get("preset:import");
    const exportPresets = handlers.get("preset:export");

    const imported = await importPresets?.({}, {
      presets: [
        makeUserPreset("user-imported-1", builtInPreset.category),
        makeUserPreset("user-imported-2", alternateBuiltInPreset.category),
      ],
      includeBuiltIn: false,
      source: "file",
    });

    const exported = await exportPresets?.({}, {
      includeBuiltIn: false,
      categories: [builtInPreset.category],
    });

    expect(imported).toEqual(
      expect.objectContaining({
        version: 1,
        presets: expect.arrayContaining([
          expect.objectContaining({ id: "user-imported-1" }),
          expect.objectContaining({ id: "user-imported-2" }),
        ]),
      }),
    );
    expect(exported).toEqual(
      expect.objectContaining({
        version: 1,
        presets: [expect.objectContaining({ id: "user-imported-1", category: builtInPreset.category })],
      }),
    );
    expect(db.upsertPresetOverride).toHaveBeenCalledTimes(2);
  });

  it("rejects invalid delete, reset, import, and export payloads", async () => {
    const projectId = "preset-project-errors";
    resetCommon(projectId);
    const handlers = registerHandlers(makeDb());

    await expect(handlers.get("preset:delete")?.({}, { id: "" })).rejects.toThrow(
      "preset:delete id is required",
    );
    await expect(
      handlers.get("preset:reset")?.({}, { id: builtInPreset.id, scope: "wrong" }),
    ).rejects.toThrow("preset:reset scope must be one of: all, prompt, params");
    await expect(handlers.get("preset:import")?.({}, { presets: {} })).rejects.toThrow(
      "preset:import presets array is required",
    );
    await expect(handlers.get("preset:export")?.({}, "bad-request")).rejects.toThrow(
      "preset:export request must be an object",
    );
  });
});
