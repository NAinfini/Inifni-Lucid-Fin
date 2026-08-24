import type {
  ResourceAmount,
  ResourceRemaining,
  RunBlocker,
  RunResourceBudget,
  RunResourceRemainder,
  RunResourceUsage,
} from '@lucid-fin/contracts';

type MeteredAmount =
  | { knowledge: 'known' | 'estimated'; value: number; upperBound: true }
  | { knowledge: 'unknown' };

export interface ResourceQuote {
  tokens: MeteredAmount;
  toolCalls: number;
  costUsd: MeteredAmount;
}

export interface ResourceMeasurement {
  tokens: ResourceAmount;
  toolCalls: number;
  costUsd: ResourceAmount;
}

export interface RunResourceClockCheckpoint {
  state: 'active' | 'waiting_user' | 'paused' | 'stopped';
  pauseDepth: number;
  activeMs: number;
}

export interface RunResourceLeaseCheckpoint {
  leaseId: string;
  parentLeaseId?: string;
  budget: RunResourceBudget;
  clock: RunResourceClockCheckpoint;
}

export interface RunResourceOperationCheckpoint {
  operationKey: string;
  operationId: string;
  leaseId: string;
  source: 'model' | 'tool';
  quote: ResourceQuote;
  measurement?: ResourceMeasurement;
}

/** Private, JSON-serializable state required to resume one shared resource ledger. */
export interface RunResourceBudgetCheckpoint {
  kind: 'run_resource_budget_checkpoint';
  schemaVersion: 1;
  carryIn: RunResourceUsage;
  leases: RunResourceLeaseCheckpoint[];
  operations: RunResourceOperationCheckpoint[];
}

export interface RunResourceBudgetRestore {
  root: RunResourceBudgetController;
  controllers: ReadonlyMap<string, RunResourceBudgetController>;
}

export type ResourceStateCause =
  | { kind: 'initialized' }
  | { kind: 'reserved' | 'settled'; operationId: string; source: 'model' | 'tool' }
  | { kind: 'wait_started' | 'wait_ended' }
  | { kind: 'pause_started' | 'pause_ended' }
  | { kind: 'boundary'; blocker: RunBlocker };

export interface ResourceStateSnapshot {
  kind: 'resource_state';
  schemaVersion: 1;
  cause: ResourceStateCause;
  usage: RunResourceUsage;
  remaining: RunResourceRemainder;
  clock: {
    state: 'active' | 'waiting_user' | 'paused' | 'stopped';
    activeMs: number;
    changedAt: number;
  };
}

export type ResourceReservation =
  | { accepted: true; state: ResourceStateSnapshot }
  | { accepted: false; blocker: RunBlocker; state: ResourceStateSnapshot };

interface OperationLedgerEntry {
  source: 'model' | 'tool';
  quote: ResourceQuote;
  measurement?: ResourceMeasurement;
}

interface AccountOperation {
  lease: ResourceLease;
  operationId: string;
  operation: OperationLedgerEntry;
}

interface ResourceLease {
  id: string;
  budget: Readonly<RunResourceBudget>;
  parent?: ResourceLease;
}

interface ControllerOptions {
  now?: () => number;
  carryIn?: RunResourceUsage;
  leaseId?: string;
  account?: ResourceAccount;
  parentLease?: ResourceLease;
  clock?: RunResourceClockCheckpoint;
}

const ZERO_USAGE: RunResourceUsage = {
  tokens: { knowledge: 'known', value: 0 },
  toolCalls: 0,
  wallTimeMs: 0,
  costUsd: { knowledge: 'known', value: 0 },
};

function cloneAmount(value: ResourceAmount): ResourceAmount {
  return value.knowledge === 'unknown' ? { knowledge: 'unknown' } : { ...value };
}

function cloneUsage(value: RunResourceUsage): RunResourceUsage {
  return {
    tokens: cloneAmount(value.tokens),
    toolCalls: value.toolCalls,
    wallTimeMs: value.wallTimeMs,
    costUsd: cloneAmount(value.costUsd),
  };
}

function cloneMeteredAmount(value: MeteredAmount): MeteredAmount {
  return value.knowledge === 'unknown' ? { knowledge: 'unknown' } : { ...value };
}

