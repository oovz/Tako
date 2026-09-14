# Contributing a Site Integration

This guide explains how to add or maintain a manga, comic, manhwa, or manhua integration in Tako's WXT Manifest V3 extension.

> **Important (Chrome Web Store Remote-Code Policy):** Chrome Web Store Manifest V3 policies prohibit runtime-loaded integration scripts, remote code execution, dynamic plugins, and user-supplied code evaluation (`eval()`). Write integrations in TypeScript, compile them into the extension bundle, and verify them with the repository's build and test checks.

## What an integration owns

An integration owns:

1. URL matching and required provider/asset origins.
2. Series/chapter context resolution.
3. Chapter image resolution, validation, download behavior, and any descrambling.
4. Provider rate/timeout policy and optional localized settings.
5. Deterministic fixtures plus live smoke evidence.

Use the term **site integration** and the field `siteIntegrationId` consistently. Provider-specific fields must not leak into shared queue/message contracts.

## Fast track: Minimum Viable Integration (MVI)

Start with the smallest working implementation: parse URLs or fetch simple API/HTML data in the background, then download chapters and images in offscreen.

### 1. Scaffold the integration

Run the scaffolding tool:

```powershell
pnpm new:site-integration <id> --name "Site Name"
```

This creates `src/site-integrations/<id>/` with defaults that keep the integration out of shipped builds:

- `definition.json` (`shipped: false`)
- `offscreen-runtime.ts` (typed adapter stub)
- `contracts/index.ts` (contract definitions)
- `fixtures/contract.json` (deterministic fixture seed)
- `README.md` (Approach, Endpoints, States covered, Live smoke)

The default `shipped: false` value lets the scaffold pass generator checks without adding unfinished stubs to the build bundle.

### 2. Configure `definition.json`

Update URL patterns, required origins, endpoint policies, and rate limits:

```json
{
  "schemaVersion": 1,
  "id": "mysite",
  "name": "My Site",
  "contributors": ["YourName"],
  "version": "1.0.0",
  "shipped": false,
  "enabledByDefault": false,
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
    },
    {
      "id": "mysite-image",
      "purpose": "My Site chapter images",
      "origins": ["https://mysite.example.com/*"],
      "originKind": "fixed",
      "credentials": "omit",
      "redirect": "error",
      "responseType": "bytes",
      "maxResponseBytes": 50000000
    }
  ],
  "sessionRefererRules": [],
  "customSettings": [],
  "fixtures": {
    "paths": ["src/site-integrations/mysite/fixtures/contract.json"],
    "liveFreshnessDays": 30
  }
}
```

### 3. Implement Background Series Resolution

Implement `resolveSeriesData` in `background-runtime.ts`. Use `integrationHttpClient` for network requests; raw `fetch()` is not allowed in this path:

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
import { fetchImageWithStallDetection } from "@/src/runtime/fetch-image"

const offscreen: OffscreenIntegration = {
  name: "My Site Offscreen",
  chapter: {
    async resolveChapterPlan(chapter, input) {
      // Resolve image URLs for the chapter
      const urls = ["https://mysite.example.com/images/1.jpg"]
      return ChapterImagePlanSchema.parse({ imageUrls: urls })
    },
    async downloadImage(imageUrl, opts) {
      const image = await fetchImageWithStallDetection(imageUrl, {
        integrationId: "mysite",
        endpointId: "mysite-image",
        signal: opts.signal,
        rateLimitService: opts.runtime.rateLimitService,
        rateLimitPolicy: opts.runtime.rateLimitSettings.image,
        liveResourceLedger: opts.liveResourceLedger,
        onBytesReceived: opts.onBytesReceived,
        skipRateLimit: true, // The chapter image batch owns scheduling.
      })
      return {
        ...image,
        filename: "001.jpg",
      }
    },
  },
}

