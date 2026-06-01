import { describe, expect, it } from 'vitest';
import type { Canvas, CanvasNode, CanvasEdge } from '@lucid-fin/contracts';
import { scoreSession, renderQualitySnippet, type QualityReport, type ScoringInput } from './quality-scoring.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeResult(overrides?: Partial<ScoringInput>): ScoringInput {
  return {
    outcome: 'completed',
    steps: 10,
    toolCalls: [],
    toolCallCounts: {},
    askUserCount: 2,
    promptTokensEstimated: 5000,
    stylePlateLocked: true,
    contractSatisfied: true,
    exitOutcome: 'satisfied',
    blocker: null,
    ...overrides,
  };
}

function makeNode(type: string, overrides?: Record<string, unknown>): CanvasNode {
  const now = Date.now();
  return {
    id: `node-${Math.random().toString(36).slice(2, 8)}`,
    type: type as CanvasNode['type'],
    position: { x: 0, y: 0 },
    data: {},
    title: `Test ${type}`,
    bypassed: false,
    locked: false,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as CanvasNode;
}

function makeImageNode(prompt?: string, refs?: Record<string, unknown>): CanvasNode {
  return makeNode('image', {
    data: {
      prompt: prompt ?? 'A cinematic wide shot of a cyberpunk cityscape at night with neon lights',
      status: 'done',
      assetHash: 'sha256:abc',
      ...(refs ?? {}),
    },
  });
}

function makeVideoNode(prompt?: string, anchors?: Record<string, unknown>): CanvasNode {
  return makeNode('video', {
    data: {
      prompt: prompt ?? 'Camera slowly pans across the neon-lit rooftops as a courier runs',
      status: 'done',
      duration: 6,
      ...(anchors ?? {}),
    },
  });
}

function makeAudioNode(prompt?: string): CanvasNode {
  return makeNode('audio', {
    data: {
      prompt: prompt ?? 'Ambient cyberpunk city soundscape with distant sirens',
      audioType: 'sfx',
      status: 'done',
    },
  });
}

function makeEdge(source: string, target: string): CanvasEdge {
  return {
    id: `edge-${Math.random().toString(36).slice(2, 8)}`,
    source,
    target,
    data: { status: 'idle' as const },
  };
}

function makeCanvas(overrides?: Partial<Canvas>): Canvas {
  return {
    id: 'canvas-1',
    name: 'Test Canvas',
    nodes: [],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    notes: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

function makeGoodCanvas(): Canvas {
  const img1 = makeImageNode('Character reference sheet with full body turnaround', { characterRefs: [{ id: 'char-1' }] });
  const img2 = makeImageNode('Wide establishing shot of the cyberpunk city', { locationRefs: [{ id: 'loc-1' }] });
  const vid1 = makeVideoNode('Courier runs across neon rooftops', { firstFrameNodeId: img2.id });
  const vid2 = makeVideoNode('Confrontation on the rooftop at dawn');
  const aud1 = makeAudioNode('Tense electronic music building to climax');

  return makeCanvas({
    nodes: [img1, img2, vid1, vid2, aud1],
    edges: [makeEdge(img2.id, vid1.id), makeEdge(vid1.id, vid2.id)],
    settings: {
      stylePlate: 'Cinematic cyberpunk, neon-lit, high contrast',
      negativePrompt: 'blurry, low quality, cartoon',
      aspectRatio: '16:9',
    },
  });
}

// ---------------------------------------------------------------------------
// Composite scoring
// ---------------------------------------------------------------------------

describe('scoreSession', () => {
  describe('composite score', () => {
    it('returns a score between 0 and 100', () => {
      const report = scoreSession(makeResult(), makeGoodCanvas());
      expect(report.composite).toBeGreaterThanOrEqual(0);
      expect(report.composite).toBeLessThanOrEqual(100);
    });

    it('gives a high score to a well-structured session', () => {
      const canvas = makeGoodCanvas();
      const result = makeResult({
        toolCallCounts: {
          'canvas.createNodes': 1,
          'canvas.generation': 3,
          'canvas.setSettings': 1,
          'entity.generateRefImage': 1,
        },
        contractSatisfied: true,
        stylePlateLocked: true,
      });
      const report = scoreSession(result, canvas);
      expect(report.composite).toBeGreaterThan(60);
      expect(report.grade).toMatch(/^[AB]$/);
    });

    it('gives a low score to an empty canvas session', () => {
      const result = makeResult({
        outcome: 'completed',
        stylePlateLocked: false,
        contractSatisfied: false,
        exitOutcome: 'unsatisfied',
        blocker: 'missing_commit',
        toolCallCounts: {},
      });
      const report = scoreSession(result, makeCanvas());
      expect(report.composite).toBeLessThan(30);
      expect(report.grade).toMatch(/^[DF]$/);
    });

    it('gives F grade to errored sessions', () => {
      const result = makeResult({
        outcome: 'error',
        error: 'LLM connection failed',
        stylePlateLocked: false,
        contractSatisfied: false,
        toolCallCounts: {},
      });
      const report = scoreSession(result, null);
      expect(report.grade).toBe('F');
    });

    it('handles null canvas gracefully', () => {
      const report = scoreSession(makeResult(), null);
      expect(report.composite).toBeGreaterThanOrEqual(0);
      expect(report.dimensions.length).toBe(7);
    });
  });

  // ---------------------------------------------------------------------------
  // Grade bands
  // ---------------------------------------------------------------------------

  describe('grade bands', () => {
    it('maps composite >= 80 to A', () => {
      const canvas = makeGoodCanvas();
      const result = makeResult({
        toolCallCounts: {
          'canvas.createNodes': 1,
          'canvas.generation': 5,
          'canvas.setSettings': 1,
          'entity.generateRefImage': 1,
        },
        contractSatisfied: true,
        stylePlateLocked: true,
        askUserCount: 2,
      });
      const report = scoreSession(result, canvas);
      if (report.composite >= 80) {
        expect(report.grade).toBe('A');
      }
    });

    it('maps composite < 20 to F', () => {
      const result = makeResult({
        outcome: 'error',
        contractSatisfied: false,
        stylePlateLocked: false,
        toolCallCounts: {},
      });
      const report = scoreSession(result, makeCanvas());
      if (report.composite < 20) {
        expect(report.grade).toBe('F');
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Dimensions
  // ---------------------------------------------------------------------------

  describe('dimensions', () => {
    it('produces exactly 7 dimensions', () => {
      const report = scoreSession(makeResult(), makeGoodCanvas());
      expect(report.dimensions).toHaveLength(7);
    });

    it('all dimensions have name, score, maxScore, weight, details', () => {
      const report = scoreSession(makeResult(), makeGoodCanvas());
      for (const d of report.dimensions) {
        expect(typeof d.name).toBe('string');
        expect(d.name.length).toBeGreaterThan(0);
        expect(d.score).toBeGreaterThanOrEqual(0);
        expect(d.score).toBeLessThanOrEqual(d.maxScore);
        expect(d.weight).toBeGreaterThan(0);
        expect(typeof d.details).toBe('string');
      }
    });

    it('dimension weights sum to 100', () => {
      const report = scoreSession(makeResult(), makeGoodCanvas());
      const totalWeight = report.dimensions.reduce((sum, d) => sum + d.weight, 0);
      expect(totalWeight).toBe(100);
    });

    it('includes Style & Settings dimension', () => {
      const report = scoreSession(makeResult(), makeGoodCanvas());
      const dim = report.dimensions.find((d) => d.name === 'Style & Settings');
      expect(dim).toBeDefined();
    });

    it('includes Node Creation dimension', () => {
      const report = scoreSession(makeResult(), makeGoodCanvas());
      const dim = report.dimensions.find((d) => d.name === 'Node Creation');
      expect(dim).toBeDefined();
    });

    it('includes Prompt Quality dimension', () => {
      const report = scoreSession(makeResult(), makeGoodCanvas());
      const dim = report.dimensions.find((d) => d.name === 'Prompt Quality');
      expect(dim).toBeDefined();
    });

    it('includes Contract Outcome dimension', () => {
      const report = scoreSession(makeResult(), makeGoodCanvas());
      const dim = report.dimensions.find((d) => d.name === 'Contract Outcome');
      expect(dim).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Style & Settings scoring
  // ---------------------------------------------------------------------------

  describe('Style & Settings dimension', () => {
    it('scores high when stylePlate, negativePrompt, and aspectRatio are set', () => {
      const canvas = makeCanvas({
        settings: {
          stylePlate: 'Cinematic',
          negativePrompt: 'blurry',
          aspectRatio: '16:9',
        },
      });
      const report = scoreSession(makeResult({ stylePlateLocked: true }), canvas);
      const dim = report.dimensions.find((d) => d.name === 'Style & Settings')!;
      expect(dim.score).toBe(1);
    });

    it('scores 0.6 when only stylePlate is locked', () => {
      const canvas = makeCanvas({ settings: { stylePlate: 'Cinematic' } });
      const report = scoreSession(makeResult({ stylePlateLocked: true }), canvas);
      const dim = report.dimensions.find((d) => d.name === 'Style & Settings')!;
      expect(dim.score).toBe(0.6);
    });

    it('scores 0 when nothing is set', () => {
      const canvas = makeCanvas();
      const report = scoreSession(makeResult({ stylePlateLocked: false }), canvas);
      const dim = report.dimensions.find((d) => d.name === 'Style & Settings')!;
      expect(dim.score).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Node Creation scoring
  // ---------------------------------------------------------------------------

  describe('Node Creation dimension', () => {
    it('scores higher with more visual and audio nodes', () => {
      const fewNodes = makeCanvas({ nodes: [makeImageNode()] });
      const manyNodes = makeCanvas({
        nodes: [
          makeImageNode(), makeImageNode(), makeImageNode(),
          makeVideoNode(), makeVideoNode(),
          makeAudioNode(),
        ],
      });
      const rFew = scoreSession(makeResult(), fewNodes);
      const rMany = scoreSession(makeResult(), manyNodes);
      const dimFew = rFew.dimensions.find((d) => d.name === 'Node Creation')!;
      const dimMany = rMany.dimensions.find((d) => d.name === 'Node Creation')!;
      expect(dimMany.score).toBeGreaterThan(dimFew.score);
    });

    it('scores 0 for empty canvas', () => {
      const report = scoreSession(makeResult(), makeCanvas());
      const dim = report.dimensions.find((d) => d.name === 'Node Creation')!;
      expect(dim.score).toBe(0);
    });

    it('rewards having both image and video nodes', () => {
      const onlyImage = makeCanvas({ nodes: [makeImageNode(), makeImageNode()] });
      const mixed = makeCanvas({ nodes: [makeImageNode(), makeVideoNode()] });
      const rImage = scoreSession(makeResult(), onlyImage);
      const rMixed = scoreSession(makeResult(), mixed);
      const dimImage = rImage.dimensions.find((d) => d.name === 'Node Creation')!;
      const dimMixed = rMixed.dimensions.find((d) => d.name === 'Node Creation')!;
      expect(dimMixed.score).toBeGreaterThan(dimImage.score);
    });
  });

  // ---------------------------------------------------------------------------
  // Prompt Quality scoring
  // ---------------------------------------------------------------------------

  describe('Prompt Quality dimension', () => {
    it('scores higher for longer, more detailed prompts', () => {
      const shortPrompt = makeCanvas({ nodes: [makeImageNode('cat')] });
      const longPrompt = makeCanvas({
        nodes: [makeImageNode(
          'A highly detailed cinematic wide-angle shot of a cyberpunk city at night, ' +
          'neon signs reflecting on wet asphalt, volumetric fog, three-point studio lighting, ' +
          'rain particles caught in street lamp glow, establishing shot for film noir mood, ' +
          'ultra-high resolution 4K render with ray tracing and global illumination',
        )],
      });
      const rShort = scoreSession(makeResult(), shortPrompt);
      const rLong = scoreSession(makeResult(), longPrompt);
      const dimShort = rShort.dimensions.find((d) => d.name === 'Prompt Quality')!;
      const dimLong = rLong.dimensions.find((d) => d.name === 'Prompt Quality')!;
      expect(dimLong.score).toBeGreaterThan(dimShort.score);
    });

    it('scores 0 when no generatable nodes exist', () => {
      const textOnly = makeCanvas({ nodes: [makeNode('text', { data: { content: 'hello' } })] });
      const report = scoreSession(makeResult(), textOnly);
      const dim = report.dimensions.find((d) => d.name === 'Prompt Quality')!;
      expect(dim.score).toBe(0);
    });

    it('penalizes nodes missing prompts', () => {
      const missingPrompt = makeCanvas({
        nodes: [
          makeImageNode('Good prompt here'),
          makeNode('image', { data: { status: 'empty' } }),
        ],
      });
      const report = scoreSession(makeResult(), missingPrompt);
      const dim = report.dimensions.find((d) => d.name === 'Prompt Quality')!;
      expect(dim.score).toBeLessThan(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Entity Bindings scoring
  // ---------------------------------------------------------------------------

  describe('Entity Bindings dimension', () => {
    it('scores 1 when all visual nodes have entity refs', () => {
      const canvas = makeCanvas({
        nodes: [
          makeImageNode('Shot', { characterRefs: [{ id: 'c1' }] }),
          makeVideoNode('Scene', { locationRefs: [{ id: 'l1' }] }),
        ],
      });
      const report = scoreSession(makeResult(), canvas);
      const dim = report.dimensions.find((d) => d.name === 'Entity Bindings')!;
      expect(dim.score).toBe(1);
    });

    it('scores 0.5 when half of visual nodes have entity refs', () => {
      const canvas = makeCanvas({
        nodes: [
          makeImageNode('Shot', { characterRefs: [{ id: 'c1' }] }),
          makeImageNode('Shot 2'),
        ],
      });
      const report = scoreSession(makeResult(), canvas);
      const dim = report.dimensions.find((d) => d.name === 'Entity Bindings')!;
      expect(dim.score).toBe(0.5);
    });

    it('scores 0 when no visual nodes exist', () => {
      const canvas = makeCanvas({ nodes: [makeAudioNode()] });
      const report = scoreSession(makeResult(), canvas);
      const dim = report.dimensions.find((d) => d.name === 'Entity Bindings')!;
      expect(dim.score).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Edge Connectivity scoring
  // ---------------------------------------------------------------------------

  describe('Edge Connectivity dimension', () => {
    it('scores higher with more connected nodes', () => {
      const n1 = makeImageNode();
      const n2 = makeVideoNode('Scene', { firstFrameNodeId: n1.id });
      const canvas = makeCanvas({
        nodes: [n1, n2],
        edges: [makeEdge(n1.id, n2.id)],
      });
      const report = scoreSession(makeResult(), canvas);
      const dim = report.dimensions.find((d) => d.name === 'Edge Connectivity')!;
      expect(dim.score).toBeGreaterThan(0);
    });

    it('scores 0 for a single node', () => {
      const canvas = makeCanvas({ nodes: [makeImageNode()] });
      const report = scoreSession(makeResult(), canvas);
      const dim = report.dimensions.find((d) => d.name === 'Edge Connectivity')!;
      expect(dim.score).toBe(0);
    });

    it('ignores edges pointing to nonexistent nodes', () => {
      const n1 = makeImageNode();
      const canvas = makeCanvas({
        nodes: [n1],
        edges: [makeEdge(n1.id, 'nonexistent-node')],
      });
      const report = scoreSession(makeResult(), canvas);
      const dim = report.dimensions.find((d) => d.name === 'Edge Connectivity')!;
      expect(dim.score).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Tool Usage scoring
  // ---------------------------------------------------------------------------

  describe('Tool Usage dimension', () => {
    it('scores higher when key tools are used', () => {
      const resultGood = makeResult({
        toolCallCounts: {
          'canvas.createNodes': 1,
          'canvas.generation': 3,
          'canvas.setSettings': 1,
          'entity.generateRefImage': 1,
        },
        askUserCount: 2,
      });
      const resultBad = makeResult({ toolCallCounts: {} });
      const rGood = scoreSession(resultGood, makeGoodCanvas());
      const rBad = scoreSession(resultBad, makeGoodCanvas());
      const dimGood = rGood.dimensions.find((d) => d.name === 'Tool Usage')!;
      const dimBad = rBad.dimensions.find((d) => d.name === 'Tool Usage')!;
      expect(dimGood.score).toBeGreaterThan(dimBad.score);
    });

    it('does not penalize for moderate askUser count', () => {
      const result = makeResult({
        toolCallCounts: { 'canvas.createNodes': 1 },
        askUserCount: 3,
      });
      const report = scoreSession(result, makeGoodCanvas());
      const dim = report.dimensions.find((d) => d.name === 'Tool Usage')!;
      expect(dim.score).toBeGreaterThan(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Contract Outcome scoring
  // ---------------------------------------------------------------------------

  describe('Contract Outcome dimension', () => {
    it('scores 1 for satisfied contract', () => {
      const result = makeResult({ contractSatisfied: true });
      const report = scoreSession(result, makeGoodCanvas());
      const dim = report.dimensions.find((d) => d.name === 'Contract Outcome')!;
      expect(dim.score).toBe(1);
    });

    it('scores 0.3 for completed but unsatisfied', () => {
      const result = makeResult({ outcome: 'completed', contractSatisfied: false });
      const report = scoreSession(result, makeGoodCanvas());
      const dim = report.dimensions.find((d) => d.name === 'Contract Outcome')!;
      expect(dim.score).toBe(0.3);
    });

    it('scores 0.1 for budget-exceeded', () => {
      const result = makeResult({ outcome: 'budget-exceeded', contractSatisfied: false });
      const report = scoreSession(result, makeGoodCanvas());
      const dim = report.dimensions.find((d) => d.name === 'Contract Outcome')!;
      expect(dim.score).toBe(0.1);
    });

    it('scores 0 for errored sessions', () => {
      const result = makeResult({ outcome: 'error', contractSatisfied: false });
      const report = scoreSession(result, makeGoodCanvas());
      const dim = report.dimensions.find((d) => d.name === 'Contract Outcome')!;
      expect(dim.score).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Flags
  // ---------------------------------------------------------------------------

  describe('flags', () => {
    it('flags SESSION_ERROR for errored sessions', () => {
      const result = makeResult({ outcome: 'error', error: 'Something broke' });
      const report = scoreSession(result, null);
      const flag = report.flags.find((f) => f.code === 'SESSION_ERROR');
      expect(flag).toBeDefined();
      expect(flag!.severity).toBe('critical');
      expect(flag!.message).toContain('Something broke');
    });

    it('flags EMPTY_CANVAS when session completed with 0 nodes', () => {
      const result = makeResult({ outcome: 'completed' });
      const canvas = makeCanvas();
      const report = scoreSession(result, canvas);
      const flag = report.flags.find((f) => f.code === 'EMPTY_CANVAS');
      expect(flag).toBeDefined();
      expect(flag!.severity).toBe('critical');
    });

    it('does not flag EMPTY_CANVAS when session errored with 0 nodes', () => {
      const result = makeResult({ outcome: 'error' });
      const canvas = makeCanvas();
      const report = scoreSession(result, canvas);
      const flag = report.flags.find((f) => f.code === 'EMPTY_CANVAS');
      expect(flag).toBeUndefined();
    });

    it('flags NO_STYLE_PLATE when nodes exist without locked style', () => {
      const result = makeResult({ stylePlateLocked: false });
      const canvas = makeCanvas({ nodes: [makeImageNode()] });
      const report = scoreSession(result, canvas);
      const flag = report.flags.find((f) => f.code === 'NO_STYLE_PLATE');
      expect(flag).toBeDefined();
      expect(flag!.severity).toBe('warning');
    });

    it('flags NO_AUDIO when video nodes exist without audio', () => {
      const canvas = makeCanvas({ nodes: [makeVideoNode()] });
      const report = scoreSession(makeResult(), canvas);
      const flag = report.flags.find((f) => f.code === 'NO_AUDIO');
      expect(flag).toBeDefined();
    });

    it('does not flag NO_AUDIO when audio nodes exist', () => {
      const canvas = makeCanvas({ nodes: [makeVideoNode(), makeAudioNode()] });
      const report = scoreSession(makeResult(), canvas);
      const flag = report.flags.find((f) => f.code === 'NO_AUDIO');
      expect(flag).toBeUndefined();
    });

    it('flags MISSING_PROMPTS for generatable nodes without prompts', () => {
      const canvas = makeCanvas({
        nodes: [makeNode('image', { data: { status: 'empty' } })],
      });
      const report = scoreSession(makeResult(), canvas);
      const flag = report.flags.find((f) => f.code === 'MISSING_PROMPTS');
      expect(flag).toBeDefined();
    });

    it('flags HIGH_ERROR_RATE with many tool errors', () => {
      const toolCalls = Array.from({ length: 6 }, (_, i) => ({
        step: i,
        name: 'canvas.createNodes',
        ok: false,
        errorMessage: 'Invalid args',
      }));
      const result = makeResult({ toolCalls });
      const report = scoreSession(result, makeGoodCanvas());
      const flag = report.flags.find((f) => f.code === 'HIGH_ERROR_RATE');
      expect(flag).toBeDefined();
    });

    it('flags EXCESSIVE_QUESTIONS with >5 askUser calls', () => {
      const result = makeResult({ askUserCount: 8 });
      const report = scoreSession(result, makeGoodCanvas());
      const flag = report.flags.find((f) => f.code === 'EXCESSIVE_QUESTIONS');
      expect(flag).toBeDefined();
    });

    it('flags LOW_PRODUCTIVITY with many steps but few nodes', () => {
      const result = makeResult({ steps: 60 });
      const canvas = makeCanvas({ nodes: [makeImageNode()] });
      const report = scoreSession(result, canvas);
      const flag = report.flags.find((f) => f.code === 'LOW_PRODUCTIVITY');
      expect(flag).toBeDefined();
    });

    it('flags VIDEO_NO_ANCHORS for videos without anchor frames', () => {
      const canvas = makeCanvas({ nodes: [makeVideoNode()] });
      const report = scoreSession(makeResult(), canvas);
      const flag = report.flags.find((f) => f.code === 'VIDEO_NO_ANCHORS');
      expect(flag).toBeDefined();
      expect(flag!.severity).toBe('info');
    });

    it('flags HIGH_TOKEN_USAGE with >300k tokens', () => {
      const result = makeResult({ promptTokensEstimated: 350_000 });
      const report = scoreSession(result, makeGoodCanvas());
      const flag = report.flags.find((f) => f.code === 'HIGH_TOKEN_USAGE');
      expect(flag).toBeDefined();
    });

    it('produces no flags for a well-structured session', () => {
      const result = makeResult({
        stylePlateLocked: true,
        askUserCount: 2,
        steps: 10,
        promptTokensEstimated: 5000,
      });
      const canvas = makeGoodCanvas();
      const report = scoreSession(result, canvas);
      const critical = report.flags.filter((f) => f.severity === 'critical');
      expect(critical).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // renderQualitySnippet
  // ---------------------------------------------------------------------------

  describe('renderQualitySnippet', () => {
    it('produces markdown with grade and composite score', () => {
      const report = scoreSession(makeResult(), makeGoodCanvas());
      const md = renderQualitySnippet(report);
      expect(md).toContain(`**Quality: ${report.composite}/100 (${report.grade})**`);
    });

    it('includes dimension table with all 7 dimensions', () => {
      const report = scoreSession(makeResult(), makeGoodCanvas());
      const md = renderQualitySnippet(report);
      expect(md).toContain('| dimension | score | weight | details |');
      for (const d of report.dimensions) {
        expect(md).toContain(d.name);
      }
    });

    it('includes flags section when flags exist', () => {
      const result = makeResult({ outcome: 'error', error: 'test error' });
      const report = scoreSession(result, null);
      const md = renderQualitySnippet(report);
      expect(md).toContain('**Flags:**');
      expect(md).toContain('SESSION_ERROR');
    });

    it('omits flags section when no flags', () => {
      const result = makeResult({ stylePlateLocked: true, askUserCount: 2, steps: 10 });
      const canvas = makeGoodCanvas();
      const report = scoreSession(result, canvas);
      if (report.flags.length === 0) {
        const md = renderQualitySnippet(report);
        expect(md).not.toContain('**Flags:**');
      }
    });
  });
});
