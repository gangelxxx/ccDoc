import { describe, it, expect } from "vitest";
import { computeBackoff } from "../main/utils/backoff";
import {
  classifyApiError,
  isRetryable,
  getRetryPolicy,
  getMaxRetries,
} from "../main/utils/error-classify";
import { ApiRateLimiter } from "../main/utils/rate-limiter";

// ─── computeBackoff ───

describe("computeBackoff", () => {
  const policy = { initialMs: 1000, maxMs: 10000, factor: 2, jitter: 0 };

  it("attempt 1 = initialMs (no jitter)", () => {
    expect(computeBackoff(policy, 1)).toBe(1000);
  });

  it("exponential growth", () => {
    expect(computeBackoff(policy, 2)).toBe(2000);
    expect(computeBackoff(policy, 3)).toBe(4000);
    expect(computeBackoff(policy, 4)).toBe(8000);
  });

  it("caps at maxMs", () => {
    expect(computeBackoff(policy, 5)).toBe(10000); // 16000 → capped
    expect(computeBackoff(policy, 10)).toBe(10000);
  });

  it("jitter adds randomness within bounds", () => {
    const jitterPolicy = { ...policy, jitter: 0.5 };
    for (let i = 0; i < 100; i++) {
      const value = computeBackoff(jitterPolicy, 1);
      expect(value).toBeGreaterThanOrEqual(1000);
      expect(value).toBeLessThanOrEqual(1500); // 1000 + 1000*0.5
    }
  });

  it("attempt 0 treated same as attempt 1", () => {
    expect(computeBackoff(policy, 0)).toBe(1000);
  });
});

// ─── classifyApiError ───

describe("classifyApiError", () => {
  it("429 → rate_limit", () => {
    expect(classifyApiError(429, "anything")).toBe("rate_limit");
  });

  it("403 'Request not allowed' → rate_limit (masked)", () => {
    expect(classifyApiError(403, '{"error":{"message":"Request not allowed"}}')).toBe("rate_limit");
  });

  it("403 with 'permission' → auth (real)", () => {
    expect(classifyApiError(403, '{"error":{"message":"Your API key does not have permission"}}')).toBe("auth");
  });

  it("403 with 'API key' → auth (real)", () => {
    expect(classifyApiError(403, '{"error":{"message":"Invalid API key"}}')).toBe("auth");
  });

  it("403 with empty body → rate_limit (default)", () => {
    expect(classifyApiError(403, "")).toBe("rate_limit");
  });

  it("529 → overloaded", () => {
    expect(classifyApiError(529, "")).toBe("overloaded");
  });

  it("503 + 'overloaded' → overloaded", () => {
    expect(classifyApiError(503, '{"error":"overloaded_error"}')).toBe("overloaded");
  });

  it("503 without overloaded pattern → server_error", () => {
    expect(classifyApiError(503, "Service Unavailable")).toBe("server_error");
  });

  it("500 → server_error", () => {
    expect(classifyApiError(500, "")).toBe("server_error");
  });

  it("502 → server_error", () => {
    expect(classifyApiError(502, "Bad Gateway")).toBe("server_error");
  });

  it("400 → bad_request", () => {
    expect(classifyApiError(400, "")).toBe("bad_request");
  });

  it("rate limit pattern in body with non-standard status → rate_limit", () => {
    expect(classifyApiError(200, "rate_limit_error")).toBe("rate_limit");
    expect(classifyApiError(503, "too many requests")).toBe("rate_limit");
    expect(classifyApiError(500, "quota exceeded")).toBe("rate_limit");
  });

  it("unknown status → unknown", () => {
    expect(classifyApiError(418, "I'm a teapot")).toBe("unknown");
  });
});

// ─── isRetryable ───

describe("isRetryable", () => {
  it("rate_limit, overloaded, server_error → true", () => {
    expect(isRetryable("rate_limit")).toBe(true);
    expect(isRetryable("overloaded")).toBe(true);
    expect(isRetryable("server_error")).toBe(true);
  });

  it("auth, bad_request, unknown → false", () => {
    expect(isRetryable("auth")).toBe(false);
    expect(isRetryable("bad_request")).toBe(false);
    expect(isRetryable("unknown")).toBe(false);
  });
});

// ─── getRetryPolicy ───

describe("getRetryPolicy", () => {
  it("each retryable category returns valid policy", () => {
    for (const cat of ["rate_limit", "overloaded", "server_error"] as const) {
      const policy = getRetryPolicy(cat);
      expect(policy.initialMs).toBeGreaterThan(0);
      expect(policy.maxMs).toBeGreaterThan(policy.initialMs);
      expect(policy.factor).toBeGreaterThanOrEqual(2);
      expect(policy.jitter).toBeGreaterThanOrEqual(0);
      expect(policy.jitter).toBeLessThanOrEqual(1);
    }
  });
});

// ─── getMaxRetries ───

describe("getMaxRetries", () => {
  it("rate_limit has the most retries", () => {
    expect(getMaxRetries("rate_limit")).toBeGreaterThan(getMaxRetries("server_error"));
  });

  it("non-retryable categories return 0", () => {
    expect(getMaxRetries("auth")).toBe(0);
    expect(getMaxRetries("bad_request")).toBe(0);
    expect(getMaxRetries("unknown")).toBe(0);
  });
});

// ─── ApiRateLimiter.getRetryAfterMs ───

describe("ApiRateLimiter.getRetryAfterMs", () => {
  const limiter = new ApiRateLimiter(0);

  it("parses numeric seconds", () => {
    const headers = new Headers({ "retry-after": "30" });
    expect(limiter.getRetryAfterMs(headers)).toBe(30000);
  });

  it("parses fractional seconds", () => {
    const headers = new Headers({ "retry-after": "1.5" });
    expect(limiter.getRetryAfterMs(headers)).toBe(1500);
  });

  it("returns 0 when header is missing", () => {
    const headers = new Headers();
    expect(limiter.getRetryAfterMs(headers)).toBe(0);
  });

  it("handles HTTP-date format", () => {
    const futureDate = new Date(Date.now() + 10000).toUTCString();
    const headers = new Headers({ "retry-after": futureDate });
    const ms = limiter.getRetryAfterMs(headers);
    expect(ms).toBeGreaterThan(5000);
    expect(ms).toBeLessThanOrEqual(11000);
  });

  it("returns 0 for unparseable value", () => {
    const headers = new Headers({ "retry-after": "not-a-date-or-number" });
    expect(limiter.getRetryAfterMs(headers)).toBe(0);
  });
});
