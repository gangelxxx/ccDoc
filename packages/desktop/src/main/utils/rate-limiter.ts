import { sleep } from "./backoff";

export interface RateLimitState {
  requestsRemaining: number;
  requestsReset: number; // timestamp ms
  tokensRemaining: number;
  tokensReset: number; // timestamp ms
}

/**
 * Minimum remaining tokens before we wait for reset.
 * A typical request consumes 5-20K tokens; 5000 is a reasonable buffer.
 */
const MIN_TOKENS_REMAINING = 5000;

export class ApiRateLimiter {
  private lastRequestTime = 0;
  private minIntervalMs: number;
  private state: RateLimitState = {
    requestsRemaining: Infinity,
    requestsReset: 0,
    tokensRemaining: Infinity,
    tokensReset: 0,
  };

  /**
   * @param minIntervalMs Anti-burst minimum interval between requests.
   * Tier 1 Anthropic limit is 50 RPM = 1 req per 1200ms.
   * 500ms doesn't slow normal operation (tool execution between rounds
   * is usually >500ms) but prevents burst when parallel calls happen
   * (sub-agent + compact-messages simultaneously).
   */
  // Promise queue ensures concurrent callers wait in sequence
  private queue: Promise<void> = Promise.resolve();

  constructor(minIntervalMs = 500) {
    this.minIntervalMs = minIntervalMs;
  }

  /** Call BEFORE each API request. Resolves when it's safe to send. */
  waitIfNeeded(): Promise<void> {
    this.queue = this.queue.then(() => this.doWait());
    return this.queue;
  }

  private async doWait(): Promise<void> {
    let now = Date.now();

    // If API reported requests nearly exhausted — wait until reset
    if (this.state.requestsRemaining <= 1 && now < this.state.requestsReset) {
      const waitMs = this.state.requestsReset - now + 200;
      console.log(
        `[rate-limiter] requests nearly exhausted (${this.state.requestsRemaining}), waiting ${waitMs}ms until reset`
      );
      await sleep(waitMs);
      now = Date.now(); // refresh after sleep
    }

    // Same for tokens
    if (
      this.state.tokensRemaining <= MIN_TOKENS_REMAINING &&
      now < this.state.tokensReset
    ) {
      const waitMs = this.state.tokensReset - now + 200;
      console.log(
        `[rate-limiter] tokens nearly exhausted (${this.state.tokensRemaining}), waiting ${waitMs}ms until reset`
      );
      await sleep(waitMs);
    }

    // Anti-burst: minimum interval between requests
    const elapsed = Date.now() - this.lastRequestTime;
    if (elapsed < this.minIntervalMs) {
      await sleep(this.minIntervalMs - elapsed);
    }

    this.lastRequestTime = Date.now();
  }

  /** Call AFTER each API response (both success and error). Parses rate limit headers. */
  updateFromHeaders(headers: Headers): void {
    const reqRemaining = headers.get("anthropic-ratelimit-requests-remaining");
    const reqReset = headers.get("anthropic-ratelimit-requests-reset");
    const tokRemaining = headers.get("anthropic-ratelimit-tokens-remaining");
    const tokReset = headers.get("anthropic-ratelimit-tokens-reset");

    if (reqRemaining != null) {
      const parsed = parseInt(reqRemaining, 10);
      if (!isNaN(parsed)) this.state.requestsRemaining = parsed;
    }
    if (reqReset) {
      // ISO 8601 date (e.g. "2024-03-15T12:30:00Z")
      const ts = new Date(reqReset).getTime();
      if (!isNaN(ts)) this.state.requestsReset = ts;
    }
    if (tokRemaining != null) {
      const parsed = parseInt(tokRemaining, 10);
      if (!isNaN(parsed)) this.state.tokensRemaining = parsed;
    }
    if (tokReset) {
      const ts = new Date(tokReset).getTime();
      if (!isNaN(ts)) this.state.tokensReset = ts;
    }

    // Log only when limits are getting low
    if (
      this.state.requestsRemaining < 10 ||
      this.state.tokensRemaining < 50000
    ) {
      console.log(
        `[rate-limiter] requests: ${this.state.requestsRemaining}, ` +
          `tokens: ${this.state.tokensRemaining}, ` +
          `resets: req=${reqReset}, tok=${tokReset}`
      );
    }
  }

  /**
   * Parse retry-after header from a 429 response.
   * Anthropic sends seconds (number), but we also handle HTTP-date as fallback.
   */
  getRetryAfterMs(headers: Headers): number {
    const retryAfter = headers.get("retry-after");
    if (!retryAfter) return 0;

    const seconds = Number(retryAfter);
    if (!isNaN(seconds)) return Math.ceil(seconds * 1000);

    // Fallback: HTTP-date (e.g. "Wed, 15 Mar 2024 12:30:00 GMT")
    const date = new Date(retryAfter);
    if (!isNaN(date.getTime())) {
      return Math.max(0, date.getTime() - Date.now());
    }

    return 0;
  }
}

/** Singleton — shared across all IPC calls (main agent, sub-agent, etc.) */
export const rateLimiter = new ApiRateLimiter(500);
