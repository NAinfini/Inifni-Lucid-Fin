import { describe, it, expect } from 'vitest';
import { parseFountain, parsePlaintext, parseScript } from '../src/script-parser.js';

describe('parseFountain', () => {
  it('parses a single scene heading', () => {
    const scenes = parseFountain('INT. COFFEE SHOP - DAY\n\nA quiet morning.');
    expect(scenes).toHaveLength(1);
    expect(scenes[0].heading).toBe('INT. COFFEE SHOP - DAY');
    expect(scenes[0].location).toBe('COFFEE SHOP');
    expect(scenes[0].timeOfDay).toBe('DAY');
    expect(scenes[0].content).toContain('A quiet morning.');
  });

  it('parses multiple scenes', () => {
    const text = `INT. OFFICE - NIGHT\n\nWorking late.\n\nEXT. PARK - DAY\n\nBirds singing.`;
    const scenes = parseFountain(text);
    expect(scenes).toHaveLength(2);
    expect(scenes[0].location).toBe('OFFICE');
    expect(scenes[0].timeOfDay).toBe('NIGHT');
    expect(scenes[1].location).toBe('PARK');
    expect(scenes[1].timeOfDay).toBe('DAY');
  });

  it('extracts character names from dialogue', () => {
    const text = `INT. ROOM - DAY\n\n\nJOHN\nHello there.\n\n\nMARY\nHi John.`;
    const scenes = parseFountain(text);
    expect(scenes[0].characters).toContain('JOHN');
    expect(scenes[0].characters).toContain('MARY');
  });

  it('extracts dialogue lines', () => {
    const text = `INT. ROOM - DAY\n\n\nJOHN\nHello there.`;
    const scenes = parseFountain(text);
    expect(scenes[0].dialogue).toHaveLength(1);
    expect(scenes[0].dialogue[0].character).toBe('JOHN');
    expect(scenes[0].dialogue[0].line).toBe('Hello there.');
  });

  it('deduplicates character names', () => {
    const text = `INT. ROOM - DAY\n\n\nJOHN\nLine one.\n\n\nJOHN\nLine two.`;
    const scenes = parseFountain(text);
    expect(scenes[0].characters.filter((c) => c === 'JOHN')).toHaveLength(1);
  });

  it('handles EXT. and INT/EXT. headings', () => {
    const text = `EXT. BEACH - SUNSET\n\nWaves.\n\nINT/EXT. CAR - NIGHT\n\nDriving.`;
    const scenes = parseFountain(text);
    expect(scenes).toHaveLength(2);
    expect(scenes[0].location).toBe('BEACH');
    expect(scenes[0].timeOfDay).toBe('SUNSET');
    expect(scenes[1].location).toBe('CAR');
  });

  it('handles transitions', () => {
    const text = `INT. ROOM - DAY\n\nAction.\n\nCUT TO:\n\nMore action.`;
    const scenes = parseFountain(text);
    expect(scenes[0].content).toContain('CUT TO:');
  });

  it('returns empty array for empty input', () => {
    expect(parseFountain('')).toEqual([]);
  });

  it('returns empty array for text with no scene headings', () => {
    expect(parseFountain('Just some random text.')).toEqual([]);
  });
});

describe('parsePlaintext', () => {
  it('wraps text in a single scene', () => {
    const scenes = parsePlaintext('Hello world');
    expect(scenes).toHaveLength(1);
    expect(scenes[0].heading).toBe('Scene 1');
    expect(scenes[0].content).toBe('Hello world');
    expect(scenes[0].characters).toEqual([]);
  });

  it('returns empty for blank input', () => {
    expect(parsePlaintext('')).toEqual([]);
    expect(parsePlaintext('   ')).toEqual([]);
  });
});

describe('parseScript', () => {
  it('defaults to fountain format', () => {
    const scenes = parseScript('INT. LAB - NIGHT\n\nExperiment.');
    expect(scenes).toHaveLength(1);
    expect(scenes[0].location).toBe('LAB');
  });

  it('uses plaintext when specified', () => {
    const scenes = parseScript('INT. LAB - NIGHT', 'plaintext');
    expect(scenes).toHaveLength(1);
    expect(scenes[0].heading).toBe('Scene 1');
  });

  it('falls back to plaintext for fdx', () => {
    const scenes = parseScript('Some fdx content', 'fdx');
    expect(scenes).toHaveLength(1);
    expect(scenes[0].heading).toBe('Scene 1');
  });
});
