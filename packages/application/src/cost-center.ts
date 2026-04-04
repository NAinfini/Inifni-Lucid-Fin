import type { CostEstimate, GenerationType } from '@lucid-fin/contracts';

export interface UsageRecord {
  id: string;
  provider: string;
  type: GenerationType;
  cost: number;
  currency: string;
  timestamp: number;
  jobId?: string;
}

export interface BudgetLimit {
  provider?: string;
  type?: GenerationType;
  maxCost: number;
  currency: string;
  period: 'daily' | 'monthly' | 'total';
}

export interface BudgetStatus {
  limit: BudgetLimit;
  spent: number;
  remaining: number;
  exceeded: boolean;
}

export class CostCenter {
  private records: UsageRecord[] = [];
  private limits: BudgetLimit[] = [];
  private idCounter = 0;

  addLimit(limit: BudgetLimit): void {
    this.limits.push(limit);
  }

  removeLimit(index: number): void {
    this.limits.splice(index, 1);
  }

  getLimits(): readonly BudgetLimit[] {
    return this.limits;
  }

  /** Record actual spend after a job completes */
  record(
    provider: string,
    type: GenerationType,
    cost: number,
    currency: string,
    jobId?: string,
  ): UsageRecord {
    const rec: UsageRecord = {
      id: `cost-${++this.idCounter}`,
      provider,
      type,
      cost,
      currency,
      timestamp: Date.now(),
      jobId,
    };
    this.records.push(rec);
    return rec;
  }

  /** Check if a planned generation would exceed any budget limit */
  wouldExceed(estimate: CostEstimate, type: GenerationType): BudgetStatus | null {
    for (const limit of this.limits) {
      if (limit.provider && limit.provider !== estimate.provider) continue;
      if (limit.type && limit.type !== type) continue;
      if (limit.currency !== estimate.currency) continue;

      const spent = this.getSpent(limit);
      const remaining = limit.maxCost - spent;
      if (estimate.estimatedCost > remaining) {
        return { limit, spent, remaining, exceeded: true };
      }
    }
    return null;
  }

  /** Get all budget statuses */
  getBudgetStatuses(): BudgetStatus[] {
    return this.limits.map((limit) => {
      const spent = this.getSpent(limit);
      return {
        limit,
        spent,
        remaining: Math.max(0, limit.maxCost - spent),
        exceeded: spent >= limit.maxCost,
      };
    });
  }

  /** Get total spend for a period */
  getTotalSpend(currency: string, period?: 'daily' | 'monthly' | 'total'): number {
    const cutoff = this.getCutoff(period ?? 'total');
    return this.records
      .filter((r) => r.currency === currency && r.timestamp >= cutoff)
      .reduce((sum, r) => sum + r.cost, 0);
  }

  /** Get spend grouped by provider */
  getSpendByProvider(
    currency: string,
    period?: 'daily' | 'monthly' | 'total',
  ): Record<string, number> {
    const cutoff = this.getCutoff(period ?? 'total');
    const result: Record<string, number> = {};
    for (const r of this.records) {
      if (r.currency !== currency || r.timestamp < cutoff) continue;
      result[r.provider] = (result[r.provider] ?? 0) + r.cost;
    }
    return result;
  }

  /** Get all records (for persistence) */
  getRecords(): readonly UsageRecord[] {
    return this.records;
  }

  /** Restore records from persistence */
  loadRecords(records: UsageRecord[]): void {
    this.records = [...records];
    this.idCounter = records.length;
  }

  private getSpent(limit: BudgetLimit): number {
    const cutoff = this.getCutoff(limit.period);
    return this.records
      .filter((r) => {
        if (r.timestamp < cutoff) return false;
        if (limit.provider && r.provider !== limit.provider) return false;
        if (limit.type && r.type !== limit.type) return false;
        if (limit.currency !== r.currency) return false;
        return true;
      })
      .reduce((sum, r) => sum + r.cost, 0);
  }

  private getCutoff(period: 'daily' | 'monthly' | 'total'): number {
    if (period === 'total') return 0;
    const now = new Date();
    if (period === 'daily') {
      return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    }
    return new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  }
}
