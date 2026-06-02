# Contributing a Site Integration

This guide explains how to add or maintain a supported-site integration for Tako.

## What a site integration owns

A site integration is responsible for four things:

1. **URL matching** through the manifest
2. **Series and chapter extraction** in the content-script context or through background-side APIs
3. **Chapter image resolution and download behavior** in the offscreen pipeline
4. **Optional site-specific settings and runtime handoff data**

Tako uses the term **Site Integration** everywhere in code and UI. Use `siteIntegrationId` for identifiers.

## The main files

| Path | Purpose |
|---|---|
| `src/site-integrations/manifest.ts` | Single source of truth for integration metadata, URL patterns, defaults, and optional settings |
| `src/site-integrations/<site>/index.ts` | Main integration implementation |
| `src/site-integrations/<site>/content-runtime.ts` | Content-script runtime export used by the static content registry |
| `src/site-integrations/<site>/background-runtime.ts` | Service-worker runtime export for series API calls and dispatch-context preparation |
| `src/site-integrations/<site>/offscreen-runtime.ts` | Offscreen runtime export for chapter image resolution, DOM/web-API-assisted processing, and image downloads |
| `src/runtime/generated/site-integration-content-registry.ts` | Generated static list of content runtime imports |
| `src/runtime/generated/site-integration-background-registry.ts` | Generated static list of service-worker runtime imports |
| `src/runtime/generated/site-integration-offscreen-registry.ts` | Generated static list of offscreen runtime imports |
| `scripts/generate-site-integration-registries.mjs` | Build-time generator for context-scoped static registries |
| `src/types/site-integrations.ts` | Shared integration interfaces |
| `src/shared/site-integration-utils.ts` | Shared label and numeric parsing helpers |
| `tests/unit/integrations/` | Integration-focused unit coverage |
| `tests/e2e/fixtures/mock-data/site-integrations/` | Mock site data for deterministic Side Panel and download-workflow coverage |
| `tests/live/` | Real-site validation for supported integrations |

## Integration shape

Every integration exports a `SiteIntegration` with `content` and `background` sections.

### Content integration

The content side can:

- wait for a page to be ready with `waitForPageReady?()`
- derive a stable series identifier with `getSeriesId()`
- extract chapter lists with `extractChapterList?()`
- extract series metadata with `extractSeriesMetadata?()`

Use the content side when the site's truth lives in the page DOM or in page-scoped state.

### Background integration

The background side runs in the MV3 service worker. It can:

- fetch series metadata from an API with `series.fetchSeriesMetadata()`
- fetch chapter lists from an API with `series.fetchChapterList()`
- prepare per-dispatch runtime context with `prepareDispatchContext()`

Use the background side when the site exposes stable series APIs or when queue dispatch needs privileged extension APIs such as storage. It must not import DOM-only or offscreen-only image processing code.

### Offscreen integration

The offscreen side runs in the hidden offscreen document. It can:

- resolve image URLs with `chapter.resolveImageUrls()`
- fall back to HTML parsing with `chapter.parseImageUrlsFromHtml()`
- normalize candidate image URLs with `chapter.processImageUrls()`
- download final image bytes with `chapter.downloadImage()`

Use the offscreen side for chapter/image work, DOMParser, iframe-assisted scraping, canvas, `createImageBitmap`, `OffscreenCanvas`, Blob/object URL work, and other web APIs unavailable to the service worker. Offscreen documents have DOM/web APIs but only `chrome.runtime` from the Chrome extension API surface, so storage and downloads API calls must still route through the service worker by message.

## Manifest-first registration

Add every integration to `src/site-integrations/manifest.ts`.

Each manifest entry should define:

- `id`
- `name`
- `author`
- `patterns.domains`
- `patterns.seriesMatches`
- optional `patterns.excludeMatches`
- `policyDefaults.image`
- `policyDefaults.chapter`
- optional `handlesOwnRetries`
- optional `customSettings`
- `runtimes.content`
- `runtimes.background`
- `runtimes.offscreen`

The manifest drives metadata, URL matching, user enablement, options rendering, rate defaults, and content-script match generation. It must stay metadata-only and must not import site runtime code.

