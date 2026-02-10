import type express from "express";

type Bucket = { count: number; resetAt: number };

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  retryAfterSec: number;
};

export class FixedWindowRateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    private readonly windowMs: number,
    public readonly maxRequests: number
  ) {}

  consume(key: string, now = Date.now()): RateLimitResult {
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

function getClientIp(req: express.Request) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }
  return req.ip || req.socket.remoteAddress || "unknown";
}

export function createRateLimitMiddleware(limiter: FixedWindowRateLimiter) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    limiter.cleanup();
    const key = getClientIp(req);
    const result = limiter.consume(key);

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
  };
}
