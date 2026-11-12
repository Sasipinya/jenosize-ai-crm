// Tiny in-memory fixed-window rate limiter. Per serverless instance only: good enough for the
// public intake at this scale (ADR 007); a shared store would be needed for strict limits.
const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    if (buckets.size > 5_000) buckets.clear(); // bound memory
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  b.count += 1;
  return b.count <= limit;
}

export function resetRateLimits() {
  buckets.clear();
}
