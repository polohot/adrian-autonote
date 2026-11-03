export type RateLimitResult = { allowed: true } | { allowed: false; retryAfterMs: number };

/** Fixed-window limiter kept in memory; restarts reset it, which is fine for login attempts. */
export class RateLimiter {
  private readonly windows = new Map<string, { start: number; count: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  hit(key: string, now = Date.now()): RateLimitResult {
    if (this.windows.size > 10_000) this.prune(now);
    const window = this.windows.get(key);
    if (!window || now - window.start >= this.windowMs) {
      this.windows.set(key, { start: now, count: 1 });
      return { allowed: true };
    }
    if (window.count >= this.limit) {
      return { allowed: false, retryAfterMs: window.start + this.windowMs - now };
    }
    window.count++;
    return { allowed: true };
  }

  private prune(now: number): void {
    for (const [key, window] of this.windows) {
      if (now - window.start >= this.windowMs) this.windows.delete(key);
    }
  }
}