function cloneQuote(value: ResourceQuote): ResourceQuote {
  return {
    tokens: cloneMeteredAmount(value.tokens),
    toolCalls: value.toolCalls,
    costUsd: cloneMeteredAmount(value.costUsd),
  };
}

function cloneMeasurement(value: ResourceMeasurement): ResourceMeasurement {
  return {
    tokens: cloneAmount(value.tokens),
    toolCalls: value.toolCalls,
    costUsd: cloneAmount(value.costUsd),
  };
}

function cloneBudget(value: Readonly<RunResourceBudget>): RunResourceBudget {
  return { ...value };
}

function toPublicAmount(value: MeteredAmount): ResourceAmount {
  return value.knowledge === 'unknown'
    ? { knowledge: 'unknown' }
    : { knowledge: value.knowledge, value: value.value };
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function addAmounts(values: readonly ResourceAmount[]): ResourceAmount {
  if (values.some((value) => value.knowledge === 'unknown')) return { knowledge: 'unknown' };
  const knowledge = values.some((value) => value.knowledge === 'estimated')
    ? 'estimated'
    : 'known';
  return {
    knowledge,
    value: values.reduce((sum, value) => sum + ('value' in value ? value.value : 0), 0),
  };
}

const USD_SCALE = 1_000_000;

function usdMicros(value: number): number {
  return Math.round(value * USD_SCALE);
}

function publicUsd(micros: number): number {
  return Number((micros / USD_SCALE).toFixed(6));
}

function addCostAmounts(values: readonly ResourceAmount[]): ResourceAmount {
  if (values.some((value) => value.knowledge === 'unknown')) return { knowledge: 'unknown' };
  const knowledge = values.some((value) => value.knowledge === 'estimated')
    ? 'estimated'
    : 'known';
  return {
    knowledge,
    value: publicUsd(
      values.reduce(
        (sum, value) => sum + ('value' in value ? usdMicros(value.value) : 0),
        0,
      ),
    ),
  };
}

function remainingFor(
  limit: number | undefined,
  usage: ResourceAmount,
): ResourceRemaining {
  if (limit === undefined) return { state: 'unlimited' };
  if (usage.knowledge === 'unknown') return { state: 'unknown' };
  return {
    state: usage.knowledge,
    value: Math.max(0, limit - usage.value),
  };
}

function minimumRemaining(values: ResourceRemaining[]): ResourceRemaining {
  const bounded = values.filter((value) => value.state !== 'unlimited');
  if (bounded.length === 0) return { state: 'unlimited' };
  if (bounded.some((value) => value.state === 'unknown')) return { state: 'unknown' };
  const measured = bounded as Array<Extract<ResourceRemaining, { value: number }>>;
  return {
    state: measured.some((value) => value.state === 'estimated') ? 'estimated' : 'known',
    value: Math.min(...measured.map((value) => value.value)),
  };
}

function exhausted(metric: 'tokens' | 'tool_calls' | 'wall_time' | 'cost'): RunBlocker {
  return { kind: 'resource_budget', metric, reason: 'exhausted' };
}

function unavailable(metric: 'tokens' | 'cost'): RunBlocker {
  return { kind: 'resource_budget', metric, reason: 'unavailable' };
}

let nextLeaseId = 0;

class ResourceAccount {
  private readonly operations = new Map<string, AccountOperation>();
  private readonly leases = new Map<
    string,
    { lease: ResourceLease; controller: RunResourceBudgetController }
  >();
  private readonly carryIn: RunResourceUsage;

  constructor(carryIn?: RunResourceUsage) {
    this.carryIn = cloneUsage(carryIn ?? ZERO_USAGE);
  }

  get(key: string): OperationLedgerEntry | undefined {
    return this.operations.get(key)?.operation;
  }

  set(
    key: string,
    lease: ResourceLease,
    operationId: string,
    operation: OperationLedgerEntry,
  ): void {
    if (this.operations.has(key)) {
      throw new Error(`Resource operation ${operationId} already exists`);
    }
    this.operations.set(key, {
      lease,
      operationId,
      operation: {
        source: operation.source,
        quote: cloneQuote(operation.quote),
        ...(operation.measurement ? { measurement: cloneMeasurement(operation.measurement) } : {}),
      },
    });
  }

  registerLease(lease: ResourceLease, controller: RunResourceBudgetController): void {
    if (this.leases.has(lease.id)) {
      throw new Error(`Duplicate resource lease ${lease.id}`);
    }
    this.leases.set(lease.id, { lease, controller });
  }

  hasLease(leaseId: string): boolean {
    return this.leases.has(leaseId);
  }

  getLeases(): Array<{ lease: ResourceLease; controller: RunResourceBudgetController }> {
    return [...this.leases.values()];
  }

  getOperations(): Array<[string, AccountOperation]> {
    return [...this.operations.entries()];
  }

  getCarryIn(): RunResourceUsage {
    return cloneUsage(this.carryIn);
  }

  usage(lease: ResourceLease, wallTimeMs: number): RunResourceUsage {
    const entries = [...this.operations.values()]
      .filter((entry) => this.belongsTo(entry.lease, lease))
      .map((entry) => entry.operation);
    const includeCarryIn = lease.parent === undefined;
    return {
      tokens: addAmounts([
        ...(includeCarryIn ? [this.carryIn.tokens] : []),
        ...entries.map((entry) =>
          entry.measurement?.tokens ?? toPublicAmount(entry.quote.tokens)),
      ]),
      toolCalls:
        (includeCarryIn ? this.carryIn.toolCalls : 0) +
        entries.reduce(
          (sum, entry) => sum + (entry.measurement?.toolCalls ?? entry.quote.toolCalls),
          0,
        ),
      wallTimeMs,
      costUsd: addCostAmounts([
        ...(includeCarryIn ? [this.carryIn.costUsd] : []),
        ...entries.map((entry) =>
          entry.measurement?.costUsd ?? toPublicAmount(entry.quote.costUsd)),
      ]),
    };
  }

  private belongsTo(candidate: ResourceLease, ancestor: ResourceLease): boolean {
    let current: ResourceLease | undefined = candidate;
    while (current) {
      if (current === ancestor) return true;
      current = current.parent;
    }
    return false;
  }
}

function childBudget(parent: Readonly<RunResourceBudget>, requested?: RunResourceBudget): RunResourceBudget {
  const narrowed = { ...parent, ...(requested ?? {}) };
  for (const key of ['maxTokens', 'maxToolCalls', 'maxWallTimeMs', 'maxCostUsd'] as const) {
    const parentLimit = parent[key];
    const childLimit = narrowed[key];
    if (parentLimit !== undefined && (childLimit === undefined || childLimit > parentLimit)) {
      throw new Error(`Child resource budget cannot widen ${key}`);
    }
  }
  return narrowed;
}

function checkpointError(message: string): never {
  throw new Error(`Invalid resource checkpoint: ${message}`);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function checkpointRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isPlainRecord(value)) checkpointError(`${label} must be an object`);
  return value;
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function exactCheckpointKeys(
  record: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
  label: string,
): void {
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) checkpointError(`${label} contains unsupported field ${key}`);
  }
  for (const key of required) {
    if (!hasOwn(record, key)) checkpointError(`${label} is missing ${key}`);
  }
}

