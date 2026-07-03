# Changelog

All notable changes to `l402-server` are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## Versioning policy (0.x)

This package is pre-1.0. Per [semver](https://semver.org/#spec-item-4), 0.x
releases may include breaking changes in **minor** versions: `0.N` → `0.N+1`
can break the public API (called out explicitly in the entry below); patch
releases (`0.N.x` → `0.N.x+1`) are always backward compatible. Pin a minor
range (e.g. `~0.2.0` or `^0.2.0` — npm's `^` on 0.x already restricts to the
same minor) if you need stability.

## [0.2.0] - 2026-07-03

### Added

- `VerifyTokenArgs.resource` (optional): pass the request path you are gating
  and the Lightning Enable producer API enforces the macaroon's `path` caveat
  server-side — a token bound to a different resource returns `valid: false`.
  Previously the caveat value was only echoed back and enforcement was the
  integrator's responsibility.
- `VerifyTokenArgs.amountSats` (optional): pass your endpoint's price and the
  producer API enforces the macaroon's `amount_sats` caveat server-side,
  preventing replay of a cheaper token against a pricier endpoint.
- Client-side validation mirroring the producer API: empty-string `resource`
  and `amountSats < 1` throw immediately with descriptive errors instead of
  a 400 round-trip.
- This CHANGELOG.

### Changed

- README: `l402-express` (npm) and `L402Server.AspNetCore` (NuGet) moved from
  "in development" to shipped, with registry links.

No breaking changes — both new fields are optional and omitted from the wire
body when unset.

## [0.1.1] - 2026-05-12

### Fixed

- Reject unresolved environment-variable placeholders (the literal string
  `${VAR_NAME}`) passed as `apiKey` at construction time with a
  self-diagnosing error, instead of sending them as the `X-API-Key` header
  and surfacing an opaque 401.
- `package-lock.json` synced to the released version.

## [0.1.0] - 2026-05-12

### Added

- Initial release: `L402Server` client wrapping Lightning Enable's hosted
  L402 producer API — `createChallenge` (`POST /api/l402/challenges`) and
  `verifyToken` (`POST /api/l402/challenges/verify`), typed errors
  (`L402AuthError`, `L402PlanError`, `L402ApiError`, `L402NetworkError`),
  per-request timeout, injectable `fetch`, ESM + CJS dual exports.
