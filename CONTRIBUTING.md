# Contributing to Tako

This guide covers local setup, development, testing, and pull requests.

## Quick setup

```powershell
pnpm install
pnpm build
```

The extension loads from `.output\chrome-mv3`. Open `chrome://extensions`, enable **Developer mode**, and choose **Load unpacked**.

## Development workflow

```powershell
pnpm dev # WXT dev server
pnpm test:unit # Fast feedback loop
pnpm test:e2e # Deterministic extension behavior
pnpm test:live # Real-site validation (requires supported sites to be accessible)
```

Use one of three build modes:

| Mode              | Command                   | Artifact and policy                                                                                                |
| ----------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Production        | `pnpm build` / `pnpm zip` | `.output\chrome-mv3`; release build                                                                                |
| Deterministic E2E | `pnpm test:e2e`           | `.output\chrome-mv3-e2e-test`; local mock state/redirect support only                                              |
| Live E2E          | `pnpm test:live`          | `.output\chrome-mv3-live-test`; live state seeding is enabled, while production redirect rejection remains enabled |

Load the production artifact for everyday use. Deterministic and live artifacts are for their respective test suites; coverage instrumentation runs in deterministic E2E builds.

Extension tests use a persistent Playwright-managed Chromium context, with `chromium-tip-of-tree` as the default channel. Tako requires Chrome/Chromium 150 or newer; CI uses the compatible Chromium 151 canary. Install the fixture's browser before running E2E tests:

```powershell
pnpm exec playwright install chromium-tip-of-tree
pnpm test:e2e
```