Runtime loading is static and context-scoped. Each site folder should provide a runtime file for every manifest runtime flag set to `true`:

- `content-runtime.ts` exports `contentSiteAdapter`
- `background-runtime.ts` exports `backgroundSiteAdapter`
- `offscreen-runtime.ts` exports `offscreenSiteAdapter`

Do not edit generated registry files directly. `pnpm generate:site-integrations` regenerates them, and `pnpm lint` verifies they are current. `pnpm type-check`, `pnpm build`, and packaging scripts regenerate them automatically before running their normal work.

If a site has no custom runtime for a context, set that flag to `false`. For example, `runtimes.offscreen: false` means `offscreen-runtime.ts` is not required and will not be imported into the offscreen registry.

## Recommended implementation flow

1. Add the manifest entry.
2. Create `src/site-integrations/<site>/index.ts`.
3. Create `src/site-integrations/<site>/content-runtime.ts`, `src/site-integrations/<site>/background-runtime.ts`, and `src/site-integrations/<site>/offscreen-runtime.ts` runtime exports.
4. Run `pnpm generate:site-integrations` or rely on `pnpm type-check` / `pnpm build` to regenerate static registries.
5. Add any helper modules the site needs inside the same folder.
6. Add unit coverage in `tests/unit/integrations/`.
7. Add mocked E2E coverage under `tests/e2e/` for Side Panel navigation and download workflows when the integration participates in the MVP UI flow.
8. Add or update live coverage in `tests/live/` when the site is stable enough for it.

## Shared helper rules

Use `src/shared/site-integration-utils.ts` when you need common preprocessing.

| Helper | Use it for |
|---|---|
| `sanitizeLabel()` | Normalizing titles, chapter labels, and volume labels |
| `parseChapterNumber()` | Deriving numeric chapter values from raw text |
| `parseVolumeInfo()` | Deriving `volumeLabel` and `volumeNumber` from raw text |
| `filterValidImageUrls()` | Dropping malformed absolute image URL candidates |
| `normalizeAllowedImageMimeType()` | Validating image response content types before filename/path work |

If an integration can derive numeric chapter or volume metadata, it should set those values itself. The enqueue path preserves provided numeric metadata; it does not invent it later.

## Chapter volume grouping

Use explicit volumes whenever the source site exposes chapter sections, arcs, books, single issues, extras, or similar chapter-list categories.

The fields have separate responsibilities:

| Field | Responsibility |
|---|---|
| `VolumeState.id` | Opaque, deterministic group key scoped to the current series state. It is not user-visible and does not need to be numeric. |
| `VolumeState.title` / `VolumeState.label` | User-visible group text from the site. Prefer the site label when it exists, including localized labels such as Manhuagui `单行本`, `番外篇`, and `连载`. |
| `Chapter.volumeId` | Reference to `VolumeState.id`; this is what the Side Panel uses for explicit grouping. |
| `Chapter.volumeLabel` | Per-chapter copy of the source volume/category label for display fallback, debugging, templates, and downstream metadata. |
| `Chapter.volumeNumber` | Parsed numeric volume metadata when available. This is useful for ComicInfo/template output and numeric fallback sorting, but it is not the group identity. |

For sites like Manhuagui, each chapter-list heading should become one `VolumeState` entry. Chapters under that heading should set `volumeId` to the corresponding entry's `id` and should preserve the heading text as `volumeLabel`. The Side Panel displays the explicit `VolumeState.title` / `label` first and falls back to `Chapter.volumeLabel` or `Volume {volumeNumber}` only when the explicit label is absent.

If a site only provides numeric volume metadata and no explicit `volumes[]`, the runtime may derive fallback groups such as `volume-1` with label `Volume 1`. New integrations should prefer explicit `volumes[]` when the site has meaningful category names.

## Dispatch-context handoff pattern

When a site needs extra runtime data during chapter processing:

1. Prefer `prepareDispatchContext()`.
2. Use a `chrome.storage.session` bridge only when the source data exists only in page or content-script context.
3. Keep the payload integration-scoped and small.
4. Pass the data through the generic `integrationContext` field instead of adding site-named shared message fields.