function checkpointString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    checkpointError(`${label} must be a non-empty string`);
  }
  return value;
}

function checkpointNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    checkpointError(`${label} must be a finite non-negative number`);
  }
  return value;
}

function parseResourceAmount(value: unknown, label: string): ResourceAmount {
  const record = checkpointRecord(value, label);
  const knowledge = record.knowledge;
  if (knowledge === 'unknown') {
    exactCheckpointKeys(record, ['knowledge'], [], label);
    return { knowledge: 'unknown' };
  }
  if (knowledge !== 'known' && knowledge !== 'estimated') {
    checkpointError(`${label}.knowledge is invalid`);
  }
  exactCheckpointKeys(record, ['knowledge', 'value'], [], label);
  return { knowledge, value: checkpointNumber(record.value, `${label}.value`) };
}

function parseMeteredAmount(value: unknown, label: string): MeteredAmount {
  const record = checkpointRecord(value, label);
  const knowledge = record.knowledge;
  if (knowledge === 'unknown') {
    exactCheckpointKeys(record, ['knowledge'], [], label);
    return { knowledge: 'unknown' };
  }
  if (knowledge !== 'known' && knowledge !== 'estimated') {
    checkpointError(`${label}.knowledge is invalid`);
  }
  exactCheckpointKeys(record, ['knowledge', 'value', 'upperBound'], [], label);
  if (record.upperBound !== true) checkpointError(`${label}.upperBound must be true`);
  return {
    knowledge,
    value: checkpointNumber(record.value, `${label}.value`),
    upperBound: true,
  };
}

