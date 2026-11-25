import { describe, test, expect } from "bun:test";
import { runPaced } from "./paced";

describe("runPaced", () => {
  test("paces calls with the given delay", async () => {
    const start = Date.now();
    await runPaced([1, 2, 3], async (n) => n, { delayMs: 50 });
    const elapsed = Date.now() - start;
    // 3 items = 2 gaps of 50ms; allow slack for scheduling jitter
    expect(elapsed).toBeGreaterThanOrEqual(90);
  });

  test("isolates a failing item instead of aborting the batch", async () => {
    const { succeeded, failed } = await runPaced(
      [1, 2, 3, 4],
      async (n) => {
        if (n === 2) throw new Error("boom");
        return n * 10;
      },
      { delayMs: 1 },
    );

    expect(succeeded.map((s) => s.result)).toEqual([10, 30, 40]);
    expect(failed).toHaveLength(1);
    expect(failed[0]!.item).toBe(2);
    expect((failed[0]!.error as Error).message).toBe("boom");
  });

  test("reports progress after every item, success or failure", async () => {
    const progress: string[] = [];
    await runPaced(
      ["a", "b", "c"],
      async (item) => {
        if (item === "b") throw new Error("fail b");
        return item;
      },
      {
        delayMs: 1,
        onProgress: (done, total) => {
          progress.push(`${done}/${total}`);
        },
      },
    );
    expect(progress).toEqual(["1/3", "2/3", "3/3"]);
  });

  test("returns empty results for an empty input without delay", async () => {
    const start = Date.now();
    const { succeeded, failed } = await runPaced([], async () => "x", { delayMs: 1000 });
    expect(succeeded).toEqual([]);
    expect(failed).toEqual([]);
    expect(Date.now() - start).toBeLessThan(100);
  });
});
