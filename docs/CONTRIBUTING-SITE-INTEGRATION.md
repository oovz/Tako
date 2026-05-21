# Contributing a Site Integration

This guide explains how to add or maintain a supported-site integration for Tako.

## What a site integration owns

A site integration is responsible for four things:

1. **URL matching** through the manifest
2. **Series and chapter extraction** in the content-script context or through background-side APIs
3. **Chapter image resolution and download behavior** in the background or offscreen pipeline
4. **Optional site-specific settings and runtime handoff data**

Tako uses the term **Site Integration** everywhere in code and UI. Use `siteIntegrationId` for identifiers.

## The main files

| Path | Purpose |
|---|---|
| `src/site-integrations/manifest.ts` | Single source of truth for integration metadata, URL patterns, defaults, and optional settings |
| `src/site-integrations/<site>/index.ts` | Main integration implementation |
| `src/site-integrations/<site>/runtime.ts` | Runtime export used by manifest-driven loading |
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

The background side can:

- fetch series metadata from an API with `series.fetchSeriesMetadata()`
- fetch chapter lists from an API with `series.fetchChapterList()`
- prepare per-dispatch runtime context with `prepareDispatchContext()`
- resolve image URLs with `chapter.resolveImageUrls()`
- fall back to HTML parsing with `chapter.parseImageUrlsFromHtml()`
- normalize candidate image URLs with `chapter.processImageUrls()`
- download final image bytes with `chapter.downloadImage()`

Use the background side when the site exposes stable APIs or when download logic needs privileged extension capabilities.

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
- `importPath`
- `exportName`

The manifest drives runtime loading and content-script match generation, so keep it accurate and minimal.

## Recommended implementation flow

1. Add the manifest entry.
2. Create `src/site-integrations/<site>/index.ts`.
3. Create `src/site-integrations/<site>/runtime.ts` that re-exports the integration.
4. Add any helper modules the site needs inside the same folder.
5. Add unit coverage in `tests/unit/integrations/`.
6. Add mocked E2E coverage under `tests/e2e/` for Side Panel navigation and download workflows when the integration participates in the MVP UI flow.
7. Add or update live coverage in `tests/live/` when the site is stable enough for it.

## Shared helper rules

Use `src/shared/site-integration-utils.ts` when you need common preprocessing.

| Helper | Use it for |
|---|---|
| `sanitizeLabel()` | Normalizing titles, chapter labels, and volume labels |
| `parseChapterNumber()` | Deriving numeric chapter values from raw text |
| `parseVolumeInfo()` | Deriving `volumeLabel` and `volumeNumber` from raw text |

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

## Related docs

- `ARCHITECTURE.md` - broader runtime ownership and storage model
- `MESSAGING.md` - runtime message reference
- `TEMPLATE-MACROS.md` - path and filename template reference
