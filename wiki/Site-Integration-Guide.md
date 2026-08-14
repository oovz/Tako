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

## Manifest first

`src/site-integrations/manifest.ts` is the single registry. Every entry
declares:

```typescript
interface SiteIntegrationManifest {
  id: string
  name: string
  version: string
  author: string
  maturity: "experimental" | "stable"
  shipped: boolean
  enabledByDefault: boolean
  implementationType:
    "official-api" | "unofficial-api" | "dom-scraping" | "hybrid"

  patterns: {
    domains: string[]
    seriesMatches: string[]
    excludeMatches?: string[]
  }
  requiredOrigins: string[]
  requiresPageProbe: boolean
  requiresBroadHttpsPermission?: boolean

  policyDefaults: {
    image: { concurrency: number; delayMs: number }
    chapter: { concurrency: number; delayMs: number }
  }
  handlesOwnRetries?: boolean
  customSettings?: SettingsFieldSchema[]
  runtimes: {
    background: boolean
    offscreen: boolean
  }
}
```

`enabledByDefault` is the only fresh-profile default. A missing user override
resolves from it everywhere: Options, active-tab detection, background dispatch,
generated registries, and tests. Do not duplicate a different fallback.

Set a runtime flag to `true` only when that context has a real, bundled
implementation. The generator must not create placeholder adapters just to
satisfy a manifest shape.

MangaDex is the current example of `requiresBroadHttpsPermission: true`. It is
disabled by default; its Options enable gesture requests optional `https://*/*`.
A denied/revoked permission leaves it unavailable. Broad browser permission
never broadens the integration's runtime URL policy.

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
backoff, and `nextChapterDispatchAt` deadline. Series resolvers also receive an
AbortSignal that must be passed to provider fetches so a resolution deadline
cancels the underlying request. Service Worker suspension must not erase a
provider delay.

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

All provider/API/image requests must go through the shared hardened request
layer, which enforces:

- HTTPS unless an origin is explicitly approved;
- integration-specific origin allowlists;
- redirect rejection before follow (current limit: zero), plus defensive
  final-URL validation;
- private, link-local, and loopback rejection unless explicitly required;
- declared credential mode;
- response-size limits and AbortSignal cancellation;
- metadata/HTML response bodies capped at 10 MiB before parsing;
- raster MIME plus magic-byte validation;
- encoded pixel-dimension limits before canvas allocation, with a post-decode
  consistency check;
- sanitized filenames;
- structured retry/error categories;
- redacted logging of query values, credentials, headers, and bodies.

`handlesOwnRetries` changes retry classification/backoff only; it never bypasses
proactive rate limiting.

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
- Validate final response MIME, magic bytes, size, and dimensions.
- Preserve source extensions only after validation.
- Keep descramblers deterministic and pixel-tested against representative
  fixtures.
- Never report chapter/task completion when offscreen merely prepared a Blob.
  Chrome Downloads commit at `downloads.onChanged: complete`; FSA commits after
  writable-stream `close()` succeeds.
- For loose images, record requested, committed, and failed output counts so a
  partial image result produces task `partial_success` rather than false
  failure.

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

Validate persisted values when a field is renamed or removed, and add a
migration when the old value has a safe replacement.

## Maturity and promotion

New integrations begin `experimental`. They may become `stable` after:

- deterministic parser/image/descrambler fixtures pass;
- live smoke tests pass over several days;
- representative readable, unavailable, and locked states are covered;
- unknown provider changes fail closed with a mapped message;
- no known archive corruption or systematic extraction failure remains.

Unofficial APIs, HTML parsing, and descrambling can be Stable after this
evidence. The soak period supplements regression tests; it does not replace
them.

## Recommended implementation flow

1. Add the manifest entry and runtime schemas.
2. Implement URL/API/fetched-HTML series resolution.
3. Add a one-shot probe only if a fixture proves it is necessary.
4. Implement offscreen chapter/image behavior through the shared request layer.
5. Add deterministic unit fixtures, including locked/unavailable cases.
6. Add mocked Side Panel/download E2E coverage.
7. Add live smoke coverage when publicly testable.
8. Regenerate registry artifacts; do not edit generated files manually.
9. Inspect the built Chrome manifest and verify required versus optional
   origins.

## Validation commands

```powershell
node scripts/generate-site-integration-registries.mjs --check
pnpm exec tsc --noEmit
pnpm exec vitest run --project unit
pnpm build
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
| Comic Nettai | SSR open/expired state, PUBLUS viewer, normal-navigation/session-sensitive viewer access                                                                                  |

Related: [Architecture](Architecture), [Permissions](Permissions), and
[Template Macros](Template-Macros).
