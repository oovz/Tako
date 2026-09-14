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
| Production        | `pnpm build` / `pnpm zip` | `.output\chrome-mv3`; no deterministic state seed, redirect relaxation, or coverage instrumentation                |
| Deterministic E2E | `pnpm test:e2e`           | `.output\chrome-mv3-e2e-test`; local mock state/redirect support only                                              |
| Live E2E          | `pnpm test:live`          | `.output\chrome-mv3-live-test`; live state seeding is enabled, while production redirect rejection remains enabled |

Do not load deterministic or live artifacts as production extensions. Coverage instrumentation runs only in deterministic E2E builds.

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

The diagnostic stream correlates console messages and uncaught errors from browser pages, worker console messages (including the MV3 service worker), integration requests and responses, failed requests, and requests received by the local mock server. It omits successful extension asset requests. Diagnostics are disabled by default and do not change routing or test behavior. Set `TMD_TEST_E2E_DIAG=true` when using another Playwright configuration, such as the live-test configuration.

Diagnostics retain technical identifiers and provider URL origins and paths. Extension console arguments are inspected structurally before redaction; provider console and page-error payloads are omitted. Credential fields, supported credential and header text, URL parameters, bodies, and local paths are redacted. Review failure artifacts before sharing. Redaction does not make arbitrary free text or browsing context safe to disclose. Automatic live-site network traces remain disabled.

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
- Do not perform asynchronous Chrome API work at module scope in entrypoint files; keep it in the entrypoint initialization path.
- Register event listeners synchronously during entrypoint initialization; do not defer registration behind asynchronous setup.
- Keep background and offscreen site runtime files separate. Use the generated registries under `src/runtime/generated/`. Resolve page context from URLs, provider APIs, or fetched HTML first; use the bundled one-shot page probe only when an integration requires live page state.
- To scaffold a new site integration, run `pnpm new:site-integration <id>` and follow the [Site Integration Guide](https://github.com/oovz/Tako/wiki/Site-Integration-Guide).
- Pass integration-specific data through the generic `integrationContext` field; do not add site-named shared message fields.
- Typed message handlers return a schema-valid response or a Promise. The dispatcher owns target, request, principal and readiness validation. `createRuntimeMessageListener()` owns the Chrome callback bridge: it calls `sendResponse` and returns `true` while the response is pending.

## Testing

- **Unit tests** (`tests/unit/`) cover pure logic, message contracts, and component behavior.
- **Integration tests** run in Node environment with mocked Chrome APIs for cross-context module wiring.
- **E2E tests** (`tests/e2e/`) use Playwright against the built extension with mocked routes.
- **Live tests** (`tests/live/`) validate real-site behavior.

Add tests for new behavior. Site integrations require unit coverage and, when UI-visible, mocked E2E coverage.

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
