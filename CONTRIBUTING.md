# Contributing to Tako

Thanks for considering a contribution.

## Quick setup

```powershell
pnpm install
pnpm build
```

The extension loads from `.output\chrome-mv3`. Open `chrome://extensions`,
enable **Developer mode**, and choose **Load unpacked**.

## Development workflow

```powershell
pnpm dev          # WXT dev server
pnpm test:unit    # Fast feedback loop
pnpm test:e2e     # Deterministic extension behavior
pnpm test:live    # Real-site validation (requires supported sites to be accessible)
```

Build/test artifacts use three explicit modes:

| Mode              | Command                   | Artifact and policy                                                                                                |
| ----------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Production        | `pnpm build` / `pnpm zip` | `.output\chrome-mv3`; no deterministic state seed, redirect relaxation, or coverage instrumentation                |
| Deterministic E2E | `pnpm test:e2e`           | `.output\chrome-mv3-e2e-test`; local mock state/redirect support only                                              |
| Live E2E          | `pnpm test:live`          | `.output\chrome-mv3-live-test`; live state seeding is enabled, while production redirect rejection remains enabled |

The deterministic and live artifacts must not be loaded as production
extensions. Coverage instrumentation is limited to the deterministic E2E mode.

The architecture is currently maintained as a substantial Phase 2 checkpoint
with partial Phase 3 work. Do not describe Phase 3 as complete until the full
transition-kernel, invariant, property, and differential-test exit gate is met.

The E2E fixture defaults to Playwright's Chromium tip-of-tree channel. To use a
compatible installed channel instead, set `TMD_TEST_E2E_BROWSER_CHANNEL` before
running the tests. For example, an installed Edge channel can be selected with:

```powershell
$env:TMD_TEST_E2E_BROWSER_CHANNEL = "msedge"
pnpm test:e2e
```

### E2E diagnostics

When a mocked or live E2E failure crosses browser contexts, enable the opt-in
diagnostic stream before running the smallest reproducing spec:

```powershell
pnpm test:e2e:diag -- tests/e2e/mangadex-sidepanel-navigation.spec.ts
```

The stream correlates console messages and uncaught errors from browser pages,
worker console messages (including the MV3 service worker), integration requests
and responses, failed requests, and requests received by the local mock server.
Successful extension asset requests are omitted to keep the output focused.
Diagnostics are disabled by default and do not change routing or test behavior.
Set `TMD_TEST_E2E_DIAG=true` directly when using a different Playwright
configuration, such as a live test configuration.

Diagnostic output can include complete visited and requested URLs. Review it
before attaching the output to an issue or sharing it outside the project.

Run the targeted command first when iterating, then the broader suite before
finishing:

```powershell
pnpm lint
pnpm type-check
pnpm format:check
pnpm test:unit
pnpm test:integration
pnpm test:e2e
```

## Code style

- TypeScript strict mode. Follow existing patterns in the area you are changing.
- Do not perform asynchronous Chrome API work at module scope in entrypoint
  files; keep it in the entrypoint initialization path.
- Register event listeners synchronously during entrypoint initialization; do
  not defer registration behind asynchronous setup.
- Keep background and offscreen site runtime files separate. Use the generated
  registries under `src/runtime/generated/`. Resolve page context from URLs,
  provider APIs, or fetched HTML first; use the bundled one-shot page probe only
  when an integration genuinely requires live page state.
- Pass integration-specific data through the generic `integrationContext` field;
  do not add site-named shared message fields.
- All async message handlers must return `true` and resolve `sendResponse` with
  `{ success: boolean, ... }`. Never leave callers hanging.

## Testing

- **Unit tests** (`tests/unit/`) cover pure logic, message contracts, and
  component behavior.
- **Integration tests** run in Node environment with mocked Chrome APIs for
  cross-context module wiring.
- **E2E tests** (`tests/e2e/`) use Playwright against the built extension with
  mocked routes.
- **Live tests** (`tests/live/`) validate real-site behavior.

New features should include tests. Site integrations require unit coverage and,
when UI-visible, mocked E2E coverage.

## Pull requests

1. Open an issue first for large changes.
2. Branch from `main`.
3. Update relevant docs in the same PR.
4. Ensure `pnpm lint` and `pnpm type-check` pass.
5. Keep commits focused and the diff minimal.

## Documentation

If you change behavior, contributor workflow, or submission assets, update the
relevant wiki page in the same pull request.

- [Architecture](https://github.com/oovz/Tako/wiki/Architecture) — core runtime,
  storage, messaging, and state flow
- [Site Integration Guide](https://github.com/oovz/Tako/wiki/Site-Integration-Guide)
  — adding or maintaining supported-site integrations
- [Template Macros](https://github.com/oovz/Tako/wiki/Template-Macros) —
  filename and path-template macro reference
