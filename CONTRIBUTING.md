# Contributing to Tako

Thanks for considering a contribution.

## Quick setup

```powershell
pnpm install
pnpm build
```

The extension loads from `.output\chrome-mv3`. Open `chrome://extensions`, enable **Developer mode**, and choose **Load unpacked**.

## Development workflow

```powershell
pnpm dev          # WXT dev server
pnpm test:unit    # Fast feedback loop
pnpm test:e2e     # Deterministic extension behavior
pnpm test:live    # Real-site validation (requires supported sites to be accessible)
```

Run the targeted command first when iterating, then the broader suite before finishing:

```powershell
pnpm lint
pnpm type-check
pnpm test:unit
pnpm test:integration
pnpm test:e2e
```

## Code style

- TypeScript strict mode. Follow existing patterns in the area you are changing.
- Do not call `chrome.*` APIs at module scope in entrypoint files; put them inside `main()`.
- Register event listeners synchronously inside `main()`.
- Keep content, background, and offscreen site runtime files separate. Use the generated registries under `src/runtime/generated/`.
- Pass integration-specific data through the generic `integrationContext` field; do not add site-named shared message fields.
- All async message handlers must return `true` and resolve `sendResponse` with `{ success: boolean, ... }`. Never leave callers hanging.

## Testing

- **Unit tests** (`tests/unit/`) cover pure logic, message contracts, and component behavior.
- **Integration tests** run in Node environment with mocked Chrome APIs for cross-context module wiring.
- **E2E tests** (`tests/e2e/`) use Playwright against the built extension with mocked routes.
- **Live tests** (`tests/live/`) validate real-site behavior.

New features should include tests. Site integrations require unit coverage and, when UI-visible, mocked E2E coverage.

## Pull requests

1. Open an issue first for large changes.
2. Branch from `main`.
3. Update relevant docs in the same PR.
4. Ensure `pnpm lint` and `pnpm type-check` pass.
5. Keep commits focused and the diff minimal.

## Documentation

If you change behavior, contributor workflow, or submission assets, update the relevant wiki page in the same pull request.

- [Architecture](https://github.com/oovz/Tako/wiki/Architecture) — core runtime, storage, messaging, and state flow
- [Site Integration Guide](https://github.com/oovz/Tako/wiki/Site-Integration-Guide) — adding or maintaining supported-site integrations
- [Template Macros](https://github.com/oovz/Tako/wiki/Template-Macros) — filename and path-template macro reference
