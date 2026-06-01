import { describe, expect, it } from 'vitest';
import { decide } from '../exit-decision-engine.js';
import type { CompletionEvidence, RunIntent } from '../types.js';
import { mutationExecutionContract, workflowExecutionContract } from './index.js';

function commit(toolName: string, args: unknown = {}, resultOk = true): CompletionEvidence {
  return { kind: 'mutation_commit', toolName, args, resultOk, at: 0 };
}

describe('mutationExecutionContract — satisfied paths', () => {
  it('any successful mutation satisfies', () => {
    const ledger: CompletionEvidence[] = [commit('canvas.createNodes', { nodes: [{}] })];
    const d = decide({
      contract: mutationExecutionContract,
      intent: { kind: 'execution' },
      ledger,
    });
    expect(d.outcome).toBe('satisfied');
  });

  it('any tool name satisfies (wildcard)', () => {
    const ledger: CompletionEvidence[] = [commit('preset.manage', {})];
    const d = decide({
      contract: mutationExecutionContract,
      intent: { kind: 'execution' },
      ledger,
    });
    expect(d.outcome).toBe('satisfied');
  });

  it('failed mutation (resultOk=false) does not satisfy', () => {
    const ledger: CompletionEvidence[] = [commit('canvas.createNodes', {}, false)];
    const d = decide({
      contract: mutationExecutionContract,
      intent: { kind: 'execution' },
      ledger,
    });
    expect(d.outcome).toBe('unsatisfied');
  });

  it('informational intent gets exempted', () => {
    const d = decide({
      contract: mutationExecutionContract,
      intent: { kind: 'informational' },
      ledger: [],
    });
    expect(d.outcome).toBe('informational_answered');
  });
});

describe('workflowExecutionContract — satisfied paths', () => {
  const wfIntent: RunIntent = { kind: 'execution', workflow: 'story-to-video' };

  it('any successful mutation satisfies', () => {
    const ledger: CompletionEvidence[] = [commit('canvas.createNodes', { nodes: [{}] })];
    const d = decide({ contract: workflowExecutionContract, intent: wfIntent, ledger });
    expect(d.outcome).toBe('satisfied');
  });

  it('any tool name satisfies (wildcard)', () => {
    const ledger: CompletionEvidence[] = [commit('canvas.updateNodes', { updates: [{}] })];
    const d = decide({ contract: workflowExecutionContract, intent: wfIntent, ledger });
    expect(d.outcome).toBe('satisfied');
  });

  it('failed mutation (resultOk=false) does not satisfy', () => {
    const ledger: CompletionEvidence[] = [commit('canvas.createNodes', {}, false)];
    const d = decide({ contract: workflowExecutionContract, intent: wfIntent, ledger });
    expect(d.outcome).toBe('unsatisfied');
  });

  it('informational intent gets exempted', () => {
    const d = decide({
      contract: workflowExecutionContract,
      intent: { kind: 'informational' },
      ledger: [],
    });
    expect(d.outcome).toBe('informational_answered');
  });
});