export const offscreenSiteAdapter: OffscreenSiteAdapter = {
  offscreen,
}
```

### 5. Document in `README.md`

Document the integration in `src/site-integrations/<id>/README.md`:

- **Approach:** How the site is handled (API vs DOM parsing, session requirements).
- **Endpoints:** All endpoint IDs and their purpose.
- **States covered:** Free chapters, locked/paywalled chapters, deleted series handling.
- **Live smoke:** Live verification notes and sample URLs.

### 6. Verify and Ship

1. Run initial verification while developing:
   `pnpm check:site-integrations && pnpm type-check && pnpm test:unit`.
2. After the resolvers and fixtures are complete, set `"shipped": true` in `src/site-integrations/<id>/definition.json`.
3. Re-run code generation to compile your adapter into the runtime bundle registries:
   ```powershell
   pnpm generate:site-integrations
   ```
4. Re-run the full verification suite:
   ```powershell
   pnpm check:site-integrations
   pnpm type-check
   pnpm test:unit
   ```

---

## Advanced capabilities (opt-in)

### 1. One-shot page probes

Set `pageProbe: "optional"` or `"required"` and provide `probe.ts`. Probes run via `chrome.scripting.executeScript`:

- Must be read-only and return plain, schema-validated JSON data.
- Must not install persistent listeners, timers, or unbounded DOM observers.
- Run in isolated world by default (`world: 'MAIN'` only with documented need).

### 2. Declarative Net Request (DNR) session rules

When a site requires custom referer headers for images or viewer sessions, declare `sessionRefererRules` in `definition.json`:

- IDs must be in the extension-managed range `41000`–`41999`.
- Domains and referers must match declared site patterns and required origins.

### 3. Image transformations and descramblers

When chapter pages are scrambled or split into tiles:

- Set `imageTransform: { "kind": "integrated-descramble", "estimatedCostMs": 3000 }`.
- Implement canvas descrambling in offscreen runtime.
- Add deterministic pixel-tested fixtures covering tile reconstruction.
- Image adapters use a live-resource ledger and pass each lease with the image bytes. Transformations reserve all required buffers and surfaces before allocation and release them when processing completes, fails, or is canceled.
- MangaMillion AVIF uses bounded metadata preflight, the renderer budget, and JPEG conversion. Its encoded transport also supports encrypted octet-stream payloads; other image requests keep their declared MIME contract.

### 4. Provider-issued origins

When image CDNs or storage nodes are issued dynamically (e.g. MangaDex At-Home nodes):

- Declare provider-issued CDN endpoints with `originKind: "provider-issued"`; validate each URL at the provider resolver that discovered it with the endpoint policy and public-HTTPS rules.
- Declare fixed endpoint origins in `requiredOrigins` and provider-selected patterns in `optionalOrigins`. Disabled shipped providers have their required origins emitted as optional manifest grants automatically.

### 5. Custom settings and i18n localization

When an integration exposes user-configurable settings in Options:

- Add typed fields to `customSettings` in `definition.json`.
- Every field's `labelKey` (and optional `descriptionKey` or option `labelKey`) **must exist in all four locale catalogs**: `en`, `ja`, `zh_CN`, `zh_TW` under `public/_locales/*/messages.json`.
- `generate:site-integrations` enforces complete localization and fails if any key is missing.

---

## Shared request security

Provider request paths use the shared HTTP client (`integrationHttpClient`). It enforces:

- HTTPS by default;
- integration-specific origin allowlists;
- redirect rejection before following, plus final-URL validation;
- private, link-local, and loopback rejection;
- credential modes declared per endpoint (`omit` or `include`);
- response-size limits and AbortSignal cancellation;
- metadata/HTML response bodies capped at 10 MiB before parsing;
- raw image response `Content-Type` MIME and byte size validation;
- sanitized filenames;
- redacted logging of query values, credentials, headers, and bodies.

## Validation commands

```powershell
pnpm generate:site-integrations # Regenerates catalogs and registries
pnpm check:site-integrations # Verifies generated files are in sync
pnpm type-check # Verifies TypeScript types
pnpm lint # Lints TypeScript and architectural boundaries
pnpm test:unit # Runs full unit test suite
```

Related: [Architecture](Architecture), [Permissions](Permissions), and [Template Macros](Template-Macros).
