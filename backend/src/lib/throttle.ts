/**
 * In-memory attempt limiter with exponential backoff, keyed by e.g. email.
 * Complements the per-IP route limits: an attacker rotating IPs still hits
 * the per-email limit, and repeated failures lock the key out for longer.
 */
export class AttemptThrottle {
  private readonly entries = new Map<string, { windowStart: number; count: number; failures: number; blockedUntil: number }>();

  constructor(
    private readonly maxPerWindow: number,
    private readonly windowMs = 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  /** Records an attempt. Returns seconds to wait if the attempt is not allowed. */
  hit(key: string): number | null {
    const t = this.now();
    const e = this.entries.get(key) ?? { windowStart: t, count: 0, failures: 0, blockedUntil: 0 };
    if (e.blockedUntil > t) return Math.ceil((e.blockedUntil - t) / 1000);
    if (t - e.windowStart >= this.windowMs) {
      e.windowStart = t;
      e.count = 0;
    }
    e.count += 1;
    this.entries.set(key, e);
    if (e.count > this.maxPerWindow) return Math.ceil((e.windowStart + this.windowMs - t) / 1000);
    return null;
  }

  /** After 3 consecutive failures, block for 2, 4, 8 … seconds, capped at 15 minutes. */
  fail(key: string): void {
    const t = this.now();
    const e = this.entries.get(key) ?? { windowStart: t, count: 0, failures: 0, blockedUntil: 0 };
    e.failures += 1;
    if (e.failures >= 3) e.blockedUntil = t + Math.min(2 ** (e.failures - 2) * 1000, 15 * 60_000);
    this.entries.set(key, e);
  }

  succeed(key: string): void {
    this.entries.delete(key);
  }

  /** Drops stale entries; called by the session cleanup job. */
  prune(): void {
    const t = this.now();
    for (const [k, e] of this.entries) {
      if (e.blockedUntil < t && t - e.windowStart > this.windowMs) this.entries.delete(k);
    }
  }
}
