import { describe, expect, it, vi } from "vitest";

const getCurrentProjectId = vi.hoisted(() => vi.fn(() => "project-1"));
const randomUUID = vi.hoisted(() => vi.fn(() => "equipment-generated"));

vi.mock("../project-context.js", () => ({
  getCurrentProjectId,
}));

vi.mock("node:crypto", () => ({
  randomUUID,
}));

import { registerEquipmentHandlers } from "./equipment.handlers.js";

function resetCommon() {
  vi.clearAllMocks();
  getCurrentProjectId.mockReset();
  getCurrentProjectId.mockReturnValue("project-1");
  randomUUID.mockReset();
  randomUUID.mockReturnValue("equipment-generated");
}

function makeEquipment(overrides?: Record<string, unknown>) {
  return {
    id: "equipment-1",
    projectId: "project-1",
    name: "Sword",
    type: "weapon",
    subtype: "longsword",
    description: "sharp",
    function: "fight",
    tags: ["steel"],
    referenceImages: [{ slot: "front", assetHash: "hash-front", isStandard: true }],
    createdAt: 100,
    updatedAt: 200,
    ...overrides,
  };
}

function registerHandlers(db?: Record<string, unknown>) {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();

  registerEquipmentHandlers(
    {
      handle(channel: string, handler: (...args: unknown[]) => unknown) {
        handlers.set(channel, handler);
      },
    } as never,
    (db ?? {
      listEquipment: vi.fn(),
      getEquipment: vi.fn(),
      upsertEquipment: vi.fn(),
      deleteEquipment: vi.fn(),
    }) as never,
  );

  return handlers;
}

describe("registerEquipmentHandlers", () => {
  it("registers all equipment IPC handlers", () => {
    resetCommon();
    const handlers = registerHandlers();

    expect([...handlers.keys()].sort()).toEqual([
      "equipment:delete",
      "equipment:get",
      "equipment:list",
      "equipment:removeRefImage",
      "equipment:save",
      "equipment:setRefImage",
    ]);
  });

  it("lists equipment for the current project and optional type filter", async () => {
    resetCommon();
    const db = {
      listEquipment: vi.fn(() => [makeEquipment()]),
      getEquipment: vi.fn(),
      upsertEquipment: vi.fn(),
      deleteEquipment: vi.fn(),
    };
    const handlers = registerHandlers(db);
    const list = handlers.get("equipment:list");

    await expect(list?.({}, { type: "weapon" })).resolves.toEqual([makeEquipment()]);
    expect(db.listEquipment).toHaveBeenCalledWith("project-1", "weapon");
  });

  it("creates new equipment with filtered tags and default type fallback", async () => {
    resetCommon();
    const db = {
      listEquipment: vi.fn(),
      getEquipment: vi.fn(() => undefined),
      upsertEquipment: vi.fn(),
      deleteEquipment: vi.fn(),
    };
    const handlers = registerHandlers(db);
    const save = handlers.get("equipment:save");

    const result = await save?.({}, {
      name: "  Utility Belt  ",
      type: "not-valid",
      description: "tools",
      function: "carry gadgets",
      tags: ["gear", 1, "belt"],
      referenceImages: [{ slot: "front", assetHash: "hash-1", isStandard: true }],
    });

    expect(result).toEqual(
      expect.objectContaining({
        id: "equipment-generated",
        projectId: "project-1",
        name: "Utility Belt",
        type: "other",
        tags: ["gear", "belt"],
      }),
    );
    expect(db.upsertEquipment).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "equipment-generated",
        type: "other",
        functionDesc: "carry gadgets",
        tags: ["gear", "belt"],
      }),
    );
  });

  it("updates and deletes reference images by slot", async () => {
    resetCommon();
    const db = {
      listEquipment: vi.fn(),
      getEquipment: vi.fn(() =>
        makeEquipment({
          referenceImages: [
            { slot: "front", assetHash: "old-front", isStandard: true },
            { slot: "detail", assetHash: "keep-detail", isStandard: false },
          ],
        }),
      ),
      upsertEquipment: vi.fn(),
      deleteEquipment: vi.fn(),
    };
    const handlers = registerHandlers(db);
    const setRefImage = handlers.get("equipment:setRefImage");
    const removeRefImage = handlers.get("equipment:removeRefImage");

    await expect(
      setRefImage?.({}, {
        equipmentId: "equipment-1",
        slot: "front",
        assetHash: "new-front",
        isStandard: false,
      }),
    ).resolves.toEqual({
      slot: "front",
      assetHash: "new-front",
      isStandard: false,
    });

    await expect(
      removeRefImage?.({}, { equipmentId: "equipment-1", slot: "detail" }),
    ).resolves.toBeUndefined();

    expect(db.upsertEquipment).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        id: "equipment-1",
        referenceImages: [
          { slot: "detail", assetHash: "keep-detail", isStandard: false },
          { slot: "front", assetHash: "new-front", isStandard: false },
        ],
      }),
    );
    expect(db.upsertEquipment).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        id: "equipment-1",
        referenceImages: [{ slot: "front", assetHash: "old-front", isStandard: true }],
      }),
    );
  });

  it("requires an open project and rejects missing equipment records", async () => {
    resetCommon();
    getCurrentProjectId.mockReturnValue(null);
    const db = {
      listEquipment: vi.fn(),
      getEquipment: vi.fn(() => undefined),
      upsertEquipment: vi.fn(),
      deleteEquipment: vi.fn(),
    };
    const handlers = registerHandlers(db);

    await expect(handlers.get("equipment:list")?.({})).rejects.toThrow("No project open");

    getCurrentProjectId.mockReturnValue("project-1");
    await expect(
      handlers.get("equipment:get")?.({}, { id: "missing" }),
    ).rejects.toThrow("Equipment not found: missing");
  });
});
