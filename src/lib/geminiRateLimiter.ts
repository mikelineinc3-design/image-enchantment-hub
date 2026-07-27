// Gemini's free tier has a low requests-per-minute ceiling PER KEY/PROJECT.
// Our app fires multiple photos in parallel batches (BATCH_SIZE in Index.tsx).
// This module gives each Gemini API KEY its own independent throttle "lane" —
// so if you configure 3 Gemini keys, up to 3 requests can be in flight at
// once (one per key), each key individually staying under its own RPM limit,
// instead of everything queueing behind a single global limiter.

const MIN_GAP_MS = 4500; // ~13 requests/minute ceiling per key, safely under typical free-tier RPM limits
const lanes = new Map<string, Promise<void>>();
const lastCallAt = new Map<string, number>();

/**
 * Run fn() throttled per-key. Calls using DIFFERENT keys run independently
 * (in parallel, each respecting its own pacing). Calls using the SAME key
 * are serialized with a minimum gap between them.
 */
export function runGeminiThrottled<T>(fn: () => Promise<T>, laneKey = 'default'): Promise<T> {
  const prevInLane = lanes.get(laneKey) || Promise.resolve();
  const run = prevInLane.then(async () => {
    const now = Date.now();
    const last = lastCallAt.get(laneKey) || 0;
    const wait = Math.max(0, last + MIN_GAP_MS - now);
    if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
    lastCallAt.set(laneKey, Date.now());
  });
  lanes.set(laneKey, run.catch(() => {})); // keep the lane's chain alive even if fn() below throws
  return run.then(fn);
}

/**
 * Pick a Gemini key order for this call using round-robin across all
 * configured keys, so consecutive photos spread across different keys/lanes
 * instead of all defaulting to key[0] and only moving on when it fails.
 */
let rrCounter = 0;
export function pickGeminiKeyRoundRobin(keys: string[]): string[] {
  if (keys.length <= 1) return keys;
  const start = rrCounter % keys.length;
  rrCounter++;
  return [...keys.slice(start), ...keys.slice(0, start)];
}
