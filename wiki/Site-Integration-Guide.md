# Contributing a Site Integration

[English](Site-Integration-Guide) · [日本語](Site-Integration-Guide.ja) · [简体中文](Site-Integration-Guide.zh-CN) · [繁體中文](Site-Integration-Guide.zh-TW) · [한국어](Site-Integration-Guide.ko)

This guide is for contributors adding or maintaining a supported site. To request a site without writing code, [open a feature request](https://github.com/oovz/Tako/issues/new?template=feature_request.md).

Read [Contributing](https://github.com/oovz/Tako/blob/main/CONTRIBUTING.md) for setup and [Architecture](Architecture) for runtime ownership. Integrations are TypeScript modules packaged with the extension.

## What an integration owns

A site integration identifies supported pages, resolves series and chapter information, downloads images, and handles any site-specific image transformation. Its definition declares origins, request policy, and settings.

Keep provider details inside the integration. Shared queue and message contracts use `siteIntegrationId` and generic integration context.

## Add a site

### 1. Create the scaffold

```powershell
pnpm new:site-integration <id> --name "Native Site Name" --english-name "English Site Name"
```

The command creates source files and a test-data seed:

| File                                                  | Purpose                                                               |
| ----------------------------------------------------- | --------------------------------------------------------------------- |
| `src/site-integrations/<id>/definition.json`          | Identity, URL matching, origins, capabilities, policies, and settings |
| `src/site-integrations/<id>/background-runtime.ts`    | Series and chapter-list resolution                                    |
| `src/site-integrations/<id>/offscreen-runtime.ts`     | Chapter plans and image downloading                                   |
| `src/site-integrations/<id>/contracts/index.ts`       | Provider contracts                                                    |
| `tests/fixtures/site-integrations/<id>/contract.json` | Deterministic test-data seed                                          |

The scaffold starts with `shipped: false` and `enabledByDefault: false`. Set `shipped: true` when the implementation and tests are ready for release. For isolated scaffolding, `--out-dir` selects the source destination and `--fixtures-dir` selects the test-data destination.

### 2. Declare the site's contract

Edit `definition.json` using the [definition schema](https://github.com/oovz/Tako/blob/main/src/site-integrations/definition.schema.json) and a comparable existing integration as references.

Set `name` to the site’s native display name and `englishName` to its English name. Use a stable identifier for `id` and the integration directory; alternative domains belong in the matching rules.

Define the pages Tako should recognize, fixed and optional origins, endpoint purposes, credentials, response types and limits, request spacing, retry ownership, and required runtime capabilities. Declare only access the integration needs.

### 3. Resolve the series in the background

Implement `resolveSeriesData` in `background-runtime.ts`, following [`ServiceWorkerIntegration`](https://github.com/oovz/Tako/blob/main/src/types/site-integrations.ts).

Resolve the series title, metadata, chapter IDs, chapter URLs, and availability from URL data, the provider API, or fetched HTML. Use `integrationHttpClient` for requests and validate provider data before returning it. Add dispatch-context preparation only when chapter processing needs it.

### 4. Resolve and download chapter images offscreen

Implement `resolveChapterPlan` and `downloadImage` in `offscreen-runtime.ts`, following [`OffscreenIntegration`](https://github.com/oovz/Tako/blob/main/src/types/site-integrations.ts).

Use the shared chapter-plan schemas and `fetchImageWithStallDetection`. Carry the provided cancellation signal, rate policy, byte-progress callback, and live-resource ledger through the request. Return each image's bytes, filename, MIME type, and resource lease. Follow an existing integration's scheduling ownership so each request is scheduled once.

Validate response sizes, image dimensions, page counts, and provider-issued URLs before allocation or privileged use. Transformations must reserve their required resources and release them on success, failure, or cancellation.

### 5. Document and test the integration

Put captured HTML, protocol vectors, and controlled image inputs in `tests/fixtures/site-integrations/<id>/`. The generator checks the canonical `contract.json` envelope: `schemaVersion: 1`, the integration's `providerId`, and an object in `data`. Keep fixture provenance beside the data so contributors can distinguish captured fields from synthetic controls.

Add focused unit coverage and mocked browser coverage for UI-visible behavior. Check page ordering and transformed image content, along with successful decoding.

An integration `README.md` is optional. Add one when it gives contributors practical information beyond the code, types, fixture notes, and shared guides. Keep it focused on that information. Reader instructions belong in [Supported Sites](Supported-Sites) and [Troubleshooting](Troubleshooting). Live checks run from `tests/live/`; shared work URLs are defined in `tests/e2e/fixtures/test-domains-constants.ts`.

### 6. Generate and verify

While developing, run focused tests and these checks:

```powershell
pnpm generate:site-integrations
pnpm check:site-integrations
pnpm type-check
pnpm lint
pnpm test:unit
```

When resolvers and fixtures are ready, set `shipped: true` and regenerate the catalogs. Run the applicable integration and browser checks from [Contributing](https://github.com/oovz/Tako/blob/main/CONTRIBUTING.md#testing), then build the production extension with `pnpm build`.

Live-provider checks are opt-in. Use the [live chapter validation guide](https://github.com/oovz/Tako/blob/main/CONTRIBUTING.md#live-chapter-validation) to inspect an actual saved chapter and compare transformed pages with the site's reader. Record the work, chapter, date, save result, and visual inspection from the live run. Deterministic fixtures cover the retained protocol and failure cases.

## Optional capabilities

### One-shot page probes

If live page state is necessary, declare `pageProbe: "optional"` or `"required"` and provide `probe.ts`. Use bounded read-only probes that return validated plain data and release their resources when finished. Use the isolated world unless there is a documented reason to use the main world.

### Request headers

Declare required referer rules in `sessionRefererRules`. Use the managed ID range `41000`–`41999` and declared provider domains and origins. Rules remain scoped to extension requests.

### Image transformations

Declare the image-transform capability and implement it in the offscreen runtime. Reuse the shared image transport and resource accounting. Add deterministic fixtures that detect incorrect panel, tile, or page order.

### Provider-issued image servers

For dynamically selected image hosts, declare `originKind: "provider-issued"` and validate URLs where the provider supplies them. Fixed endpoint origins belong in `requiredOrigins`; optional host patterns belong in `optionalOrigins`. The generator handles optional grants for disabled shipped providers.

### Localized settings

Declare typed settings in `customSettings`. Their labels, descriptions, and option labels must exist in all five locale catalogs: `en`, `ja`, `zh_CN`, `zh_TW`, and `ko`. The generator checks that the required keys are present.

## Shared request security

Provider requests use `integrationHttpClient` and the shared endpoint policy. These boundaries enforce declared origins and credentials, HTTPS and public-host validation, redirect policy, bounded responses, and cancellation. Image transport also validates MIME types and byte limits.

Package executable integration code with the extension and parse remote responses as data. Diagnostics contain redacted technical details; credentials and raw responses stay at the request boundary.

Related: [Architecture](Architecture), [Permissions](Permissions), and [Supported Sites](Supported-Sites).
