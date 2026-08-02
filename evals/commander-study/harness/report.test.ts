import { describe, expect, it } from 'vitest';
import { renderMarkdownReport } from './report.js';
import type { SessionResult } from './run-single.js';
import type { CodexProviderSpec } from './provider-config.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeResult(overrides?: Partial<SessionResult>): SessionResult {
  return {
    personaIndex: 0,
    personaSlug: 'test-slug',
    archetype: 'story',
    providerName: 'Codex Plus',
    outcome: 'completed',
    steps: 5,
    toolCalls: [],
    toolCallCounts: {},
    mockCallCounts: {},
    askUserCount: 2,
    askUserAnswersConsumed: 1,
    askUserFallbacksUsed: 1,
    promptTokensEstimated: 5000,
    finalNodeCount: 8,
    finalEdgeCount: 3,
    stylePlateLocked: true,
    promptGuidesLoadedViaGuideGet: [],
    processPromptsInjected: [],
    preflightDecisions: [],
    evidenceLedger: [],
    exitDecision: { outcome: 'satisfied' },
    contractSatisfied: true,
    exitOutcome: 'satisfied',
    blocker: null,
    finalCanvas: null,
    qualityReport: { composite: 75, grade: 'B', dimensions: [], flags: [] },
    logFile: 'test.ndjson',
    ms: 12000,
    ...overrides,
  };
}

function makeSpec(name = 'Codex Plus', model = 'codex-plus-2026'): CodexProviderSpec {
  return { id: 'codex-plus', name, model } as CodexProviderSpec;
}

function renderDefault(results: SessionResult[], totalMs = 60_000): string {
  return renderMarkdownReport(results, {
    totalMs,
    specs: [makeSpec()],
  });
}

// ---------------------------------------------------------------------------
// Basic rendering
// ---------------------------------------------------------------------------

