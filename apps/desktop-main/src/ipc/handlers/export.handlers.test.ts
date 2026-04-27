import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import fsp from "node:fs/promises";

const logger = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: vi.fn(),
}));

const showSaveDialog = vi.hoisted(() => vi.fn());
const exportFCPXML = vi.hoisted(() => vi.fn(() => "<fcpxml />"));
const exportEDL = vi.hoisted(() => vi.fn(() => "TITLE: test"));
const exportSRT = vi.hoisted(() => vi.fn(() => "1\n00:00:00,000 --> 00:00:01,000\nhello"));
const exportASS = vi.hoisted(() => vi.fn(() => "[Script Info]"));
const archiveInstances = vi.hoisted(() => [] as Array<Record<string, unknown>>);
const pdfDocs = vi.hoisted(() => [] as Array<Record<string, unknown>>);

type FakeStream = {
  on: ReturnType<typeof vi.fn>;
  emit: (event: string, ...args: unknown[]) => void;
};

function createFakeStream(): FakeStream {
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  return {
    on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      const current = listeners.get(event) ?? [];
      current.push(listener);
      listeners.set(event, current);
      return undefined;
    }),
    emit(event: string, ...args: unknown[]) {
      for (const listener of listeners.get(event) ?? []) {
        listener(...args);
      }
    },
  };
}

const archiverFactory = vi.hoisted(() =>
  vi.fn(() => {
    const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
    let output: FakeStream | undefined;
    const instance = {
      file: vi.fn(),
      pipe: vi.fn((stream: FakeStream) => {
        output = stream;
      }),
      on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
        const current = listeners.get(event) ?? [];
        current.push(listener);
        listeners.set(event, current);
      }),
      finalize: vi.fn(async () => {
        output?.emit("close");
      }),
      emit(event: string, ...args: unknown[]) {
        for (const listener of listeners.get(event) ?? []) {
          listener(...args);
        }
      },
    };
    archiveInstances.push(instance);
    return instance;
  }),
);

const FakePDFDocument = vi.hoisted(() =>
  class FakePDFDocument {
    page = { width: 595 };
    stream: FakeStream | null = null;
    options: Record<string, unknown>;
    pipe = vi.fn((stream: FakeStream) => {
      this.stream = stream;
      return stream;
    });
    fontSize = vi.fn(() => this);
    text = vi.fn(() => this);
    moveDown = vi.fn(() => this);
    fillColor = vi.fn(() => this);
    rect = vi.fn(() => this);
    fill = vi.fn(() => this);
    image = vi.fn(() => this);
    font = vi.fn(() => this);
    addPage = vi.fn(() => this);
    end = vi.fn(() => {
      this.stream?.emit("finish");
    });

    constructor(options: Record<string, unknown>) {
      this.options = options;
      pdfDocs.push(this as unknown as Record<string, unknown>);
    }
  },
);

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
    showSaveDialog,
  },
}));

vi.mock("@lucid-fin/media-engine", () => ({
  exportFCPXML,
  exportEDL,
  exportSRT,
  exportASS,
}));

vi.mock("archiver", () => ({
  default: archiverFactory,
}));

vi.mock("pdfkit", () => ({
  default: FakePDFDocument,
}));

import { registerExportHandlers } from "./export.handlers.js";

function resetCommon() {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  showSaveDialog.mockReset();
  exportFCPXML.mockReset();
  exportEDL.mockReset();
  exportSRT.mockReset();
  exportASS.mockReset();
  exportFCPXML.mockReturnValue("<fcpxml />");
  exportEDL.mockReturnValue("TITLE: test");
  exportSRT.mockReturnValue("1\n00:00:00,000 --> 00:00:01,000\nhello");
  exportASS.mockReturnValue("[Script Info]");
  archiverFactory.mockClear();
  archiveInstances.length = 0;
  pdfDocs.length = 0;
}

function registerHandlers(cas?: Record<string, unknown>) {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();

  registerExportHandlers(
    {
      handle(channel: string, handler: (...args: unknown[]) => unknown) {
        handlers.set(channel, handler);
      },
    } as never,
    cas as never,
  );

  return handlers;
}

