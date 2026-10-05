import type { NotificationType } from '@prisma/client';
import type { Deps } from './context.js';
import type { RecurringService } from './recurring.service.js';
import type { BudgetService } from './budget.service.js';
import type { SinkingFundService } from './sinking-fund.service.js';
import type { GoalService } from './goal.service.js';
import { getHousehold } from '../repositories/households.js';
import { notFound, validationError } from '../lib/errors.js';
import { addDays, dateInTimeZone, diffDays } from '../finance/dates.js';
import { formatCentsForText, formatDateForText } from '../lib/text.js';
import { DEFAULT_NOTIFICATION_SETTINGS } from '../seed/defaults.js';

const MILESTONES = [25, 50, 75, 100];

export interface Candidate {
  type: NotificationType;
  subjectId: string;
  periodKey: string;
  title: string;
  body: string;
  link: string;
}

export function createNotificationService(
  deps: Deps,
  services: { recurring: RecurringService; budgets: BudgetService; sinkingFunds: SinkingFundService; goals: GoalService },
) {
  const { db } = deps;

  async function settingsFor(householdId: string) {
    const rows = await db.notificationSetting.findMany({ where: { householdId } });
    // Households created before a type existed get its default.
    return DEFAULT_NOTIFICATION_SETTINGS.map((d) => {
      const r = rows.find((x) => x.type === d.type);
      return { type: d.type, enabled: r?.enabled ?? d.enabled, daysBefore: r ? r.daysBefore : d.daysBefore, emailEnabled: r?.emailEnabled ?? false };
    });
  }

  /** What should be notified right now. Pure reads; storage dedupes by (type, subject, period). */
  async function candidates(householdId: string): Promise<Candidate[]> {
    const h = await getHousehold(db, householdId);
    const today = dateInTimeZone(deps.now(), h.timezone);
    const fmt = { currency: h.currency, locale: h.locale };
    const settings = await settingsFor(householdId);
    const on = (t: NotificationType) => settings.find((s) => s.type === t)!;
    const out: Candidate[] = [];

    // Upcoming bills: unposted occurrences of expense and debt schedules due within N days.
    const bills = on('UPCOMING_BILL');
    if (bills.enabled) {
      const days = bills.daysBefore ?? 3;
      const occ = await services.recurring.occurrences(householdId, { from: today, to: addDays(today, days) });
      for (const o of occ) {
        if ((o.type !== 'EXPENSE' && o.type !== 'DEBT_REPAYMENT') || o.status === 'posted' || o.status === 'skipped' || o.autoPost) continue;
        const inDays = diffDays(o.date, today);
        out.push({
          type: 'UPCOMING_BILL',
          subjectId: `${o.recurringId}|${o.occurrenceDate}`,
          periodKey: o.occurrenceDate,
          title: `${o.name} is due ${inDays === 0 ? 'today' : inDays === 1 ? 'tomorrow' : `in ${inDays} days`}`,
          body: `${o.amountKind === 'ESTIMATE' ? 'About ' : ''}${formatCentsForText(o.amountCents, fmt)} on ${formatDateForText(o.date, h.locale)} from ${o.accountName}.`,
          link: '/bills',
        });
      }
    }

    // Overspending and the start of a new period both come from the active budget.
    const overspending = on('OVERSPENDING');
    const review = on('BUDGET_REVIEW');
    if (overspending.enabled || review.enabled) {
      const budget = await services.budgets.ensureActive(householdId);
      const summary = await services.budgets.summarise(householdId, budget, {});
      if (overspending.enabled) {
        for (const b of summary.buckets) {
          for (const line of b.groups.flatMap((g) => g.lines)) {
            if (line.status !== 'amber' && line.status !== 'red') continue;
            out.push({
              type: 'OVERSPENDING',
              subjectId: line.sinkingFundId ?? line.categoryId,
              // Amber and red are separate alerts, once each per period.
              periodKey: `${summary.period.start}:${line.status}`,
              title: line.status === 'red' ? `${line.name} is over budget` : `${line.name} is at ${line.percentUsed?.toFixed(0)}% of its budget`,
              body:
                line.status === 'red'
                  ? `Spent ${formatCentsForText(line.actualCents, fmt)} of ${formatCentsForText(line.budgetCents, fmt)} — over by ${formatCentsForText(-line.remainingCents, fmt)} this period.`
                  : `Spent ${formatCentsForText(line.actualCents, fmt)} of ${formatCentsForText(line.budgetCents, fmt)}; ${formatCentsForText(line.remainingCents, fmt)} left this period.`,
              link: `/budget?bucket=${b.key}`,
            });
          }
        }
      }
      if (review.enabled) {
        const prev = await services.budgets.summarise(householdId, budget, { date: summary.period.previousStart });
        // A new household with no plan and no spending or income before this period has nothing to review yet.
        const history =
          prev.total.budgetCents !== 0 ||
          (await db.transaction.count({ where: { householdId, type: { in: ['EXPENSE', 'INCOME'] }, date: { lt: new Date(`${summary.period.start}T00:00:00Z`) } }, take: 1 })) > 0;
        if (history) out.push({
          type: 'BUDGET_REVIEW',
          subjectId: budget.id,
          periodKey: summary.period.start,
          title: 'A new budget period has started',
          body: `Last period you spent ${formatCentsForText(prev.total.actualCents, fmt)} of ${formatCentsForText(prev.total.budgetCents, fmt)} planned. Take a minute to check this period’s plan.`,
          link: '/budget',
        });
      }
    }

    // Sinking funds due within N days and not funded (or already due and short).
    const funds = on('SINKING_FUND_DEADLINE');
    if (funds.enabled) {
      const days = funds.daysBefore ?? 14;
      for (const f of await services.sinkingFunds.list(householdId)) {
        if (f.status === 'funded') continue;
        if (diffDays(f.dueDate, today) > days) continue;
        out.push({
          type: 'SINKING_FUND_DEADLINE',
          subjectId: f.id,
          periodKey: f.dueDate,
          title: f.status === 'due_short' ? `${f.name} is due and short by ${formatCentsForText(f.shortfallCents, fmt)}` : `${f.name} is due ${formatDateForText(f.dueDate, h.locale)}`,
          body: `Saved ${formatCentsForText(f.currentCents, fmt)} of ${formatCentsForText(f.targetCents, fmt)}.${f.recommendedContributionCents ? ` Put aside ${formatCentsForText(f.recommendedContributionCents, fmt)} to get there.` : ''}`,
          link: '/sinking-funds',
        });
      }
    }

    // Goal milestones: the highest of 25/50/75/100% reached.
    if (on('GOAL_MILESTONE').enabled) {
      for (const g of await services.goals.list(householdId)) {
        const reached = MILESTONES.filter((m) => (g.progressPercent ?? 0) >= m).at(-1);
        if (!reached) continue;
        out.push({
          type: 'GOAL_MILESTONE',
          subjectId: g.id,
          periodKey: String(reached),
          title: reached === 100 ? `${g.name}: goal reached!` : `${g.name} is ${reached}% of the way there`,
          body: `${formatCentsForText(g.currentCents, fmt)} of ${formatCentsForText(g.targetCents, fmt)}.`,
          link: '/fire-extinguisher',
        });
      }
    }
    return out;
  }

  const serialize = (n: { id: string; type: NotificationType; title: string; body: string; link: string | null; readAt: Date | null; createdAt: Date }) => ({
    id: n.id,
    type: n.type,
    title: n.title,
    body: n.body,
    link: n.link,
    read: n.readAt !== null,
    createdAt: n.createdAt.toISOString(),
  });

  // One generation at a time per household, shared by concurrent requests (several open tabs).
  const inFlight = new Map<string, Promise<void>>();

  return {
    candidates,

    /** Generates for one household when someone looks, so a new bill shows up without waiting for the hourly job. */
    refresh(householdId: string): Promise<void> {
      const running = inFlight.get(householdId);
      if (running) return running;
      const run = this.generate(householdId)
        .then(
          () => undefined,
          (err: unknown) => deps.log.error({ householdId, err: (err as Error).message }, 'notification refresh failed'),
        )
        .finally(() => inFlight.delete(householdId));
      inFlight.set(householdId, run);
      return run;
    },

    /** Stores new notifications for one household and emails those whose type has email on. */
    async generate(householdId: string) {
      const list = await candidates(householdId);
      const settings = await settingsFor(householdId);
      let created = 0;
      let emailed = 0;
      for (const c of list) {
        const res = await db.notification.createMany({
          data: [{ householdId, ...c, createdAt: deps.now() }],
          skipDuplicates: true, // unique (household, type, subject, period): never repeats
        });
        if (res.count === 0) continue;
        created++;
        if (deps.mailer.enabled && settings.find((s) => s.type === c.type)?.emailEnabled) {
          const members = await db.householdMember.findMany({ where: { householdId }, include: { user: { select: { email: true } } } });
          try {
            for (const m of members) {
              await deps.mailer.send({ to: m.user.email, subject: c.title, text: `${c.body}\n\n${deps.config.publicUrl}${c.link}` });
            }
            await db.notification.updateMany({ where: { householdId, type: c.type, subjectId: c.subjectId, periodKey: c.periodKey }, data: { emailedAt: deps.now() } });
            emailed++;
          } catch (err) {
            deps.log.error({ err: (err as Error).message }, 'notification email failed');
          }
        }
      }
      return { created, emailed };
    },

    async generateAll() {
      const households = await db.household.findMany({ select: { id: true } });
      const totals = { created: 0, emailed: 0 };
      for (const h of households) {
        try {
          const r = await this.generate(h.id);
          totals.created += r.created;
          totals.emailed += r.emailed;
        } catch (err) {
          deps.log.error({ householdId: h.id, err: (err as Error).message }, 'notification generation failed');
        }
      }
      return totals;
    },

    async list(householdId: string, opts: { unreadOnly?: boolean; limit?: number }) {
      const where = { householdId, ...(opts.unreadOnly ? { readAt: null } : {}) };
      const [items, unread] = await Promise.all([
        db.notification.findMany({ where, orderBy: { createdAt: 'desc' }, take: opts.limit ?? 50 }),
        db.notification.count({ where: { householdId, readAt: null } }),
      ]);
      return { items: items.map(serialize), unreadCount: unread };
    },

    async markRead(householdId: string, id: string) {
      const r = await db.notification.updateMany({ where: { householdId, id, readAt: null }, data: { readAt: deps.now() } });
      if (r.count === 0 && !(await db.notification.findFirst({ where: { householdId, id } }))) throw notFound('Notification');
    },

    async markAllRead(householdId: string) {
      const r = await db.notification.updateMany({ where: { householdId, readAt: null }, data: { readAt: deps.now() } });
      return { updated: r.count };
    },

    async getSettings(householdId: string) {
      return { emailAvailable: deps.mailer.enabled, items: await settingsFor(householdId) };
    },

    async updateSettings(householdId: string, items: { type: NotificationType; enabled: boolean; daysBefore?: number | null; emailEnabled: boolean }[]) {
      for (const i of items) {
        if (i.daysBefore != null && (i.daysBefore < 0 || i.daysBefore > 60)) throw validationError('Days before must be between 0 and 60', { field: 'daysBefore' });
      }
      await db.$transaction(
        items.map((i) =>
          db.notificationSetting.upsert({
            where: { householdId_type: { householdId, type: i.type } },
            create: { householdId, type: i.type, enabled: i.enabled, daysBefore: i.daysBefore ?? null, emailEnabled: i.emailEnabled },
            update: { enabled: i.enabled, daysBefore: i.daysBefore ?? null, emailEnabled: i.emailEnabled },
          }),
        ),
      );
      return this.getSettings(householdId);
    },
  };
}

export type NotificationService = ReturnType<typeof createNotificationService>;
