import { describe, expect, it } from 'vitest';
import { EvidenceLedger } from './evidence-ledger.js';

describe('exit-contract/EvidenceLedger', () => {
  it('starts empty', () => {
    const l = new EvidenceLedger();
    expect(l.size()).toBe(0);
    expect(l.entries()).toEqual([]);
    expect(l.hasAnySuccessfulCommit()).toBe(false);
  });

  it('preserves append order', () => {
    const l = new EvidenceLedger();
    l.record({ kind: 'guide_loaded', guideId: 'a', at: 1 });
    l.record({ kind: 'ask_user_asked', question: 'q', at: 2 });
    l.record({ kind: 'mutation_commit', toolName: 'canvas.addNode', args: {}, resultOk: true, at: 3 });
    const entries = l.entries();
    expect(entries.map((e) => e.kind)).toEqual(['guide_loaded', 'ask_user_asked', 'mutation_commit']);
    expect(l.size()).toBe(3);
  });

  it('entries() returns a snapshot, not a live reference', () => {
    const l = new EvidenceLedger();
    l.record({ kind: 'guide_loaded', guideId: 'a', at: 1 });
    const snap1 = l.entries();
    l.record({ kind: 'guide_loaded', guideId: 'b', at: 2 });
    // Snapshot must be unchanged after further appends.
    expect(snap1).toHaveLength(1);
    expect(l.entries()).toHaveLength(2);
  });

  it('hasAnySuccessfulCommit only counts resultOk=true', () => {
    const l = new EvidenceLedger();
    l.record({ kind: 'mutation_commit', toolName: 'x', args: {}, resultOk: false, at: 1 });
    expect(l.hasAnySuccessfulCommit()).toBe(false);
    l.record({ kind: 'mutation_commit', toolName: 'y', args: {}, resultOk: true, at: 2 });
    expect(l.hasAnySuccessfulCommit()).toBe(true);
  });

  it('countByKind aggregates every variant', () => {
    const l = new EvidenceLedger();
    l.record({ kind: 'guide_loaded', guideId: 'a', at: 1 });
    l.record({ kind: 'guide_loaded', guideId: 'b', at: 2 });
    l.record({ kind: 'ask_user_asked', question: 'q', at: 3 });
    l.record({ kind: 'validation_error', toolName: 'x', errorText: 'boom', at: 4 });
    const counts = l.countByKind();
    expect(counts.guide_loaded).toBe(2);
    expect(counts.ask_user_asked).toBe(1);
    expect(counts.validation_error).toBe(1);
    expect(counts.mutation_commit).toBe(0);
  });
});
