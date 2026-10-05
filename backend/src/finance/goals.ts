import { ceilToCents, Dec, percentage, type Cents } from './money.js';
import type { DateOnly } from './dates.js';
import { nominalDatesBetween, nominalSequence, type ScheduleSpec } from './recurrence.js';
import type { FrequencySpec } from './frequency.js';

export interface ContributionPlan extends FrequencySpec {
  /** The day contributions are counted from (their pattern repeats from here). */
  anchorDate: DateOnly;
}

const specOf = (p: ContributionPlan): ScheduleSpec => ({ frequency: p.frequency, interval: p.interval, startDate: p.anchorDate, amountCents: 0 });

/** Contribution dates on or after `from` and on or before `until`. */
export function countContributionDates(plan: ContributionPlan, from: DateOnly, until: DateOnly): number {
  if (until < from) return 0;
  return nominalDatesBetween(specOf(plan), from, until, 100_000).length;
}

/**
 * Sinking fund (spec §9): what is left to save ÷ contribution dates left before
 * the due date, rounded up to the cent so the target is reached. With no dates
 * left the whole shortfall is due now.
 */
export function calculateSinkingFundContribution(input: { targetCents: Cents; currentCents: Cents; datesLeft: number }): {
  remainingCents: Cents;
  contributionCents: Cents;
  funded: boolean;
} {
  const remaining = Math.max(0, input.targetCents - input.currentCents);
  if (remaining === 0) return { remainingCents: 0, contributionCents: 0, funded: true };
  if (input.datesLeft <= 0) return { remainingCents: remaining, contributionCents: remaining, funded: false };
  return { remainingCents: remaining, contributionCents: ceilToCents(new Dec(remaining).dividedBy(input.datesLeft)), funded: false };
}

export interface GoalProgress {
  progressPercent: number | null;
  remainingCents: Cents;
  reached: boolean;
  /** Needed per contribution to hit the target date; null without a date and frequency. */
  requiredContributionCents: Cents | null;
  /** When the target is reached at the current contribution; null if never. */
  projectedDate: DateOnly | null;
  /** Projected on or before the target date (null when there is no target date). */
  onTrack: boolean | null;
}

/** Goal progress (spec §10): percentage, required contribution, and projected completion. */
export function calculateGoalProgress(input: {
  targetCents: Cents;
  currentCents: Cents;
  today: DateOnly;
  targetDate?: DateOnly | null;
  contributionCents?: Cents | null;
  plan?: ContributionPlan | null;
}): GoalProgress {
  const remaining = Math.max(0, input.targetCents - input.currentCents);
  const reached = remaining === 0;
  const progressPercent = percentage(Math.max(0, input.currentCents), input.targetCents);
  let required: Cents | null = null;
  let projected: DateOnly | null = reached ? input.today : null;

  if (!reached && input.plan) {
    if (input.targetDate) {
      const dates = countContributionDates(input.plan, input.today, input.targetDate);
      required = dates > 0 ? ceilToCents(new Dec(remaining).dividedBy(dates)) : remaining;
    }
    if (input.contributionCents && input.contributionCents > 0) {
      const needed = Math.ceil(remaining / input.contributionCents);
      if (needed <= 10_000) {
        const seq = nominalSequence(specOf(input.plan), input.today, needed);
        projected = seq.dates.length === needed ? seq.dates[needed - 1]! : null;
      }
    }
  }
  return {
    progressPercent,
    remainingCents: remaining,
    reached,
    requiredContributionCents: required,
    projectedDate: projected,
    onTrack: input.targetDate ? (projected !== null && projected <= input.targetDate) : null,
  };
}

