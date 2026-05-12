/**
 * Base error class for all SDK-thrown errors. Distinguishable from arbitrary
 * `Error` instances via `instanceof L402ServerError`.
 */
export class L402ServerError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "L402ServerError";
  }
}

/**
 * Thrown on `401 Unauthorized` from the producer API. Almost always means
 * the merchant API key is missing, malformed, expired, or revoked.
 */
export class L402AuthError extends L402ServerError {
  constructor(message: string = "Merchant API key is missing or invalid.") {
    super(message);
    this.name = "L402AuthError";
  }
}

/**
 * Thrown on `403 Forbidden` from the producer API. Means the merchant
 * exists and the key is valid, but L402 is not enabled on their plan.
 * The merchant needs to upgrade to an Agentic Commerce plan.
 */
export class L402PlanError extends L402ServerError {
  /**
   * The plan tier currently on the merchant (e.g., "starter").
   * Populated when the server includes it in the error payload.
   */
  readonly currentPlan?: string;

  constructor(
    message: string = "L402 is not enabled on this merchant's plan.",
    currentPlan?: string,
  ) {
    super(message);
    this.name = "L402PlanError";
    this.currentPlan = currentPlan;
  }
}

/**
 * Thrown for transport-level failures: timeout, DNS error, TLS error,
 * unreachable host. The `cause` carries the original error.
 */
export class L402NetworkError extends L402ServerError {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "L402NetworkError";
  }
}

/**
 * Thrown when the server returns a non-success status that doesn't map to
 * a more specific error class above (e.g., 400 with a request-validation
 * problem, 500 from upstream wallet failure, 429 from rate limiting).
 */
export class L402ApiError extends L402ServerError {
  /**
   * HTTP status code returned by the producer API.
   */
  readonly statusCode: number;

  /**
   * Raw response body, useful for debugging. May be a parsed object or a
   * string if parsing failed.
   */
  readonly responseBody?: unknown;

  constructor(
    statusCode: number,
    message: string,
    responseBody?: unknown,
  ) {
    super(message);
    this.name = "L402ApiError";
    this.statusCode = statusCode;
    this.responseBody = responseBody;
  }
}
