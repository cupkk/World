import assert from "node:assert/strict";
import test from "node:test";
import { FixedWindowRateLimiter } from "./rateLimit";

test("FixedWindowRateLimiter blocks after max requests", () => {
  const limiter = new FixedWindowRateLimiter(1000, 2);
  const now = 10_000;

  const r1 = limiter.consume("ip-1", now);
  const r2 = limiter.consume("ip-1", now + 1);
  const r3 = limiter.consume("ip-1", now + 2);

  assert.equal(r1.allowed, true);
  assert.equal(r2.allowed, true);
  assert.equal(r3.allowed, false);
  assert.equal(r3.remaining, 0);
  assert.ok(r3.retryAfterSec >= 1);
});

test("FixedWindowRateLimiter resets after window", () => {
  const limiter = new FixedWindowRateLimiter(1000, 1);
  const now = 20_000;

  limiter.consume("ip-2", now);
  const blocked = limiter.consume("ip-2", now + 10);
  const allowedAfterWindow = limiter.consume("ip-2", now + 1_100);

  assert.equal(blocked.allowed, false);
  assert.equal(allowedAfterWindow.allowed, true);
});
