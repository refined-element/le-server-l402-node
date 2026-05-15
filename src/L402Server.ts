import {
  L402ApiError,
  L402AuthError,
  L402NetworkError,
  L402PlanError,
} from "./errors.js";
import type {
  Challenge,
  CreateChallengeArgs,
  L402ServerOptions,
  VerificationResult,
  VerifyTokenArgs,
} from "./types.js";

const DEFAULT_BASE_URL = "https://api.lightningenable.com";
const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Server-side client for Lightning Enable's L402 producer API. Wraps two
 * endpoints:
 *
 * - {@link createChallenge} → `POST /api/l402/challenges` — mint a
 *   Lightning invoice + macaroon for a given resource and price.
 * - {@link verifyToken} → `POST /api/l402/challenges/verify` — validate
 *   an incoming L402 token (macaroon + preimage).
 *
 * **No protocol logic lives in this SDK.** The Lightning Enable backend
 * signs macaroons, mints invoices, verifies preimages, and tracks consumed
 * tokens for replay protection. The SDK is purely an HTTP client with
 * typed inputs/outputs.
 *
 * @example
 * ```ts
 * import { L402Server } from "l402-server";
 *
 * const l402 = new L402Server({
 *   apiKey: process.env.LIGHTNING_ENABLE_API_KEY!,
 * });
 *
 * // On an unauthenticated incoming request:
 * const challenge = await l402.createChallenge({
 *   resource: "/api/premium/weather",
 *   priceSats: 100,
 *   description: "Premium weather forecast",
 * });
 *
 * // Send back as 402 Payment Required with the challenge headers.
 *
 * // When client comes back with Authorization: L402 mac:preimage,
 * // parse and verify:
 * const verification = await l402.verifyToken({
 *   macaroon: parsedMacaroon,
 *   preimage: parsedPreimage,
 * });
 * if (verification.valid) {
 *   // Serve the response.
 * }
 * ```
 */
