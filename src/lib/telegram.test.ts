import { describe, test, expect, beforeEach, afterEach } from "bun:test";

const originalFetch = globalThis.fetch;
const originalBotToken = process.env.BOT_TOKEN;

beforeEach(() => {
  process.env.BOT_TOKEN = "dummy-token";
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  process.env.BOT_TOKEN = originalBotToken;
});

function mockResponses(responses: { status: number; body: unknown }[]) {
  let i = 0;
  globalThis.fetch = (async () => {
    const r = responses[Math.min(i, responses.length - 1)]!;
    i++;
    return new Response(JSON.stringify(r.body), { status: r.status });
  }) as unknown as typeof fetch;
}

describe("lib/telegram call() retry/backoff", () => {
  test("retries on 429 honoring retry_after, then succeeds", async () => {
    mockResponses([
      { status: 429, body: { ok: false, description: "flood", parameters: { retry_after: 0 } } },
      { status: 429, body: { ok: false, description: "flood", parameters: { retry_after: 0 } } },
      { status: 200, body: { ok: true, result: { message_id: 1 } } },
    ]);
    const { sendMessage } = await import("./telegram");
    const res = await sendMessage(123, "hi");
    expect(res).toEqual({ message_id: 1 });
  });

  test("retry_after: 0 is honored, not treated as missing (falsy-check regression)", async () => {
    let attempts = 0;
    globalThis.fetch = (async () => {
      attempts++;
      if (attempts < 2) {
        return new Response(
          JSON.stringify({ ok: false, description: "flood", parameters: { retry_after: 0 } }),
          { status: 429 },
        );
      }
      return new Response(JSON.stringify({ ok: true, result: { message_id: 2 } }), { status: 200 });
    }) as unknown as typeof fetch;

    const { sendMessage } = await import("./telegram");
    const res = await sendMessage(123, "hi");
    expect(res).toEqual({ message_id: 2 });
    expect(attempts).toBe(2);
  });

  test("gives up after MAX_ATTEMPTS and throws with retryAfterSec", async () => {
    let attempts = 0;
    globalThis.fetch = (async () => {
      attempts++;
      return new Response(
        JSON.stringify({ ok: false, description: "flood", parameters: { retry_after: 0 } }),
        { status: 429 },
      );
    }) as unknown as typeof fetch;

    const { sendMessage } = await import("./telegram");
    await expect(sendMessage(123, "hi")).rejects.toThrow();
    expect(attempts).toBe(4); // MAX_ATTEMPTS
  });

  test("non-429 errors are not retried", async () => {
    let attempts = 0;
    globalThis.fetch = (async () => {
      attempts++;
      return new Response(JSON.stringify({ ok: false, description: "bad request" }), { status: 400 });
    }) as unknown as typeof fetch;

    const { sendMessage } = await import("./telegram");
    await expect(sendMessage(123, "hi")).rejects.toThrow(/bad request/);
    expect(attempts).toBe(1);
  });
});
