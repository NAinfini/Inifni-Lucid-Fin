import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const getCurrentProjectPath = vi.hoisted(() => vi.fn(() => null));

vi.mock("../project-context.js", () => ({
  getCurrentProjectPath,
}));

import { registerStyleHandlers } from "./style.handlers.js";

function resetCommon() {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  getCurrentProjectPath.mockReset();
  getCurrentProjectPath.mockReturnValue(null);
}

function makeTempProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "lucid-style-handler-"));
}

function makeStyleGuide() {
  return {
    global: {
      artStyle: "cinematic realism",
      colorPalette: { primary: "#111111", secondary: "#eeeeee", forbidden: ["#ff00ff"] },
      lighting: "dramatic",
      texture: "grainy film",
      referenceImages: ["hash-1"],
      freeformDescription: "high contrast",
    },
    sceneOverrides: {
      "scene-1": {
        lighting: "neon",
      },
    },
  };
}

function registerHandlers() {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();

  registerStyleHandlers({
    handle(channel: string, handler: (...args: unknown[]) => unknown) {
      handlers.set(channel, handler);
    },
  } as never);

  return handlers;
}

describe("registerStyleHandlers", () => {
  it("registers style save and load handlers", () => {
    resetCommon();
    const handlers = registerHandlers();

    expect([...handlers.keys()].sort()).toEqual(["style:load", "style:save"]);
  });

  it("saves a style guide to style-guide.json and syncs it into project.json", async () => {
    resetCommon();
    const projectPath = makeTempProject();
    getCurrentProjectPath.mockReturnValue(projectPath);
    const handlers = registerHandlers();
    const save = handlers.get("style:save");
    const manifestPath = path.join(projectPath, "project.json");
    const manifest = {
      id: "project-1",
      title: "Pilot",
      description: "",
      genre: "",
      resolution: [1920, 1080],
      fps: 24,
      aspectRatio: "16:9",
      createdAt: 1,
      updatedAt: 1,
      aiProviders: [],
      snapshots: [],
      styleGuide: makeStyleGuide(),
    };
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");

    const styleGuide = makeStyleGuide();
    await expect(save?.({}, styleGuide)).resolves.toBeUndefined();

    expect(JSON.parse(fs.readFileSync(path.join(projectPath, "style-guide.json"), "utf-8"))).toEqual(styleGuide);
    const updatedManifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    expect(updatedManifest.styleGuide).toEqual(styleGuide);
    expect(updatedManifest.updatedAt).toBeGreaterThan(1);
  });

  it("rejects invalid style guide payloads", async () => {
    resetCommon();
    const handlers = registerHandlers();
    const save = handlers.get("style:save");

    await expect(save?.({}, { global: "bad" })).rejects.toThrow("Invalid style guide payload");
  });

  it("loads an existing style-guide.json when present", async () => {
    resetCommon();
    const projectPath = makeTempProject();
    getCurrentProjectPath.mockReturnValue(projectPath);
    const styleGuide = makeStyleGuide();
    fs.writeFileSync(path.join(projectPath, "style-guide.json"), JSON.stringify(styleGuide, null, 2), "utf-8");
    const handlers = registerHandlers();

    await expect(handlers.get("style:load")?.({})).resolves.toEqual(styleGuide);
  });

  it("falls back to the manifest style guide and writes style-guide.json", async () => {
    resetCommon();
    const projectPath = makeTempProject();
    getCurrentProjectPath.mockReturnValue(projectPath);
    const styleGuide = makeStyleGuide();
    fs.writeFileSync(
      path.join(projectPath, "project.json"),
      JSON.stringify({
        id: "project-1",
        title: "Pilot",
        description: "",
        genre: "",
        resolution: [1920, 1080],
        fps: 24,
        aspectRatio: "16:9",
        createdAt: 1,
        updatedAt: 1,
        aiProviders: [],
        snapshots: [],
        styleGuide,
      }),
      "utf-8",
    );
    const handlers = registerHandlers();

    await expect(handlers.get("style:load")?.({})).resolves.toEqual(styleGuide);
    expect(JSON.parse(fs.readFileSync(path.join(projectPath, "style-guide.json"), "utf-8"))).toEqual(styleGuide);
  });

  it("writes and returns the default style guide when no saved guide exists", async () => {
    resetCommon();
    const projectPath = makeTempProject();
    getCurrentProjectPath.mockReturnValue(projectPath);
    const handlers = registerHandlers();

    const result = await handlers.get("style:load")?.({});

    expect(result).toEqual({
      global: {
        artStyle: "",
        colorPalette: { primary: "", secondary: "", forbidden: [] },
        lighting: "natural",
        texture: "",
        referenceImages: [],
        freeformDescription: "",
      },
      sceneOverrides: {},
    });
    expect(JSON.parse(fs.readFileSync(path.join(projectPath, "style-guide.json"), "utf-8"))).toEqual(result);
  });
});