Examples in the current codebase:

- **MangaDex** bridges selected website preferences from page state into session storage, then forwards the needed subset through `integrationContext`.
- **Pixiv Comic** resolves cookie-backed request context and forwards the required header data through `integrationContext`.

## Context ownership

Keep content, service-worker, and offscreen responsibilities separable even when they share helper modules.

- Content runtime code may read `window`, `document`, page DOM, and page-scoped state.
- Background runtime code runs in the service worker and may use service-worker-safe extension APIs. Because Chrome MV3 service workers do not support dynamic `import()`, background runtimes are statically imported into the service-worker graph; keep them free of offscreen-only chapter/image code.
- Offscreen runtime code may use DOM and web APIs such as `DOMParser`, iframe scripting, canvas, and document APIs for advanced JavaScript page processing. It still cannot read the live tab DOM directly; pass page-derived data from content scripts or fetch/embed source documents explicitly. It also cannot read `chrome.storage` directly, so storage-dependent data must be passed in `integrationContext` or requested from the service worker.
- API-backed series loading should be exposed through the background runtime and requested from content via `FETCH_SERIES_DATA`; content scripts should not import background runtime modules directly.
- User enablement is currently a runtime processing toggle. Disabling an integration does not remove static content-script matches or broad host permissions during the MVP phase.
- ESLint restrictions and `tests/unit/site-integration-context-boundaries.spec.ts` enforce that content, background, and offscreen entrypoints cannot reach wrong-context site runtime files.

## Rate limiting and download rules

All integrations should use the shared rate limiter for network work.

Use:

```typescript
import { rateLimitedFetchByUrlScope } from '@/src/runtime/rate-limit';
```

Do not bypass it with raw `fetch(...)` for chapter or image traffic unless you are deliberately delegating to a helper that already applies the shared limiter.

Even when an integration handles its own retry strategy, it should still respect the shared concurrency and delay rules.

## Site-specific settings

Integrations can expose custom settings through `customSettings` in the manifest.

Common field types:

- `boolean`
- `string`
- `number`
- `select`
- `multiselect`

Those settings are rendered in the options page and stored under the integration's settings namespace in local storage.

Use this only for true integration behavior, not for generic extension settings that belong to all sites.

## DNR and header rewriting

Use Declarative Net Request only when regular request options are not enough.

Rules:

- keep the scope site-specific
- prefer session rules over broad persistent rules
- document the reason in the integration code and guide reviewers to the affected hostnames
- avoid rules that could affect unrelated integrations

## Validation checklist

Before you consider a site integration ready, verify all of the following.

- The manifest entry matches only the URLs you truly support.
- `getSeriesId()` is stable for the supported page shape.
- Chapter titles and numeric metadata are normalized.
- Image downloads go through the shared rate limiter.
- Any integration-specific handoff data flows through `integrationContext`.
- The integration works after `pnpm build` and appears in the generated extension manifest.
- Unit coverage exists for parsing and integration-specific edge cases.
- Mocked E2E coverage exists for supported user workflows when the site has UI-visible behavior.
- Live coverage exists if the site is stable and publicly testable.

## Validation commands

```powershell
pnpm type-check
pnpm test:unit
pnpm test:live:ci
pnpm build
```

After a build, inspect `.output/chrome-mv3/manifest.json` and confirm your domains appear in the generated content-script matches.

## Learn from the existing integrations

| Integration | Useful patterns |
|---|---|
| `mangadex` | Preference bridge, rich metadata, numeric metadata preservation |
| `pixiv-comic` | Cookie-backed request context, build-ID refresh, image reconstruction |
| `shonenjumpplus` | Episode JSON flow, DOM-backed metadata, image reconstruction |
| `manhuagui` | DOM chapter grouping, adult-gate cookie priming, reader-config parsing, referrer-sensitive image fetches |
| `comicnettai` | PUBLUS viewer API flow, tile-based image reconstruction, DOM chapter list extraction |

## Related docs

- `ARCHITECTURE.md` - broader runtime ownership and storage model
- `MESSAGING.md` - runtime message reference
- `TEMPLATE-MACROS.md` - path and filename template reference
