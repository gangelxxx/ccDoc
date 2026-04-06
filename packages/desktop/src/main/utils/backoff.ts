export interface BackoffPolicy {
  initialMs: number;
  maxMs: number;
  factor: number;
  jitter: number; // 0–1
}

/**
 * Exponential backoff with jitter.
 * Formula: base = initialMs × factor^max(attempt-1, 0), jitter = base × policy.jitter × random()
 * Result capped at maxMs.
 * @param attempt 1-indexed
 */
export function computeBackoff(policy: BackoffPolicy, attempt: number): number {
  const base = policy.initialMs * Math.pow(policy.factor, Math.max(attempt - 1, 0));
  const jitterAmount = base * policy.jitter * Math.random();
  return Math.min(policy.maxMs, Math.round(base + jitterAmount));
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) return new Promise((r) => setTimeout(r, ms));
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason); return; }
    const timer = setTimeout(() => { signal.removeEventListener("abort", onAbort); resolve(); }, ms);
    function onAbort() { clearTimeout(timer); reject(signal!.reason); }
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