function parseUsage(value: unknown, label: string): RunResourceUsage {
  const record = checkpointRecord(value, label);
  exactCheckpointKeys(record, ['tokens', 'toolCalls', 'wallTimeMs', 'costUsd'], [], label);
  return {
    tokens: parseResourceAmount(record.tokens, `${label}.tokens`),
    toolCalls: checkpointNumber(record.toolCalls, `${label}.toolCalls`),
    wallTimeMs: checkpointNumber(record.wallTimeMs, `${label}.wallTimeMs`),
    costUsd: parseResourceAmount(record.costUsd, `${label}.costUsd`),
  };
}

function parseQuote(value: unknown, label: string): ResourceQuote {
  const record = checkpointRecord(value, label);
  exactCheckpointKeys(record, ['tokens', 'toolCalls', 'costUsd'], [], label);
  return {
    tokens: parseMeteredAmount(record.tokens, `${label}.tokens`),
    toolCalls: checkpointNumber(record.toolCalls, `${label}.toolCalls`),
    costUsd: parseMeteredAmount(record.costUsd, `${label}.costUsd`),
  };
}

function parseMeasurement(value: unknown, label: string): ResourceMeasurement {
  const record = checkpointRecord(value, label);
  exactCheckpointKeys(record, ['tokens', 'toolCalls', 'costUsd'], [], label);
  return {
    tokens: parseResourceAmount(record.tokens, `${label}.tokens`),
    toolCalls: checkpointNumber(record.toolCalls, `${label}.toolCalls`),
    costUsd: parseResourceAmount(record.costUsd, `${label}.costUsd`),
  };
}

const BUDGET_KEYS = ['maxTokens', 'maxToolCalls', 'maxWallTimeMs', 'maxCostUsd'] as const;

function parseBudget(value: unknown, label: string): RunResourceBudget {
  const record = checkpointRecord(value, label);
  exactCheckpointKeys(record, [], BUDGET_KEYS, label);
  const budget: Record<string, number> = {};
  for (const key of BUDGET_KEYS) {
    if (hasOwn(record, key)) budget[key] = checkpointNumber(record[key], `${label}.${key}`);
  }
  return budget as RunResourceBudget;
}

function parseClock(value: unknown, label: string): RunResourceClockCheckpoint {
  const record = checkpointRecord(value, label);
  exactCheckpointKeys(record, ['state', 'pauseDepth', 'activeMs'], [], label);
  const state = record.state;
  if (state !== 'active' && state !== 'waiting_user' && state !== 'paused' && state !== 'stopped') {
    checkpointError(`${label}.state is invalid`);
  }
  const pauseDepth = checkpointNumber(record.pauseDepth, `${label}.pauseDepth`);
  if (!Number.isSafeInteger(pauseDepth)) checkpointError(`${label}.pauseDepth must be an integer`);
  const activeMs = checkpointNumber(record.activeMs, `${label}.activeMs`);
  if ((state === 'paused') !== (pauseDepth > 0)) {
    checkpointError(`${label} has inconsistent state and pause depth`);
  }
  return { state, pauseDepth, activeMs };
}

function parseLease(value: unknown, label: string): RunResourceLeaseCheckpoint {
  const record = checkpointRecord(value, label);
  exactCheckpointKeys(record, ['leaseId', 'budget', 'clock'], ['parentLeaseId'], label);
  const parentLeaseId = hasOwn(record, 'parentLeaseId')
    ? checkpointString(record.parentLeaseId, `${label}.parentLeaseId`)
    : undefined;
  return {
    leaseId: checkpointString(record.leaseId, `${label}.leaseId`),
    ...(parentLeaseId ? { parentLeaseId } : {}),
    budget: parseBudget(record.budget, `${label}.budget`),
    clock: parseClock(record.clock, `${label}.clock`),
  };
}

