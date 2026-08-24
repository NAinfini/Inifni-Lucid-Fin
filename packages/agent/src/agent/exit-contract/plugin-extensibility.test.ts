/**
 * Phase F — end-to-end plugin test.
 *
 * Verifies that a third-party contract registered at runtime via the
 * public `contractRegistry.register()` surface flows through
 * `select → decide` and produces the expected `ExitDecision`, without
 * touching orchestrator internals.
 *
 * This is the "Phase F is done" sanity check: if this breaks, the
 * extensibility surface is broken.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  contractRegistry,
  decide,
  type CompletionContract,
  type CompletionEvidence,
  type RunIntent,
} from './index.js';

const PLUGIN_CONTRACT_ID = 'phase-f-plugin-test';

const pluginContract: CompletionContract = {
  id: PLUGIN_CONTRACT_ID,
  requiredCommits: [
    {
      kind: 'mutation_commit',
      toolName: 'canvas.customPluginWrite',
      // Minimal predicate: any success counts.
      argPredicate: () => true,
    },
  ],
  infoIntentExemption: false,
  blockingQuestionsAllowed: 0,
};

describe('plugin extensibility (Phase F)', () => {
  afterEach(() => {
    contractRegistry.unregister(PLUGIN_CONTRACT_ID);
  });

  it('registers a third-party contract, selects it by task-list id, and decides satisfied', () => {
    contractRegistry.register(pluginContract);

    const intent: RunIntent = { kind: 'execution', taskList: PLUGIN_CONTRACT_ID };
    const picked = contractRegistry.select(intent);
    expect(picked.id).toBe(PLUGIN_CONTRACT_ID);

    const now = Date.now();
    const ledger: readonly CompletionEvidence[] = [
      {
        kind: 'mutation_commit',
        toolName: 'canvas.customPluginWrite',
        args: { foo: 'bar' },
        resultOk: true,
        at: now,
      },
    ];
    const verdict = decide({
      contract: picked,
      intent,
      ledger,
      lastAssistantText: 'done',
    });
    expect(verdict.outcome).toBe('satisfied');
  });

  it('returns unsatisfied when the plugin contract requires a commit that never fired', () => {
    contractRegistry.register(pluginContract);

    const intent: RunIntent = { kind: 'execution', taskList: PLUGIN_CONTRACT_ID };
    const picked = contractRegistry.select(intent);
    const ledger: readonly CompletionEvidence[] = [
      {
        kind: 'mutation_commit',
        toolName: 'canvas.customPluginWrite',
        args: {},
        resultOk: false,
        at: Date.now(),
      },
    ];
    const verdict = decide({
      contract: picked,
      intent,
      ledger,
      lastAssistantText: 'nothing happened',
    });
    expect(verdict.outcome).toBe('unsatisfied');
    if (verdict.outcome === 'unsatisfied') {
      expect(verdict.blocker.kind).toBe('missing_commit');
    }
  });

  it('is safe to register the same contract object twice (idempotent)', () => {
    contractRegistry.register(pluginContract);
    expect(() => contractRegistry.register(pluginContract)).not.toThrow();
  });
});
