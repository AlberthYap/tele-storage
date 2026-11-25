const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export type PacedResult<T, R> = {
  succeeded: { item: T; result: R }[];
  failed: { item: T; error: unknown }[];
};

// Runs `worker` over `items` sequentially with a fixed delay between calls, to stay under
// Telegram's per-chat rate limit (~1 msg/sec). Telegram's own 429 retry/backoff (see
// lib/telegram.ts) handles transient flood-wait within a single call; this handles pacing
// across a whole batch and keeps one item's failure from aborting the rest.
export async function runPaced<T, R>(
  items: T[],
  worker: (item: T, index: number) => Promise<R>,
  opts: { delayMs?: number; onProgress?: (done: number, total: number) => void | Promise<void> } = {},
): Promise<PacedResult<T, R>> {
  const delayMs = opts.delayMs ?? 200;
  const succeeded: { item: T; result: R }[] = [];
  const failed: { item: T; error: unknown }[] = [];

  for (let i = 0; i < items.length; i++) {
    if (i > 0) await sleep(delayMs);
    const item = items[i]!;
    try {
      succeeded.push({ item, result: await worker(item, i) });
    } catch (error) {
      failed.push({ item, error });
    }
    await opts.onProgress?.(succeeded.length + failed.length, items.length);
  }

  return { succeeded, failed };
}