function parseOperation(value: unknown, label: string): RunResourceOperationCheckpoint {
  const record = checkpointRecord(value, label);
  exactCheckpointKeys(record, ['operationKey', 'operationId', 'leaseId', 'source', 'quote'], ['measurement'], label);
  const source = record.source;
  if (source !== 'model' && source !== 'tool') checkpointError(`${label}.source is invalid`);
  const measurement = hasOwn(record, 'measurement')
    ? parseMeasurement(record.measurement, `${label}.measurement`)
    : undefined;
  return {
    operationKey: checkpointString(record.operationKey, `${label}.operationKey`),
    operationId: checkpointString(record.operationId, `${label}.operationId`),
    leaseId: checkpointString(record.leaseId, `${label}.leaseId`),
    source,
    quote: parseQuote(record.quote, `${label}.quote`),
    ...(measurement ? { measurement } : {}),
  };
}

export function parseRunResourceBudgetCheckpoint(value: unknown): RunResourceBudgetCheckpoint {
  const record = checkpointRecord(value, 'checkpoint');
  exactCheckpointKeys(record, ['kind', 'schemaVersion', 'carryIn', 'leases', 'operations'], [], 'checkpoint');
  if (record.kind !== 'run_resource_budget_checkpoint') checkpointError('checkpoint.kind is invalid');
  if (record.schemaVersion !== 1) checkpointError('checkpoint.schemaVersion is invalid');
  if (!Array.isArray(record.leases) || !Array.isArray(record.operations)) {
    checkpointError('checkpoint leases and operations must be arrays');
  }
  return {
    kind: 'run_resource_budget_checkpoint',
    schemaVersion: 1,
    carryIn: parseUsage(record.carryIn, 'checkpoint.carryIn'),
    leases: record.leases.map((lease, index) => parseLease(lease, `checkpoint.leases[${index}]`)),
    operations: record.operations.map((operation, index) =>
      parseOperation(operation, `checkpoint.operations[${index}]`)),
  };
}

function assertRestorableCheckpoint(checkpoint: RunResourceBudgetCheckpoint): Map<string, RunResourceLeaseCheckpoint> {
  const leases = new Map<string, RunResourceLeaseCheckpoint>();
  for (const lease of checkpoint.leases) {
    if (leases.has(lease.leaseId)) checkpointError(`duplicate lease ${lease.leaseId}`);
    leases.set(lease.leaseId, lease);
  }
  if (leases.size === 0) checkpointError('checkpoint requires a root resource lease');
  for (const lease of leases.values()) {
    if (!lease.parentLeaseId) continue;
    const parent = leases.get(lease.parentLeaseId);
    if (!parent) checkpointError(`lease ${lease.leaseId} has a missing parent`);
    for (const key of BUDGET_KEYS) {
      const parentLimit = parent.budget[key];
      const childLimit = lease.budget[key];
      if (parentLimit !== undefined && (childLimit === undefined || childLimit > parentLimit)) {
        checkpointError(`lease ${lease.leaseId} widens ${key}`);
      }
    }
  }
  for (const lease of leases.values()) {
    const visited = new Set<string>();
    let current: RunResourceLeaseCheckpoint | undefined = lease;
    while (current) {
      if (visited.has(current.leaseId)) checkpointError(`lease lineage contains a cycle at ${current.leaseId}`);
      visited.add(current.leaseId);
      current = current.parentLeaseId ? leases.get(current.parentLeaseId) : undefined;
    }
  }
  const roots = [...leases.values()].filter((lease) => !lease.parentLeaseId);
  if (roots.length !== 1) checkpointError('checkpoint requires exactly one root resource lease');

  const operationKeys = new Set<string>();
  for (const operation of checkpoint.operations) {
    if (!leases.has(operation.leaseId)) {
      checkpointError(`operation ${operation.operationKey} has an unknown lease`);
    }
    if (operation.operationKey !== `${operation.leaseId}:${operation.operationId}`) {
      checkpointError(`operation ${operation.operationKey} has an inconsistent key`);
    }
    if (operationKeys.has(operation.operationKey)) {
      checkpointError(`conflicting operation ${operation.operationKey}`);
    }
    operationKeys.add(operation.operationKey);
  }
  return leases;
}

/**
 * Per-run resource ledger. It owns the frozen limits, cumulative usage and
 * active-time clock; callers persist each returned full snapshot before an
 * external operation is allowed to start.
 */
