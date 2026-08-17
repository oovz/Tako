# Contributing a Site Integration

This guide covers adding or maintaining a manga/comic/manhwa/manhua integration
for Tako's WXT Manifest V3 architecture.

## What an integration owns

An integration owns:

1. URL matching and required provider/asset origins.
2. Series/chapter context resolution.
3. Chapter image resolution, validation, download behavior, and any
   descrambling.
4. Provider rate/timeout policy and optional localized settings.
5. Deterministic fixtures plus live smoke evidence.

Use the term **site integration** and the field `siteIntegrationId`
consistently. Provider-specific fields must not leak into shared queue/message
contracts.

## Definition first

`src/site-integrations/*/definition.json` is the source of truth for provider
identity, maturity, URL patterns, origins, request policies, runtime surfaces,
resolution strategies, page-probe mode, custom settings, and fixture paths.
Every definition is validated against
`src/site-integrations/definition.schema.json`; the generator then emits the
typed catalog, context-specific runtime registries, page-probe registry, and
permission inventory.

The current `definition.json` fields include `maturity`, `shipped`,
`enabledByDefault`, `implementationType`, `volatility`, `authentication`,
`patterns`, `requiredOrigins`, `optionalOrigins`, `policyDefaults`,
`retryOwner`, `pageProbe` (`none`, `optional`, or `required`), `runtimes`,
`resolution`, `endpointPolicies`, `dynamicOrigins`, `sessionRefererRules`,
`customSettings`, and `fixtures`. Do not recreate a separate manifest or infer
provider policy from generated output.

`enabledByDefault` is the only fresh-profile default. A missing user override
resolves from it everywhere: Options, active-tab detection, background dispatch,
generated registries, and tests. Do not duplicate a different fallback.

Set a runtime flag to `true` only when that context has a real, bundled
implementation. The generator must not create placeholder adapters just to
satisfy a definition shape.

MangaDex is the current example of a provider with optional `https://*/*`
access. It is disabled by default; its Options enable gesture requests that
optional origin. A denied/revoked permission leaves it unavailable. Broad
browser permission never broadens the integration's runtime URL policy. Each
`endpointPolicies` entry declares credentials, redirects, response type, and
response-size bounds; the owning provider code remains the runtime request-role
factory. `originKind: "provider-issued"` means a provider-issued dynamic origin
(for example, a MangaDex At-Home host) validated by the owning provider's
runtime policy, not arbitrary HTTPS access; the generated required-origin
inventory is not necessarily exhaustive for that dynamic host set. The shared
policy consumer is live today: `src/site-integrations/request-policy.ts` builds
the endpoint policy and `src/site-integrations/http-client.ts` enforces origin,
credential mode, redirect, response-type, and size limits for every provider
request. New provider code must route all requests through
`integrationHttpClient`; raw `fetch()` is prohibited.

## Context-resolution hierarchy

Use the least page-coupled strategy that produces correct data:

1. Parse the active tab URL.
2. Call a provider API.
3. Fetch and structurally parse provider HTML in extension/offscreen context.
4. Use a bundled one-shot page probe only when live DOM or page-owned storage is
   genuinely required.

There is no resident content script by default. Do not add a static WXT content
entrypoint merely for URL parsing or data that fetched HTML already contains.

### One-shot probe rules

A probe runs through `chrome.scripting.executeScript` and must:

- use the isolated world by default;
- be bundled with the extension;
- be read-only and return schema-validated plain data;
- accept no selector, code, or executable configuration from provider responses;
- install no persistent listener, history patch, interval, or unbounded
  observer;
- clean up any bounded readiness observer before returning;
- never write extension storage or operate the queue/download pipeline;
- use `world: 'MAIN'` only with a documented integration-specific reason.

SPA navigation restarts loading-first resolution. A resident observer is allowed
only after an integration test proves URL/navigation events plus one-shot
resolution cannot represent the visible page correctly.

## Runtime boundaries

