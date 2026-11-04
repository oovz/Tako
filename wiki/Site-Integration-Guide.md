# Add a site integration

[English](Site-Integration-Guide) · [日本語](Site-Integration-Guide.ja) · [简体中文](Site-Integration-Guide.zh-CN) · [繁體中文](Site-Integration-Guide.zh-TW) · [한국어](Site-Integration-Guide.ko)

To request a site without writing code, [open a feature request](https://github.com/oovz/Tako/issues/new?template=feature_request.md). For development setup, read [Contributing](https://github.com/oovz/Tako/blob/main/CONTRIBUTING.md).

## Create the integration

```sh
pnpm new:site-integration <id> --name "Native Site Name" --english-name "English Site Name"
```

Use the site’s native name for `--name`. For an English-language site, use the same name for `--english-name`. For other sites, use the English name or Latin-script brand the provider uses on its website, in its logo, or on an official social account. If the provider uses neither, use the main domain’s label without the public suffix, such as `example` for `www.example.co.jp`.

The scaffold creates source files in `src/site-integrations/<id>/` and test data in `tests/fixtures/site-integrations/<id>/`.

Declare the site's supported URLs and access requirements in `definition.json`. Implement series and chapter-list loading in `background-runtime.ts`, and chapter images in `offscreen-runtime.ts`. Use the [definition schema](https://github.com/oovz/Tako/blob/main/src/site-integrations/definition.schema.json), [runtime interfaces](https://github.com/oovz/Tako/blob/main/src/types/site-integrations.ts), and a comparable existing integration as references.

Use `integrationHttpClient` for requests and `fetchImageWithStallDetection` for images. Forward cancellation, rate settings, byte progress, and resource accounting. Schedule each request once.

Validate response sizes, image dimensions, page counts, and provider-issued URLs before allocation or privileged use. Transformations must reserve their required resources and release them on success, failure, or cancellation.

Request only the site access you need. Package executable code with the extension; do not execute code from site responses or log credentials.

## Add tests

Keep HTML, API, and image fixtures beside the scaffold's `contract.json`. Record their sources and remove account details, cookies, and tokens.

The generator checks the `contract.json` envelope: `schemaVersion: 1`, the integration's `providerId`, and an object in `data`.

Cover metadata, chapter order, image transformations, and failure handling with focused tests. Use mocked browser tests for visible behavior and inspect the saved images, not just the archive's existence. Add a live check when site access is available.

```sh
pnpm generate:site-integrations
pnpm lint
pnpm type-check
pnpm test:unit
```

Run the applicable integration and browser checks from [Contributing](https://github.com/oovz/Tako/blob/main/CONTRIBUTING.md#testing), then `pnpm build`.

## Finish the contribution

The scaffold starts with `shipped: false` and `enabledByDefault: false`. Set `shipped: true` only when the integration and its tests are ready, then regenerate the catalogs.

Declare typed settings in `customSettings`. Add every referenced label, description, and option label to all five locale catalogs: `en`, `ja`, `zh_CN`, `zh_TW`, and `ko`.

Update [Supported Sites](Supported-Sites) and [Troubleshooting](Troubleshooting), including any access requirements that affect downloads.

## Optional capabilities

### One-shot page probes

If live page state is necessary, declare `pageProbe: "optional"` or `"required"` and provide `probe.ts`. Use bounded read-only probes that return validated plain data and release their resources when finished. Use the isolated world by default.

### Request headers

Declare required referer rules in `sessionRefererRules`. Use the managed ID range `41000`–`41999` and declared provider domains and origins. Rules remain scoped to extension requests.

### Image transformations

Declare image transformations in the definition and implement them offscreen. Test panel, tile and page order. Provide `cover.downloadImage` when covers need different image handling.

### Provider-issued image servers

For dynamically selected image hosts, declare `originKind: "provider-issued"` and validate URLs where the provider supplies them. Fixed endpoint origins belong in `requiredOrigins`; optional host patterns belong in `optionalOrigins`.