export class L402Server {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: L402ServerOptions) {
    if (!options.apiKey || options.apiKey.trim().length === 0) {
      throw new Error(
        "L402Server: `apiKey` is required. Get one from your Lightning Enable dashboard.",
      );
    }
    if (/^\$\{[^}]+\}$/.test(options.apiKey.trim())) {
      throw new Error(
        `L402Server: \`apiKey\` looks like an unresolved environment-variable placeholder (${options.apiKey.trim()}). ` +
          `This usually means a parent shell exported the literal string \"\${VAR_NAME}\" instead of the substituted value. ` +
          `Common sources: settings.json/launch.json with unrendered \${env:NAME}, a Dockerfile ENV line, or a chained .env loader. ` +
          `Fix by setting LIGHTNING_ENABLE_API_KEY directly to the real key, or by clearing the placeholder so the SDK reads the right value.`,
      );
    }

    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = options.fetch ?? fetch;
  }

  /**
   * Mint an L402 challenge — a Lightning invoice plus a macaroon scoped to
   * the given resource. Present this to the requesting client/agent in a
   * `402 Payment Required` response. Once they pay the invoice and obtain
   * the preimage, they will retry the request with
   * `Authorization: L402 <macaroon>:<preimage>`.
   *
   * @param args - resource path, price in sats, optional description and idempotency key.
   * @returns The {@link Challenge} containing the invoice, macaroon, and metadata.
   * @throws {@link L402AuthError} on 401 (invalid API key).
   * @throws {@link L402PlanError} on 403 (L402 not enabled on merchant's plan).
   * @throws {@link L402ApiError} on other non-2xx responses.
   * @throws {@link L402NetworkError} on timeout or transport failure.
   */
  async createChallenge(args: CreateChallengeArgs): Promise<Challenge> {
    if (!args.resource || args.resource.trim().length === 0) {
      throw new Error("createChallenge: `resource` is required.");
    }
    if (!Number.isFinite(args.priceSats) || args.priceSats < 1) {
      throw new Error("createChallenge: `priceSats` must be an integer ≥ 1.");
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-API-Key": this.apiKey,
      Accept: "application/json",
    };
    if (args.idempotencyKey) {
      headers["X-Idempotency-Key"] = args.idempotencyKey;
    }

    const body = JSON.stringify({
      resource: args.resource,
      priceSats: args.priceSats,
      description: args.description,
    });

    const response = await this.request(
      "/api/l402/challenges",
      "POST",
      headers,
      body,
    );

    if (response.status === 200) {
      const data = (await response.json()) as {
        invoice: string;
        macaroon: string;
        paymentHash: string;
        expiresAt: string;
        resource: string;
        priceSats: number;
        mppChallenge?: string | null;
      };
      return {
        invoice: data.invoice,
        macaroon: data.macaroon,
        paymentHash: data.paymentHash,
        expiresAt: data.expiresAt,
        resource: data.resource,
        priceSats: data.priceSats,
        mppChallenge: data.mppChallenge ?? undefined,
      };
    }

    await this.throwForStatus(response);
    // Unreachable — throwForStatus always throws on non-2xx.
    throw new L402ApiError(
      response.status,
      "Unexpected response from L402 producer API.",
    );
  }

  /**
   * Verify an L402 token. Returns a {@link VerificationResult} indicating
   * whether the token is valid plus metadata extracted from the macaroon
   * (resource, merchant ID, amount).
   *
   * The producer API returns `200 OK` for both valid and invalid tokens;
   * inspect `result.valid` rather than relying on HTTP status. Non-200
   * responses indicate a higher-level problem (auth, plan, transport).
   *
   * @param args - macaroon (required for L402; omit only for MPP) + preimage.
   * @returns The {@link VerificationResult}.
   * @throws {@link L402AuthError} on 401 (invalid API key).
   * @throws {@link L402PlanError} on 403 (L402 not enabled on merchant's plan).
   * @throws {@link L402ApiError} on other non-2xx responses.
   * @throws {@link L402NetworkError} on timeout or transport failure.
   */
  async verifyToken(args: VerifyTokenArgs): Promise<VerificationResult> {
    if (!args.preimage || args.preimage.trim().length === 0) {
      throw new Error("verifyToken: `preimage` is required.");
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-API-Key": this.apiKey,
      Accept: "application/json",
    };

    const body = JSON.stringify({
      macaroon: args.macaroon,
      preimage: args.preimage,
    });

    const response = await this.request(
      "/api/l402/challenges/verify",
      "POST",
      headers,
      body,
    );

    if (response.status === 200) {
      const data = (await response.json()) as {
        valid: boolean;
        resource?: string | null;
        merchantId?: number | null;
        amountSats?: number | null;
        paymentHash?: string | null;
        error?: string | null;
      };
      return {
        valid: data.valid,
        error: data.error ?? undefined,
        resource: data.resource ?? undefined,
        merchantId: data.merchantId ?? undefined,
        amountSats: data.amountSats ?? undefined,
        paymentHash: data.paymentHash ?? undefined,
      };
    }

    await this.throwForStatus(response);
    throw new L402ApiError(
      response.status,
      "Unexpected response from L402 producer API.",
    );
  }

  private async request(
    path: string,
    method: string,
    headers: Record<string, string>,
    body: string,
  ): Promise<Response> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      return await this.fetchImpl(url, {
        method,
        headers,
        body,
        signal: controller.signal,
      });
    } catch (err) {
      if ((err as { name?: string })?.name === "AbortError") {
        throw new L402NetworkError(
          `Request to ${url} timed out after ${this.timeoutMs}ms`,
          err,
        );
      }
      throw new L402NetworkError(
        `Network error talking to ${url}: ${(err as Error).message}`,
        err,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  private async throwForStatus(response: Response): Promise<never> {
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      try {
        body = await response.text();
      } catch {
        body = undefined;
      }
    }

    const errorMessage =
      (body as { error?: string; message?: string })?.error ??
      (body as { error?: string; message?: string })?.message ??
      `HTTP ${response.status} from ${response.url}`;

    if (response.status === 401) {
      throw new L402AuthError(errorMessage);
    }
    if (response.status === 403) {
      const currentPlan = (body as { current_plan?: string })?.current_plan;
      throw new L402PlanError(errorMessage, currentPlan);
    }
    throw new L402ApiError(response.status, errorMessage, body);
  }
}