### Service Worker runtime

Use it for URL routing, provider series API/HTML loading that is Service Worker
safe, permission checks, and preparing small non-secret dispatch context. It
must not perform long-running timers or DOM/canvas work.

### Offscreen runtime

Use it for provider request scheduling, chapter HTML parsing, image resolution,
image validation/download, descrambling, archive creation, FSA writes, and Blob
URL ownership. It communicates through `chrome.runtime`; storage/downloads/
permissions/alarms remain Service Worker responsibilities.

The component making requests owns the rate limiter, Retry-After handling,
backoff, and `nextChapterDispatchAt` deadline. Series resolvers receive an
AbortSignal; the owning provider passes it to network requests and offscreen
pagination so a deadline or superseded navigation stops the underlying work.
Service Worker suspension must not erase a provider delay.

MangaDex chapter downloads use the typed `resolveImageUrls` At-Home resolver in
both bundled runtimes. The generic HTML parser fallback is for integrations that
do not provide a resolver and is not registered for MangaDex; keep the
provider's At-Home request and quality policy in that single resolver.

### Dispatch context

Provider-specific dispatch data uses a versioned envelope:

```typescript
interface IntegrationContextEnvelope<T = unknown> {
  integrationId: string
  schemaVersion: number
  createdAt: number
  data: T
}
```

Only the owning integration decodes `data` with a runtime schema. Reject unknown
future versions with a mapped compatibility error. Do not put cookies, bearer
tokens, signed URLs intended for logs, or constructed `Cookie` headers into this
envelope. Normal browser-managed credentials are declared per request origin.

## Shared request security

Provider request paths use the shared hardened layer when their integration
delegates to it; provider-specific request roles remain explicit in the owning
integration. The common layer enforces:

- HTTPS unless an origin is explicitly approved;
- integration-specific origin allowlists;
- redirect rejection before follow (current limit: zero), plus defensive
  final-URL validation;
- private, link-local, and loopback rejection unless explicitly required;
- the credential mode supplied by the provider request role;
- response-size limits and AbortSignal cancellation;
- metadata/HTML response bodies capped at 10 MiB before parsing;
- raw image fetches validate the response `Content-Type` MIME and byte size;
- image transformation paths validate encoded signatures and dimensions before
  canvas allocation, with a post-decode consistency check;
- AVIF is rejected by the shared transformation preflight until bounded support
  exists;
- sanitized filenames;
- structured retry/error categories;
- redacted logging of query values, credentials, headers, and bodies.

HTML response decoding is intentionally strict rather than browser-equivalent:
the response must provide a BOM, HTTP charset, or supported meta charset, and
malformed bytes fail through the fatal decoder. Providers that consume HTML must
satisfy that metadata contract. `handlesOwnRetries` changes retry
classification/backoff only; it never bypasses proactive rate limiting.
Providers needing richer control set `retryOwner: "provider"` and implement it
in-adapter; schema extensions require a `schemaVersion` bump.

## Chapter and volume data

Preserve explicit site categories such as volumes, arcs, books, single issues,
extras, or localized section headings.

| Field                    | Responsibility                                              |
| ------------------------ | ----------------------------------------------------------- |
| `Volume.id`              | Opaque deterministic group identity scoped to the series    |
| `Volume.title` / `label` | User-visible source label                                   |
| `Chapter.volumeId`       | Explicit reference to `Volume.id`                           |
| `Chapter.volumeLabel`    | Source label retained for fallback/templates/metadata       |
| `Chapter.volumeNumber`   | Parsed numeric metadata, not grouping identity              |
| `Chapter.listPosition`   | Stable 1-based source-list position preserved through retry |

Use shared sanitization and chapter/volume parsing helpers. Integrations should
provide numeric metadata when reliable; the enqueue path preserves rather than
reinterprets it.

## Image and output rules

- Resolve ordered image candidates deterministically.
- Validate final response MIME and size at the raw fetch boundary; transformed
  images additionally validate encoded signatures and dimensions.
