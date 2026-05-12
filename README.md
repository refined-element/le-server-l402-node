# l402-server

[![npm](https://img.shields.io/npm/v/l402-server.svg)](https://www.npmjs.com/package/l402-server)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**L402 server SDK for Node.** Mint Lightning invoices and macaroons. Verify L402 tokens. Wrap any HTTP API with pay-per-request Lightning payments — one `npm install`, two methods.

This is the **producer-side** companion to [`l402-requests`](https://www.npmjs.com/package/l402-requests) (the consumer-side auto-paying HTTP client). Use `l402-requests` to *call* paid APIs from agents. Use `l402-server` to *build* paid APIs that those agents pay for.

## What you're paying for

`l402-server` is a thin TypeScript wrapper around [Lightning Enable](https://lightningenable.com)'s hosted producer API. The protocol-heavy work — invoice minting, macaroon signing, preimage verification, replay protection, wallet integration (Strike / OpenNode / LND / NWC) — all runs on Lightning Enable's side. The SDK is ~200 lines of HTTP-client glue.

**Requires a Lightning Enable merchant API key** and an Agentic Commerce subscription ($99/mo Individual or $299/mo Business). Get both at [lightningenable.com/dashboard](https://api.lightningenable.com/dashboard).

## Install

```bash
npm install l402-server
```

Node 18+. ESM + CJS dual exports. TypeScript types included.

## Quick start

```ts
import { L402Server } from "l402-server";

const l402 = new L402Server({
  apiKey: process.env.LIGHTNING_ENABLE_API_KEY!,
});

// 1. On an unauthenticated incoming request, mint a challenge:
const challenge = await l402.createChallenge({
  resource: "/api/premium/weather",
  priceSats: 100,
  description: "Premium weather forecast",
});
// → { invoice: "lnbc100n1...", macaroon: "AgEL...", paymentHash: "...", expiresAt, ... }

// Send back as 402 Payment Required with the macaroon + invoice in headers.
// (Use a framework middleware on top of this SDK to automate that step.)

// 2. When the client retries with Authorization: L402 <macaroon>:<preimage>,
// parse the header and verify:
const result = await l402.verifyToken({
  macaroon: parsedMacaroon,
  preimage: parsedPreimage,
});

if (result.valid) {
  // result.resource → which path the token is bound to
  // result.amountSats → how much was paid
  // Serve your real response.
}
```

## Surface

### `new L402Server(options)`

| Option | Type | Default | Notes |
|---|---|---|---|
| `apiKey` | `string` | **required** | Your Lightning Enable merchant API key |
| `baseUrl` | `string` | `https://api.lightningenable.com` | Override for testing |
| `timeoutMs` | `number` | `10000` | Per-request timeout |
| `fetch` | `typeof fetch` | global `fetch` | Inject for tests / retries |

### `createChallenge(args)` → `Promise<Challenge>`

```ts
{
  resource: string;       // bound as a macaroon caveat
  priceSats: number;      // ≥ 1
  description?: string;   // shown in payer's wallet
  idempotencyKey?: string; // optional; falls back to client IP
}
```

Returns: `{ invoice, macaroon, paymentHash, expiresAt, resource, priceSats, mppChallenge? }`.

### `verifyToken(args)` → `Promise<VerificationResult>`

```ts
{
  macaroon?: string;  // required for L402; omit only for MPP
  preimage: string;
}
```

Returns: `{ valid, error?, resource?, merchantId?, amountSats?, paymentHash? }`. Inspect `result.valid` — the producer API returns 200 OK for both valid and invalid tokens.

### Errors

All SDK errors extend `L402ServerError`:

| Class | When |
|---|---|
| `L402AuthError` | 401 — API key missing / invalid / revoked |
| `L402PlanError` | 403 — L402 not enabled on merchant's plan (surfaces `currentPlan`) |
| `L402ApiError` | Other non-2xx (400 / 429 / 5xx); surfaces `statusCode` + `responseBody` |
| `L402NetworkError` | Timeout, DNS, TLS, transport failure (surfaces `cause`) |

## Two integration modes

Lightning Enable supports two integration shapes:

- **Proxy mode** — point Lightning Enable at your API URL; we forward authenticated requests on your behalf. Best for public APIs or quick experiments. [Setup walkthrough](https://docs.lightningenable.com/products/l402-microtransactions/proxy-setup-walkthrough).
- **Native mode** — install this SDK in your existing API. Lightning Enable handles payment; your API handles everything else. Best for commercial APIs with their own auth, observability, or sensitive infrastructure. **This SDK is the Native mode building block.**

Framework-specific middleware that wraps this SDK is in development:

- `l402-express` — Express middleware
- ASP.NET Core middleware (separate package)
- FastAPI dependency (separate package)
- `l402-server-go` — Go middleware (Phase 2 of the roadmap)

## Architectural notes

The architectural decisions baked into this SDK are deliberate:

- **No protocol code in the SDK.** Macaroon signing, preimage hashing, payment-hash linking — all server-side. The SDK is HTTP-client glue.
- **Verification via the hosted endpoint, not local key material.** We don't distribute the L402 root key to merchants. Every `verifyToken` call goes to `/api/l402/challenges/verify`. One round-trip per paid request (~50ms regional). The trade-off is acceptable until a high-volume partner complains; we'll revisit then.
- **Replay prevention centralized.** Lightning Enable tracks consumed preimages. Merchants don't maintain a local cache. Consistent across the merchant's whole API surface.
- **No credentials stored anywhere.** Lightning Enable never asks for your upstream API credentials. The SDK just calls our two endpoints; your traffic stays on your server.

## Contributing

Open source under MIT. Issues and pull requests welcome. For protocol-level discussion, see the [L402 spec at lightninglabs/L402](https://github.com/lightninglabs/L402).

## License

MIT © Refined Element, LLC