describe("registerExportHandlers", () => {
  it("registers all export IPC handlers", () => {
    resetCommon();
    const handlers = registerHandlers();

    expect([...handlers.keys()].sort()).toEqual([
      "export:assetBundle",
      "export:capcut",
      "export:metadata",
      "export:nle",
      "export:storyboard",
      "export:subtitles",
      "import:srt",
    ]);
  });

  it("exports NLE timelines to the requested output path and logs file size", async () => {
    resetCommon();
    vi.spyOn(fsp, "writeFile").mockImplementation(async () => undefined);
    vi.spyOn(fs, "statSync").mockReturnValue({ size: 321 } as fs.Stats);
    const handlers = registerHandlers();
    const exportNle = handlers.get("export:nle");

    const result = await exportNle?.({}, {
      format: "fcpxml",
      project: { metadata: { title: "Pilot" }, tracks: [] },
      outputPath: "C:\\exports\\timeline.fcpxml",
    });

    expect(result).toEqual({
      outputPath: "C:\\exports\\timeline.fcpxml",
      format: "fcpxml",
      fileSize: 321,
    });
    expect(exportFCPXML).toHaveBeenCalledWith({ metadata: { title: "Pilot" }, tracks: [] });
    expect(fsp.writeFile).toHaveBeenCalledWith(
      "C:\\exports\\timeline.fcpxml",
      "<fcpxml />",
      "utf8",
    );
    expect(logger.info).toHaveBeenCalledWith(
      "NLE export completed",
      expect.objectContaining({
        category: "export",
        format: "fcpxml",
        outputPath: "C:\\exports\\timeline.fcpxml",
        fileSize: 321,
      }),
    );
  });

  it("cancels NLE export through the save dialog and validates bad NLE requests", async () => {
    resetCommon();
    showSaveDialog.mockResolvedValue({ canceled: true, filePath: undefined });
    const handlers = registerHandlers();
    const exportNle = handlers.get("export:nle");

    await expect(
      exportNle?.({}, { format: "edl", project: { metadata: { title: "Pilot" }, tracks: [] } }),
    ).resolves.toBeNull();
    await expect(exportNle?.({}, { format: "bad", project: { metadata: { title: "Pilot" }, tracks: [] } })).rejects.toThrow(
      'export:nle: format must be "fcpxml" or "edl"',
    );
    await expect(exportNle?.({}, { format: "edl" })).rejects.toThrow("export:nle: project is required");

    expect(logger.info).toHaveBeenCalledWith(
      "NLE export cancelled",
      expect.objectContaining({
        category: "export",
        format: "edl",
      }),
    );
  });

  it("exports asset bundles as zip archives using resolved CAS file paths", async () => {
    resetCommon();
    const stream = createFakeStream();
    vi.spyOn(fs, "createWriteStream").mockReturnValue(stream as never);
    vi.spyOn(fs, "existsSync").mockImplementation((target) => {
      const value = String(target);
      return value.includes("hash-image.png") || value.includes("hash-audio.mp3");
    });
    vi.spyOn(fs, "statSync").mockReturnValue({ size: 2048 } as fs.Stats);
    const cas = {
      getAssetPath: vi.fn((hash: string, type: string, ext: string) => `C:\\cas\\${type}\\${hash}.${ext}`),
    };
    const handlers = registerHandlers(cas);
    const exportBundle = handlers.get("export:assetBundle");

    const result = await exportBundle?.({}, {
      assetHashes: ["hash-image", "hash-audio"],
      outputPath: "C:\\exports\\assets.zip",
    });

    expect(result).toEqual({
      outputPath: "C:\\exports\\assets.zip",
      fileCount: 2,
      fileSize: 2048,
    });
    expect(archiverFactory).toHaveBeenCalledWith("zip", { zlib: { level: 6 } });
    expect((archiveInstances[0] as { file: ReturnType<typeof vi.fn> }).file).toHaveBeenCalledWith(
      "C:\\cas\\image\\hash-image.png",
      { name: "hash-image.png" },
    );
    expect((archiveInstances[0] as { file: ReturnType<typeof vi.fn> }).file).toHaveBeenCalledWith(
      "C:\\cas\\audio\\hash-audio.mp3",
      { name: "hash-audio.mp3" },
    );
    expect(logger.info).toHaveBeenCalledWith(
      "Asset bundle export completed",
      expect.objectContaining({
        category: "export",
        outputPath: "C:\\exports\\assets.zip",
        fileCount: 2,
        fileSize: 2048,
      }),
    );
  });

  it("rejects asset bundle export when CAS is unavailable, hashes are missing, or no files resolve", async () => {
    resetCommon();
    const handlersWithoutCas = registerHandlers();

    await expect(
      handlersWithoutCas.get("export:assetBundle")?.({}, { assetHashes: ["hash-1"] }),
    ).rejects.toThrow("export:assetBundle: CAS not available");

    const cas = {
      getAssetPath: vi.fn((hash: string, type: string, ext: string) => `C:\\cas\\${type}\\${hash}.${ext}`),
    };
    const handlers = registerHandlers(cas);
    const exportBundle = handlers.get("export:assetBundle");
    vi.spyOn(fs, "existsSync").mockReturnValue(false);

    await expect(exportBundle?.({}, { assetHashes: [] })).rejects.toThrow(
      "export:assetBundle: assetHashes array required",
    );
    await expect(
      exportBundle?.({}, { assetHashes: ["missing"], outputPath: "C:\\exports\\assets.zip" }),
    ).rejects.toThrow("export:assetBundle: no asset files found for given hashes");
  });

  it("exports subtitles in srt and ass formats and validates subtitle requests", async () => {
    resetCommon();
    vi.spyOn(fsp, "writeFile").mockImplementation(async () => undefined);
    const handlers = registerHandlers();
    const exportSubtitles = handlers.get("export:subtitles");
    const cues = [{ id: "cue-1", startTime: 0, endTime: 1, text: "hello" }];

    await expect(
      exportSubtitles?.({}, {
        format: "srt",
        cues,
        outputPath: "C:\\exports\\captions.srt",
      }),
    ).resolves.toBeUndefined();
    await expect(
      exportSubtitles?.({}, {
        format: "ass",
        cues,
        outputPath: "C:\\exports\\captions.ass",
        videoWidth: 1920,
        videoHeight: 1080,
      }),
    ).resolves.toBeUndefined();
    await expect(
      exportSubtitles?.({}, { format: "bad", cues, outputPath: "C:\\exports\\captions.txt" }),
    ).rejects.toThrow('export:subtitles: format must be "srt" or "ass"');
    await expect(exportSubtitles?.({}, { format: "srt", cues: undefined })).rejects.toThrow(
      "export:subtitles: cues array required",
    );

    expect(exportSRT).toHaveBeenCalledWith(cues);
    expect(exportASS).toHaveBeenCalledWith(cues, 1920, 1080);
    expect(fsp.writeFile).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("captions.srt"),
      "1\n00:00:00,000 --> 00:00:01,000\nhello",
      "utf8",
    );
    expect(fsp.writeFile).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("captions.ass"),
      "[Script Info]",
      "utf8",
    );
  });

  it("opens save dialog when subtitles outputPath is omitted and cancels gracefully", async () => {
    resetCommon();
    showSaveDialog.mockResolvedValueOnce({ canceled: true, filePath: undefined });
    const handlers = registerHandlers();
    const exportSubtitles = handlers.get("export:subtitles");
    const cues = [{ id: "cue-1", startTime: 0, endTime: 1, text: "hello" }];

    await expect(
      exportSubtitles?.({}, { format: "srt", cues }),
    ).resolves.toBeNull();

    expect(showSaveDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultPath: "subtitles.srt",
      }),
    );
    expect(logger.info).toHaveBeenCalledWith(
      "Subtitle export cancelled",
      expect.objectContaining({ category: "export", format: "srt" }),
    );
  });

  it("rejects subtitles export with path traversal or disallowed extension", async () => {
    resetCommon();
    const handlers = registerHandlers();
    const exportSubtitles = handlers.get("export:subtitles");
    const cues = [{ id: "cue-1", startTime: 0, endTime: 1, text: "hello" }];

    await expect(
      exportSubtitles?.({}, { format: "srt", cues, outputPath: "C:\\exports\\..\\..\\system.srt" }),
    ).rejects.toThrow("export:subtitles: path traversal detected");

    await expect(
      exportSubtitles?.({}, { format: "srt", cues, outputPath: "C:\\exports\\payload.exe" }),
    ).rejects.toThrow('export:subtitles: disallowed extension ".exe"');
  });

  it("exports storyboard PDFs with resolved thumbnails and supports dialog cancellation", async () => {
    resetCommon();
    const stream = createFakeStream();
    vi.spyOn(fs, "createWriteStream").mockReturnValue(stream as never);
    vi.spyOn(fs, "statSync").mockReturnValue({ size: 5120 } as fs.Stats);
    vi.spyOn(fs, "existsSync").mockImplementation((target) => String(target).includes("frame-1.png"));
    showSaveDialog.mockResolvedValueOnce({ canceled: true, filePath: undefined });
    const cas = {
      getAssetPath: vi.fn((hash: string, type: string, ext: string) => `C:\\cas\\${type}\\${hash}.${ext}`),
    };
    const handlers = registerHandlers(cas);
    const exportStoryboard = handlers.get("export:storyboard");

    await expect(
      exportStoryboard?.({}, {
        nodes: [{ title: "Shot 1", type: "image" }],
        projectTitle: "Pilot",
      }),
    ).resolves.toBeNull();

    const result = await exportStoryboard?.({}, {
      nodes: [
        {
          title: "Shot 1",
          type: "image",
          prompt: "hero walks in",
          assetHash: "frame-1",
          sceneNumber: "1",
          shotOrder: 1,
        },
      ],
      projectTitle: "Pilot",
      outputPath: "C:\\exports\\storyboard.pdf",
    });

    expect(result).toEqual({
      outputPath: "C:\\exports\\storyboard.pdf",
      nodeCount: 1,
      fileSize: 5120,
    });
    const doc = pdfDocs[0] as FakePDFDocument;
    expect(doc.image).toHaveBeenCalledWith(
      "C:\\cas\\image\\frame-1.png",
      expect.any(Number),
      expect.any(Number),
      expect.objectContaining({
        width: expect.any(Number),
        height: expect.any(Number),
      }),
    );
    expect(logger.info).toHaveBeenCalledWith(
      "Storyboard export cancelled",
      expect.objectContaining({ category: "export" }),
    );
    expect(logger.info).toHaveBeenCalledWith(
      "Storyboard PDF export completed",
      expect.objectContaining({
        category: "export",
        outputPath: "C:\\exports\\storyboard.pdf",
        nodeCount: 1,
        fileSize: 5120,
      }),
    );
  });

  it("exports metadata as JSON and CSV with proper field escaping and dialog cancellation", async () => {
    resetCommon();
    vi.spyOn(fsp, "writeFile").mockImplementation(async () => undefined);
    vi.spyOn(fs, "statSync").mockReturnValue({ size: 333 } as fs.Stats);
    showSaveDialog.mockResolvedValueOnce({ canceled: true, filePath: undefined });
    const handlers = registerHandlers();
    const exportMetadata = handlers.get("export:metadata");
    const nodes = [
      {
        id: "node-1",
        type: "image",
        title: "Quote, Test",
        prompt: "He said \"hello\"",
        tags: ["one", "two"],
      },
    ];

    await expect(
      exportMetadata?.({}, {
        format: "json",
        nodes,
        projectTitle: "Pilot",
      }),
    ).resolves.toBeNull();

    await expect(
      exportMetadata?.({}, {
        format: "json",
        nodes,
        projectTitle: "Pilot",
        outputPath: "C:\\exports\\metadata.json",
      }),
    ).resolves.toEqual({
      outputPath: "C:\\exports\\metadata.json",
      format: "json",
      nodeCount: 1,
      fileSize: 333,
    });

    await expect(
      exportMetadata?.({}, {
        format: "csv",
        nodes,
        outputPath: "C:\\exports\\metadata.csv",
      }),
    ).resolves.toEqual({
      outputPath: "C:\\exports\\metadata.csv",
      format: "csv",
      nodeCount: 1,
      fileSize: 333,
    });

    expect(fsp.writeFile).toHaveBeenNthCalledWith(
      1,
      "C:\\exports\\metadata.json",
      expect.stringContaining('"project": "Pilot"'),
      "utf8",
    );
    expect(fsp.writeFile).toHaveBeenNthCalledWith(
      2,
      "C:\\exports\\metadata.csv",
      expect.stringContaining('"Quote, Test","He said ""hello"""'),
      "utf8",
    );
    expect(logger.info).toHaveBeenCalledWith(
      "Metadata export cancelled",
      expect.objectContaining({ category: "export" }),
    );
  });
});
