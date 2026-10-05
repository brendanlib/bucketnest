import { Dec, percentage, type Cents } from './money.js';
import type { Decimal } from 'decimal.js';

export type BudgetStatus = 'none' | 'ok' | 'amber' | 'red' | 'unbudgeted';

export interface Thresholds {
  /** % used at which a line turns amber, e.g. 90. */
  amber: Decimal.Value;
  /** % used above which a line turns red, e.g. 100. */
  red: Decimal.Value;
}

export interface Variance {
  budgetCents: Cents;
  actualCents: Cents;
  /** Budget − actual; negative means overspent. */
  remainingCents: Cents;
  /** Actual ÷ budget × 100 to 2 dp; null when the budget is 0 (shown as "—"). */
  percentUsed: number | null;
  status: BudgetStatus;
}

export function calculateRemainingBudget(budgetCents: Cents, actualCents: Cents): Cents {
  return budgetCents - actualCents;
}

/**
 * Budget vs actual for one line (spec §9). Thresholds compare exact values, so
 * 90.00% used is amber at a 90% threshold and 100.00% is not yet red at 100%.
 */
export function calculateBudgetVariance(budgetCents: Cents, actualCents: Cents, thresholds: Thresholds): Variance {
  const remainingCents = calculateRemainingBudget(budgetCents, actualCents);
  if (budgetCents === 0) {
    return { budgetCents, actualCents, remainingCents, percentUsed: null, status: actualCents > 0 ? 'unbudgeted' : 'none' };
  }
  const used = new Dec(actualCents).times(100).dividedBy(budgetCents);
  const status: BudgetStatus = used.greaterThan(thresholds.red) ? 'red' : used.greaterThanOrEqualTo(thresholds.amber) ? 'amber' : 'ok';
  return { budgetCents, actualCents, remainingCents, percentUsed: percentage(actualCents, budgetCents), status };
}

/** (income − spending) ÷ income, as a percentage to 2 dp; null with no income. */
export function calculateSavingsRate(incomeCents: Cents, spendingCents: Cents): number | null {
  return percentage(incomeCents - spendingCents, incomeCents);
}

export interface SummaryCategory {
  id: string;
  name: string;
  bucketId: string | null;
  parentId: string | null;
  isGroup: boolean;
  isActive: boolean;
  sortOrder: number;
  kind: 'INCOME' | 'EXPENSE';
}

export interface SummaryBucket {
  id: string;
  key: string;
  name: string;
  colour: string;
  sortOrder: number;
}

export interface SummaryItem {
  categoryId: string;
  /** Already converted to the budget period. */
  periodAmountCents: Cents;
}

export interface Line extends Variance {
  categoryId: string;
  name: string;
  hasItem: boolean;
  isActive: boolean;
  /** Set for a sinking fund's line: its contribution is the budget, contributions the actual. */
  sinkingFundId?: string;
}

export interface FundLine {
  sinkingFundId: string;
  /** The fund's linked category, which places the line in a bucket and group. */
  categoryId: string;
  name: string;
  budgetCents: Cents;
  actualCents: Cents;
}

export interface GroupSummary extends Variance {
  groupId: string | null;
  name: string;
  lines: Line[];
}

export interface BucketSummary extends Variance {
  bucketId: string;
  key: string;
  name: string;
  colour: string;
  allocatedCents: Cents;
  /** Planned total minus allocation when positive ("over-allocated by $X"), else 0. */
  overAllocatedCents: Cents;
  /** Actual vs the allocation, for the bucket cards. */
  allocation: Variance;
  groups: GroupSummary[];
}

/**
 * Rolls category lines up by group, then bucket, then total. A line appears
 * when it has a budget item or any activity; activity with no item is
 * flagged unbudgeted. Inactive categories appear only if they have either.
 */
export function buildBudgetSummary(input: {
  categories: SummaryCategory[];
  buckets: SummaryBucket[];
  items: SummaryItem[];
  spending: Map<string, Cents>;
  allocations: Map<string, Cents>;
  thresholds: Thresholds;
  includeEmpty?: boolean;
  /** Sinking fund lines (spec §9), placed beside their category. */
  fundLines?: FundLine[];
}): { buckets: BucketSummary[]; total: Variance } {
  const { thresholds } = input;
  const itemFor = new Map(input.items.map((i) => [i.categoryId, i.periodAmountCents]));
  const groupName = new Map(input.categories.filter((c) => c.isGroup).map((c) => [c.id, c]));
  const leaves = input.categories
    .filter((c) => !c.isGroup && c.kind === 'EXPENSE' && c.bucketId)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));

  const sum = (list: Variance[]) => {
    const budget = list.reduce((s, v) => s + v.budgetCents, 0);
    const actual = list.reduce((s, v) => s + v.actualCents, 0);
    return calculateBudgetVariance(budget, actual, thresholds);
  };

  const buckets = [...input.buckets]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((b): BucketSummary => {
      const lines = leaves
        .filter((c) => c.bucketId === b.id)
        .map((c): Line | null => {
          const hasItem = itemFor.has(c.id);
          const actual = input.spending.get(c.id) ?? 0;
          if (!hasItem && actual === 0 && !(input.includeEmpty && c.isActive)) return null;
          return { categoryId: c.id, name: c.name, hasItem, isActive: c.isActive, ...calculateBudgetVariance(itemFor.get(c.id) ?? 0, actual, thresholds) };
        })
        .filter((l): l is Line => l !== null);
      for (const f of input.fundLines ?? []) {
        const c = leaves.find((x) => x.id === f.categoryId);
        if (c?.bucketId !== b.id) continue;
        const at = lines.findIndex((l) => l.categoryId === f.categoryId);
        const line: Line = { categoryId: f.categoryId, name: f.name, hasItem: true, isActive: true, sinkingFundId: f.sinkingFundId, ...calculateBudgetVariance(f.budgetCents, f.actualCents, thresholds) };
        if (at >= 0) lines.splice(at + 1, 0, line);
        else lines.push(line);
      }

      const groupIds = [...new Set(lines.map((l) => leaves.find((c) => c.id === l.categoryId)!.parentId))];
      const groups = groupIds
        .map((gid): GroupSummary => {
          const groupLines = lines.filter((l) => leaves.find((c) => c.id === l.categoryId)!.parentId === gid);
          const g = gid ? groupName.get(gid) : undefined;
          return { groupId: gid, name: g?.name ?? 'Other', lines: groupLines, ...sum(groupLines) };
        })
        .sort((x, y) => (groupName.get(x.groupId ?? '')?.sortOrder ?? 1e9) - (groupName.get(y.groupId ?? '')?.sortOrder ?? 1e9));

      const totals = sum(lines);
      const allocated = input.allocations.get(b.id) ?? 0;
      return {
        bucketId: b.id,
        key: b.key,
        name: b.name,
        colour: b.colour,
        allocatedCents: allocated,
        overAllocatedCents: Math.max(0, totals.budgetCents - allocated),
        allocation: calculateBudgetVariance(allocated, totals.actualCents, thresholds),
        groups,
        ...totals,
      };
    });

  return { buckets, total: sum(buckets) };
}
