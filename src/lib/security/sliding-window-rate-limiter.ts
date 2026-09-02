export type SlidingWindowRateLimiterOptions = {
  windowMs: number;
  maxEvents: number;
};

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
};

export class SlidingWindowRateLimiter {
  private readonly events = new Map<string, number[]>();

  constructor(private readonly options: SlidingWindowRateLimiterOptions) {
    if (!Number.isFinite(options.windowMs) || options.windowMs <= 0) {
      throw new Error("windowMs must be greater than 0");
    }
    if (!Number.isInteger(options.maxEvents) || options.maxEvents <= 0) {
      throw new Error("maxEvents must be a positive integer");
    }
  }

  consume(key: string, now = Date.now()): RateLimitResult {
    const cutoff = now - this.options.windowMs;
    const recent = (this.events.get(key) ?? []).filter((timestamp) => timestamp > cutoff);

    if (recent.length >= this.options.maxEvents) {
      this.events.set(key, recent);
      const oldest = recent[0] ?? now;
      return {
        allowed: false,
        remaining: 0,
        retryAfterMs: Math.max(1, oldest + this.options.windowMs - now),
      };
    }

    recent.push(now);
    this.events.set(key, recent);
    return {
      allowed: true,
      remaining: Math.max(0, this.options.maxEvents - recent.length),
      retryAfterMs: 0,
    };
  }

  clear(key?: string) {
    if (key) this.events.delete(key);
    else this.events.clear();
  }

  prune(now = Date.now()) {
    const cutoff = now - this.options.windowMs;
    for (const [key, timestamps] of this.events) {
      const recent = timestamps.filter((timestamp) => timestamp > cutoff);
      if (recent.length === 0) this.events.delete(key);
      else this.events.set(key, recent);
    }
  }
}
