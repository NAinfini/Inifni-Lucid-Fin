import { describe, expect, it } from 'vitest';
import {
  parseRunResourceBudgetCheckpoint,
  RunResourceBudgetController,
  type RunResourceBudgetCheckpoint,
  type ResourceQuote,
} from './run-resource-budget.js';

function clock(start = 1_000) {
  let now = start;
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

const freeModelQuote = (tokens: number): ResourceQuote => ({
  tokens: { knowledge: 'estimated', value: tokens, upperBound: true },
  toolCalls: 0,
  costUsd: { knowledge: 'known', value: 0, upperBound: true },
});

function checkpointClone(checkpoint: RunResourceBudgetCheckpoint): RunResourceBudgetCheckpoint {
  return JSON.parse(JSON.stringify(checkpoint)) as RunResourceBudgetCheckpoint;
}

describe('RunResourceBudgetController', () => {
  it('shares token, tool-call, and cost usage across child leases without sharing their clocks', () => {
    const time = clock();
    const parent = new RunResourceBudgetController(
      { maxTokens: 100, maxToolCalls: 2, maxWallTimeMs: 100, maxCostUsd: 1 },
      { now: time.now, leaseId: 'parent' },
    );
    const firstChild = parent.createLease(
      { maxTokens: 100, maxToolCalls: 2, maxWallTimeMs: 80, maxCostUsd: 1 },
      'child-a',
    );
    const secondChild = parent.createLease(undefined, 'child-b');

    expect(firstChild.reserve('model:1', 'model', freeModelQuote(10)).accepted).toBe(true);
    expect(secondChild.reserve('model:1', 'model', freeModelQuote(10)).accepted).toBe(true);
    time.advance(20);
    expect(firstChild.startPause().clock).toMatchObject({ state: 'paused', activeMs: 20 });
    time.advance(30);
    expect(secondChild.snapshot({ kind: 'initialized' }).clock).toMatchObject({
      state: 'active',
      activeMs: 50,
    });
    expect(firstChild.endPause().clock).toMatchObject({ state: 'active', activeMs: 20 });
    expect(parent.snapshot({ kind: 'initialized' }).usage.tokens).toEqual({
      knowledge: 'estimated',
      value: 20,
    });
  });

  it('applies a child cap to its subtree increment while preserving the root account cap', () => {
    const parent = new RunResourceBudgetController(
      { maxTokens: 1_000, maxToolCalls: 10, maxCostUsd: 10 },
      { leaseId: 'parent' },
    );
    expect(parent.reserve('model:1', 'model', freeModelQuote(500)).accepted).toBe(true);
    const child = parent.createLease({ maxTokens: 100 }, 'child-a');
    const sibling = parent.createLease(undefined, 'child-b');

    expect(child.reserve('model:1', 'model', freeModelQuote(100)).accepted).toBe(true);
    expect(child.getUsage().tokens).toEqual({ knowledge: 'estimated', value: 100 });
    expect(parent.getUsage().tokens).toEqual({ knowledge: 'estimated', value: 600 });
    expect(sibling.reserve('model:1', 'model', freeModelQuote(401))).toMatchObject({
      accepted: false,
      blocker: { kind: 'resource_budget', metric: 'tokens', reason: 'exhausted' },
    });
  });

  it('applies a delegated cap across all grandchildren in that child subtree', () => {
    const parent = new RunResourceBudgetController({ maxTokens: 1_000 }, { leaseId: 'parent' });
    const child = parent.createLease({ maxTokens: 100 }, 'child');
    const firstGrandchild = child.createLease(undefined, 'grandchild-a');
    const secondGrandchild = child.createLease(undefined, 'grandchild-b');

    expect(firstGrandchild.reserve('model:1', 'model', freeModelQuote(60)).accepted).toBe(true);
    expect(secondGrandchild.reserve('model:1', 'model', freeModelQuote(60))).toMatchObject({
      accepted: false,
      blocker: { kind: 'resource_budget', metric: 'tokens', reason: 'exhausted' },
    });
    expect(child.getUsage().tokens).toEqual({ knowledge: 'estimated', value: 60 });
    expect(parent.getUsage().tokens).toEqual({ knowledge: 'estimated', value: 60 });
  });

  it('rejects a child lease that widens any parent budget limit', () => {
    const parent = new RunResourceBudgetController({ maxTokens: 100, maxToolCalls: 4 });

    expect(() => parent.createLease({ maxTokens: 101 })).toThrow(/widen/i);
    expect(() => parent.createLease({ maxToolCalls: 5 })).toThrow(/widen/i);
  });

  it('treats an empty budget as unlimited and never turns unknown cost into zero', () => {
    const time = clock();
    const controller = new RunResourceBudgetController({}, { now: time.now });

    const reservation = controller.reserve(
      'model:1:attempt:0',
      'model',
      {
        tokens: { knowledge: 'unknown' },
        toolCalls: 0,
        costUsd: { knowledge: 'unknown' },
      },
    );

    expect(reservation.accepted).toBe(true);
    expect(reservation.state.usage.costUsd).toEqual({ knowledge: 'unknown' });
    expect(reservation.state.remaining.costUsd).toEqual({ state: 'unlimited' });
  });

  it('accepts explicit zero limits and blocks before the first active operation', () => {
    const time = clock();
    const controller = new RunResourceBudgetController(
      { maxTokens: 0, maxToolCalls: 0, maxWallTimeMs: 0, maxCostUsd: 0 },
      { now: time.now },
    );

    const result = controller.reserve('model:1:attempt:0', 'model', freeModelQuote(1));

    expect(result).toMatchObject({
      accepted: false,
      blocker: { kind: 'resource_budget', metric: 'wall_time', reason: 'exhausted' },
    });
    expect(controller.getUsage()).toEqual({
      tokens: { knowledge: 'known', value: 0 },
      toolCalls: 0,
      wallTimeMs: 0,
      costUsd: { knowledge: 'known', value: 0 },
    });
  });

  it('fails closed on unknown token or cost quotes only when that metric is capped', () => {
    const unknownQuote: ResourceQuote = {
      tokens: { knowledge: 'unknown' },
      toolCalls: 0,
      costUsd: { knowledge: 'unknown' },
    };

    expect(
      new RunResourceBudgetController({ maxTokens: 100 }).reserve(
        'model:1:attempt:0',
        'model',
        unknownQuote,
      ),
    ).toMatchObject({
      accepted: false,
      blocker: { kind: 'resource_budget', metric: 'tokens', reason: 'unavailable' },
    });
    expect(
      new RunResourceBudgetController({ maxCostUsd: 1 }).reserve(
        'model:1:attempt:0',
        'model',
        unknownQuote,
      ),
    ).toMatchObject({
      accepted: false,
      blocker: { kind: 'resource_budget', metric: 'cost', reason: 'unavailable' },
    });
  });

  it('reserves and settles the same operation idempotently without double counting', () => {
    const controller = new RunResourceBudgetController({ maxTokens: 100, maxCostUsd: 1 });
    const quote: ResourceQuote = {
      tokens: { knowledge: 'estimated', value: 40, upperBound: true },
      toolCalls: 0,
      costUsd: { knowledge: 'estimated', value: 0.5, upperBound: true },
    };

    const first = controller.reserve('model:1:attempt:0', 'model', quote);
    const replay = controller.reserve('model:1:attempt:0', 'model', quote);
    expect(first.accepted).toBe(true);
    expect(replay.state.usage.tokens).toEqual({ knowledge: 'estimated', value: 40 });

    const settled = controller.settle('model:1:attempt:0', 'model', {
      tokens: { knowledge: 'known', value: 25 },
      toolCalls: 0,
      costUsd: { knowledge: 'known', value: 0.2 },
    });
    const settledReplay = controller.settle('model:1:attempt:0', 'model', {
      tokens: { knowledge: 'known', value: 25 },
      toolCalls: 0,
      costUsd: { knowledge: 'known', value: 0.2 },
    });

    expect(settled.usage.tokens).toEqual({ knowledge: 'known', value: 25 });
    expect(settled.usage.costUsd).toEqual({ knowledge: 'known', value: 0.2 });
    expect(settledReplay.usage).toEqual(settled.usage);
  });

  it('blocks an entire tool batch before any quota is consumed', () => {
    const controller = new RunResourceBudgetController({ maxToolCalls: 2 });
    const result = controller.reserve('tool:1:batch:0', 'tool', {
      tokens: { knowledge: 'known', value: 0, upperBound: true },
      toolCalls: 3,
      costUsd: { knowledge: 'known', value: 0, upperBound: true },
    });

    expect(result).toMatchObject({
      accepted: false,
      blocker: { kind: 'resource_budget', metric: 'tool_calls', reason: 'exhausted' },
    });
    expect(controller.getUsage().toolCalls).toBe(0);
  });

  it('excludes explicit user-wait time from active wall time', () => {
    const time = clock();
    const controller = new RunResourceBudgetController(
      { maxWallTimeMs: 100 },
      { now: time.now },
    );

    expect(controller.reserve('model:1:attempt:0', 'model', freeModelQuote(10)).accepted).toBe(
      true,
    );
    time.advance(25);
    const waiting = controller.startUserWait();
    expect(waiting.clock).toMatchObject({ state: 'waiting_user', activeMs: 25 });

    time.advance(10_000);
    const resumed = controller.endUserWait();
    expect(resumed.clock).toMatchObject({ state: 'active', activeMs: 25 });

    time.advance(74);
    expect(controller.checkBoundary()).toBeUndefined();
    time.advance(1);
    expect(controller.checkBoundary()).toEqual({
      kind: 'resource_budget',
      metric: 'wall_time',
      reason: 'exhausted',
    });
  });

  it('excludes paused time from active wall time', () => {
    const time = clock();
    const controller = new RunResourceBudgetController(
      { maxWallTimeMs: 100 },
      { now: time.now },
    );

    expect(controller.reserve('model:1:attempt:0', 'model', freeModelQuote(10)).accepted).toBe(
      true,
    );
    time.advance(30);
    expect(controller.startPause().clock).toMatchObject({ state: 'paused', activeMs: 30 });

    time.advance(10_000);
    expect(controller.endPause().clock).toMatchObject({ state: 'active', activeMs: 30 });
    time.advance(70);
    expect(controller.checkBoundary()).toEqual({
      kind: 'resource_budget',
      metric: 'wall_time',
      reason: 'exhausted',
    });
  });

  it('keeps a shared clock paused until every cooperative Run boundary resumes', () => {
    const time = clock();
    const controller = new RunResourceBudgetController(
      { maxWallTimeMs: 100 },
      { now: time.now },
    );

    expect(controller.reserve('model:1:attempt:0', 'model', freeModelQuote(10)).accepted).toBe(
      true,
    );
    time.advance(20);
    expect(controller.startPause().clock).toMatchObject({ state: 'paused', activeMs: 20 });
    expect(controller.startPause().clock).toMatchObject({ state: 'paused', activeMs: 20 });
    time.advance(1_000);
    expect(controller.endPause().clock).toMatchObject({ state: 'paused', activeMs: 20 });
    time.advance(1_000);
    expect(controller.endPause().clock).toMatchObject({ state: 'active', activeMs: 20 });
  });

  it('carries prior usage into a continuation without copying mutable remaining values', () => {
    const controller = new RunResourceBudgetController(
      { maxTokens: 100, maxToolCalls: 5, maxCostUsd: 1 },
      {
        carryIn: {
          tokens: { knowledge: 'known', value: 60 },
          toolCalls: 2,
          wallTimeMs: 10,
          costUsd: { knowledge: 'estimated', value: 0.4 },
        },
      },
    );

    expect(controller.snapshot({ kind: 'initialized' }).remaining).toEqual({
      tokens: { state: 'known', value: 40 },
      toolCalls: { state: 'known', value: 3 },
      wallTimeMs: { state: 'unlimited' },
      costUsd: { state: 'estimated', value: 0.6 },
    });
  });

  it('round-trips one shared root ledger with two child leases, operation ids, subtree caps, and clocks', () => {
    const time = clock();
    const root = new RunResourceBudgetController(
      { maxTokens: 100, maxToolCalls: 6, maxWallTimeMs: 100, maxCostUsd: 10 },
      { now: time.now, leaseId: 'root' },
    );
    const firstChild = root.createLease({ maxTokens: 50, maxWallTimeMs: 80 }, 'child-a');
    const secondChild = root.createLease(undefined, 'child-b');
    const sharedQuote = freeModelQuote(20);

    expect(root.reserve('model:root', 'model', freeModelQuote(10)).accepted).toBe(true);
    expect(firstChild.reserve('model:shared', 'model', sharedQuote).accepted).toBe(true);
    expect(secondChild.reserve('model:shared', 'model', sharedQuote).accepted).toBe(true);
    firstChild.settle('model:shared', 'model', {
      tokens: { knowledge: 'known', value: 15 },
      toolCalls: 0,
      costUsd: { knowledge: 'known', value: 0 },
    });
    time.advance(10);
    firstChild.startPause();
    firstChild.startPause();
    time.advance(10);

    const before = new Map([
      ['root', root.snapshot({ kind: 'initialized' })],
      ['child-a', firstChild.snapshot({ kind: 'initialized' })],
      ['child-b', secondChild.snapshot({ kind: 'initialized' })],
    ]);
    const checkpoint = checkpointClone(root.exportCheckpoint());
    expect(checkpoint.operations.filter((operation) => operation.operationId === 'model:shared')).toHaveLength(2);

    const restored = RunResourceBudgetController.restoreCheckpoint(checkpoint, { now: time.now });
    expect(restored.controllers.size).toBe(3);
    for (const [leaseId, state] of before) {
      expect(restored.controllers.get(leaseId)?.snapshot({ kind: 'initialized' })).toMatchObject({
        usage: state.usage,
        remaining: state.remaining,
        clock: { state: state.clock.state, activeMs: state.clock.activeMs },
      });
    }

    const restoredFirstChild = restored.controllers.get('child-a')!;
    const restoredSecondChild = restored.controllers.get('child-b')!;
    expect(restoredFirstChild.reserve('model:shared', 'model', sharedQuote).accepted).toBe(true);
    expect(restoredFirstChild.getUsage().tokens).toEqual({ knowledge: 'known', value: 15 });
    expect(restoredFirstChild.reserve('model:over-cap', 'model', freeModelQuote(36))).toMatchObject({
      accepted: false,
      blocker: { kind: 'resource_budget', metric: 'tokens', reason: 'exhausted' },
    });
    expect(restoredSecondChild.reserve('model:shared', 'model', sharedQuote).accepted).toBe(true);

    time.advance(5);
    expect(restored.root.getUsage().wallTimeMs).toBe(25);
    expect(restoredSecondChild.getUsage().wallTimeMs).toBe(25);
    expect(restoredFirstChild.getUsage().wallTimeMs).toBe(10);
    expect(restoredFirstChild.endPause().clock.state).toBe('paused');
    expect(restoredFirstChild.endPause().clock.state).toBe('active');
  });

  it('fails closed for malformed or inconsistent private resource checkpoints', () => {
    const root = new RunResourceBudgetController({ maxTokens: 100 }, { leaseId: 'root' });
    const child = root.createLease({ maxTokens: 50 }, 'child');
    expect(child.reserve('model:1', 'model', freeModelQuote(10)).accepted).toBe(true);
    const valid = root.exportCheckpoint();

    const duplicateLease = checkpointClone(valid);
    duplicateLease.leases.push({ ...duplicateLease.leases[0]! });
    expect(() => RunResourceBudgetController.restoreCheckpoint(duplicateLease)).toThrow(/duplicate lease/i);

    const missingParent = checkpointClone(valid);
    missingParent.leases.find((lease) => lease.leaseId === 'child')!.parentLeaseId = 'missing';
    expect(() => RunResourceBudgetController.restoreCheckpoint(missingParent)).toThrow(/parent/i);

    const cycle = checkpointClone(valid);
    cycle.leases.find((lease) => lease.leaseId === 'child')!.parentLeaseId = 'child';
    expect(() => RunResourceBudgetController.restoreCheckpoint(cycle)).toThrow(/cycle|root/i);

    const widenedBudget = checkpointClone(valid);
    widenedBudget.leases.find((lease) => lease.leaseId === 'child')!.budget.maxTokens = 101;
    expect(() => RunResourceBudgetController.restoreCheckpoint(widenedBudget)).toThrow(/widen/i);

    const conflictOperation = checkpointClone(valid);
    conflictOperation.operations.push({ ...conflictOperation.operations[0]! });
    expect(() => RunResourceBudgetController.restoreCheckpoint(conflictOperation)).toThrow(/operation/i);

    const invalidNumber = checkpointClone(valid);
    invalidNumber.leases.find((lease) => lease.leaseId === 'root')!.clock.activeMs = Number.POSITIVE_INFINITY;
    expect(() => RunResourceBudgetController.restoreCheckpoint(invalidNumber)).toThrow(/finite|number/i);

    const invalidClock = checkpointClone(valid);
    invalidClock.leases.find((lease) => lease.leaseId === 'child')!.clock = { state: 'paused', pauseDepth: 0, activeMs: 0 };
    expect(() => RunResourceBudgetController.restoreCheckpoint(invalidClock)).toThrow(/clock/i);

    const unexpectedPayload = checkpointClone(valid) as unknown as {
      operations: Array<Record<string, unknown>>;
    };
    unexpectedPayload.operations[0]!.args = { prompt: 'must not enter the resource ledger' };
    expect(() => parseRunResourceBudgetCheckpoint(unexpectedPayload)).toThrow(/unsupported field args/i);
    expect(() => RunResourceBudgetController.restoreCheckpoint(unexpectedPayload)).toThrow(/unsupported field args/i);
  });
});
