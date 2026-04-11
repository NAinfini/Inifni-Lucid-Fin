import { describe, it, expect } from "vitest";
import {
  BUILT_IN_PRESET_LIBRARY,
  BUILT_IN_SHOT_TEMPLATES,
  PRESET_CATEGORIES,
  createEmptyPresetTrackSet,
} from "./presets.js";

describe("presets DTO", () => {
  it("exports all preset categories in a stable order", () => {
    expect(PRESET_CATEGORIES).toEqual([
      "camera",
      "lens",
      "look",
      "scene",
      "composition",
      "emotion",
      "flow",
      "technical",
    ]);
    expect(new Set(PRESET_CATEGORIES).size).toBe(PRESET_CATEGORIES.length);
  });

  it("creates an empty preset track set with per-category defaults", () => {
    const trackSet = createEmptyPresetTrackSet();

    expect(Object.keys(trackSet)).toEqual(PRESET_CATEGORIES);

    for (const category of PRESET_CATEGORIES) {
      expect(trackSet[category]).toEqual({
        category,
        entries: [],
      });
    }
  });

  it("returns fresh track objects and arrays on each factory call", () => {
    const first = createEmptyPresetTrackSet();
    const second = createEmptyPresetTrackSet();

    expect(first).not.toBe(second);
    expect(first.camera).not.toBe(second.camera);
    expect(first.camera.entries).not.toBe(second.camera.entries);

    first.camera.entries.push({
      id: "entry-1",
      category: "camera",
      presetId: "builtin-camera-zoom-in",
      params: {},
      order: 0,
    });

    expect(second.camera.entries).toEqual([]);
  });

  it("builds a complete built-in preset library with unique ids", () => {
    expect(BUILT_IN_PRESET_LIBRARY).toHaveLength(186);

    const ids = BUILT_IN_PRESET_LIBRARY.map((preset) => preset.id);
    expect(new Set(ids).size).toBe(ids.length);

    for (const category of PRESET_CATEGORIES) {
      expect(BUILT_IN_PRESET_LIBRARY.some((preset) => preset.category === category)).toBe(true);
    }

    for (const preset of BUILT_IN_PRESET_LIBRARY) {
      expect(preset.builtIn).toBe(true);
      expect(preset.modified).toBe(false);
      expect(preset.defaultPrompt).toBe(preset.prompt);
      expect(preset.defaultParams).toEqual(preset.defaults);
      expect(preset.defaultParams).not.toBe(preset.defaults);
      expect(preset.id).toBe(`builtin-${preset.category}-${preset.name}`);
    }
  });

  it("applies technical aspect-ratio defaults for built-in technical presets", () => {
    const verticalPreset = BUILT_IN_PRESET_LIBRARY.find(
      (preset) => preset.id === "builtin-technical-vertical-mobile-916",
    );
    const scopePreset = BUILT_IN_PRESET_LIBRARY.find(
      (preset) => preset.id === "builtin-technical-cinematic-scope-239",
    );

    expect(verticalPreset).toMatchObject({
      category: "technical",
      prompt: "9:16 vertical portrait framing, mobile-first social media composition",
      defaults: {
        ratio: "9:16",
        quality: "medium",
        steps: 20,
        cfg: 7,
        intensity: 100,
      },
    });
    expect(scopePreset).toMatchObject({
      category: "technical",
      defaults: {
        ratio: "2.39:1",
        quality: "medium",
        steps: 20,
        cfg: 7,
        intensity: 100,
      },
    });
  });

  it("derives preset descriptions and parameter definitions for representative presets", () => {
    const zoomInPreset = BUILT_IN_PRESET_LIBRARY.find(
      (preset) => preset.id === "builtin-camera-zoom-in",
    );
    const wesAndersonPreset = BUILT_IN_PRESET_LIBRARY.find(
      (preset) => preset.id === "builtin-look-wes-anderson-pastel",
    );

    expect(zoomInPreset).toMatchObject({
      description: "Zoom In preset for camera control with production-ready defaults.",
      defaults: {
        speed: "medium",
        intensity: 100,
        amplitude: 40,
      },
    });
    expect(zoomInPreset?.params.map((param) => param.key)).toEqual([
      "speed",
      "intensity",
      "amplitude",
    ]);

    expect(wesAndersonPreset?.prompt).toContain("pastel warm yellows and pinks");
    expect(wesAndersonPreset?.params.map((param) => param.key)).toEqual([
      "stylization",
      "saturation",
      "temperature",
      "detail",
      "intensity",
    ]);
  });

  it("exports built-in shot templates that resolve to library presets", () => {
    expect(BUILT_IN_SHOT_TEMPLATES.length).toBeGreaterThan(0);

    const presetIds = new Set(BUILT_IN_PRESET_LIBRARY.map((preset) => preset.id));
    const templateIds = BUILT_IN_SHOT_TEMPLATES.map((template) => template.id);
    expect(new Set(templateIds).size).toBe(templateIds.length);

    for (const template of BUILT_IN_SHOT_TEMPLATES) {
      expect(template.builtIn).toBe(true);

      for (const [category, track] of Object.entries(template.tracks)) {
        expect(track).toBeDefined();
        expect(track?.category).toBe(category);
        expect(track?.entries).toHaveLength(1);
        expect(track?.entries[0]).toMatchObject({
          id: `tmpl-${category}-${track?.entries[0].presetId.replace(`builtin-${category}-`, "")}`,
          category,
          params: {},
          order: 0,
          intensity: track?.intensity,
        });
        expect(presetIds.has(track!.entries[0].presetId)).toBe(true);
      }
    }
  });
});