[Playwright's extension guidance](https://playwright.dev/docs/chrome-extensions) recommends its bundled Chromium because Chrome and Edge removed the command-line extension side-loading flags. Keep the repository's tested channel for extension validation.

### E2E diagnostics

When a mocked or live E2E failure involves more than one browser context, enable diagnostics before running the smallest reproducing spec:

```powershell
pnpm test:e2e:diag -- tests/e2e/mangadex-sidepanel-navigation.spec.ts
```

The diagnostic stream correlates console messages and uncaught errors from browser pages, worker console messages (including the MV3 service worker), integration requests and responses, failed requests, and requests received by the local mock server. It omits successful extension asset requests. Enable diagnostics for a reproducing run; routing and test behavior stay the same. Set `TMD_TEST_E2E_DIAG=true` when using another Playwright configuration, such as the live-test configuration.

Diagnostics retain technical identifiers and provider URL origins and paths. Extension console arguments are inspected structurally before redaction; provider console and page-error payloads are omitted. Credential fields, supported credential and header text, URL parameters, bodies, and local paths are redacted. Review failure artifacts before sharing, including free text and browsing context. Live-site runs leave automatic network tracing disabled.

Run targeted checks while iterating, then run the broader suite before finishing:

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

- TypeScript strict mode. Follow existing patterns in the area you are changing.
- Put asynchronous Chrome API work in the entrypoint initialization path.
- Register event listeners synchronously during entrypoint initialization, before asynchronous setup.
- Keep background and offscreen site runtime files separate. Use the generated registries under `src/runtime/generated/`. Resolve page context from URLs, provider APIs, or fetched HTML first; use the bundled one-shot page probe only when an integration requires live page state.
- To scaffold a new site integration, run `pnpm new:site-integration <id>` and follow the [Site Integration Guide](https://github.com/oovz/Tako/wiki/Site-Integration-Guide).
- Pass integration-specific data through the generic `integrationContext` field.
- Typed message handlers return a schema-valid response or a Promise. The dispatcher owns target, request, principal and readiness validation. `createRuntimeMessageListener()` owns the Chrome callback bridge: it calls `sendResponse` and returns `true` while the response is pending.

## Testing

- **Unit tests** (`tests/unit/`) cover pure logic, message contracts, and component behavior.
- **Integration tests** run in Node environment with mocked Chrome APIs for cross-context module wiring.
- **E2E tests** (`tests/e2e/`) use Playwright against the built extension with mocked routes.
- **Live tests** (`tests/live/`) validate real-site behavior.

Site-specific captured pages, protocol vectors, and controlled image inputs live in `tests/fixtures/site-integrations/<id>/`. Optional integration READMEs explain protocol and implementation details for contributors; reader instructions live in the wiki.

Use existing coverage where it establishes the changed behavior. Add focused tests for distinct new behavior or failure cases. Site integrations require unit coverage and, when UI-visible, mocked E2E coverage.

### Recovery and output validation

Run `pnpm test:coverage` for the complete unit/integration suite and its coverage thresholds. The composed integration tests use real domain transitions, repositories, and coordinators with controlled browser, storage, network, and worker boundaries:

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

Run `pnpm test:e2e --workers=1` for deterministic workflows against the isolated built extension. The browser suite verifies Blob readability while Chrome holds an accepted transfer, actual saved bytes, terminal consumption and erasure, Options closure on both sides of a folder-save commit, opted-in fallback output, manual retry after an unconfirmed save, and rendered queue/history recovery. These packaged-browser observations establish the platform release boundary; the composed tests establish aggregate admission across retained outputs. Measure peak memory separately when validating large jobs.

Record every command and terminal result, including parallel-run failures and focused reruns. Record an earlier suite failure alongside any passing focused rerun. Browser startup requires access to the host's browser services. The fixture uses disposable profiles and deterministic routes; keep live-provider validation opt-in.

For release validation, also run `pnpm lint`, `pnpm type-check`, `pnpm format:check`, and `pnpm build`. Lint checks generated integration data and architecture boundaries. Inspect `.output/chrome-mv3/manifest.json`, the canonical entrypoints, packaged locales, permissions and the absence of test-seeding handlers. Keep the production artifact separate from the deterministic test artifact.

### Live chapter validation

Live-provider runs are opt-in. Each shipped integration has a single-chapter download test using a real work URL owned by `tests/e2e/fixtures/test-domains-constants.ts`. Run one integration explicitly, for example:

```powershell
pnpm exec playwright test --config=playwright.live.config.ts --project=shonenjumpplus download-workflow.spec.ts
```

These tests wait for Tako’s confirmed save result, query the native download result and read the saved CBZ. The MangaDex custom-folder test reads its saved OPFS artifact. Tests disable covers and ComicInfo, use three-digit page names, check the image sequence against the resolved chapter page count, and decode every page with Chromium. The checker uses the installed [fflate ZIP reader](https://github.com/101arrowz/fflate) and the browser's [image decoder](https://developer.mozilla.org/en-US/docs/Web/API/Window/createImageBitmap).

Each inspection retains the full saved CBZ as a test attachment. Successful inspection also attaches a JSON receipt with the run date, Tako/browser versions, work and selected chapter, and decoded page dimensions, plus previews of the first three pages. Inspect the retained archive against the same chapter in the site's reader before recording visual correctness, especially for these transformations:

| Integration                   | Visual check                                                              |
| ----------------------------- | ------------------------------------------------------------------------- |
| pixiv Comic (pixivコミック)   | Keyed grid reconstruction preserves panel and text order.                 |
| Shonen Jump+ (少年ジャンプ＋) | The 4×4 tile reconstruction produces continuous panels and text.          |
| Comic Nettai (COMIC熱帯)      | PUBLUS reconstruction preserves page edges, panel order and orientation.  |
| MANGA MILLION                 | Decryption and any AVIF-to-JPEG conversion preserve visible page content. |

Decoding establishes image readability; visual comparison establishes page layout. Record the command, terminal result, tested work/chapter, version and date when reporting a live run. Deterministic passes establish harness coverage. Record real-site runs and visual review separately.

The checker itself has deterministic valid, missing-page, numbering, empty-image, malformed-archive and corrupt-image controls:

```powershell
pnpm exec vitest run tests/unit/e2e/chapter-artifact.spec.ts
pnpm exec playwright test tests/e2e/chapter-artifact.spec.ts tests/e2e/shonenjumpplus-download-workflow.spec.ts
```

## Pull requests

1. Open an issue first for large changes.
2. Branch from `main`.
3. Update relevant docs in the same PR.
4. Ensure `pnpm lint` and `pnpm type-check` pass.
5. Keep commits focused and the diff minimal.

## Documentation

If you change behavior, contributor workflow, or submission assets, update the relevant wiki page in the same pull request.

- [Architecture](https://github.com/oovz/Tako/wiki/Architecture) — Core runtime, storage, messaging, and state flow
- [Site Integration Guide](https://github.com/oovz/Tako/wiki/Site-Integration-Guide) — Adding or maintaining supported-site integrations
- [Template Macros](https://github.com/oovz/Tako/wiki/Template-Macros) — Filename and path-template macro reference
