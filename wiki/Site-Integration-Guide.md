# Contributing a Site Integration

This guide covers adding or maintaining a manga/comic/manhwa/manhua integration
for Tako's WXT Manifest V3 architecture.

> **Important (Chrome Web Store Remote-Code Policy):** Runtime-loaded
> integration scripts, remote code execution, dynamic plugins, or user-supplied
> code evaluation (`eval()`) are strictly prohibited under Chrome Web Store
> Manifest V3 policies. All site integrations must be written in TypeScript,
> compiled statically into the extension bundle, and verified through repository
> build and test gates.

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

## Contribution lifecycle

Tako uses a **contribution model, not an ownership model**:

- **Responsibility ends at merge:** A contributor's obligation is completed once
  their pull request is reviewed, tested, and merged. Contributors are not
  obligated to maintain integrations indefinitely.
- **Courtesy notifications:** Past authors may be tagged or pinged as a courtesy
  when an upstream site changes, but active fixes are voluntary.
- **Automated gates as maintainer safety net:** Strict schema validation,
  deterministic contract fixtures, unit tests, and live smoke tests protect the
  extension over time when contributors move on.

### Promotion and demotion

| Lifecycle stage   | `shipped` | `maturity`       | Description                                                           |
| ----------------- | --------- | ---------------- | --------------------------------------------------------------------- |
| In-development    | `false`   | `"experimental"` | Scaffolding default; excluded from generated runtime bundles.         |
| Active PR / Beta  | `true`    | `"experimental"` | Bundled; passes deterministic fixtures; undergoing live validation.   |
| Production Ready  | `true`    | `"stable"`       | Passes all fixtures, live smoke, covers locked/error states cleanly.  |
| Degraded / Broken | `true`    | `"experimental"` | Upstream site changes detected; demoted while awaiting a fix.         |
| Inactive / Dead   | `false`   | `"experimental"` | Unbundled safely without code deletion until an active fix is merged. |

Integrations define a re-verification cadence via `fixtures.liveFreshnessDays`
(typically 14–30 days). When a live smoke check fails and no contributor fix is
available, maintainers can safely demote the integration
(`maturity: "experimental"` or `"shipped": false`).

## Fast track: Minimum Viable Integration (MVI)

To add a new site integration, start with the lightest sufficient
implementation: URL parsing (or simple API/HTML fetch) in the background and
chapter/image download in offscreen.

### 1. Scaffold the integration

Run the scaffolding tool:

```powershell
pnpm new:site-integration <id> --name "Site Name"
```

This creates `src/site-integrations/<id>/` with safe defaults:

- `definition.json` (`shipped: false`, `maturity: "experimental"`)
- `background-runtime.ts` (typed adapter stub)
- `offscreen-runtime.ts` (typed adapter stub)
- `contracts/index.ts` (contract definitions)
- `fixtures/contract.json` (deterministic fixture seed)
- `README.md` (Approach, Endpoints, States covered, Live smoke)

Because `shipped: false` is set by default, the scaffold passes all generator
checks immediately without injecting unfinished stubs into the build bundle.

### 2. Configure `definition.json`

Update URL patterns, required origins, endpoint policies, and rate limits:

```json
{
  "schemaVersion": 1,
  "id": "mysite",
  "name": "My Site",
  "author": "YourName",
  "version": "1.0.0",
  "maturity": "experimental",
  "shipped": false,
  "enabledByDefault": false,
  "implementationType": "dom-scraping",
  "volatility": "low",
  "authentication": "anonymous",
  "regions": ["global"],
  "accountConstraints": [],
  "patterns": {
    "domains": ["mysite.example.com"],
    "seriesMatches": ["/series/*"]
  },
  "requiredOrigins": ["https://mysite.example.com/*"],
  "optionalOrigins": [],
  "policyDefaults": {
    "image": { "concurrency": 2, "delayMs": 500 },
    "chapter": { "concurrency": 1, "delayMs": 1000 }
  },
  "retryOwner": "platform",
  "pageProbe": "none",
  "runtimes": {
    "background": true,
    "offscreen": true,
    "dispatchContext": { "mode": "none" }
  },
  "imageTransform": {
    "kind": "none",
    "estimatedCostMs": 0
  },
  "endpointPolicies": [
    {
      "id": "mysite-series-page",
      "purpose": "My Site series HTML and catalog",
      "origins": ["https://mysite.example.com/*"],
      "originKind": "fixed",
      "credentials": "omit",
      "redirect": "error",
      "responseType": "html",
      "maxResponseBytes": 10000000
    }
  ],
  "dynamicOrigins": [],
  "sessionRefererRules": [],
  "customSettings": [],
  "fixtures": {
    "paths": ["src/site-integrations/mysite/fixtures/contract.json"],
    "liveFreshnessDays": 30
  }
}
```

