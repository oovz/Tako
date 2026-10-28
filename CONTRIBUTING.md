# Contributing to Tako

Set up Tako locally, run the tests, and prepare a pull request.

## Quick setup

```powershell
pnpm install
pnpm build
```

Open `chrome://extensions`, enable **Developer mode**, and choose **Load unpacked**. Select `.output\chrome-mv3`.

## Development workflow

```powershell
pnpm dev # WXT dev server
pnpm test:unit # Fast feedback loop
pnpm test:e2e # Deterministic extension behavior
pnpm test:live # Real-site validation (requires supported sites to be accessible)
```

Choose the build mode for your task:

| Mode              | Command                   | Artifact and policy                                                                          |
| ----------------- | ------------------------- | -------------------------------------------------------------------------------------------- |
| Production        | `pnpm build` / `pnpm zip` | `.output\chrome-mv3`; release build                                                          |
| Deterministic E2E | `pnpm test:e2e`           | `.output\chrome-mv3-e2e-test`; controlled state and request routing                          |
| Live E2E          | `pnpm test:live`          | `.output\chrome-mv3-live-test`; real sites, test state setup, and production redirect checks |

Use the production build for everyday use. The deterministic and live builds support their test suites. E2E coverage runs use the deterministic build.

Extension tests run in a persistent Chromium profile managed by Playwright. The default channel is `chromium-tip-of-tree`. Tako requires Chrome/Chromium 150 or newer, and CI uses Chromium 151 canary. Install the test browser before running E2E tests:

```powershell
pnpm exec playwright install chromium-tip-of-tree
pnpm test:e2e
```

