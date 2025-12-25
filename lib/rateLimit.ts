type RateLimitState = {
  count: number;
  resetAt: number;
};

type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  resetAt: number;
};

const rateLimitStore = new Map<string, RateLimitState>();

// NOTE: In-memory store for v1. Replace with Redis/shared cache for multi-instance setups.
export const rateLimit = (key: string, limit: number, windowMs: number): RateLimitResult => {
  const now = Date.now();
  const existing = rateLimitStore.get(key);

  if (!existing || now > existing.resetAt) {
    const resetAt = now + windowMs;
    rateLimitStore.set(key, { count: 1, resetAt });
    return { allowed: true, remaining: limit - 1, resetAt };
  }

  if (existing.count >= limit) {
    return { allowed: false, remaining: 0, resetAt: existing.resetAt };
  }

  existing.count += 1;
  rateLimitStore.set(key, existing);
  return { allowed: true, remaining: limit - existing.count, resetAt: existing.resetAt };
};