describe('renderMarkdownReport', () => {
  describe('structure', () => {
    it('produces a non-empty markdown string', () => {
      const md = renderDefault([makeResult()]);
      expect(md.length).toBeGreaterThan(0);
      expect(md.endsWith('\n')).toBe(true);
    });

    it('includes the session count in the heading', () => {
      const md = renderDefault([makeResult(), makeResult({ personaIndex: 1 })]);
      expect(md).toContain('2 sessions');
    });

    it('includes the wall time in minutes', () => {
      const md = renderDefault([makeResult()], 120_000);
      expect(md).toContain('2.0 min');
    });

    it('includes provider name and model', () => {
      const md = renderMarkdownReport([makeResult()], {
        totalMs: 1000,
        specs: [makeSpec('Codex Team', 'codex-team-2026')],
      });
      expect(md).toContain('Codex Team');
      expect(md).toContain('codex-team-2026');
    });

    it('includes all required section headers', () => {
      const md = renderDefault([makeResult()]);
      const sections = [
        '## Outcomes',
        '## Outcomes × archetype',
        '## Headline stats',
        '## Quality scores',
        '## Product satisfaction',
        '## Tool call frequency',
        '## Guides loaded via guide.get',
        '## Process prompts injected',
        '## Contract outcomes',
        '## Process-prompt activations',
        '## Top tool-error shapes',
        '## Per-session summary',
      ];
      for (const section of sections) {
        expect(md, `missing section: ${section}`).toContain(section);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Outcomes
  // ---------------------------------------------------------------------------

  describe('outcomes', () => {
    it('tabulates outcome counts correctly', () => {
      const results = [
        makeResult({ outcome: 'completed' }),
        makeResult({ outcome: 'completed', personaIndex: 1 }),
        makeResult({ outcome: 'error', personaIndex: 2 }),
        makeResult({ outcome: 'budget-exceeded', personaIndex: 3 }),
      ];
      const md = renderDefault(results);
      expect(md).toContain('| completed | 2 |');
      expect(md).toContain('| error | 1 |');
      expect(md).toContain('| budget-exceeded | 1 |');
    });

    it('computes outcome percentages', () => {
      const results = [
        makeResult({ outcome: 'completed' }),
        makeResult({ outcome: 'completed', personaIndex: 1 }),
      ];
      const md = renderDefault(results);
      expect(md).toContain('100.0%');
    });

    it('cross-tabulates outcomes by archetype', () => {
      const results = [
        makeResult({ archetype: 'story', outcome: 'completed' }),
        makeResult({ archetype: 'edge', outcome: 'error', personaIndex: 1 }),
      ];
      const md = renderDefault(results);
      expect(md).toMatch(/story.*1.*0.*0.*0/);
      expect(md).toMatch(/edge.*0.*0.*0.*1/);
    });
  });

  // ---------------------------------------------------------------------------
  // Headline stats
  // ---------------------------------------------------------------------------

  describe('headline stats', () => {
    it('computes average steps per session', () => {
      const results = [makeResult({ steps: 10 }), makeResult({ steps: 20, personaIndex: 1 })];
      const md = renderDefault(results);
      expect(md).toContain('15.0');
    });

    it('computes average canvas nodes at end', () => {
      const results = [
        makeResult({ finalNodeCount: 4 }),
        makeResult({ finalNodeCount: 6, personaIndex: 1 }),
      ];
      const md = renderDefault(results);
      expect(md).toContain('5.0');
    });

    it('counts sessions with stylePlate locked', () => {
      const results = [
        makeResult({ stylePlateLocked: true }),
        makeResult({ stylePlateLocked: false, personaIndex: 1 }),
        makeResult({ stylePlateLocked: true, personaIndex: 2 }),
      ];
      const md = renderDefault(results);
      expect(md).toContain('2 / 3');
    });

    it('reports total askUser invocations', () => {
      const results = [
        makeResult({ askUserCount: 3 }),
        makeResult({ askUserCount: 7, personaIndex: 1 }),
      ];
      const md = renderDefault(results);
      expect(md).toContain('| total askUser invocations | 10 |');
    });
  });

  // ---------------------------------------------------------------------------
  // Product satisfaction (Phase E)
  // ---------------------------------------------------------------------------

  describe('product satisfaction', () => {
    it('computes overall satisfaction percentage', () => {
      const results = [
        makeResult({ contractSatisfied: true }),
        makeResult({ contractSatisfied: true, personaIndex: 1 }),
        makeResult({ contractSatisfied: false, personaIndex: 2 }),
      ];
      const md = renderDefault(results);
      expect(md).toContain('2 / 3');
      expect(md).toContain('66.7%');
    });

    it('breaks down satisfaction by archetype', () => {
      const results = [
        makeResult({ archetype: 'story', contractSatisfied: true }),
        makeResult({ archetype: 'story', contractSatisfied: false, personaIndex: 1 }),
        makeResult({ archetype: 'edge', contractSatisfied: false, personaIndex: 2 }),
      ];
      const md = renderDefault(results);
      expect(md).toMatch(/story.*1.*2/);
      expect(md).toMatch(/edge.*0.*1/);
    });

    it('includes blocker histogram when blockers exist', () => {
      const results = [
        makeResult({
          contractSatisfied: false,
          blocker: 'no_canvas_nodes',
          exitDecision: { outcome: 'unsatisfied' },
        }),
        makeResult({
          contractSatisfied: false,
          blocker: 'no_canvas_nodes',
          exitDecision: { outcome: 'unsatisfied' },
          personaIndex: 1,
        }),
        makeResult({
          contractSatisfied: false,
          blocker: 'generation_failed',
          exitDecision: { outcome: 'unsatisfied' },
          personaIndex: 2,
        }),
      ];
      const md = renderDefault(results);
      expect(md).toContain('### Blockers');
      expect(md).toContain('no_canvas_nodes');
      expect(md).toContain('generation_failed');
    });

    it('omits blocker section when no blockers exist', () => {
      const results = [makeResult({ contractSatisfied: true })];
      const md = renderDefault(results);
      expect(md).not.toContain('### Blockers');
    });
  });

  // ---------------------------------------------------------------------------
  // Tool call frequency
  // ---------------------------------------------------------------------------

  describe('tool call frequency', () => {
    it('lists tool counts sorted by frequency', () => {
      const results = [
        makeResult({
          toolCallCounts: {
            'canvas.createNodes': 10,
            'canvas.generation': 5,
            'character.create': 1,
          },
        }),
      ];
      const md = renderDefault(results);
      const addNodeIdx = md.indexOf('canvas.createNodes');
      const generateIdx = md.indexOf('canvas.generation');
      const createIdx = md.indexOf('character.create');
      expect(addNodeIdx).toBeLessThan(generateIdx);
      expect(generateIdx).toBeLessThan(createIdx);
    });

    it('flags mocked tools', () => {
      const results = [
        makeResult({
          toolCallCounts: {
            'canvas.generation': 5,
            'canvas.createNodes': 3,
          },
        }),
      ];
      const md = renderDefault(results);
      expect(md).toMatch(/canvas\.generation.*yes/);
    });

    it('aggregates tool counts across sessions', () => {
      const results = [
        makeResult({ toolCallCounts: { 'canvas.createNodes': 3 } }),
        makeResult({ toolCallCounts: { 'canvas.createNodes': 7 }, personaIndex: 1 }),
      ];
      const md = renderDefault(results);
      expect(md).toContain('| canvas.createNodes | 10 |');
    });
  });

  // ---------------------------------------------------------------------------
  // Guides loaded
  // ---------------------------------------------------------------------------

  describe('guides loaded via guide.get', () => {
    it('lists guide fetch counts sorted by frequency', () => {
      const results = [
        makeResult({
          promptGuidesLoadedViaGuideGet: ['workflow', 'camera', 'workflow'],
        }),
      ];
      const md = renderDefault(results);
      expect(md).toContain('| workflow | 2 |');
      expect(md).toContain('| camera | 1 |');
    });

    it('shows placeholder when no guides were loaded', () => {
      const results = [makeResult({ promptGuidesLoadedViaGuideGet: [] })];
      const md = renderDefault(results);
      expect(md).toContain('No guide.get calls recorded');
    });
  });

  // ---------------------------------------------------------------------------
  // Process prompts
  // ---------------------------------------------------------------------------

  describe('process prompts injected', () => {
    it('lists process prompt injection counts', () => {
      const results = [
        makeResult({
          processPromptsInjected: ['style-plate-lock', 'style-plate-lock', 'entity-management'],
        }),
      ];
      const md = renderDefault(results);
      expect(md).toContain('| style-plate-lock | 2 |');
      expect(md).toContain('| entity-management | 1 |');
    });

    it('shows placeholder when no process prompts were injected', () => {
      const results = [makeResult({ processPromptsInjected: [] })];
      const md = renderDefault(results);
      expect(md).toContain('No process-prompt injections observed');
    });
  });

  // ---------------------------------------------------------------------------
  // Contract outcomes (Phase D)
  // ---------------------------------------------------------------------------

  describe('contract outcomes', () => {
    it('tabulates exit decision outcomes', () => {
      const results = [
        makeResult({ exitDecision: { outcome: 'satisfied' } }),
        makeResult({ exitDecision: { outcome: 'satisfied' }, personaIndex: 1 }),
        makeResult({ exitDecision: { outcome: 'unsatisfied' }, personaIndex: 2 }),
      ];
      const md = renderDefault(results);
      expect(md).toContain('| satisfied | 2 |');
      expect(md).toContain('| unsatisfied | 1 |');
    });

    it('shows placeholder when no exit decisions captured', () => {
      const results = [makeResult({ exitDecision: null })];
      const md = renderDefault(results);
      expect(md).toContain('No `exit_decision` events captured');
    });

    it('cross-tabulates contract outcomes by archetype', () => {
      const results = [
        makeResult({ archetype: 'story', exitDecision: { outcome: 'satisfied' } }),
        makeResult({
          archetype: 'edge',
          exitDecision: { outcome: 'unsatisfied' },
          personaIndex: 1,
        }),
      ];
      const md = renderDefault(results);
      expect(md).toContain('### Contract outcomes × archetype');
    });
  });

  // ---------------------------------------------------------------------------
  // Preflight histogram
  // ---------------------------------------------------------------------------

  describe('process-prompt activations (preflight)', () => {
    it('shows activation rate per spec key', () => {
      const results = [
        makeResult({
          preflightDecisions: [
            { specKey: 'style-plate-lock', decision: 'activated', step: 1 },
            { specKey: 'style-plate-lock', decision: 'skipped', step: 2 },
            { specKey: 'entity-management', decision: 'activated', step: 3 },
          ],
        }),
      ];
      const md = renderDefault(results);
      expect(md).toContain('style-plate-lock');
      expect(md).toContain('entity-management');
      expect(md).toContain('50.0%');
      expect(md).toContain('100.0%');
    });

    it('shows placeholder when no preflight decisions', () => {
      const results = [makeResult({ preflightDecisions: [] })];
      const md = renderDefault(results);
      expect(md).toContain('No `preflight_decision` events captured');
    });
  });

  // ---------------------------------------------------------------------------
  // Tool errors
  // ---------------------------------------------------------------------------

  describe('top tool-error shapes', () => {
    it('lists error counts with truncated first line', () => {
      const results = [
        makeResult({
          toolCalls: [
            {
              step: 1,
              name: 'canvas.createNodes',
              ok: false,
              errorMessage: 'Node type not supported: banana',
            },
            {
              step: 2,
              name: 'canvas.createNodes',
              ok: false,
              errorMessage: 'Node type not supported: banana',
            },
            { step: 3, name: 'character.create', ok: false, errorMessage: 'Name is required' },
          ],
        }),
      ];
      const md = renderDefault(results);
      expect(md).toContain('Node type not supported: banana');
      expect(md).toContain('Name is required');
    });

    it('shows placeholder when no tool errors', () => {
      const results = [
        makeResult({
          toolCalls: [{ step: 1, name: 'canvas.createNodes', ok: true }],
        }),
      ];
      const md = renderDefault(results);
      expect(md).toContain('No tool errors');
    });
  });

  // ---------------------------------------------------------------------------
  // Quality scores
  // ---------------------------------------------------------------------------

  describe('quality scores', () => {
    it('shows average quality score in headline stats', () => {
      const results = [
        makeResult({ qualityReport: { composite: 80, grade: 'A', dimensions: [], flags: [] } }),
        makeResult({
          qualityReport: { composite: 60, grade: 'B', dimensions: [], flags: [] },
          personaIndex: 1,
        }),
      ];
      const md = renderDefault(results);
      expect(md).toContain('70.0 / 100');
    });

    it('shows grade histogram', () => {
      const results = [
        makeResult({ qualityReport: { composite: 85, grade: 'A', dimensions: [], flags: [] } }),
        makeResult({
          qualityReport: { composite: 82, grade: 'A', dimensions: [], flags: [] },
          personaIndex: 1,
        }),
        makeResult({
          qualityReport: { composite: 55, grade: 'C', dimensions: [], flags: [] },
          personaIndex: 2,
        }),
      ];
      const md = renderDefault(results);
      expect(md).toContain('| A | 2 |');
      expect(md).toContain('| C | 1 |');
    });

    it('includes quality score and grade in per-session row', () => {
      const results = [
        makeResult({
          qualityReport: { composite: 72.5, grade: 'B', dimensions: [], flags: [] },
        }),
      ];
      const md = renderDefault(results);
      expect(md).toContain('| 72.5 |');
      expect(md).toContain('| B |');
    });
  });

  // ---------------------------------------------------------------------------
  // Per-session summary table
  // ---------------------------------------------------------------------------

  describe('per-session summary', () => {
    it('includes per-session row with correct fields', () => {
      const results = [
        makeResult({
          personaIndex: 3,
          archetype: 'power',
          personaSlug: 'shot-list-master',
          outcome: 'completed',
          steps: 12,
          finalNodeCount: 10,
          stylePlateLocked: true,
          askUserCount: 3,
          toolCallCounts: { 'canvas.createNodes': 5, 'canvas.generation': 2 },
          ms: 45_000,
        }),
      ];
      const md = renderDefault(results);
      expect(md).toContain('| 3 |');
      expect(md).toContain('power');
      expect(md).toContain('shot-list-master');
      expect(md).toContain('completed');
    });

    it('includes error message excerpt for error outcomes', () => {
      const results = [
        makeResult({
          outcome: 'error',
          error: 'ECONNREFUSED: Connection refused at port 8080',
        }),
      ];
      const md = renderDefault(results);
      expect(md).toContain('ECONNREFUSED');
    });

    it('marks stylePlate as Y or N', () => {
      const results = [
        makeResult({ stylePlateLocked: true }),
        makeResult({ stylePlateLocked: false, personaIndex: 1 }),
      ];
      const md = renderDefault(results);
      expect(md).toContain('| Y |');
      expect(md).toContain('| N |');
    });
  });

  // ---------------------------------------------------------------------------
  // Edge cases
  // ---------------------------------------------------------------------------

  describe('edge cases', () => {
    it('handles empty results array', () => {
      const md = renderDefault([]);
      expect(md).toContain('0 sessions');
    });

    it('handles single session', () => {
      const md = renderDefault([makeResult()]);
      expect(md).toContain('1 sessions');
    });

    it('handles multiple providers', () => {
      const md = renderMarkdownReport([makeResult()], {
        totalMs: 1000,
        specs: [makeSpec('Codex Plus', 'codex-plus'), makeSpec('Codex Team', 'codex-team')],
      });
      expect(md).toContain('Codex Plus');
      expect(md).toContain('Codex Team');
    });

    it('escapes pipe characters in error messages', () => {
      const results = [
        makeResult({
          toolCalls: [
            { step: 1, name: 'test', ok: false, errorMessage: 'Expected A | B but got C' },
          ],
        }),
      ];
      const md = renderDefault(results);
      expect(md).toContain('Expected A \\| B but got C');
    });
  });
});
