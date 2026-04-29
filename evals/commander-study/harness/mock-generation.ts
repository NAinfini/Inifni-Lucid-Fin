/**
 * Overrides every tool that would hit a real image/video/audio provider with
 * a canned `success: true` stub. Call AFTER `registerAllTools()` so the
 * Map-based registry's `set()` semantics silently replace the production
 * implementations. Leaves non-generation tools (canvas CRUD, entity CRUD,
 * prompt/provider/meta tools, scripts, presets, etc.) intact — the harness
 * is studying *agent decision flow*, not generation output quality.
 */
import type { AgentToolRegistry, AgentTool } from '@lucid-fin/application';
import { randomUUID } from 'node:crypto';

export interface MockStats {
  calls: Record<string, number>;
}

/** Names of tools that get mocked. Kept here so reports can flag coverage. */
export const MOCKED_TOOL_NAMES = [
  'canvas.generate',
  'character.generateRefImage',
  'location.generateRefImage',
  'equipment.generateRefImage',
  'canvas.previewPrompt',
] as const;

function stubTool(
  name: string,
  description: string,
  tier: AgentTool['tier'],
  buildResult: (args: Record<string, unknown>) => Record<string, unknown>,
  stats: MockStats,
): AgentTool {
  return {
    name,
    description: `[MOCKED by fake-user harness] ${description}`,
    tier,
    // Minimal schema — the real tool's schema is still what the LLM sees at
    // turn N because we only override AFTER the registry has been queried for
    // its schema list for turn 1. Subsequent turns will see our schema, but
    // it's intentionally permissive (no `required`) so the model's real-tool
    // arg shape still passes through.
    parameters: {
      type: 'object',
      properties: {},
    },
    execute: async (args) => {
      stats.calls[name] = (stats.calls[name] ?? 0) + 1;
      return { success: true, data: buildResult(args) };
    },
  };
}

export function installMockGeneration(registry: AgentToolRegistry): MockStats {
  const stats: MockStats = { calls: {} };

  const register = (t: AgentTool) => registry.register(t);

  // canvas.generate — returns immediately with a fake jobId.
  register(
    stubTool(
      'canvas.generate',
      'Trigger media generation for a node.',
      3,
      (args) => {
        const nodeId = typeof args.nodeId === 'string' ? args.nodeId : 'unknown';
        return {
          jobId: `mock-job-${randomUUID().slice(0, 8)}`,
          nodeId,
          status: 'queued',
          message: 'MOCK: generation accepted (no real render performed)',
        };
      },
      stats,
    ),
  );

  // Reference-image tools (character/location/equipment).
  for (const entity of ['character', 'location', 'equipment']) {
    const name = `${entity}.generateRefImage`;
    register(
      stubTool(
        name,
        `Generate reference image for a ${entity}.`,
        3,
        (args) => {
          const entityId =
            typeof args.id === 'string'
              ? args.id
              : typeof args[`${entity}Id`] === 'string'
                ? (args[`${entity}Id`] as string)
                : 'unknown';
          return {
            jobId: `mock-ref-${randomUUID().slice(0, 8)}`,
            entity,
            entityId,
            assetHash: `sha256:mock${randomUUID().replace(/-/g, '').slice(0, 40)}`,
            message: 'MOCK: reference image generation accepted (no render performed)',
          };
        },
        stats,
      ),
    );
  }

  // canvas.previewPrompt — real impl hits the generation pipeline (adapter
  // required). Stub returns a plausible preview so Commander can still
  // inspect prompts without adapter keys.
  register(
    stubTool(
      'canvas.previewPrompt',
      'Preview the compiled prompt for a node.',
      1,
      (args) => {
        const nodeId = typeof args.nodeId === 'string' ? args.nodeId : 'unknown';
        return {
          nodeId,
          prompt: '[MOCK preview prompt — generation pipeline not exercised]',
          wordCount: 8,
          budget: 400,
          segments: [],
          diagnostics: [],
          providerId: 'mock',
          mode: 'mock',
        };
      },
      stats,
    ),
  );

  return stats;
}