export class RunResourceBudgetController {
  readonly budget: Readonly<RunResourceBudget>;
  private readonly now: () => number;
  private readonly account: ResourceAccount;
  private readonly lease: ResourceLease;
  private clockState: 'active' | 'waiting_user' | 'paused' | 'stopped' = 'stopped';
  private pauseDepth = 0;
  private activeMs = 0;
  private changedAt: number;

  constructor(budget: RunResourceBudget, options: ControllerOptions = {}) {
    this.budget = Object.freeze({ ...budget });
    this.now = options.now ?? Date.now;
    this.account = options.account ?? new ResourceAccount(options.carryIn);
    const leaseId = options.leaseId ?? this.nextLeaseId();
    this.lease = {
      id: leaseId,
      budget: this.budget,
      ...(options.parentLease ? { parent: options.parentLease } : {}),
    };
    this.clockState = options.clock?.state ?? 'stopped';
    this.pauseDepth = options.clock?.pauseDepth ?? 0;
    this.activeMs = options.clock?.activeMs ?? (options.account ? 0 : (options.carryIn?.wallTimeMs ?? 0));
    this.changedAt = this.now();
    this.account.registerLease(this.lease, this);
  }

  createLease(requestedBudget?: RunResourceBudget, leaseId?: string): RunResourceBudgetController {
    return new RunResourceBudgetController(childBudget(this.budget, requestedBudget), {
      now: this.now,
      account: this.account,
      leaseId,
      parentLease: this.lease,
    });
  }

  get leaseId(): string {
    return this.lease.id;
  }

  exportCheckpoint(): RunResourceBudgetCheckpoint {
    const capturedAt = this.now();
    const leases = this.account.getLeases();
    for (const { controller } of leases) controller.sampleActiveTime(capturedAt);
    const checkpoint: RunResourceBudgetCheckpoint = {
      kind: 'run_resource_budget_checkpoint',
      schemaVersion: 1,
      carryIn: this.account.getCarryIn(),
      leases: leases
        .map(({ lease, controller }) => ({
          leaseId: lease.id,
          ...(lease.parent ? { parentLeaseId: lease.parent.id } : {}),
          budget: cloneBudget(lease.budget),
          clock: controller.checkpointClock(),
        }))
        .sort((left, right) => left.leaseId.localeCompare(right.leaseId)),
      operations: this.account
        .getOperations()
        .map(([operationKey, entry]) => ({
          operationKey,
          operationId: entry.operationId,
          leaseId: entry.lease.id,
          source: entry.operation.source,
          quote: cloneQuote(entry.operation.quote),
          ...(entry.operation.measurement
            ? { measurement: cloneMeasurement(entry.operation.measurement) }
            : {}),
        }))
        .sort((left, right) => left.operationKey.localeCompare(right.operationKey)),
    };
    return parseRunResourceBudgetCheckpoint(checkpoint);
  }

  static restoreCheckpoint(
    checkpoint: unknown,
    options: { now?: () => number } = {},
  ): RunResourceBudgetRestore {
    const parsed = parseRunResourceBudgetCheckpoint(checkpoint);
    const leases = assertRestorableCheckpoint(parsed);
    const now = options.now ?? Date.now;
    const account = new ResourceAccount(parsed.carryIn);
    const rootLease = [...leases.values()].find((lease) => !lease.parentLeaseId)!;
    const root = new RunResourceBudgetController(rootLease.budget, {
      now,
      account,
      leaseId: rootLease.leaseId,
      clock: rootLease.clock,
    });
    const controllers = new Map<string, RunResourceBudgetController>([[root.leaseId, root]]);
    const pending = [...leases.values()].filter((lease) => lease !== rootLease);
    while (pending.length > 0) {
      let restored = false;
      for (let index = pending.length - 1; index >= 0; index--) {
        const lease = pending[index]!;
        const parent = controllers.get(lease.parentLeaseId!);
        if (!parent) continue;
        const controller = new RunResourceBudgetController(lease.budget, {
          now,
          account,
          leaseId: lease.leaseId,
          parentLease: parent.lease,
          clock: lease.clock,
        });
        controllers.set(controller.leaseId, controller);
        pending.splice(index, 1);
        restored = true;
      }
      if (!restored) checkpointError('lease lineage cannot be restored');
    }
    for (const operation of parsed.operations) {
      const controller = controllers.get(operation.leaseId);
      if (!controller) checkpointError(`operation ${operation.operationKey} has an unknown lease`);
      account.set(operation.operationKey, controller.lease, operation.operationId, {
        source: operation.source,
        quote: operation.quote,
        ...(operation.measurement ? { measurement: operation.measurement } : {}),
      });
    }
    return { root, controllers };
  }

