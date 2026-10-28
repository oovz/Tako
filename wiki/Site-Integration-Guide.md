# Contributing a Site Integration

[English](Site-Integration-Guide) · [日本語](Site-Integration-Guide.ja) · [简体中文](Site-Integration-Guide.zh-CN) · [繁體中文](Site-Integration-Guide.zh-TW) · [한국어](Site-Integration-Guide.ko)

This guide is for contributors adding or maintaining a supported site. To request a site without writing code, [open a feature request](https://github.com/oovz/Tako/issues/new?template=feature_request.md).

Read [Contributing](https://github.com/oovz/Tako/blob/main/CONTRIBUTING.md) for setup and [Architecture](Architecture) for runtime ownership. Integrations are TypeScript modules packaged with the extension.

## What an integration owns

A site integration identifies supported pages, resolves series and chapter information, downloads images, and handles any site-specific image transformation. Its definition declares origins, request policy, and settings.

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

Implement `series.resolveSeriesData` in `background-runtime.ts`, following [`ServiceWorkerIntegration`](https://github.com/oovz/Tako/blob/main/src/types/site-integrations.ts).

Resolve the series title, metadata, chapter IDs, chapter URLs, and availability from URL data, the provider API, or fetched HTML. Use `integrationHttpClient` for requests and validate provider data before returning it. Add dispatch-context preparation only when chapter processing needs it.

### 4. Resolve and download chapter images offscreen

Implement `chapter.resolveChapterPlan` and `chapter.downloadImage` in `offscreen-runtime.ts`, following [`OffscreenIntegration`](https://github.com/oovz/Tako/blob/main/src/types/site-integrations.ts).

Use the shared chapter-plan schemas and `fetchImageWithStallDetection`. Forward cancellation, rate settings, byte progress and resource accounting, and return the image result defined by the interface. Schedule each request once.

Validate response sizes, image dimensions, page counts, and provider-issued URLs before allocation or privileged use. Transformations must reserve their required resources and release them on success, failure, or cancellation.

### 5. Document and test the integration

Put captured HTML, protocol vectors, and controlled image inputs in `tests/fixtures/site-integrations/<id>/`. The generator checks the canonical `contract.json` envelope: `schemaVersion: 1`, the integration's `providerId`, and an object in `data`. Keep fixture provenance beside the data so contributors can distinguish captured fields from synthetic controls.

Add focused unit coverage and mocked browser coverage for UI-visible behavior. Check page ordering and transformed image content, along with successful decoding.

Update reader instructions in [Supported Sites](Supported-Sites) and [Troubleshooting](Troubleshooting). Live checks belong in `tests/live/`; shared work URLs are defined in `tests/e2e/fixtures/test-domains-constants.ts`.

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

Run a [live chapter check](https://github.com/oovz/Tako/blob/main/CONTRIBUTING.md#live-chapter-validation) when site access is available, and compare transformed pages with the site's reader.

## Optional capabilities

### One-shot page probes

If live page state is necessary, declare `pageProbe: "optional"` or `"required"` and provide `probe.ts`. Use bounded read-only probes that return validated plain data and release their resources when finished. Use the isolated world by default.

### Request headers

Declare required referer rules in `sessionRefererRules`. Use the managed ID range `41000`–`41999` and declared provider domains and origins. Rules remain scoped to extension requests.

### Image transformations

Declare image transformations in the definition and implement them offscreen. Test panel, tile and page order. Provide `cover.downloadImage` when covers need different image handling.

### Provider-issued image servers

For dynamically selected image hosts, declare `originKind: "provider-issued"` and validate URLs where the provider supplies them. Fixed endpoint origins belong in `requiredOrigins`; optional host patterns belong in `optionalOrigins`.

### Localized settings

Declare typed settings in `customSettings`. Their labels, descriptions, and option labels must exist in all five locale catalogs: `en`, `ja`, `zh_CN`, `zh_TW`, and `ko`. The generator checks that the required keys are present.

## Shared request security

Use `integrationHttpClient` and the shared image transport for requests. Declare the required origins, credentials and response limits in the definition. Package executable code with the extension and parse remote responses as data. Keep credentials and raw responses out of logs.

Related: [Architecture](Architecture), [Permissions](Permissions), and [Supported Sites](Supported-Sites).
