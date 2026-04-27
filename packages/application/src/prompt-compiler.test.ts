import { describe, expect, it } from 'vitest';
import {
  createEmptyPresetTrackSet,
  type Character,
  type Equipment,
  type Location,
  type PresetCategory,
  type PresetDefinition,
  type PresetTrackSet,
} from '@lucid-fin/contracts';
import { compilePrompt, getCameraShot, tokenizeForWordCount, type ResolvedCharacter } from './prompt-compiler.js';

function makePreset(
  id: string,
  category: PresetCategory,
  prompt: string,
  overrides?: Partial<PresetDefinition> & { negativePrompt?: string; promptFragment?: string },
): PresetDefinition {
  return {
    id,
    category,
    name: id,
    description: id,
    prompt,
    builtIn: true,
    modified: false,
    params: [],
    defaults: {},
    ...(overrides ?? {}),
  };
}

function makeTracks(): PresetTrackSet {
  const tracks = createEmptyPresetTrackSet();
  for (const _key of Object.keys(tracks) as PresetCategory[]) { /* init default entries if needed */ }
  return tracks;
}

describe('compilePrompt', () => {
  it('passes through basic text-only prompt', () => {
    const result = compilePrompt({
      nodeType: 'image',
      prompt: 'A cinematic portrait of a detective',
      providerId: 'kling',
      mode: 'text-to-image',
      presetLibrary: [],
    });

    expect(result.prompt).toBe('A cinematic portrait of a detective');
    expect(result.negativePrompt).toBeUndefined();
    expect(result.diagnostics).toBeDefined();
    expect(Array.isArray(result.diagnostics)).toBe(true);
    expect(result.segments).toBeDefined();
    expect(typeof result.wordCount).toBe('number');
    expect(typeof result.budget).toBe('number');
  });

  it('stacks preset fragments in the required order', () => {
    const presets = [
      makePreset('p-camera', 'camera', 'camera fragment'),
      makePreset('p-look', 'look', 'look fragment'),
      makePreset('p-technical', 'technical', 'technical fragment'),
      makePreset('p-flow', 'flow', 'flow fragment'),
    ];

    const tracks = makeTracks();
    tracks.look.entries.push({
      id: 'e-look',
      category: 'look',
      presetId: 'p-look',
      params: {},
      order: 0,
    });
    tracks.flow.entries.push({
      id: 'e-flow',
      category: 'flow',
      presetId: 'p-flow',
      params: {},
      order: 0,
    });
    tracks.technical.entries.push({
      id: 'e-technical',
      category: 'technical',
      presetId: 'p-technical',
      params: {},
      order: 0,
    });
    tracks.camera.entries.push({
      id: 'e-camera',
      category: 'camera',
      presetId: 'p-camera',
      params: {},
      order: 0,
    });

    const result = compilePrompt({
      nodeType: 'image',
      prompt: 'user scene',
      presetTracks: tracks,
      providerId: 'kling',
      mode: 'text-to-image',
      presetLibrary: presets,
    });

    expect(result.prompt).toContain('user scene');
    expect(result.prompt.indexOf('camera fragment')).toBeLessThan(
      result.prompt.indexOf('look fragment'),
    );
    expect(result.prompt.indexOf('look fragment')).toBeLessThan(
      result.prompt.indexOf('flow fragment'),
    );
    expect(result.prompt.indexOf('flow fragment')).toBeLessThan(
      result.prompt.indexOf('technical fragment'),
    );
  });

  it('trims prompt to model-specific word budget', () => {
    const longPrompt = Array.from({ length: 200 }, (_, i) => `word${i + 1}`).join(' ');

    const result = compilePrompt({
      nodeType: 'video',
      prompt: longPrompt,
      providerId: 'runway',
      mode: 'text-to-video',
      presetLibrary: [],
    });

    expect(result.prompt.split(/\s+/).length).toBe(150);
  });

  it('strips non-motion context in image-to-video mode', () => {
    const presets = [
      makePreset('p-look', 'look', 'highly detailed style'),
      makePreset('p-camera', 'camera', 'subject turns and walks forward'),
    ];
    const tracks = makeTracks();
    tracks.look.entries.push({
      id: 'e-look',
      category: 'look',
      presetId: 'p-look',
      params: {},
      order: 0,
    });
    tracks.camera.entries.push({
      id: 'e-camera',
      category: 'camera',
      presetId: 'p-camera',
      params: {},
      order: 0,
    });

    const result = compilePrompt({
      nodeType: 'video',
      prompt: 'A woman in a red dress. Camera pans left quickly. She has blue eyes.',
      presetTracks: tracks,
      providerId: 'kling',
      mode: 'image-to-video',
      presetLibrary: presets,
    });

    expect(result.prompt).toContain('Camera pans left quickly');
    expect(result.prompt).toContain('subject turns and walks forward');
    expect(result.prompt).not.toContain('highly detailed style');
    expect(result.prompt).not.toContain('blue eyes');
  });

  it('collects negative prompts from preset fields', () => {
    const presets = [
      makePreset('p1', 'scene', 'soft light', { negativePrompt: 'blurry' }),
      makePreset('p2', 'technical', 'high quality', {
        defaultParams: { negativePrompt: 'watermark' },
      }),
    ];
    const tracks = makeTracks();
    tracks.scene.entries.push({
      id: 'e-scene',
      category: 'scene',
      presetId: 'p1',
      params: {},
      order: 0,
    });
    tracks.technical.entries.push({
      id: 'e-technical',
      category: 'technical',
      presetId: 'p2',
      params: {},
      order: 0,
    });

    const result = compilePrompt({
      nodeType: 'image',
      providerId: 'kling',
      mode: 'text-to-image',
      presetTracks: tracks,
      presetLibrary: presets,
    });

    expect(result.negativePrompt).toContain('blurry');
    expect(result.negativePrompt).toContain('watermark');
  });

  it('supports blend entry interpolation and adapter params passthrough', () => {
    const presets = [
      makePreset('p-a', 'camera', 'slow dolly in'),
      makePreset('p-b', 'camera', 'fast orbit around subject'),
    ];
    const tracks = makeTracks();
    tracks.camera.entries.push({
      id: 'e-blend',
      category: 'camera',
      presetId: 'p-a',
      params: { speed: 'slow' },
      order: 0,
      blend: {
        category: 'camera',
        presetIdB: 'p-b',
        factor: 0.5,
        paramsB: { intensity: 0.7 },
      },
    });

    const result = compilePrompt({
      nodeType: 'video',
      providerId: 'kling',
      mode: 'text-to-video',
      presetTracks: tracks,
      presetLibrary: presets,
    });

    expect(result.prompt).toContain('(50% slow dolly in), (50% fast orbit around subject)');
    expect(result.params).toMatchObject({ speed: 'slow', intensity: 0.7 });
  });

  it('handles empty/missing preset tracks safely', () => {
    const result = compilePrompt({
      nodeType: 'audio',
      providerId: 'kling',
      mode: 'text-to-video',
      presetLibrary: [],
      presetTracks: undefined,
      prompt: '',
    });

    expect(result.prompt).toBe('');
    expect(result.negativePrompt).toBeUndefined();
    expect(result.referenceImages).toBeUndefined();
  });

  it('injects visible entity context into compiled prompt', () => {
    const character: Character = {
      id: 'char-1',
      name: 'Alex',
      role: 'protagonist',
      description: 'A grizzled detective.',
      appearance: 'Tall with sharp jawline. Short brown hair. Scar on left cheek.',
      personality: 'Stoic',
      costumes: [
        { id: 'c1', name: 'trench-coat', description: 'long dark trench coat' },
      ],
      tags: [],
      age: 45,
      gender: 'male',
      referenceImages: [],
      loadouts: [{ id: 'l1', name: 'default', equipmentIds: ['eq-1'] }],
      defaultLoadoutId: 'l1',
      createdAt: 0,
      updatedAt: 0,
    };
    const equipment: Equipment = {
      id: 'eq-1',
      name: 'handgun',
      type: 'weapon',
      description: 'A standard issue pistol.',
      tags: [],
      referenceImages: [],
      createdAt: 0,
      updatedAt: 0,
    };
    const resolved: ResolvedCharacter = {
      character,
      loadout: character.loadouts[0],
      equipment: [equipment],
      emotion: 'determined',
    };

    const location: Location = {
      id: 'loc-1',
      name: 'The Blue Moon Bar',
      timeOfDay: 'night',
      description: 'A dimly lit dive bar with neon signs',
      mood: 'tense',
      lighting: 'neon, dim',
      tags: [],
      referenceImages: [],
      createdAt: 0,
      updatedAt: 0,
    };

    const result = compilePrompt({
      nodeType: 'image',
      prompt: 'A scene in the city',
      negativePrompt: 'no crowd',
      characters: [resolved],
      locations: [location],
      equipmentItems: [equipment],
      providerId: 'kling',
      mode: 'text-to-image',
      presetLibrary: [],
    });

    // Entity descriptions should be merged into the compiled prompt alongside node text.
    expect(result.prompt).toContain('A scene in the city');
    expect(result.prompt).toContain('Alex');
    expect(result.prompt).toContain('Tall with sharp jawline');
    expect(result.prompt).toContain('expression reads determined');
    expect(result.prompt).toContain('The Blue Moon Bar');
    expect(result.prompt).toContain('dimly lit dive bar with neon signs');
    expect(result.prompt).toContain('handgun');
    expect(result.negativePrompt).toContain('no crowd');
  });

  it('detects conflicting presets and reports diagnostic', () => {
    const presets = [
      { id: 'scene:high-key', category: 'scene' as const, name: 'High Key', description: '', prompt: 'high key lighting', builtIn: true, modified: false, params: [], defaults: {} },
      { id: 'scene:low-key', category: 'scene' as const, name: 'Low Key', description: '', prompt: 'low key lighting', builtIn: true, modified: false, params: [], defaults: {} },
    ];
    const result = compilePrompt({
      nodeType: 'image',
      mode: 'text-to-image',
      prompt: 'test scene',
      providerId: 'test',
      presetLibrary: presets,
      presetTracks: {
        camera: { category: 'camera', entries: [] },
        lens: { category: 'lens', entries: [] },
        look: { category: 'look', entries: [] },
        scene: {
          category: 'scene',
          entries: [
            { id: 'e1', category: 'scene' as const, presetId: 'scene:high-key', params: {}, order: 0, intensity: 80 },
            { id: 'e2', category: 'scene' as const, presetId: 'scene:low-key', params: {}, order: 1, intensity: 50 },
          ],
        },
        composition: { category: 'composition', entries: [] },
        emotion: { category: 'emotion', entries: [] },
        flow: { category: 'flow', entries: [] },
        technical: { category: 'technical', entries: [] },
      },
    });

    const conflicts = result.diagnostics.filter(d => d.type === 'conflict');
    expect(conflicts.length).toBeGreaterThanOrEqual(1);
    expect(conflicts[0].message).toContain('high-key');
    expect(conflicts[0].message).toContain('low-key');
  });

  it('compiles character-sheet mode with structured fields', () => {
    const result = compilePrompt({
      nodeType: 'image',
      mode: 'character-sheet',
      providerId: 'test',
      presetLibrary: [],
      characters: [{
        character: {
          id: 'char-1',
          name: 'Maya Chen',
          role: 'protagonist',
          description: '',
          appearance: '',
          personality: '',
          costumes: [],
          tags: [],
          referenceImages: [],
          loadouts: [],
          defaultLoadoutId: '',
          createdAt: 0,
          updatedAt: 0,
          age: 28,
          gender: 'female',
          face: {
            eyeShape: 'almond-shaped',
            eyeColor: 'dark brown',
            noseType: 'straight',
            lipShape: 'full',
            jawline: 'oval',
            definingFeatures: 'small scar above left eyebrow',
          },
          hair: { color: 'jet black', style: 'bob', length: 'shoulder-length', texture: 'straight' },
          skinTone: 'warm olive',
          body: { height: "5'6\"", build: 'athletic' },
          distinctTraits: ['silver nose stud'],
        },
      }],
    });

    expect(result.prompt).toContain('Maya Chen');
    expect(result.prompt).toContain('SUBJECT');
    expect(result.prompt).toContain('almond-shaped dark brown eyes');
    expect(result.prompt).toContain('jet black, bob, shoulder-length, straight');
    expect(result.prompt).toContain('warm olive');
    expect(result.prompt).toContain('athletic');
    expect(result.prompt).toContain('silver nose stud');
    expect(result.prompt).toContain('TURNAROUND');
    expect(result.prompt).toContain('EXPRESSION SHEET');
    expect(result.negativePrompt).toContain('no distorted anatomy');
  });

  it('applies style guide defaults to empty preset tracks', () => {
    const presets = [
      makePreset('look:cinematic-realism', 'look', 'cinematic realism'),
      makePreset('scene:low-key', 'scene', 'low key dramatic lighting'),
    ];
    const result = compilePrompt({
      nodeType: 'image',
      mode: 'text-to-image',
      prompt: 'a warrior',
      providerId: 'test',
      presetLibrary: presets,
      styleGuide: {
        artStyle: 'cinematic-realism',
        lighting: 'dramatic',
      },
    });

    expect(result.prompt).toContain('cinematic realism');
    expect(result.prompt).toContain('low key dramatic lighting');
    expect(result.prompt).toContain('Maintain consistent');
  });

  it('does not override existing node presets with style guide', () => {
    const presets = [
      makePreset('look:anime-cel', 'look', 'anime cel shading'),
      makePreset('look:cinematic-realism', 'look', 'cinematic realism'),
    ];
    const result = compilePrompt({
      nodeType: 'image',
      mode: 'text-to-image',
      prompt: 'a warrior',
      providerId: 'test',
      presetLibrary: presets,
      presetTracks: {
        camera: { category: 'camera', entries: [] },
        lens: { category: 'lens', entries: [] },
        look: {
          category: 'look',
          entries: [{ id: 'e1', category: 'look' as const, presetId: 'look:anime-cel', params: {}, order: 0 }],
        },
        scene: { category: 'scene', entries: [] },
        composition: { category: 'composition', entries: [] },
        emotion: { category: 'emotion', entries: [] },
        flow: { category: 'flow', entries: [] },
        technical: { category: 'technical', entries: [] },
      },
      styleGuide: {
        artStyle: 'cinematic-realism',
      },
    });

    expect(result.prompt).toContain('anime cel shading');
    expect(result.prompt).not.toContain('cinematic realism');
  });

  it('compiles voice mode with vocal traits and emotion', () => {
    const result = compilePrompt({
      nodeType: 'audio',
      mode: 'voice',
      providerId: 'test',
      presetLibrary: [],
      dialogueText: 'I will find you.',
      emotion: 'determined',
      characters: [{
        character: {
          id: 'c1', name: 'Maya', role: 'protagonist', description: '', appearance: '',
          personality: '', costumes: [], tags: [], referenceImages: [], loadouts: [],
          defaultLoadoutId: '', createdAt: 0, updatedAt: 0,
          vocalTraits: { pitch: 'alto', accent: 'British RP', cadence: 'measured' },
        },
      }],
    });

    expect(result.prompt).toContain('alto voice');
    expect(result.prompt).toContain('British RP accent');
    expect(result.prompt).toContain('determined tone');
    expect(result.prompt).toContain('I will find you');
  });

  it('compiles music mode with genre, tempo, and instruments', () => {
    const result = compilePrompt({
      nodeType: 'audio',
      mode: 'music',
      prompt: 'epic battle theme',
      providerId: 'test',
      presetLibrary: [],
      musicConfig: {
        genre: 'orchestral',
        tempo: '140bpm',
        key: 'D minor',
        instrumentation: ['brass', 'timpani', 'strings'],
      },
      durationSeconds: 30,
    });

    expect(result.prompt).toContain('epic battle theme');
    expect(result.prompt).toContain('orchestral');
    expect(result.prompt).toContain('140bpm tempo');
    expect(result.prompt).toContain('D minor');
    expect(result.prompt).toContain('brass, timpani, strings');
    expect(result.prompt).toContain('30 seconds');
  });

  it('compiles sfx mode with environment and material', () => {
    const result = compilePrompt({
      nodeType: 'audio',
      mode: 'sfx',
      prompt: 'sword clash',
      providerId: 'test',
      presetLibrary: [],
      sfxPlacement: 'close',
      locations: [{
        id: 'loc1', name: 'Dungeon',
        description: '', tags: [], referenceImages: [], createdAt: 0, updatedAt: 0,
        atmosphereKeywords: ['echoing', 'damp'],
      }],
      equipmentItems: [{
        id: 'eq1', name: 'Broadsword', type: 'weapon',
        description: '', tags: [], referenceImages: [], createdAt: 0, updatedAt: 0,
        material: 'forged steel',
      }],
    });

    expect(result.prompt).toContain('sword clash');
    expect(result.prompt).toContain('Dungeon');
    expect(result.prompt).toContain('echoing');
    expect(result.prompt).toContain('forged steel Broadsword');
    expect(result.prompt).toContain('close-up');
  });
});

