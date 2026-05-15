import { describe, expect, it, vi } from "vitest";
import {
  L402ApiError,
  L402AuthError,
  L402NetworkError,
  L402PlanError,
  L402Server,
} from "../src/index.js";

const API_KEY = "test-merchant-key";
const BASE_URL = "https://api.example";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("L402Server constructor", () => {
  it("throws if apiKey is empty", () => {
    expect(() => new L402Server({ apiKey: "" })).toThrow(/apiKey/);
    expect(() => new L402Server({ apiKey: "   " })).toThrow(/apiKey/);
  });

  // Regression: a parent shell can export the literal string "${VAR_NAME}"
  // (from an unrendered settings.json or env file) and the SDK would happily
  // POST that as the X-API-Key header, getting back an opaque 401/403 from
  // the producer API. Catch it at construction with a self-diagnosing error.
  it("throws a self-diagnosing error if apiKey is an unresolved placeholder", () => {
    expect(() => new L402Server({ apiKey: "${LIGHTNING_ENABLE_API_KEY}" })).toThrow(
      /unresolved environment-variable placeholder/,
    );
    expect(() => new L402Server({ apiKey: "${SOME_OTHER_VAR}" })).toThrow(
      /unresolved environment-variable placeholder/,
    );
  });

  it("accepts apiKey that merely contains a dollar sign or braces (not the full ${...} shape)", () => {
    // Make sure we don't false-positive on real keys that happen to contain $ or }.
    expect(() => new L402Server({ apiKey: "abc$def" })).not.toThrow();
    expect(() => new L402Server({ apiKey: "abc{def}" })).not.toThrow();
    expect(() => new L402Server({ apiKey: "${incomplete" })).not.toThrow();
  });

  it("accepts a minimal config", () => {
    const client = new L402Server({ apiKey: API_KEY });
    expect(client).toBeInstanceOf(L402Server);
  });

  it("strips trailing slashes from baseUrl", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        invoice: "lnbc100n1...",
        macaroon: "AgEL...",
        paymentHash: "abc123",
        expiresAt: "2026-05-12T01:00:00Z",
        resource: "/api/x",
        priceSats: 100,
      }),
    );
    const client = new L402Server({
      apiKey: API_KEY,
      baseUrl: `${BASE_URL}///`,
      fetch: fetchImpl,
    });
    await client.createChallenge({ resource: "/api/x", priceSats: 100 });
    const calledUrl = fetchImpl.mock.calls[0][0];
    expect(calledUrl).toBe(`${BASE_URL}/api/l402/challenges`);
  });
});

describe("createChallenge", () => {
  it("posts the expected body and returns the typed challenge", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        invoice: "lnbc100n1...",
        macaroon: "AgELbGlnaHRuaW5n...",
        paymentHash: "abc123def456",
        expiresAt: "2026-05-12T01:00:00Z",
        resource: "/api/weather",
        priceSats: 100,
        mppChallenge: null,
      }),
    );
    const client = new L402Server({
      apiKey: API_KEY,
      baseUrl: BASE_URL,
      fetch: fetchImpl,
    });

    const result = await client.createChallenge({
      resource: "/api/weather",
      priceSats: 100,
      description: "Weather forecast",
    });

    expect(result).toEqual({
      invoice: "lnbc100n1...",
      macaroon: "AgELbGlnaHRuaW5n...",
      paymentHash: "abc123def456",
      expiresAt: "2026-05-12T01:00:00Z",
      resource: "/api/weather",
      priceSats: 100,
      mppChallenge: undefined,
    });

    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(`${BASE_URL}/api/l402/challenges`);
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers["X-API-Key"]).toBe(API_KEY);
    expect(headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body as string)).toEqual({
      resource: "/api/weather",
      priceSats: 100,
      description: "Weather forecast",
    });
  });

  it("includes X-Idempotency-Key when supplied", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        invoice: "lnbc100n1...",
        macaroon: "AgEL...",
        paymentHash: "abc",
        expiresAt: "2026-05-12T01:00:00Z",
        resource: "/r",
        priceSats: 1,
      }),
    );
    const client = new L402Server({
      apiKey: API_KEY,
      baseUrl: BASE_URL,
      fetch: fetchImpl,
    });

    await client.createChallenge({
      resource: "/r",
      priceSats: 1,
      idempotencyKey: "req-abc-123",
    });

    const headers = fetchImpl.mock.calls[0][1].headers as Record<string, string>;
    expect(headers["X-Idempotency-Key"]).toBe("req-abc-123");
  });

  it("rejects empty resource", async () => {
    const client = new L402Server({ apiKey: API_KEY, fetch: vi.fn() });
    await expect(
      client.createChallenge({ resource: "", priceSats: 100 }),
    ).rejects.toThrow(/resource/);
    await expect(
      client.createChallenge({ resource: "   ", priceSats: 100 }),
    ).rejects.toThrow(/resource/);
  });

  it("rejects priceSats less than 1", async () => {
    const client = new L402Server({ apiKey: API_KEY, fetch: vi.fn() });
    await expect(
      client.createChallenge({ resource: "/r", priceSats: 0 }),
    ).rejects.toThrow(/priceSats/);
    await expect(
      client.createChallenge({ resource: "/r", priceSats: -5 }),
    ).rejects.toThrow(/priceSats/);
    await expect(
      client.createChallenge({ resource: "/r", priceSats: NaN }),
    ).rejects.toThrow(/priceSats/);
  });

  it("maps 401 to L402AuthError", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(401, { error: "Bad key" }));
    const client = new L402Server({
      apiKey: API_KEY,
      baseUrl: BASE_URL,
      fetch: fetchImpl,
    });
    await expect(
      client.createChallenge({ resource: "/r", priceSats: 1 }),
    ).rejects.toBeInstanceOf(L402AuthError);
  });

  it("maps 403 to L402PlanError and surfaces current_plan", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(403, {
        error: "L402 not enabled",
        current_plan: "starter",
        action_required: "upgrade_plan",
      }),
    );
    const client = new L402Server({
      apiKey: API_KEY,
      baseUrl: BASE_URL,
      fetch: fetchImpl,
    });
    try {
      await client.createChallenge({ resource: "/r", priceSats: 1 });
      throw new Error("expected to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(L402PlanError);
      expect((err as L402PlanError).currentPlan).toBe("starter");
    }
  });

  it("maps other non-2xx to L402ApiError with statusCode", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(500, { error: "Wallet down" }));
    const client = new L402Server({
      apiKey: API_KEY,
      baseUrl: BASE_URL,
      fetch: fetchImpl,
    });
    try {
      await client.createChallenge({ resource: "/r", priceSats: 1 });
      throw new Error("expected to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(L402ApiError);
      expect((err as L402ApiError).statusCode).toBe(500);
    }
  });

  it("wraps fetch failures in L402NetworkError", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const client = new L402Server({
      apiKey: API_KEY,
      baseUrl: BASE_URL,
      fetch: fetchImpl,
    });
    await expect(
      client.createChallenge({ resource: "/r", priceSats: 1 }),
    ).rejects.toBeInstanceOf(L402NetworkError);
  });

  it("wraps timeouts in L402NetworkError", async () => {
    const fetchImpl = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        });
      });
    });
    const client = new L402Server({
      apiKey: API_KEY,
      baseUrl: BASE_URL,
      timeoutMs: 10,
      fetch: fetchImpl,
    });
    await expect(
      client.createChallenge({ resource: "/r", priceSats: 1 }),
    ).rejects.toBeInstanceOf(L402NetworkError);
  });
});

