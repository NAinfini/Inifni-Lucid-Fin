import { describe, it, expect } from 'vitest';
import { exportSRT, exportASS } from './subtitles.js';
import type { SubtitleCue } from './subtitles.js';

const cues: SubtitleCue[] = [
  { id: '1', startTime: 0, endTime: 2.5, text: 'Hello world' },
  { id: '2', startTime: 3, endTime: 5.1, text: 'Second line' },
];

describe('exportSRT', () => {
  it('generates valid SRT format', () => {
    const srt = exportSRT(cues);
    expect(srt).toContain('1\n00:00:00,000 --> 00:00:02,500\nHello world');
    expect(srt).toContain('2\n00:00:03,000 --> 00:00:05,100\nSecond line');
  });

  it('sorts cues by start time', () => {
    const reversed: SubtitleCue[] = [
      { id: '2', startTime: 3, endTime: 5, text: 'Second' },
      { id: '1', startTime: 0, endTime: 2, text: 'First' },
    ];
    const srt = exportSRT(reversed);
    const firstIdx = srt.indexOf('First');
    const secondIdx = srt.indexOf('Second');
    expect(firstIdx).toBeLessThan(secondIdx);
  });

  it('handles zero-length cue list', () => {
    expect(exportSRT([])).toBe('');
  });

  it('formats hours correctly', () => {
    const longCue: SubtitleCue[] = [{ id: '1', startTime: 3661.5, endTime: 3665, text: 'Late' }];
    const srt = exportSRT(longCue);
    expect(srt).toContain('01:01:01,500');
  });
});

describe('exportASS', () => {
  it('generates valid ASS header', () => {
    const ass = exportASS(cues);
    expect(ass).toContain('[Script Info]');
    expect(ass).toContain('PlayResX: 1920');
    expect(ass).toContain('PlayResY: 1080');
    expect(ass).toContain('[V4+ Styles]');
    expect(ass).toContain('[Events]');
  });

  it('includes dialogue lines', () => {
    const ass = exportASS(cues);
    expect(ass).toContain('Hello world');
    expect(ass).toContain('Second line');
  });

  it('respects custom resolution', () => {
    const ass = exportASS(cues, 3840, 2160);
    expect(ass).toContain('PlayResX: 3840');
    expect(ass).toContain('PlayResY: 2160');
  });

  it('applies style overrides', () => {
    const styled: SubtitleCue[] = [
      { id: '1', startTime: 0, endTime: 1, text: 'Bold', style: { bold: true, fontSize: 64 } },
    ];
    const ass = exportASS(styled);
    expect(ass).toContain('\\b1');
    expect(ass).toContain('\\fs64');
  });

  it('replaces newlines with \\N in ASS', () => {
    const multiline: SubtitleCue[] = [
      { id: '1', startTime: 0, endTime: 1, text: 'Line 1\nLine 2' },
    ];
    const ass = exportASS(multiline);
    expect(ass).toContain('Line 1\\NLine 2');
  });
});