describe('getCameraShot', () => {
  it('returns close-up for close-up preset IDs', () => {
    const tracks = makeTracks();
    tracks.camera.entries.push({
      id: 'e', category: 'camera', presetId: 'extreme-close-up', params: {}, order: 0,
    });
    expect(getCameraShot(tracks)).toBe('close-up');
  });

  it('returns wide for wide/establishing preset IDs', () => {
    const tracks = makeTracks();
    tracks.camera.entries.push({
      id: 'e', category: 'camera', presetId: 'wide-establishing-shot', params: {}, order: 0,
    });
    expect(getCameraShot(tracks)).toBe('wide');
  });

  it('returns medium for non-matching preset IDs', () => {
    const tracks = makeTracks();
    tracks.camera.entries.push({
      id: 'e', category: 'camera', presetId: 'over-the-shoulder', params: {}, order: 0,
    });
    expect(getCameraShot(tracks)).toBe('medium');
  });

  it('returns default when no camera entries exist', () => {
    const tracks = makeTracks();
    expect(getCameraShot(tracks)).toBe('default');
  });

  it('returns default when preset tracks are undefined', () => {
    expect(getCameraShot(undefined)).toBe('default');
  });
});

describe('tokenizeForWordCount', () => {
  it('splits ASCII on whitespace', () => {
    expect(tokenizeForWordCount('hello world foo')).toEqual(['hello', 'world', 'foo']);
  });

  it('treats each CJK ideograph as its own token', () => {
    // Without CJK tokenization this whole string would be one "word" and
    // every downstream word-budget / duplicate-phrase check would silently
    // no-op on Chinese prompts.
    expect(tokenizeForWordCount('身材高大')).toEqual(['身', '材', '高', '大']);
  });

  it('preserves ASCII word groups when mixed with CJK', () => {
    // "tall hero 高大的 person" → 5 tokens: tall | hero | 高 | 大 | 的 | person
    expect(tokenizeForWordCount('tall hero 高大的 person')).toEqual([
      'tall',
      'hero',
      '高',
      '大',
      '的',
      'person',
    ]);
  });

  it('handles Japanese kana as CJK', () => {
    expect(tokenizeForWordCount('こんにちは')).toHaveLength(5);
  });

  it('returns empty array for empty input', () => {
    expect(tokenizeForWordCount('')).toEqual([]);
    expect(tokenizeForWordCount('   ')).toEqual([]);
  });
});

describe('compilePrompt — CJK word budget', () => {
  it('trims a CJK-only prompt to the model-specific word budget', () => {
    // 200 Chinese ideographs — old code treated this as 1 "word", budget
    // never triggered, prompt was never trimmed. After the tokenizer fix
    // every ideograph counts as one token.
    const longCjk = '的'.repeat(200);

    const result = compilePrompt({
      nodeType: 'video',
      prompt: longCjk,
      providerId: 'runway',
      mode: 'text-to-video',
      presetLibrary: [],
    });

    // Runway budget is 150; wordCount should match the trimmed length, not
    // the untrimmed 200.
    expect(tokenizeForWordCount(result.prompt).length).toBe(150);
  });
});
