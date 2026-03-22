import type { BackoffPolicy } from "./backoff";

export type ErrorCategory =
  | "rate_limit"
  | "overloaded"
  | "server_error"
  | "auth"
  | "bad_request"
  | "unknown";

const RATE_LIMIT_PATTERNS = [
  "rate_limit",
  "rate limit",
  "too many requests",
  "quota exceeded",
  "exceeded your current quota",
  "model_cooldown",
  "resource_exhausted",
  "tokens per minute",
  "tokens per day",
  "tpm",
  "acceleration limit",
];

const OVERLOADED_PATTERNS = [
  "overloaded_error",
  "overloaded",
  "high demand",
];

// Real permission errors — do NOT retry
const AUTH_PERMANENT_PATTERNS = [
  "permission",
  "api key",
  "api_key",
  "not have access",
  "invalid x-api-key",
  "invalid api key",
  "authentication",
  "request not allowed",
];

/**
 * Classify an API error by HTTP status and response body text.
 *
 * 403 is treated as rate_limit by default (Cloudflare / acceleration limits)
 * unless the body contains a real permission error pattern.
 */
export function classifyApiError(status: number, body: string): ErrorCategory {
  const lower = body.toLowerCase();

  // 429 — always rate limit
  if (status === 429) return "rate_limit";

  // Rate limit patterns in body (may come with non-standard status)
  if (RATE_LIMIT_PATTERNS.some((p) => lower.includes(p))) return "rate_limit";

  // 403: distinguish real auth vs masked rate limit
  if (status === 403) {
    if (AUTH_PERMANENT_PATTERNS.some((p) => lower.includes(p))) return "auth";
    return "rate_limit"; // Cloudflare blocks without specific auth message → rate limit
  }

  // 529 or 503 + overloaded
  if (status === 529) return "overloaded";
  if (status === 503 && OVERLOADED_PATTERNS.some((p) => lower.includes(p)))
    return "overloaded";

  // Other 5xx
  if (status >= 500) return "server_error";

  // 401 — auth error (expired token, invalid credentials)
  if (status === 401) return "auth";

  // 400
  if (status === 400) return "bad_request";

  return "unknown";
}

export function isRetryable(category: ErrorCategory): boolean {
  return (
    category === "rate_limit" ||
    category === "overloaded" ||
    category === "server_error"
  );
}

export function getRetryPolicy(category: ErrorCategory): BackoffPolicy {
  switch (category) {
    case "rate_limit":
      return { initialMs: 5000, maxMs: 60000, factor: 2, jitter: 0.25 };
    case "overloaded":
      return { initialMs: 3000, maxMs: 30000, factor: 2, jitter: 0.3 };
    case "server_error":
      return { initialMs: 2000, maxMs: 15000, factor: 2, jitter: 0.2 };
    default:
      return { initialMs: 1000, maxMs: 5000, factor: 2, jitter: 0.1 };
  }
}

export function getMaxRetries(category: ErrorCategory): number {
  switch (category) {
    case "rate_limit":
      return 5;
    case "overloaded":
      return 3;
    case "server_error":
      return 3;
    default:
      return 0;
  }
}
