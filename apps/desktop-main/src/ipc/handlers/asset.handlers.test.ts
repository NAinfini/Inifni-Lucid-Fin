import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

const logger = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: vi.fn(),
}));

const showOpenDialog = vi.hoisted(() => vi.fn());
const showSaveDialog = vi.hoisted(() => vi.fn());

vi.mock("../../logger.js", () => ({
  default: logger,
  debug: logger.debug,
  info: logger.info,
  warn: logger.warn,
  error: logger.error,
  fatal: logger.fatal,
}));

vi.mock("electron", () => ({
  dialog: {
    showOpenDialog,
    showSaveDialog,
  },
}));

import { registerAssetHandlers } from "./asset.handlers.js";

function resetCommon() {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  showOpenDialog.mockReset();
  showSaveDialog.mockReset();
}

function wrapAssetRepo(flatDb: Record<string, unknown>): Record<string, unknown> {
  const insert = flatDb.insertAsset as ReturnType<typeof vi.fn> | undefined;
  const del = flatDb.deleteAsset as ReturnType<typeof vi.fn> | undefined;
  const search = flatDb.searchAssets as ReturnType<typeof vi.fn> | undefined;
  const query = flatDb.queryAssets as ReturnType<typeof vi.fn> | undefined;
  const repair = flatDb.repairAssetSizes as ReturnType<typeof vi.fn> | undefined;
  return {
    ...flatDb,
    repos: {
      assets: {
        insert: insert ?? vi.fn(),
        delete: del ?? vi.fn(),
        // Handlers call `.rows` on query/search results; wrap the flat array
        // spies so existing `toHaveBeenCalledWith(...)` assertions keep working
        // while the handler receives { rows } shape.
        query: search || query ? vi.fn((...args: unknown[]) => ({ rows: query ? (query(...args) ?? []) : [] })) : vi.fn(() => ({ rows: [] })),
        search: search ? vi.fn((...args: unknown[]) => ({ rows: search(...args) ?? [] })) : vi.fn(() => ({ rows: [] })),
        repairSizes: repair ?? vi.fn().mockReturnValue(0),
      },
    },
  };
}

function registerHandlers(
  cas?: Record<string, unknown>,
  db?: Record<string, unknown>,
) {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();

  const effectiveDb =
    db ??
    {
      insertAsset: vi.fn(),
      deleteAsset: vi.fn(),
      searchAssets: vi.fn(),
      queryAssets: vi.fn(),
      repairAssetSizes: vi.fn().mockReturnValue(0),
    };

  registerAssetHandlers(
    {
      handle(channel: string, handler: (...args: unknown[]) => unknown) {
        handlers.set(channel, handler);
      },
    } as never,
    (cas ?? {
      importAsset: vi.fn(),
      importBuffer: vi.fn(),
      getAssetPath: vi.fn(),
      deleteAsset: vi.fn(),
    }) as never,
    wrapAssetRepo(effectiveDb) as never,
  );

  return handlers;
}

