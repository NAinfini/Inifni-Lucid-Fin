import { describe, expect, it, vi } from 'vitest';
import { createOrchestrationTools, type OrchestrationToolDeps } from './orchestration-tools.js';

function createDeps(): OrchestrationToolDeps {
  return {
    listOrchestrations: vi.fn(async () => []),
    deleteOrchestration: vi.fn(async () => undefined),
  };
}

describe('createOrchestrationTools', () => {
  it('returns an empty tool list (tools removed)', () => {
    const deps = createDeps();
    const tools = createOrchestrationTools(deps);
    expect(tools).toEqual([]);
  });
});