describe("verifyToken", () => {
  it("returns the typed result for a valid token", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        valid: true,
        resource: "/api/weather",
        merchantId: 42,
        amountSats: 100,
        paymentHash: "abc123",
        error: null,
      }),
    );
    const client = new L402Server({
      apiKey: API_KEY,
      baseUrl: BASE_URL,
      fetch: fetchImpl,
    });

    const result = await client.verifyToken({
      macaroon: "AgEL...",
      preimage: "deadbeef".repeat(8),
    });

    expect(result).toEqual({
      valid: true,
      error: undefined,
      resource: "/api/weather",
      merchantId: 42,
      amountSats: 100,
      paymentHash: "abc123",
    });

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(`${BASE_URL}/api/l402/challenges/verify`);
    expect(JSON.parse(init.body as string)).toEqual({
      macaroon: "AgEL...",
      preimage: "deadbeef".repeat(8),
    });
  });

  it("returns valid=false with error for an invalid token (200 response)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        valid: false,
        error: "Invalid preimage",
      }),
    );
    const client = new L402Server({
      apiKey: API_KEY,
      baseUrl: BASE_URL,
      fetch: fetchImpl,
    });

    const result = await client.verifyToken({
      macaroon: "AgEL...",
      preimage: "bad",
    });

    expect(result.valid).toBe(false);
    expect(result.error).toBe("Invalid preimage");
    expect(result.resource).toBeUndefined();
  });

  it("accepts preimage-only (MPP) verification with no macaroon", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, { valid: true, paymentHash: "abc" }),
    );
    const client = new L402Server({
      apiKey: API_KEY,
      baseUrl: BASE_URL,
      fetch: fetchImpl,
    });

    await client.verifyToken({ preimage: "deadbeef".repeat(8) });

    const body = JSON.parse(fetchImpl.mock.calls[0][1].body as string);
    expect(body.macaroon).toBeUndefined();
    expect(body.preimage).toBe("deadbeef".repeat(8));
  });

  it("rejects empty preimage", async () => {
    const client = new L402Server({ apiKey: API_KEY, fetch: vi.fn() });
    await expect(
      client.verifyToken({ macaroon: "AgEL...", preimage: "" }),
    ).rejects.toThrow(/preimage/);
  });

  it("maps 401 to L402AuthError on verify too", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(401, { error: "Bad key" }));
    const client = new L402Server({
      apiKey: API_KEY,
      baseUrl: BASE_URL,
      fetch: fetchImpl,
    });
    await expect(
      client.verifyToken({ macaroon: "x", preimage: "y" }),
    ).rejects.toBeInstanceOf(L402AuthError);
  });
});
