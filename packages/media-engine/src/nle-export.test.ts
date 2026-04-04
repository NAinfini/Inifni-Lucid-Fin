import { describe, it, expect } from 'vitest';
import { exportFCPXML, exportEDL } from './nle-export.js';
import type { NLEProject, NLEClip } from './nle-export.js';

function makeClip(overrides?: Partial<NLEClip>): NLEClip {
  return {
    id: 'clip-1',
    trackIndex: 0,
    trackType: 'video',
    assetPath: '/assets/shot1.mp4',
    startTime: 0,
    duration: 5,
    inPoint: 0,
    outPoint: 5,
    speed: 1,
    ...overrides,
  };
}

function makeProject(overrides?: Partial<NLEProject>): NLEProject {
  return {
    name: 'Test Project',
    fps: 24,
    width: 1920,
    height: 1080,
    clips: [makeClip()],
    ...overrides,
  };
}

describe('exportFCPXML', () => {
  it('generates valid XML structure', () => {
    const xml = exportFCPXML(makeProject());
    expect(xml).toContain('<?xml version="1.0"');
    expect(xml).toContain('<xmeml version="5">');
    expect(xml).toContain('<sequence>');
    expect(xml).toContain('<name>Test Project</name>');
    expect(xml).toContain('<timebase>24</timebase>');
    expect(xml).toContain('<width>1920</width>');
  });

  it('includes video clips in video track', () => {
    const xml = exportFCPXML(makeProject());
    expect(xml).toContain('<video>');
    expect(xml).toContain('clip-1');
    expect(xml).toContain('file://localhost/');
  });

  it('includes audio clips in audio track', () => {
    const project = makeProject({
      clips: [makeClip({ id: 'audio-1', trackType: 'audio', assetPath: '/assets/music.mp3' })],
    });
    const xml = exportFCPXML(project);
    expect(xml).toContain('<audio>');
    expect(xml).toContain('audio-1');
  });

  it('escapes XML special characters in name', () => {
    const project = makeProject({ name: 'Film <"Test"> & More' });
    const xml = exportFCPXML(project);
    expect(xml).toContain('Film &lt;&quot;Test&quot;&gt; &amp; More');
  });

  it('calculates correct frame numbers', () => {
    const project = makeProject({
      clips: [makeClip({ startTime: 1, duration: 2, inPoint: 0, outPoint: 2 })],
    });
    const xml = exportFCPXML(project);
    // startTime=1 at 24fps = frame 24, endTime=3 = frame 72
    expect(xml).toContain('<start>24</start>');
    expect(xml).toContain('<end>72</end>');
  });
});

describe('exportEDL', () => {
  it('generates valid EDL header', () => {
    const edl = exportEDL(makeProject());
    expect(edl).toContain('TITLE: Test Project');
    expect(edl).toContain('FCM: NON-DROP FRAME');
  });

  it('includes video clips with timecodes', () => {
    const edl = exportEDL(makeProject());
    expect(edl).toContain('001  AX       V     C');
    expect(edl).toContain('FROM CLIP NAME:');
  });

  it('sorts clips by start time', () => {
    const project = makeProject({
      clips: [
        makeClip({ id: 'b', startTime: 5, assetPath: '/b.mp4' }),
        makeClip({ id: 'a', startTime: 0, assetPath: '/a.mp4' }),
      ],
    });
    const edl = exportEDL(project);
    const aIdx = edl.indexOf('/a.mp4');
    const bIdx = edl.indexOf('/b.mp4');
    expect(aIdx).toBeLessThan(bIdx);
  });

  it('only includes video clips', () => {
    const project = makeProject({
      clips: [
        makeClip({ id: 'v1', trackType: 'video', assetPath: '/video.mp4' }),
        makeClip({ id: 'a1', trackType: 'audio', assetPath: '/audio.mp3' }),
      ],
    });
    const edl = exportEDL(project);
    expect(edl).toContain('/video.mp4');
    expect(edl).not.toContain('/audio.mp3');
  });

  it('handles empty clip list', () => {
    const edl = exportEDL(makeProject({ clips: [] }));
    expect(edl).toContain('TITLE:');
    expect(edl).not.toContain('001');
  });
});