  reserve(
    operationId: string,
    source: 'model' | 'tool',
    quote: ResourceQuote,
  ): ResourceReservation {
    const accountOperationId = `${this.lease.id}:${operationId}`;
    const prior = this.account.get(accountOperationId);
    if (prior) {
      if (prior.source !== source || !sameJson(prior.quote, quote)) {
        throw new Error(`Resource operation ${operationId} was replayed with conflicting input`);
      }
      return { accepted: true, state: this.snapshot({ kind: 'reserved', operationId, source }) };
    }

    this.ensureActive();
    const boundary = this.checkBoundary();
    if (boundary) return this.rejected(boundary);

    for (const lease of this.lineage()) {
      const usage = this.account.usage(lease, 0);
      if (lease.budget.maxToolCalls !== undefined &&
          usage.toolCalls + quote.toolCalls > lease.budget.maxToolCalls) {
        return this.rejected(exhausted('tool_calls'));
      }
      const tokenBlocker = this.preflightAmount(
        'tokens', lease.budget.maxTokens, usage.tokens, quote.tokens,
      );
      if (tokenBlocker) return this.rejected(tokenBlocker);
      const costBlocker = this.preflightAmount(
        'cost', lease.budget.maxCostUsd, usage.costUsd, quote.costUsd,
      );
      if (costBlocker) return this.rejected(costBlocker);
    }

    this.account.set(accountOperationId, this.lease, operationId, { source, quote });
    return { accepted: true, state: this.snapshot({ kind: 'reserved', operationId, source }) };
  }

  settle(
    operationId: string,
    source: 'model' | 'tool',
    measurement: ResourceMeasurement,
  ): ResourceStateSnapshot {
    const operation = this.account.get(`${this.lease.id}:${operationId}`);
    if (!operation || operation.source !== source) {
      throw new Error(`Cannot settle unknown resource operation ${operationId}`);
    }
    if (operation.measurement && !sameJson(operation.measurement, measurement)) {
      throw new Error(`Resource operation ${operationId} was settled with conflicting input`);
    }
    operation.measurement = cloneMeasurement(measurement);
    return this.snapshot({ kind: 'settled', operationId, source });
  }

  startUserWait(): ResourceStateSnapshot {
    this.sampleActiveTime();
    this.clockState = 'waiting_user';
    this.changedAt = this.now();
    return this.snapshot({ kind: 'wait_started' });
  }

  endUserWait(): ResourceStateSnapshot {
    if (this.clockState === 'waiting_user') {
      this.clockState = 'active';
      this.changedAt = this.now();
    }
    return this.snapshot({ kind: 'wait_ended' });
  }

  startPause(): ResourceStateSnapshot {
    if (this.pauseDepth === 0) {
      this.sampleActiveTime();
      this.clockState = 'paused';
      this.changedAt = this.now();
    }
    this.pauseDepth++;
    return this.snapshot({ kind: 'pause_started' });
  }

  endPause(): ResourceStateSnapshot {
    if (this.pauseDepth > 0) this.pauseDepth--;
    if (this.pauseDepth === 0 && this.clockState === 'paused') {
      this.clockState = 'active';
      this.changedAt = this.now();
    }
    return this.snapshot({ kind: 'pause_ended' });
  }

  stop(): void {
    this.sampleActiveTime();
    this.pauseDepth = 0;
    this.clockState = 'stopped';
    this.changedAt = this.now();
  }

  remainingWallTimeMs(): number | undefined {
    if (this.budget.maxWallTimeMs === undefined) return undefined;
    return Math.max(0, this.budget.maxWallTimeMs - this.getUsage().wallTimeMs);
  }

