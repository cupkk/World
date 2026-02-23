import type express from "express";
import Redis from "ioredis";

type Bucket = { count: number; resetAt: number };

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  retryAfterSec: number;
};

export interface RateLimiter {
  maxRequests: number;
  consume(key: string, now?: number): Promise<RateLimitResult>;
  cleanup?(now?: number): void;
}

export class FixedWindowRateLimiter implements RateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    private readonly windowMs: number,
    public readonly maxRequests: number
  ) {}

  async consume(key: string, now = Date.now()): Promise<RateLimitResult> {
    const existing = this.buckets.get(key);
    let bucket = existing;
    if (!bucket || now >= bucket.resetAt) {
      bucket = { count: 0, resetAt: now + this.windowMs };
    }

    if (bucket.count >= this.maxRequests) {
      this.buckets.set(key, bucket);
      const retryAfterSec = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      return {
        allowed: false,
        remaining: 0,
        resetAt: bucket.resetAt,
        retryAfterSec
      };
    }

    bucket.count += 1;
    this.buckets.set(key, bucket);
    return {
      allowed: true,
      remaining: Math.max(0, this.maxRequests - bucket.count),
      resetAt: bucket.resetAt,
      retryAfterSec: 0
    };
  }

  cleanup(now = Date.now()) {
    for (const [key, bucket] of this.buckets.entries()) {
      if (now >= bucket.resetAt) {
        this.buckets.delete(key);
      }
    }
  }
}

export class RedisRateLimiter implements RateLimiter {
  private redis: Redis;

  constructor(
    redisUrl: string,
    private readonly windowMs: number,
    public readonly maxRequests: number
  ) {
    this.redis = new Redis(redisUrl);
  }

  async consume(key: string, now = Date.now()): Promise<RateLimitResult> {
    const redisKey = `ratelimit:${key}`;
    const multi = this.redis.multi();
    multi.incr(redisKey);
    multi.pttl(redisKey);
    
    try {
      const results = await multi.exec();
      if (!results || results.length !== 2) {
        throw new Error("Redis transaction failed");
      }

      const [incrErr, countRaw] = results[0];
      const [ttlErr, ttlRaw] = results[1];

      if (incrErr) throw incrErr;
      if (ttlErr) throw ttlErr;

      const count = Number(countRaw);
      let ttl = Number(ttlRaw);

      if (count === 1 || ttl < 0) {
        await this.redis.pexpire(redisKey, this.windowMs);
        ttl = this.windowMs;
      }

      const resetAt = now + ttl;

      if (count > this.maxRequests) {
        const retryAfterSec = Math.max(1, Math.ceil(ttl / 1000));
        return {
          allowed: false,
          remaining: 0,
          resetAt,
          retryAfterSec
        };
      }

      return {
        allowed: true,
        remaining: Math.max(0, this.maxRequests - count),
        resetAt,
        retryAfterSec: 0
      };
    } catch (err) {
      // Fallback on Redis error to avoid blocking valid traffic unexpectedly
      return {
        allowed: true,
        remaining: this.maxRequests,
        resetAt: now + this.windowMs,
        retryAfterSec: 0
      };
    }
  }
}

function getClientIp(req: express.Request) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }
  return req.ip || req.socket.remoteAddress || "unknown";
}

export function createRateLimitMiddleware(limiter: RateLimiter) {
  return async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    try {
      if (limiter.cleanup) {
        limiter.cleanup();
      }
      
      const key = getClientIp(req);
      const result = await limiter.consume(key);

      res.setHeader("X-RateLimit-Limit", String(limiter.maxRequests));
      res.setHeader("X-RateLimit-Remaining", String(result.remaining));
      res.setHeader("X-RateLimit-Reset", String(Math.floor(result.resetAt / 1000)));

      if (!result.allowed) {
        const requestIdHeader = res.getHeader("x-request-id");
        const requestId = typeof requestIdHeader === "string" ? requestIdHeader : "unknown";
        res.setHeader("Retry-After", String(result.retryAfterSec));
        res.status(429).json({
          error: {
            code: "RATE_LIMITED",
            message: "Too many requests. Please try again later.",
            request_id: requestId
          }
        });
        return;
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}
