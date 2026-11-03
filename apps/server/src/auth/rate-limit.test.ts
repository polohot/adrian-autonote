import { describe, expect, it } from "vitest";
import { RateLimiter } from "./rate-limit.ts";

describe("RateLimiter", () => {
  it("allows up to the limit, then blocks with the time left", () => {
    const limiter = new RateLimiter(3, 60_000);
    expect(limiter.hit("a", 0).allowed).toBe(true);
    expect(limiter.hit("a", 1_000).allowed).toBe(true);
    expect(limiter.hit("a", 2_000).allowed).toBe(true);
    expect(limiter.hit("a", 10_000)).toEqual({ allowed: false, retryAfterMs: 50_000 });
  });

  it("starts a new window after the old one ends", () => {
    const limiter = new RateLimiter(1, 60_000);
    limiter.hit("a", 0);
    expect(limiter.hit("a", 59_999).allowed).toBe(false);
    expect(limiter.hit("a", 60_000).allowed).toBe(true);
  });

  it("counts each key separately", () => {
    const limiter = new RateLimiter(1, 60_000);
    limiter.hit("a", 0);
    expect(limiter.hit("b", 0).allowed).toBe(true);
  });
});
