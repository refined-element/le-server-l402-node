/**
 * Public types for the L402 server SDK. Mirrors the wire contract of
 * Lightning Enable's hosted producer API at
 * https://api.lightningenable.com/api/l402/challenges.
 */

/**
 * Configuration for the {@link L402Server} client.
 */
export interface L402ServerOptions {
  /**
   * Your Lightning Enable merchant API key. Required.
   *
   * Generate one at https://api.lightningenable.com/dashboard/settings.
   * Tied to a specific merchant + an Agentic Commerce plan (L402 must be
   * enabled on the plan).
   */
  apiKey: string;

  /**
   * Base URL for the producer API. Defaults to the hosted Lightning Enable
   * instance. Override for testing against a local dev instance.
   *
   * @default "https://api.lightningenable.com"
   */
  baseUrl?: string;

  /**
   * Per-request timeout in milliseconds. Defaults to 10s.
   *
   * @default 10000
   */
  timeoutMs?: number;

  /**
   * Custom fetch implementation. Defaults to the global `fetch`. Inject a
   * mock here for tests, or a fetch-with-retry wrapper if you want
   * application-level retry policy on top of the SDK's per-call timeout.
   */
  fetch?: typeof fetch;
}

/**
 * Arguments for {@link L402Server.createChallenge}.
 */
export interface CreateChallengeArgs {
  /**
   * The resource the challenge is for, typically the request path. Bound as
   * a caveat in the macaroon so the resulting token can only access this
   * exact resource. Example: "/api/weather/forecast".
   */
  resource: string;

  /**
   * Price in satoshis. Must be ≥ 1.
   */
  priceSats: number;

  /**
   * Optional description embedded in the Lightning invoice. Visible to the
   * payer in their wallet UI.
   */
  description?: string;

  /**
   * Optional idempotency key. If the same key is sent twice within the
   * invoice's expiry window, the same challenge is returned (no duplicate
   * invoice). Useful for retry-safe issue from a middleware. Truncated to
   * 256 chars server-side.
   *
   * Defaults to none — the server falls back to client IP for
   * deduplication, which is usually correct for middleware use.
   */
  idempotencyKey?: string;
}

/**
 * The 402 challenge returned from {@link L402Server.createChallenge}.
 * Present this to the calling client/agent; they must pay the Lightning
 * invoice to obtain the preimage required for L402 authentication.
 */
export interface Challenge {
  /**
   * BOLT11 Lightning invoice the client must pay.
   */
  invoice: string;

  /**
   * Base64-encoded macaroon containing the payment hash and caveats
   * (resource, merchant_id, amount_sats). Sent as part of the
   * `WWW-Authenticate` header on the 402 response.
   */
  macaroon: string;

  /**
   * Payment hash (hex) — links the macaroon to the invoice. Useful for
   * matching incoming payment-confirmation webhooks or for debugging.
   */
  paymentHash: string;

  /**
   * When the Lightning invoice expires (ISO 8601). After this time the
   * invoice can no longer be paid and a fresh challenge must be issued.
   */
  expiresAt: string;

  /**
   * The resource the challenge is bound to. Echoed back from the request
   * so middleware can build the 402 response header without re-tracking
   * the original argument.
   */
  resource: string;

  /**
   * Price in satoshis. Echoed from the request.
   */
  priceSats: number;

  /**
   * MPP-formatted `WWW-Authenticate` challenge header value. Only present
   * if the server has MPP support enabled. Clients that speak MPP can
   * consume this directly without needing to know about macaroons.
   */
  mppChallenge?: string;
}

/**
 * Arguments for {@link L402Server.verifyToken}.
 */
export interface VerifyTokenArgs {
  /**
   * Base64-encoded macaroon from the L402 credential
   * (`Authorization: L402 <macaroon>:<preimage>`).
   *
   * Omit only if verifying an MPP-style preimage-only token — and only if
   * your Lightning Enable instance has MPP enabled. Defaults to required.
   */
  macaroon?: string;

  /**
   * Hex-encoded payment preimage (64 chars).
   */
  preimage: string;
}

/**
 * Result from {@link L402Server.verifyToken}. The producer API returns
 * `200 OK` for both valid and invalid tokens — `valid` is the gate.
 */
export interface VerificationResult {
  /**
   * Whether the token is valid. When `false`, `error` is populated.
   */
  valid: boolean;

  /**
   * Human-readable failure reason. Only populated when `valid === false`.
   * Examples: "Invalid preimage", "Token bound to a different resource",
   * "Macaroon signature invalid".
   */
  error?: string;

  /**
   * The resource the token was bound to (from the macaroon's path caveat).
   * Only populated when `valid === true`. Use this to assert the token
   * matches the resource the caller is actually requesting.
   */
  resource?: string;

  /**
   * Merchant ID the token was bound to. Only populated when valid.
   */
  merchantId?: number;

  /**
   * Amount the token was issued for, in satoshis. Only populated when
   * valid.
   */
  amountSats?: number;

  /**
   * Payment hash from the macaroon identifier.
   */
  paymentHash?: string;
}
