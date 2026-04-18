import { describe, expect, it, vi } from "vitest";

const generateAndImport = vi.hoisted(() => vi.fn());

vi.mock("../../generation-pipeline.js", () => ({
  generateAndImport,
}));

import { registerEntityHandlers } from "./entity.handlers.js";

function resetCommon() {
  vi.clearAllMocks();
}

function registerHandlers(deps?: Record<string, unknown>) {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();

  // Wrap the flat `db` mock into the new `.repos.entities` shape so handler
  // code that calls `db.repos.entities.xxx(...)` still lands on the same spies.
  let effectiveDeps = deps ?? {
    adapterRegistry: { get: vi.fn() },
    cas: {},
    db: {},
  };
  if (deps && typeof deps.db === 'object' && deps.db !== null) {
    const flatDb = deps.db as Record<string, unknown>;
    effectiveDeps = {
      ...deps,
      db: {
        ...flatDb,
        repos: {
          entities: {
            getCharacter: flatDb.getCharacter,
            getEquipment: flatDb.getEquipment,
            getLocation: flatDb.getLocation,
            upsertCharacter: flatDb.upsertCharacter,
            upsertEquipment: flatDb.upsertEquipment,
            upsertLocation: flatDb.upsertLocation,
          },
        },
      },
    };
  }

  registerEntityHandlers(
    {
      handle(channel: string, handler: (...args: unknown[]) => unknown) {
        handlers.set(channel, handler);
      },
    } as never,
    effectiveDeps as never,
  );

  return handlers;
}

describe("registerEntityHandlers", () => {
  it("registers the entity reference-image generation handler", () => {
    resetCommon();
    const handlers = registerHandlers();

    expect([...handlers.keys()]).toEqual(["entity:generateReferenceImage"]);
  });

  it("generates up to nine character reference images, increments seeds, and appends refs", async () => {
    resetCommon();
    const adapter = { id: "provider-1" };
    const db = {
      getCharacter: vi.fn(() => ({
        id: "char-1",
        name: "Hero",
        referenceImages: [{ slot: "front", assetHash: "existing", isStandard: true }],
      })),
      getEquipment: vi.fn(),
      getLocation: vi.fn(),
      upsertCharacter: vi.fn(),
      upsertEquipment: vi.fn(),
      upsertLocation: vi.fn(),
    };
    const deps = {
      adapterRegistry: { get: vi.fn(() => adapter) },
      cas: {},
      db,
    };
    generateAndImport.mockImplementation(async (request: { seed?: number }) => ({
      hashes: [`hash-${request.seed}`],
      cost: 0,
    }));
    const handlers = registerHandlers(deps);
    const generate = handlers.get("entity:generateReferenceImage");

    const result = await generate?.({}, {
      entityType: "character",
      entityId: "char-1",
      description: "hero portrait",
      provider: "provider-1",
      variantCount: 12,
      seed: 7,
    });

    expect(result).toEqual({
      variants: ["hash-7", "hash-8", "hash-9", "hash-10", "hash-11", "hash-12", "hash-13", "hash-14", "hash-15"],
    });
    expect(generateAndImport).toHaveBeenCalledTimes(9);
    expect(generateAndImport).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        type: "image",
        providerId: "provider-1",
        prompt: "hero portrait",
        seed: 7,
      }),
      expect.anything(),
      expect.objectContaining({
        provider: "provider-1",
        tags: ["character", "character:char-1", "reference-image"],
      }),
    );
    expect(generateAndImport).toHaveBeenNthCalledWith(
      9,
      expect.objectContaining({
        seed: 15,
      }),
      expect.anything(),
      expect.anything(),
    );
    expect(db.upsertCharacter).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "char-1",
        name: "Hero",
        referenceImages: expect.arrayContaining([
          { slot: "front", assetHash: "existing", isStandard: true },
          expect.objectContaining({ assetHash: "hash-7", isStandard: false }),
          expect.objectContaining({ assetHash: "hash-15", isStandard: false }),
        ]),
      }),
    );
  });

  it("updates equipment reference images when equipment generation succeeds", async () => {
    resetCommon();
    generateAndImport.mockResolvedValue({ hashes: ["equip-hash"], cost: 0 });
    const db = {
      getCharacter: vi.fn(),
      getEquipment: vi.fn(() => ({
        id: "equip-1",
        name: "Helmet",
        referenceImages: [],
      })),
      getLocation: vi.fn(),
      upsertCharacter: vi.fn(),
      upsertEquipment: vi.fn(),
      upsertLocation: vi.fn(),
    };
    const handlers = registerHandlers({
      adapterRegistry: { get: vi.fn(() => ({ id: "provider-1" })) },
      cas: {},
      db,
    });
    const generate = handlers.get("entity:generateReferenceImage");

    await expect(
      generate?.({}, {
        entityType: "equipment",
        entityId: "equip-1",
        description: "helmet concept",
        provider: "provider-1",
      }),
    ).resolves.toEqual({ variants: ["equip-hash"] });

    expect(db.upsertEquipment).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "equip-1",
        referenceImages: [expect.objectContaining({ assetHash: "equip-hash", isStandard: false })],
      }),
    );
  });

  it("updates location reference images and rejects unknown providers", async () => {
    resetCommon();
    const db = {
      getCharacter: vi.fn(),
      getEquipment: vi.fn(),
      getLocation: vi.fn(() => ({
        id: "loc-1",
        name: "Warehouse",
        referenceImages: [],
      })),
      upsertCharacter: vi.fn(),
      upsertEquipment: vi.fn(),
      upsertLocation: vi.fn(),
    };
    const missingProviderHandlers = registerHandlers({
      adapterRegistry: { get: vi.fn(() => undefined) },
      cas: {},
      db,
    });

    await expect(
      missingProviderHandlers.get("entity:generateReferenceImage")?.({}, {
        entityType: "location",
        entityId: "loc-1",
        description: "warehouse wide shot",
        provider: "missing-provider",
      }),
    ).rejects.toThrow("Provider not found: missing-provider");

    generateAndImport.mockResolvedValue({ hashes: ["loc-hash"], cost: 0 });
    const handlers = registerHandlers({
      adapterRegistry: { get: vi.fn(() => ({ id: "provider-2" })) },
      cas: {},
      db,
    });

    await expect(
      handlers.get("entity:generateReferenceImage")?.({}, {
        entityType: "location",
        entityId: "loc-1",
        description: "warehouse wide shot",
        provider: "provider-2",
      }),
    ).resolves.toEqual({ variants: ["loc-hash"] });

    expect(db.upsertLocation).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "loc-1",
        referenceImages: [expect.objectContaining({ assetHash: "loc-hash", isStandard: false })],
      }),
    );
  });
});
