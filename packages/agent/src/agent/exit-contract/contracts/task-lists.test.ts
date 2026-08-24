import { describe, expect, it } from 'vitest';
import { decide } from '../exit-decision-engine.js';
import type { CompletionEvidence, RunIntent } from '../types.js';
import { mutationExecutionContract, taskListExecutionContract } from './index.js';

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

  it('non-empty text without mutation is answered post-hoc', () => {
    const d = decide({
      contract: mutationExecutionContract,
      intent: { kind: 'informational' },
      ledger: [],
      lastAssistantText: 'Here is the answer.',
    });
    expect(d.outcome).toBe('informational_answered');
  });
});

describe('taskListExecutionContract — satisfied paths', () => {
  const wfIntent: RunIntent = { kind: 'execution', taskList: 'story-to-video' };

  it('any successful mutation satisfies', () => {
    const ledger: CompletionEvidence[] = [commit('canvas.createNodes', { nodes: [{}] })];
    const d = decide({ contract: taskListExecutionContract, intent: wfIntent, ledger });
    expect(d.outcome).toBe('satisfied');
  });

  it('any tool name satisfies (wildcard)', () => {
    const ledger: CompletionEvidence[] = [commit('canvas.updateNodes', { updates: [{}] })];
    const d = decide({ contract: taskListExecutionContract, intent: wfIntent, ledger });
    expect(d.outcome).toBe('satisfied');
  });

  it('failed mutation (resultOk=false) does not satisfy', () => {
    const ledger: CompletionEvidence[] = [commit('canvas.createNodes', {}, false)];
    const d = decide({ contract: taskListExecutionContract, intent: wfIntent, ledger });
    expect(d.outcome).toBe('unsatisfied');
  });

  it('non-empty text without mutation is answered post-hoc', () => {
    const d = decide({
      contract: taskListExecutionContract,
      intent: { kind: 'informational' },
      ledger: [],
      lastAssistantText: 'Here is the answer.',
    });
    expect(d.outcome).toBe('informational_answered');
  });
});
