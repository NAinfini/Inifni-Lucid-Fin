import { describe, expect, it } from 'vitest';
import { contractRegistry } from './index.js';
import type { CompletionContract, RunIntent } from './types.js';

/**
 * Registry tests piggy-back on the module-load-time registration that
 * `contracts/index.ts` performs. Importing the barrel above already
 * populated all 3 contracts + set the fallback, so these tests assert
 * the post-load contract of the registry rather than spinning a new
 * instance.
 */
describe('contract-registry', () => {
  it('registers all Phase C contracts on load', () => {
    const ids = contractRegistry.ids();
    expect(ids).toEqual(
      expect.arrayContaining([
        'info-answer',
        'mutation-execution',
        'workflow-execution',
      ]),
    );
    expect(ids).toHaveLength(3);
  });

  it('rejects a different contract under an existing id', () => {
    const dupe: CompletionContract = {
      id: 'mutation-execution',
      requiredCommits: [],
      infoIntentExemption: false,
      blockingQuestionsAllowed: 0,
    };
    expect(() => contractRegistry.register(dupe)).toThrow(/duplicate id/i);
  });

  it('is idempotent when the same contract object is re-registered', () => {
    const existing = contractRegistry.get('mutation-execution');
    expect(existing).toBeDefined();
    expect(() => contractRegistry.register(existing!)).not.toThrow();
    expect(contractRegistry.get('mutation-execution')).toBe(existing);
  });

  it('unregister removes a contract and is safe on unknown ids', () => {
    const probe: CompletionContract = {
      id: 'phase-f-probe-contract',
      requiredCommits: [],
      infoIntentExemption: false,
      blockingQuestionsAllowed: 0,
    };
    contractRegistry.register(probe);
    expect(contractRegistry.get('phase-f-probe-contract')).toBe(probe);
    contractRegistry.unregister('phase-f-probe-contract');
    expect(contractRegistry.get('phase-f-probe-contract')).toBeUndefined();
    // safe on unknown
    expect(() => contractRegistry.unregister('never-registered')).not.toThrow();
  });

  it('rejects re-setting the fallback to a different id', () => {
    expect(() => contractRegistry.setFallback('mutation-execution')).toThrow(/fallback already set/i);
  });

  it('accepts re-setting the fallback to the same id (idempotent)', () => {
    expect(() => contractRegistry.setFallback('info-answer')).not.toThrow();
  });

  it('refuses to register a fallback for an unregistered id', () => {
    expect(() => contractRegistry.setFallback('does-not-exist')).toThrow(/not registered/i);
  });

  it('selects workflow-execution for execution intent with known workflow', () => {
    const intent: RunIntent = { kind: 'execution', workflow: 'story-to-video' };
    expect(contractRegistry.select(intent).id).toBe('workflow-execution');
  });

  it('selects workflow-execution when workflow is unknown', () => {
    const intent: RunIntent = { kind: 'execution', workflow: 'not-a-workflow' };
    expect(contractRegistry.select(intent).id).toBe('workflow-execution');
  });

  it('selects mutation-execution when execution intent has no workflow', () => {
    const intent: RunIntent = { kind: 'execution' };
    expect(contractRegistry.select(intent).id).toBe('mutation-execution');
  });

  it('selects info-answer for informational intent', () => {
    expect(contractRegistry.select({ kind: 'informational' }).id).toBe('info-answer');
  });

  it('selects workflow-execution for execution with workflow', () => {
    const withWorkflow: RunIntent = { kind: 'execution', workflow: 'shot-list' };
    const withoutWorkflow: RunIntent = { kind: 'execution' };
    expect(contractRegistry.select(withWorkflow).id).toBe('workflow-execution');
    expect(contractRegistry.select(withoutWorkflow).id).toBe('mutation-execution');
  });
});