describe("registerAssetHandlers", () => {
  it("registers all asset IPC handlers", () => {
    resetCommon();
    const handlers = registerHandlers();

    expect([...handlers.keys()].sort()).toEqual([
      "asset:delete",
      "asset:export",
      "asset:exportBatch",
      "asset:getPath",
      "asset:import",
      "asset:importBuffer",
      "asset:pickFile",
      "asset:query",
    ]);
  });

  it("imports a file asset, associates the current project, and logs the import", async () => {
    resetCommon();
    const cas = {
      importAsset: vi.fn(async () => ({
        ref: { hash: "hash-asset-1" },
        meta: { hash: "hash-asset-1", type: "image", mimeType: "image/png", size: 128 },
      })),
      importBuffer: vi.fn(),
      getAssetPath: vi.fn(),
      deleteAsset: vi.fn(),
    };
    const db = {
      insertAsset: vi.fn(),
      deleteAsset: vi.fn(),
      searchAssets: vi.fn(),
      queryAssets: vi.fn(),
      repairAssetSizes: vi.fn().mockReturnValue(0),
    };
    const handlers = registerHandlers(cas, db);

    const importAsset = handlers.get("asset:import");
    const result = await importAsset?.({}, { filePath: "C:\\tmp\\hero.png", type: "image" });

    expect(result).toEqual({ hash: "hash-asset-1" });
    expect(cas.importAsset).toHaveBeenCalledWith("C:\\tmp\\hero.png", "image");
    expect(db.insertAsset).toHaveBeenCalledWith(
      expect.objectContaining({
        hash: "hash-asset-1",
      }),
    );
    expect(logger.info).toHaveBeenCalledWith(
      "Asset imported",
      expect.objectContaining({
        category: "asset",
        hash: "hash-asset-1",
        filePath: "C:\\tmp\\hero.png",
      }),
    );
  });

  it("imports a buffer asset and records the uploaded size", async () => {
    resetCommon();
    const cas = {
      importAsset: vi.fn(),
      importBuffer: vi.fn(async () => ({
        ref: { hash: "hash-buffer-1" },
        meta: { hash: "hash-buffer-1", type: "audio", mimeType: "audio/wav", size: 3 },
      })),
      getAssetPath: vi.fn(),
      deleteAsset: vi.fn(),
    };
    const db = {
      insertAsset: vi.fn(),
      deleteAsset: vi.fn(),
      searchAssets: vi.fn(),
      queryAssets: vi.fn(),
      repairAssetSizes: vi.fn().mockReturnValue(0),
    };
    const handlers = registerHandlers(cas, db);
    const importBuffer = handlers.get("asset:importBuffer");

    const buffer = new Uint8Array([1, 2, 3]).buffer;
    const result = await importBuffer?.({}, {
      buffer,
      fileName: "voice.wav",
      type: "audio",
    });

    expect(result).toEqual({ hash: "hash-buffer-1" });
    expect(cas.importBuffer).toHaveBeenCalledWith(expect.any(Buffer), "voice.wav", "audio");
    expect(db.insertAsset).toHaveBeenCalledWith(
      expect.objectContaining({
        hash: "hash-buffer-1",
      }),
    );
    expect(logger.info).toHaveBeenCalledWith(
      "Asset imported from buffer",
      expect.objectContaining({
        category: "asset",
        hash: "hash-buffer-1",
        fileName: "voice.wav",
        size: 3,
      }),
    );
  });

  it("rejects invalid importBuffer arguments before touching CAS", async () => {
    resetCommon();
    const cas = {
      importAsset: vi.fn(),
      importBuffer: vi.fn(),
      getAssetPath: vi.fn(),
      deleteAsset: vi.fn(),
    };
    const handlers = registerHandlers(cas);
    const importBuffer = handlers.get("asset:importBuffer");

    await expect(
      importBuffer?.({}, { buffer: undefined, fileName: "", type: "image" }),
    ).rejects.toThrow("buffer and fileName are required");

    expect(cas.importBuffer).not.toHaveBeenCalled();
  });

  it("returns null when the asset picker is cancelled", async () => {
    resetCommon();
    showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });
    const cas = {
      importAsset: vi.fn(),
      importBuffer: vi.fn(),
      getAssetPath: vi.fn(),
      deleteAsset: vi.fn(),
    };
    const handlers = registerHandlers(cas);
    const pickFile = handlers.get("asset:pickFile");

    await expect(pickFile?.({}, { type: "video" })).resolves.toBeNull();

    expect(showOpenDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        properties: ["openFile"],
        filters: expect.arrayContaining([
          expect.objectContaining({ name: "Videos" }),
        ]),
      }),
    );
    expect(cas.importAsset).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      "Asset picker cancelled",
      expect.objectContaining({
        category: "asset",
        type: "video",
      }),
    );
  });

  it("routes search queries to searchAssets and plain listing to queryAssets", async () => {
    resetCommon();
    const db = {
      insertAsset: vi.fn(),
      deleteAsset: vi.fn(),
      searchAssets: vi.fn(() => [{ hash: "searched" }]),
      queryAssets: vi.fn(() => [{ hash: "listed" }]),
      repairAssetSizes: vi.fn().mockReturnValue(0),
    };
    const handlers = registerHandlers(undefined, db);
    const query = handlers.get("asset:query");

    await expect(
      query?.({}, { search: "hero", limit: 5, type: "image", offset: 2 }),
    ).resolves.toEqual([{ hash: "searched" }]);
    await expect(
      query?.({}, { type: "audio", limit: 10, offset: 4 }),
    ).resolves.toEqual([{ hash: "listed" }]);

    expect(db.searchAssets).toHaveBeenCalledWith("hero", 5);
    expect(db.queryAssets).toHaveBeenCalledWith({
      type: "audio",
      limit: 10,
      offset: 4,
    });
  });

  it("returns an asset path with png fallback when ext is empty", async () => {
    resetCommon();
    const cas = {
      importAsset: vi.fn(),
      importBuffer: vi.fn(),
      getAssetPath: vi.fn(() => "C:\\cas\\image\\hash-1.png"),
      deleteAsset: vi.fn(),
    };
    const handlers = registerHandlers(cas);
    const getPath = handlers.get("asset:getPath");

    await expect(
      getPath?.({}, { hash: "hash-1", type: "image", ext: "" }),
    ).resolves.toBe("C:\\cas\\image\\hash-1.png");

    expect(cas.getAssetPath).toHaveBeenCalledWith("hash-1", "image", "png");
  });

  it("deletes an asset from CAS and sqlite and logs failures when deletion throws", async () => {
    resetCommon();
    const cas = {
      importAsset: vi.fn(),
      importBuffer: vi.fn(),
      getAssetPath: vi.fn(),
      deleteAsset: vi.fn(() => {
        throw new Error("cas delete failed");
      }),
    };
    const db = {
      insertAsset: vi.fn(),
      deleteAsset: vi.fn(),
      searchAssets: vi.fn(),
      queryAssets: vi.fn(),
      repairAssetSizes: vi.fn().mockReturnValue(0),
    };
    const handlers = registerHandlers(cas, db);
    const deleteAsset = handlers.get("asset:delete");

    await expect(deleteAsset?.({}, { hash: "hash-delete" })).rejects.toThrow("cas delete failed");

    expect(cas.deleteAsset).toHaveBeenCalledWith("hash-delete");
    expect(db.deleteAsset).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      "Failed to delete asset",
      expect.objectContaining({
        category: "asset",
        hash: "hash-delete",
        error: expect.stringContaining("cas delete failed"),
      }),
    );
  });

  it("exports an asset using the discovered source extension and default save name", async () => {
    resetCommon();
    showSaveDialog.mockResolvedValue({
      canceled: false,
      filePath: "C:\\exports\\hero.jpg",
    });
    vi.spyOn(fs, "readFileSync").mockImplementation((target) => {
      if (String(target).endsWith("meta.json")) {
        return JSON.stringify({ format: "jpg" });
      }
      throw new Error(`unexpected read: ${String(target)}`);
    });
    vi.spyOn(fs, "existsSync").mockImplementation((target) => String(target).endsWith(".jpg"));
    vi.spyOn(fsp, "copyFile").mockImplementation(async () => undefined);

    const cas = {
      importAsset: vi.fn(),
      importBuffer: vi.fn(),
      getAssetPath: vi.fn((hash: string, type: string, ext: string) => `C:\\cas\\${type}\\${hash}.${ext}`),
      deleteAsset: vi.fn(),
    };
    const handlers = registerHandlers(cas);
    const exportAsset = handlers.get("asset:export");

    await expect(
      exportAsset?.({}, { hash: "hash-export", type: "image", format: "png", name: "hero.png" }),
    ).resolves.toEqual({
      success: true,
      path: "C:\\exports\\hero.jpg",
    });

    expect(showSaveDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultPath: "hero.jpg",
      }),
    );
    expect(fsp.copyFile).toHaveBeenCalledWith(
      "C:\\cas\\image\\hash-export.jpg",
      "C:\\exports\\hero.jpg",
    );
    expect(logger.info).toHaveBeenCalledWith(
      "Asset export completed",
      expect.objectContaining({
        category: "asset",
        hash: "hash-export",
        sourcePath: "C:\\cas\\image\\hash-export.jpg",
        destinationPath: "C:\\exports\\hero.jpg",
      }),
    );
  });

  it("logs and rethrows when no asset file can be resolved for export", async () => {
    resetCommon();
    showSaveDialog.mockResolvedValue({
      canceled: false,
      filePath: "C:\\exports\\missing.png",
    });
    vi.spyOn(fs, "readFileSync").mockImplementation(() => {
      throw new Error("meta missing");
    });
    vi.spyOn(fs, "existsSync").mockReturnValue(false);

    const cas = {
      importAsset: vi.fn(),
      importBuffer: vi.fn(),
      getAssetPath: vi.fn((hash: string, type: string, ext: string) => `C:\\cas\\${type}\\${hash}.${ext}`),
      deleteAsset: vi.fn(),
    };
    const handlers = registerHandlers(cas);
    const exportAsset = handlers.get("asset:export");

    await expect(
      exportAsset?.({}, { hash: "hash-missing", type: "image", format: "png" }),
    ).rejects.toThrow("Asset file not found: hash-missing");

    expect(logger.error).toHaveBeenCalledWith(
      "Asset export failed",
      expect.objectContaining({
        category: "asset",
        hash: "hash-missing",
        type: "image",
        format: "png",
      }),
    );
  });

  it("exports a batch to the chosen directory and skips unresolved items", async () => {
    resetCommon();
    showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: ["C:\\exports"],
    });
    vi.spyOn(fs, "readFileSync").mockImplementation(() => {
      throw new Error("meta missing");
    });
    vi.spyOn(fs, "existsSync").mockImplementation((target) => String(target).includes("hash-1.png"));
    vi.spyOn(fsp, "copyFile").mockImplementation(async () => undefined);

    const cas = {
      importAsset: vi.fn(),
      importBuffer: vi.fn(),
      getAssetPath: vi.fn((hash: string, type: string, ext: string) => `C:\\cas\\${type}\\${hash}.${ext}`),
      deleteAsset: vi.fn(),
    };
    const handlers = registerHandlers(cas);
    const exportBatch = handlers.get("asset:exportBatch");

    await expect(
      exportBatch?.({}, {
        items: [
          { hash: "hash-1", type: "image", name: "hero.png" },
          { hash: "hash-2", type: "image", name: "villain.png" },
        ],
      }),
    ).resolves.toEqual({
      success: true,
      count: 1,
      directory: "C:\\exports",
    });

    expect(fsp.copyFile).toHaveBeenCalledWith(
      "C:\\cas\\image\\hash-1.png",
      path.join("C:\\exports", "hero.png"),
    );
    expect(logger.info).toHaveBeenCalledWith(
      "Asset batch export completed",
      expect.objectContaining({
        category: "asset",
        requestedCount: 2,
        exportedCount: 1,
        skippedCount: 1,
        outputDir: "C:\\exports",
      }),
    );
  });

  it("rejects empty batch export requests before opening a dialog", async () => {
    resetCommon();
    const handlers = registerHandlers();
    const exportBatch = handlers.get("asset:exportBatch");

    await expect(exportBatch?.({}, { items: [] })).rejects.toThrow("items required");

    expect(showOpenDialog).not.toHaveBeenCalled();
  });
});