- Derive exactly one output extension from the validated MIME; never duplicate a
  source suffix.
- Keep descramblers deterministic and pixel-tested against representative
  fixtures.
- Never report chapter/task completion when offscreen merely prepared a Blob.
  Chrome Downloads commit at `downloads.onChanged: complete`; FSA commits after
  writable-stream `close()` succeeds.
- For loose images, record requested, committed, and failed output counts so a
  partial image result produces task `partial_success` rather than false
  failure.

### Cover images

An integration may provide `offscreen.cover.downloadImage` when a cover uses a
different origin, credential mode, or response policy from chapter images. The
generic chapter `downloadImage` hook is used only when those policies are the
same. Cover prefetch is optional and nonfatal, but the hook remains abortable,
uses the provider URL/credential policy, and must not bypass the shared rate
admission owned by the caller.

## Settings schema

Custom settings use a typed, checked schema. `select` and `multiselect` fields
must declare a nonempty `options` list; a malformed schema fails at startup
instead of producing an unbounded text input in Options.

```typescript
interface SettingsFieldSchema {
  id: string
  type: "boolean" | "select" | "multiselect" | "string" | "number"
  label: string
  description?: string
  defaultValue: unknown
  options?: Array<{ value: string; label: string }>
}
```

When a persisted custom-setting shape changes, add an automatic, versioned,
one-time migration before switching the runtime validator to the new shape.
Remove the legacy decoder only after the supported direct-upgrade window (across
consecutive minor/major release epochs) has retired direct migrations from that
version.

## Maturity and promotion

New integrations begin `experimental`. They normally become `stable` after:

- deterministic parser/image/descrambler fixtures pass;
- live smoke tests pass over several days;
- representative readable, unavailable, and locked states are covered;
- unknown provider changes fail closed with a mapped message;
- no known archive corruption or systematic extraction failure remains.

Unofficial APIs, HTML parsing, DOM scraping, and descrambling may all be Stable.
Maturity describes the supported current implementation, not the likelihood that
an upstream site will remain unchanged.

## Recommended implementation flow

1. Add or update the provider `definition.json` and runtime schemas.
2. Implement URL/API/fetched-HTML series resolution.
3. Add a one-shot probe only if a fixture proves it is necessary.
4. Implement offscreen chapter/image behavior through the shared request layer.
5. Add deterministic unit fixtures, including locked/unavailable cases.
6. Add mocked Side Panel/download E2E coverage.
7. Add live smoke coverage when publicly testable.
8. Run `pnpm generate:site-integrations` (or `pnpm check:site-integrations` to
   verify generated output); never edit generated files manually.
9. Inspect the built Chrome manifest and verify required versus optional
   origins.

## Validation commands

```powershell
pnpm generate:site-integrations
pnpm check:site-integrations
```

Run site-specific live tests manually where access and automation policy permit.
A Stable integration must test production parsing/descrambling code, not only a
parallel test implementation.

## Current integration notes

| Integration  | Useful patterns                                                                                                                                                           |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MangaDex     | Official API, At-Home reporting, optional broad permission, optional one-shot page-preference import                                                                      |
| Pixiv Comic  | Internal API/build data and image reconstruction                                                                                                                          |
| Shonen Jump+ | Numeric `/episode/{id}` pages only; fetched SSR `readableProduct`, viewer API, tile reconstruction. Homepage and `/series*` catalog routes are intentionally unsupported. |
| Manhuagui    | SSR grouping, packed reader payload, explicit adult gate, referrer-sensitive images                                                                                       |
| Comic Nettai | SSR open/expired state, PUBLUS viewer, normal-navigation/session-sensitive viewer access; PUBLUS images are limited to JPEG/PNG/WebP/GIF and reject AVIF before fetching  |

Related: [Architecture](Architecture), [Permissions](Permissions), and
[Template Macros](Template-Macros).
