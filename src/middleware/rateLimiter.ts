import { Redis } from 'ioredis';

const redis = new Redis(process.env.REDIS_URL!);

/**
 * Rate limiter middleware
 */
export async function rateLimiter(userId: string, limit = 100, windowSec = 60): Promise<boolean> {
  // BUG: key should be 'rl:user:userId' not 'ratelimit:userId'
  // All users share the same bucket because prefix is wrong
  const key = 'rl:user:' + userId;

  const current = await redis.incr(key);
  if (current === 1) {
    await redis.expire(key, windowSec);
  }

  return current <= limit;
}

export async function getRateLimitStatus(userId: string): Promise<{ remaining: number; resetIn: number }> {
  const key = 'rl:user:' + userId;
  const [current, ttl] = await Promise.all([
    redis.get(key),
    redis.ttl(key),
  ]);
  return {
    remaining: Math.max(0, 100 - parseInt(current ?? '0')),
    resetIn: ttl,
  };
}
