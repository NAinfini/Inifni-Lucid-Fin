import { describe, expect, it } from 'vitest';
import type { PresetDefinition, PresetExportV1 } from '@lucid-fin/contracts';
import { exportPresets, importPresets } from './preset-export.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const samplePreset: PresetDefinition = {
  id: 'builtin-camera-zoom-in',
  category: 'camera',
  name: 'Zoom In',
  description: 'Gradual camera zoom in',
  prompt: 'camera zoom in',
  builtIn: true,
  modified: false,
  params: [],
  defaults: { speed: 'medium', intensity: 100, amplitude: 40 },
};

const samplePresetCustomIntensity: PresetDefinition = {
  ...samplePreset,
  id: 'custom-abc',
  name: 'Custom Shot',
  defaults: { speed: 'fast', intensity: 75, amplitude: 60 },
};

const APP_VERSION = '0.0.7';

// ---------------------------------------------------------------------------
// exportPresets
// ---------------------------------------------------------------------------

describe('exportPresets', () => {
  it('serializes presets into PresetExportV1 envelope', () => {
    const result = exportPresets([samplePreset], { appVersion: APP_VERSION });

    expect(result.schemaVersion).toBe(1);
    expect(result.appVersion).toBe(APP_VERSION);
    expect(typeof result.exportedAt).toBe('string');
    // ISO-8601 check
    expect(() => new Date(result.exportedAt)).not.toThrow();
    expect(result.presets).toHaveLength(1);
    expect(result.presets[0]).toEqual({
      name: 'Zoom In',
      category: 'camera',
      values: { speed: 'medium', intensity: 100, amplitude: 40 },
    });
  });

  it('omits intensity field when it equals 100 (default)', () => {
    const result = exportPresets([samplePreset], { appVersion: APP_VERSION });
    expect(result.presets[0].intensity).toBeUndefined();
  });

  it('includes intensity field when it differs from 100', () => {
    const result = exportPresets([samplePresetCustomIntensity], { appVersion: APP_VERSION });
    expect(result.presets[0].intensity).toBe(75);
  });

  it('handles empty preset array', () => {
    const result = exportPresets([], { appVersion: APP_VERSION });
    expect(result.presets).toEqual([]);
    expect(result.schemaVersion).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// importPresets — valid data
// ---------------------------------------------------------------------------

describe('importPresets', () => {
  it('round-trips export -> import successfully', () => {
    const exported = exportPresets([samplePreset, samplePresetCustomIntensity], {
      appVersion: APP_VERSION,
    });
    const imported = importPresets(exported);

    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    expect(imported.presets).toHaveLength(2);
    expect(imported.presets[0].name).toBe('Zoom In');
    expect(imported.presets[0].category).toBe('camera');
    expect(imported.presets[1].name).toBe('Custom Shot');
  });

  it('accepts a valid hand-crafted payload', () => {
    const payload: PresetExportV1 = {
      schemaVersion: 1,
      exportedAt: '2026-05-06T12:00:00.000Z',
      appVersion: '1.0.0',
      presets: [
        {
          name: 'My Preset',
          category: 'lens',
          values: { focalLengthMm: 35 },
          intensity: 80,
          tags: ['portrait', 'soft'],
        },
      ],
    };
    const result = importPresets(payload);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.presets[0].tags).toEqual(['portrait', 'soft']);
    expect(result.presets[0].intensity).toBe(80);
  });

  it('accepts empty presets array', () => {
    const payload: PresetExportV1 = {
      schemaVersion: 1,
      exportedAt: '2026-05-06T12:00:00.000Z',
      appVersion: '1.0.0',
      presets: [],
    };
    const result = importPresets(payload);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.presets).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// importPresets — invalid data
// ---------------------------------------------------------------------------

describe('importPresets — invalid data', () => {
  it('rejects null', () => {
    const result = importPresets(null);
    expect(result).toEqual({
      ok: false,
      code: 'INVALID_FORMAT',
      message: 'Import data must be a JSON object.',
    });
  });

  it('rejects undefined', () => {
    const result = importPresets(undefined);
    expect(result).toEqual({
      ok: false,
      code: 'INVALID_FORMAT',
      message: 'Import data must be a JSON object.',
    });
  });

  it('rejects a string', () => {
    const result = importPresets('not-an-object');
    expect(result).toEqual({
      ok: false,
      code: 'INVALID_FORMAT',
      message: 'Import data must be a JSON object.',
    });
  });

  it('rejects an array', () => {
    const result = importPresets([1, 2, 3]);
    expect(result).toEqual({
      ok: false,
      code: 'INVALID_FORMAT',
      message: 'Import data must be a JSON object.',
    });
  });

  it('rejects missing required fields', () => {
    const result = importPresets({ schemaVersion: 1 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('VALIDATION_ERROR');
    expect(result.message).toContain('Validation failed');
  });

  it('rejects invalid preset category', () => {
    const result = importPresets({
      schemaVersion: 1,
      exportedAt: '2026-05-06T12:00:00.000Z',
      appVersion: '1.0.0',
      presets: [{ name: 'Bad', category: 'invalid-cat', values: {} }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('VALIDATION_ERROR');
  });

  it('rejects intensity out of range', () => {
    const result = importPresets({
      schemaVersion: 1,
      exportedAt: '2026-05-06T12:00:00.000Z',
      appVersion: '1.0.0',
      presets: [{ name: 'Bad', category: 'camera', values: {}, intensity: 150 }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('VALIDATION_ERROR');
  });

  it('rejects empty preset name', () => {
    const result = importPresets({
      schemaVersion: 1,
      exportedAt: '2026-05-06T12:00:00.000Z',
      appVersion: '1.0.0',
      presets: [{ name: '', category: 'camera', values: {} }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('VALIDATION_ERROR');
  });
});

// ---------------------------------------------------------------------------
// importPresets — version mismatch
// ---------------------------------------------------------------------------

describe('importPresets — version mismatch', () => {
  it('rejects schemaVersion > 1 with VERSION_MISMATCH error', () => {
    const result = importPresets({
      schemaVersion: 2,
      exportedAt: '2026-05-06T12:00:00.000Z',
      appVersion: '2.0.0',
      presets: [],
    });
    expect(result).toEqual({
      ok: false,
      code: 'VERSION_MISMATCH',
      message: expect.stringContaining('Unsupported schema version 2'),
    });
  });

  it('rejects schemaVersion 99 with upgrade suggestion', () => {
    const result = importPresets({
      schemaVersion: 99,
      exportedAt: '2026-05-06T12:00:00.000Z',
      appVersion: '99.0.0',
      presets: [],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('VERSION_MISMATCH');
    expect(result.message).toContain('update the application');
  });
});