### 3. Implement Background Series Resolution

Implement `resolveSeriesData` in `background-runtime.ts`. Use
`integrationHttpClient` for network requests (raw `fetch()` is prohibited):

```typescript
import type {
  BackgroundSiteAdapter,
  SeriesDataResolutionInput,
  SeriesDataResolutionResult,
  ServiceWorkerIntegration,
} from "@/src/types/site-integrations"

async function resolveSeriesData(
  input: SeriesDataResolutionInput
): Promise<SeriesDataResolutionResult> {
  // Parse series URL or fetch HTML/API metadata
  return {
    seriesId: "123",
    seriesMetadata: {
      title: "Sample Manga",
      description: "...",
      author: "Author Name",
    },
    chapterList: [
      {
        id: "ch-1",
        url: "https://mysite.example.com/chapter/1",
        title: "Chapter 1",
        chapterNumber: 1,
        chapterLabel: "1",
        locked: false,
        comicInfo: {
          Title: "Chapter 1",
        },
      },
    ],
  }
}

const background: ServiceWorkerIntegration = {
  name: "My Site Background",
  series: { resolveSeriesData },
}

export const backgroundSiteAdapter: BackgroundSiteAdapter = {
  id: "mysite",
  background,
}
```

### 4. Implement Offscreen Chapter & Image Resolution

In `offscreen-runtime.ts`, implement `resolveChapterPlan` and `downloadImage`:

```typescript
import type {
  OffscreenIntegration,
  OffscreenSiteAdapter,
} from "@/src/types/site-integrations"
import { ChapterImagePlanSchema } from "../chapter-plan"
import { integrationHttpClient } from "../http-client"

const offscreen: OffscreenIntegration = {
  name: "My Site Offscreen",
  chapter: {
    async resolveChapterPlan(chapter, input) {
      // Resolve image URLs for the chapter
      const urls = ["https://mysite.example.com/images/1.jpg"]
      return ChapterImagePlanSchema.parse({ imageUrls: urls })
    },
    async downloadImage(imageUrl, opts) {
      // Fetch image bytes via the hardened integration HTTP client
      const response = await integrationHttpClient.request({
        integrationId: "mysite",
        endpointId: "mysite-series-page",
        url: imageUrl,
        scope: "image",
        rateLimitService: opts.runtime.rateLimitService,
        init: { credentials: "omit", signal: opts.signal },
        skipRateLimit: opts.skipRateLimit,
      })
      const data = await response.arrayBuffer()
      return {
        data,
        filename: "001.jpg",
        mimeType: response.headers.get("content-type") ?? "image/jpeg",
      }
    },
  },
}

export const offscreenSiteAdapter: OffscreenSiteAdapter = {
  id: "mysite",
  offscreen,
}
```

### 5. Document in `README.md`

Fill out the per-site prose in `src/site-integrations/<id>/README.md`:

- **Approach:** How the site is handled (API vs DOM parsing, session
  requirements).
- **Endpoints:** All endpoint IDs and their purpose.
- **States covered:** Free chapters, locked/paywalled chapters, deleted series
  handling.
- **Live smoke:** Live verification notes and URL samples.

### 6. Verify and Ship

1. Run initial verification while developing:
   `pnpm check:site-integrations && pnpm type-check && pnpm test:unit`.
2. When your resolvers and fixtures are complete, set `"shipped": true` in
   `src/site-integrations/<id>/definition.json`.
3. Re-run code generation to compile your adapter into the runtime bundle
   registries:
   ```powershell
   pnpm generate:site-integrations
   ```