Use the repository’s tested browser channel for extension checks. [Playwright's extension guidance](https://playwright.dev/docs/chrome-extensions) recommends bundled Chromium for command-line extension loading; Chrome and Edge have removed those loading flags.

### E2E diagnostics

For a failure that spans browser pages or workers, enable diagnostics and run the smallest spec that reproduces it:

```powershell
pnpm test:e2e:diag -- tests/e2e/mangadex-sidepanel-navigation.spec.ts
```

Diagnostics combine page console messages and uncaught errors, worker logs, integration requests and responses, failed requests, and local mock-server traffic. This includes the MV3 service worker. Successful extension asset requests are omitted. Routing and test behavior stay the same. For other Playwright configurations, including live tests, set `TMD_TEST_E2E_DIAG=true`.

Diagnostics retain technical identifiers and provider URL origins and paths. They inspect extension console arguments and redact credential fields, supported credential and header text, URL parameters, bodies, and local paths. Provider console and page-error payloads are omitted. Review artifacts for free text and browsing context before sharing them. Live tests use redacted diagnostics with automatic network tracing turned off.

Run focused checks as you work, then run the broader suite:

```powershell
pnpm lint
pnpm check:architecture
pnpm type-check
pnpm format:check
pnpm test:unit
pnpm test:integration
pnpm test:e2e
```

## Code style

- Use TypeScript strict mode and follow the surrounding code’s conventions.
- Initialize asynchronous Chrome API work in the entrypoint.
- Register event listeners synchronously before starting asynchronous setup.
- Keep background and offscreen site runtimes in separate files and use the registries under `src/runtime/generated/`. Resolve page context from URLs, provider APIs, or fetched HTML. Use the bundled one-shot probe for data that requires live page state.
- To scaffold a new site integration, run `pnpm new:site-integration <id>` and follow the [Site Integration Guide](https://github.com/oovz/Tako/wiki/Site-Integration-Guide).
- Pass integration-specific data through the generic `integrationContext` field.
- Return a schema-valid response or Promise from typed message handlers. The dispatcher validates the target, request, principal, and readiness. `createRuntimeMessageListener()` calls `sendResponse` and returns `true` while the response is pending.

## Testing

- **Unit tests** (`tests/unit/`) cover pure logic, message contracts, and component behavior.
- **Integration tests** run in Node with mocked Chrome APIs and check how modules work across extension contexts.
- **E2E tests** (`tests/e2e/`) use Playwright against the built extension with mocked routes.
- **Live tests** (`tests/live/`) validate real-site behavior.

Captured pages, protocol samples, and controlled image inputs live in `tests/fixtures/site-integrations/<id>/`. Fixture READMEs document their sources and synthetic inputs. The wiki covers site usage and integration development.

Use existing tests when they cover the changed behavior. Add focused cases for new behavior and distinct failures. Site integrations need unit tests, plus mocked E2E tests for behavior visible in the UI.

### Recovery and output validation

Run `pnpm test:coverage` for the full unit and integration suite with coverage thresholds. Integration tests combine real domain transitions, repositories, and coordinators with controlled browser, storage, network, and worker interfaces:

| Behavior                                                                                | Integration coverage                                                         |
| --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Empty pages, archive completeness, producer cancellation and subsequent work            | `chapter-output-completeness.spec.ts`                                        |
| Final native saves, folder writes, task removal and chapter-history retention           | `output-destination-settlement.spec.ts`, `chapter-history-retention.spec.ts` |
| Interrupted handoffs, preparation failures, cold recovery and subsequent queue progress | `native-output-cold-start.spec.ts`                                           |
| Retained Blob ownership, aggregate byte/count admission and release                     | `native-output-continuation.spec.ts`                                         |
| Folder defaults, capability retention and intentional history clearing                  | `options-destination-save.spec.ts`                                           |
| Captured destinations, requested paths, default edits and fresh retries                 | `task-created-destinations.spec.ts`, `destination-recovery.spec.ts`          |
| Supported profile upgrades, historical outcomes and final-save evidence                 | `stored-profile-migration.spec.ts`, `native-save-migration.spec.ts`          |
| Concurrent first-use scheduling, retry and policy invalidation                          | `rate-limit-scheduling.spec.ts`                                              |

Run `pnpm test:e2e --workers=1` to test the built extension against deterministic fixtures. The browser suite checks Blob access during Chrome transfers, saved file bytes, download completion and cleanup, folder saves when Options closes, fallback output, retries after unconfirmed saves, and queue/history recovery in the UI. Integration tests cover shared resource limits across retained outputs. Measure peak memory when testing large jobs.

Browser tests use disposable profiles and require access to your system’s browser services. Deterministic tests use controlled routes; live tests run when you request them. When reporting a run, include its command and result, any failures, and the results of focused reruns.

Before a release, run `pnpm lint`, `pnpm type-check`, `pnpm format:check`, and `pnpm build`. Lint also checks generated integration data and module boundaries. Inspect `.output/chrome-mv3/manifest.json`, the extension entrypoints, packaged locales, and permissions. Check that state-seeding handlers are confined to test builds. Use the production output for release packaging.

### Live chapter validation

Each shipped integration has a live test that downloads one chapter from a work listed in `tests/e2e/fixtures/test-domains-constants.ts`. To check a site, run its project:

```powershell
pnpm exec playwright test --config=playwright.live.config.ts --project=shonenjumpplus download-workflow.spec.ts
```

The tests wait for save confirmation, check Chrome’s download result, and open the saved CBZ. The MangaDex custom-folder case reads its saved OPFS file. Each test includes ComicInfo, uses chapter images with three-digit filenames, and checks the image count and sequence. Chromium decodes every image. The XML checks compare series details, credits, synopsis, genres, language, and available chapter and volume fields with the metadata captured for the task. The checker uses the installed [fflate ZIP reader](https://github.com/101arrowz/fflate) and the browser's [image decoder](https://developer.mozilla.org/en-US/docs/Web/API/Window/createImageBitmap). Covers are turned off for these checks.

Metadata checks compare extracted fields with the work page before downloading and attach the page synopsis and Open Graph description for review. Choose a work-specific synopsis from Open Graph metadata or the page’s full description, including hidden continuations. Deterministic tests also check CopyManga and MYCOMIC’s chapter, volume, and extra groups, including disabled empty groups. Set volume numbers from explicit single-volume labels.

Test attachments include the saved CBZ and ComicInfo XML. A successful check adds a JSON report with the run date, Tako and browser versions, work and chapter, verified metadata, and image dimensions, along with previews of the first three pages. Compare the saved pages with the site’s reader when checking these image transformations:

| Integration                   | Visual check                                                              |
| ----------------------------- | ------------------------------------------------------------------------- |
| pixiv Comic (pixivコミック)   | Keyed grid reconstruction preserves panel and text order.                 |
| Shonen Jump+ (少年ジャンプ＋) | The 4×4 tile reconstruction produces continuous panels and text.          |
| Comic Nettai (COMIC熱帯)      | PUBLUS reconstruction preserves page edges, panel order and orientation.  |
| MANGA MILLION                 | Decryption and any AVIF-to-JPEG conversion preserve visible page content. |

Image decoding checks readability. Visual comparison checks page layout. When reporting a live run, include the command, result, work and chapter, version, and date. Report deterministic checks, real-site downloads, and visual review separately.

The archive checker has deterministic cases for valid output, missing pages, numbering errors, empty images, malformed archives, and corrupt images:

```powershell
pnpm exec vitest run tests/unit/e2e/chapter-artifact.spec.ts
pnpm exec playwright test tests/e2e/chapter-artifact.spec.ts tests/e2e/shonenjumpplus-download-workflow.spec.ts
```

## Pull requests

1. Open an issue first for large changes.
2. Branch from `main`.
3. Update relevant docs in the same PR.
4. Ensure `pnpm lint` and `pnpm type-check` pass.
5. Group commits by purpose and keep each diff focused.

## Documentation

Update the relevant wiki page in the same pull request when you change behavior, the contributor workflow, or submission assets.

- [Architecture](https://github.com/oovz/Tako/wiki/Architecture) — Core runtime, storage, messaging, and state flow
- [Site Integration Guide](https://github.com/oovz/Tako/wiki/Site-Integration-Guide) — Adding or maintaining supported-site integrations
- [Template Macros](https://github.com/oovz/Tako/wiki/Template-Macros) — Filename and path-template macro reference