  checkBoundary(): RunBlocker | undefined {
    const usage = this.getUsage();
    if (
      this.budget.maxWallTimeMs !== undefined &&
      usage.wallTimeMs >= this.budget.maxWallTimeMs
    ) {
      return exhausted('wall_time');
    }
    for (const lease of this.lineage()) {
      const scoped = this.account.usage(lease, 0);
      if (lease.budget.maxTokens !== undefined && scoped.tokens.knowledge !== 'unknown' &&
          scoped.tokens.value > lease.budget.maxTokens) return exhausted('tokens');
      if (lease.budget.maxToolCalls !== undefined && scoped.toolCalls > lease.budget.maxToolCalls) {
        return exhausted('tool_calls');
      }
      if (lease.budget.maxCostUsd !== undefined && scoped.costUsd.knowledge !== 'unknown' &&
          usdMicros(scoped.costUsd.value) > usdMicros(lease.budget.maxCostUsd)) {
        return exhausted('cost');
      }
    }
    return undefined;
  }

  getUsage(): RunResourceUsage {
    this.sampleActiveTime();
    return this.account.usage(this.lease, this.activeMs);
  }

  snapshot(cause: ResourceStateCause): ResourceStateSnapshot {
    const usage = this.getUsage();
    return {
      kind: 'resource_state',
      schemaVersion: 1,
      cause,
      usage,
      remaining: this.remaining(),
      clock: {
        state: this.clockState,
        activeMs: usage.wallTimeMs,
        changedAt: this.changedAt,
      },
    };
  }

  private rejected(blocker: RunBlocker): ResourceReservation {
    return {
      accepted: false,
      blocker,
      state: this.snapshot({ kind: 'boundary', blocker }),
    };
  }

  private ensureActive(): void {
    if (this.clockState === 'stopped') {
      this.clockState = 'active';
      this.changedAt = this.now();
    }
  }

  private sampleActiveTime(now = this.now()): void {
    if (this.clockState !== 'active') return;
    this.activeMs += Math.max(0, now - this.changedAt);
    this.changedAt = now;
  }

  private checkpointClock(): RunResourceClockCheckpoint {
    return {
      state: this.clockState,
      pauseDepth: this.pauseDepth,
      activeMs: this.activeMs,
    };
  }

  private nextLeaseId(): string {
    let leaseId: string;
    do {
      leaseId = `lease-${++nextLeaseId}`;
    } while (this.account.hasLease(leaseId));
    return leaseId;
  }

  private remaining(): RunResourceRemainder {
    const scopes = this.lineage().map((lease) => ({
      budget: lease.budget,
      usage: this.account.usage(lease, lease === this.lease ? this.activeMs : 0),
    }));
    const local = scopes[0]!;
    return {
      tokens: minimumRemaining(scopes.map(({ budget, usage }) =>
        remainingFor(budget.maxTokens, usage.tokens))),
      toolCalls: minimumRemaining(scopes.map(({ budget, usage }) =>
        budget.maxToolCalls === undefined
          ? { state: 'unlimited' as const }
          : { state: 'known' as const, value: Math.max(0, budget.maxToolCalls - usage.toolCalls) })),
      wallTimeMs:
        local.budget.maxWallTimeMs === undefined
          ? { state: 'unlimited' }
          : { state: 'known', value: Math.max(0, local.budget.maxWallTimeMs - local.usage.wallTimeMs) },
      costUsd: minimumRemaining(scopes.map(({ budget, usage }) =>
        remainingFor(budget.maxCostUsd, usage.costUsd))),
    };
  }

  private lineage(): ResourceLease[] {
    const result: ResourceLease[] = [];
    let current: ResourceLease | undefined = this.lease;
    while (current) {
      result.push(current);
      current = current.parent;
    }
    return result;
  }

  private preflightAmount(
    metric: 'tokens' | 'cost',
    limit: number | undefined,
    current: ResourceAmount,
    quote: MeteredAmount,
  ): RunBlocker | undefined {
    if (limit === undefined) return undefined;
    if (current.knowledge === 'unknown' || quote.knowledge === 'unknown') {
      return unavailable(metric);
    }
    if (
      metric === 'cost'
        ? usdMicros(current.value) + usdMicros(quote.value) > usdMicros(limit)
        : current.value + quote.value > limit
    ) {
      return exhausted(metric);
    }
    return undefined;
  }
}