4. Re-run the full verification suite to ensure all registries, types, and tests
   pass with the new integration bundled:
   ```powershell
   pnpm check:site-integrations
   pnpm type-check
   pnpm test:unit
   ```

---

## Advanced capabilities (opt-in)

### 1. One-shot page probes

Set `pageProbe: "optional"` or `"required"` and provide `probe.ts`. Probes run
via `chrome.scripting.executeScript`:

- Must be read-only and return plain, schema-validated JSON data.
- Must not install persistent listeners, timers, or unbounded DOM observers.
- Run in isolated world by default (`world: 'MAIN'` only with documented need).
- Example: MangaDex uses an optional probe to import reader preferences from
  local storage.

### 2. Declarative Net Request (DNR) session rules

When a site requires custom referer headers for images or viewer sessions,
declare `sessionRefererRules` in `definition.json`:

- IDs must be in the extension-managed range `41000`–`41999`.
- Domains and referers must match declared site patterns and required origins.

### 3. Image transformations and descramblers

When chapter pages are scrambled or split into tiles:

- Set
  `imageTransform: { "kind": "integrated-descramble", "estimatedCostMs": 3000 }`.
- Implement canvas descrambling in offscreen runtime.
- Add deterministic pixel-tested fixtures covering tile reconstruction.

### 4. Dynamic origins (provider-issued hosts)

When image CDNs or storage nodes are issued dynamically (e.g. MangaDex At-Home
nodes):

- Declare `dynamicOrigins` with target endpoint ID and
  `validator: "public-https"`.
- Declare target origins as `optionalOrigins`.

### 5. Custom settings and i18n localization

When an integration exposes user-configurable settings in Options:

- Add typed fields to `customSettings` in `definition.json`.
- Every field's `labelKey` (and optional `descriptionKey` or option `labelKey`)
  **must exist in all four locale catalogs**: `en`, `ja`, `zh_CN`, `zh_TW` under
  `public/_locales/*/messages.json`.
- `generate:site-integrations` enforces complete localization and hard-fails if
  any key is missing.

---

## Shared request security

Provider request paths use the shared hardened layer (`integrationHttpClient`).
The shared layer enforces:

- HTTPS by default;
- integration-specific origin allowlists;
- redirect rejection before follow (current limit: zero), plus defensive
  final-URL validation;
- private, link-local, and loopback rejection;
- credential modes declared per endpoint (`omit` or `include`);
- response-size limits and AbortSignal cancellation;
- metadata/HTML response bodies capped at 10 MiB before parsing;
- raw image response `Content-Type` MIME and byte size validation;
- sanitized filenames;
- redacted logging of query values, credentials, headers, and bodies.

## Validation commands

```powershell
pnpm generate:site-integrations  # Regenerates catalogs and registries
pnpm check:site-integrations     # Verifies generated files are in sync
pnpm type-check                  # Verifies TypeScript types
pnpm lint                        # Lints TypeScript and architectural boundaries
pnpm test:unit                   # Runs full unit test suite
```

## Current integration notes

| Integration                                 | Useful patterns                                                                                                                                                           |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MangaDex                                    | Official API, At-Home reporting, optional broad permission, optional one-shot page-preference import                                                                      |
| Pixiv Comic                                 | Internal API/build data and image reconstruction                                                                                                                          |
| Shonen Jump+                                | Numeric `/episode/{id}` pages only; fetched SSR `readableProduct`, viewer API, tile reconstruction. Homepage and `/series*` catalog routes are intentionally unsupported. |
| Manhuagui                                   | SSR grouping, packed reader payload, explicit adult gate, referrer-sensitive images                                                                                       |
| [Comic Nettai](https://www.comicnettai.com) | SSR open/expired state, PUBLUS viewer, normal-navigation/session-sensitive viewer access; PUBLUS images are limited to JPEG/PNG/WebP/GIF and reject AVIF before fetching  |
| MangaMillion                                | Official Protobuf API, anonymous device token registration, AES-256-CBC page decryption with SubtleCrypto, multi-language chapter catalog                                 |

Related: [Architecture](Architecture), [Permissions](Permissions), and
[Template Macros](Template-Macros).
