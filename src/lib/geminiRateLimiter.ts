// Gemini's free tier has a low requests-per-minute ceiling. Our app fires
// multiple photos in parallel batches (BATCH_SIZE in Index.tsx), and each
// photo makes TWO Gemini calls (enhancement + metadata) — so a batch of 3
// photos can fire 6 simultaneous Gemini requests, blowing straight through
// the RPM limit on the very first batch. This module serializes ALL Gemini
// calls app-wide through a single queue with a minimum gap between them,
// regardless of how many photos are being processed in parallel elsewhere.

const MIN_GAP_MS = 4500; // ~13 requests/minute ceiling, safely under typical free-tier RPM limits
let queue: Promise<void> = Promise.resolve();
let lastCallAt = 0;

export function runGeminiThrottled<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const now = Date.now();
    const wait = Math.max(0, lastCallAt + MIN_GAP_MS - now);
    if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
    lastCallAt = Date.now();
  });
  queue = run.catch(() => {}); // keep the chain alive even if fn() below throws
  return run.then(fn);
}
