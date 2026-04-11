import { describe, expect, it, vi } from "vitest";

const getCurrentProjectId = vi.hoisted(() => vi.fn(() => "project-1"));
const randomUUID = vi.hoisted(() => vi.fn(() => "char-generated"));

vi.mock("../project-context.js", () => ({
  getCurrentProjectId,
}));

vi.mock("node:crypto", () => ({
  randomUUID,
}));

import { registerCharacterHandlers } from "./character.handlers.js";

function resetCommon() {
  vi.clearAllMocks();
  getCurrentProjectId.mockReset();
  getCurrentProjectId.mockReturnValue("project-1");
  randomUUID.mockReset();
  randomUUID.mockReturnValue("char-generated");
}

function makeCharacter(overrides?: Record<string, unknown>) {
  return {
    id: "char-1",
    projectId: "project-1",
    name: "Hero",
    role: "protagonist",
    description: "desc",
    appearance: "appearance",
    personality: "personality",
    referenceImage: "hash-ref",
    costumes: [],
    tags: ["hero"],
    age: 28,
    gender: "female",
    voice: "alto",
    referenceImages: [{ slot: "front", assetHash: "hash-front", isStandard: true }],
    loadouts: [{ id: "loadout-1", name: "Default", equipmentIds: ["eq-1"] }],
    defaultLoadoutId: "loadout-1",
    createdAt: 100,
    updatedAt: 200,
    ...overrides,
  };
}

function registerHandlers(db?: Record<string, unknown>) {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();

  registerCharacterHandlers(
    {
      handle(channel: string, handler: (...args: unknown[]) => unknown) {
        handlers.set(channel, handler);
      },
    } as never,
    (db ?? {
      listCharacters: vi.fn(),
      getCharacter: vi.fn(),
      upsertCharacter: vi.fn(),
      deleteCharacter: vi.fn(),
    }) as never,
  );

  return handlers;
}

describe("registerCharacterHandlers", () => {
  it("registers all character IPC handlers", () => {
    resetCommon();
    const handlers = registerHandlers();

    expect([...handlers.keys()].sort()).toEqual([
      "character:delete",
      "character:deleteLoadout",
      "character:get",
      "character:list",
      "character:removeRefImage",
      "character:save",
      "character:saveLoadout",
      "character:setRefImage",
    ]);
  });

  it("requires an open project to list characters", async () => {
    resetCommon();
    getCurrentProjectId.mockReturnValue(null);
    const db = {
      listCharacters: vi.fn(),
      getCharacter: vi.fn(),
      upsertCharacter: vi.fn(),
      deleteCharacter: vi.fn(),
    };
    const handlers = registerHandlers(db);
    const list = handlers.get("character:list");

    await expect(list?.({})).rejects.toThrow("No project open");
    expect(db.listCharacters).not.toHaveBeenCalled();
  });

  it("loads a character by id and rejects missing records", async () => {
    resetCommon();
    const db = {
      listCharacters: vi.fn(),
      getCharacter: vi.fn((id: string) => (id === "char-1" ? makeCharacter() : undefined)),
      upsertCharacter: vi.fn(),
      deleteCharacter: vi.fn(),
    };
    const handlers = registerHandlers(db);
    const get = handlers.get("character:get");

    await expect(get?.({}, { id: "char-1" })).resolves.toEqual(makeCharacter());
    await expect(get?.({}, { id: "missing" })).rejects.toThrow("Character not found: missing");
  });

  it("creates a new character with normalized fields and sqlite payload mapping", async () => {
    resetCommon();
    const db = {
      listCharacters: vi.fn(),
      getCharacter: vi.fn(() => undefined),
      upsertCharacter: vi.fn(),
      deleteCharacter: vi.fn(),
    };
    const handlers = registerHandlers(db);
    const save = handlers.get("character:save");

    const result = await save?.({}, {
      name: "  New Hero  ",
      role: "not-valid",
      description: "updated description",
      appearance: "silver armor",
      personality: "calm",
      referenceImage: "hash-main",
      costumes: [{ id: "costume-1", name: "Armor", description: "heavy" }],
      tags: ["lead", 1, "pilot"],
      age: 32,
      gender: "male",
      voice: "deep",
      referenceImages: [{ slot: "front", assetHash: "hash-angle", isStandard: true }],
      loadouts: [{ id: "loadout-2", name: "Battle", equipmentIds: ["eq-2"] }],
      defaultLoadoutId: "loadout-2",
    });

    expect(result).toEqual(
      expect.objectContaining({
        id: "char-generated",
        projectId: "project-1",
        name: "New Hero",
        role: "supporting",
        gender: "male",
        tags: ["lead", "pilot"],
        defaultLoadoutId: "loadout-2",
      }),
    );
    expect(db.upsertCharacter).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "char-generated",
        projectId: "project-1",
        name: "New Hero",
        role: "supporting",
        refImage: "hash-main",
        tags: ["lead", "pilot"],
      }),
    );
  });

  it("updates an existing character by merging missing fields from the stored record", async () => {
    resetCommon();
    const existing = makeCharacter({
      name: "Existing Hero",
      role: "antagonist",
      gender: "other",
      createdAt: 11,
      updatedAt: 22,
    });
    const db = {
      listCharacters: vi.fn(),
      getCharacter: vi.fn(() => existing),
      upsertCharacter: vi.fn(),
      deleteCharacter: vi.fn(),
    };
    const handlers = registerHandlers(db);
    const save = handlers.get("character:save");

    const result = await save?.({}, {
      id: "char-1",
      description: "new description",
      role: "invalid",
      tags: ["changed"],
    });

    expect(result).toEqual(
      expect.objectContaining({
        id: "char-1",
        name: "Existing Hero",
        role: "antagonist",
        gender: "other",
        description: "new description",
        createdAt: 11,
        tags: ["changed"],
      }),
    );
    expect(db.upsertCharacter).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "char-1",
        name: "Existing Hero",
        role: "antagonist",
        createdAt: 11,
      }),
    );
  });

  it("replaces reference images by slot and defaults isStandard to true", async () => {
    resetCommon();
    const db = {
      listCharacters: vi.fn(),
      getCharacter: vi.fn(() =>
        makeCharacter({
          referenceImages: [
            { slot: "front", assetHash: "old-front", isStandard: true },
            { slot: "side", assetHash: "keep-side", isStandard: false },
          ],
        }),
      ),
      upsertCharacter: vi.fn(),
      deleteCharacter: vi.fn(),
    };
    const handlers = registerHandlers(db);
    const setRefImage = handlers.get("character:setRefImage");

    const refImage = await setRefImage?.({}, {
      characterId: "char-1",
      slot: "front",
      assetHash: "new-front",
      isStandard: undefined,
    });

    expect(refImage).toEqual({
      slot: "front",
      assetHash: "new-front",
      isStandard: true,
    });
    expect(db.upsertCharacter).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "char-1",
        referenceImages: [
          { slot: "side", assetHash: "keep-side", isStandard: false },
          { slot: "front", assetHash: "new-front", isStandard: true },
        ],
      }),
    );
  });

  it("removes a reference image by slot", async () => {
    resetCommon();
    const db = {
      listCharacters: vi.fn(),
      getCharacter: vi.fn(() =>
        makeCharacter({
          referenceImages: [
            { slot: "front", assetHash: "front", isStandard: true },
            { slot: "side", assetHash: "side", isStandard: false },
          ],
        }),
      ),
      upsertCharacter: vi.fn(),
      deleteCharacter: vi.fn(),
    };
    const handlers = registerHandlers(db);
    const removeRefImage = handlers.get("character:removeRefImage");

    await expect(
      removeRefImage?.({}, { characterId: "char-1", slot: "front" }),
    ).resolves.toBeUndefined();

    expect(db.upsertCharacter).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "char-1",
        referenceImages: [{ slot: "side", assetHash: "side", isStandard: false }],
      }),
    );
  });

  it("creates loadouts with generated ids and assigns the first one as default", async () => {
    resetCommon();
    randomUUID.mockReturnValue("loadout-generated");
    const db = {
      listCharacters: vi.fn(),
      getCharacter: vi.fn(() => makeCharacter({ loadouts: [], defaultLoadoutId: "" })),
      upsertCharacter: vi.fn(),
      deleteCharacter: vi.fn(),
    };
    const handlers = registerHandlers(db);
    const saveLoadout = handlers.get("character:saveLoadout");

    const loadout = await saveLoadout?.({}, {
      characterId: "char-1",
      loadout: { id: "", name: "  Battle Set  ", equipmentIds: ["eq-3", "eq-4"] },
    });

    expect(loadout).toEqual({
      id: "loadout-generated",
      name: "Battle Set",
      equipmentIds: ["eq-3", "eq-4"],
    });
    expect(db.upsertCharacter).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "char-1",
        defaultLoadoutId: "loadout-generated",
        loadouts: [{ id: "loadout-generated", name: "Battle Set", equipmentIds: ["eq-3", "eq-4"] }],
      }),
    );
  });

  it("reassigns the default loadout when deleting the current default", async () => {
    resetCommon();
    const db = {
      listCharacters: vi.fn(),
      getCharacter: vi.fn(() =>
        makeCharacter({
          loadouts: [
            { id: "loadout-1", name: "Default", equipmentIds: ["eq-1"] },
            { id: "loadout-2", name: "Backup", equipmentIds: ["eq-2"] },
          ],
          defaultLoadoutId: "loadout-1",
        }),
      ),
      upsertCharacter: vi.fn(),
      deleteCharacter: vi.fn(),
    };
    const handlers = registerHandlers(db);
    const deleteLoadout = handlers.get("character:deleteLoadout");

    await expect(
      deleteLoadout?.({}, { characterId: "char-1", loadoutId: "loadout-1" }),
    ).resolves.toBeUndefined();

    expect(db.upsertCharacter).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "char-1",
        defaultLoadoutId: "loadout-2",
        loadouts: [{ id: "loadout-2", name: "Backup", equipmentIds: ["eq-2"] }],
      }),
    );
  });
});
