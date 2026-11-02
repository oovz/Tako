# Contributing to Tako

Set up Tako locally, test your changes, and open a pull request.

## Quick setup

Use the Node.js version selected by `.node-version` and the pnpm version listed in `package.json`. Other supported Node.js versions are listed in `package.json` under `engines`.

```sh
pnpm install --frozen-lockfile
pnpm build
```

Open `chrome://extensions`, enable **Developer mode**, and choose **Load unpacked**. Select `.output/chrome-mv3`. Tako requires Chrome 150 or newer.

## Development workflow

Run `pnpm dev` to start the development build. Use `pnpm build` for a production build or `pnpm zip` to create a release archive.

Before opening a pull request, run:

```sh
pnpm lint
pnpm type-check
pnpm format:check
pnpm test:unit
pnpm test:integration
pnpm build
```

Lint includes generated site-integration and module-boundary checks. Run the relevant browser tests for changes to downloads, settings, site integrations, or other visible behavior.

## Code style

Use TypeScript strict mode, follow the surrounding code, and keep changes focused. Add a regression test when fixing a bug. Name tests after the behavior they verify.

To add a site, run `pnpm new:site-integration <id>` and follow the [Site Integration Guide](https://github.com/oovz/Tako/wiki/Site-Integration-Guide). [Architecture](https://github.com/oovz/Tako/wiki/Architecture) provides a source map.

## Testing

| Suite       | Command                 | What it checks                                                            |
| ----------- | ----------------------- | ------------------------------------------------------------------------- |
| Unit        | `pnpm test:unit`        | Individual functions and components                                       |
| Integration | `pnpm test:integration` | Modules working together with controlled browser and network interfaces   |
| E2E         | `pnpm test:e2e`         | The built extension in Chromium using local site fixtures                 |
| Live E2E    | `pnpm test:live`        | The built extension against real sites; run when site access is available |

Use `pnpm test:coverage` for unit and integration coverage. Use `pnpm coverage:all` to collect compatible native and browser profiles and generate the combined report. Keep tests for distinct behavior and failures. Captured HTML, protocol samples and image inputs belong in `tests/fixtures/site-integrations/<id>/`, with their sources documented beside them.

Browser tests run headlessly in bundled Chromium, create disposable profiles, and build their own test extension. Install Chromium before running them:

```sh
pnpm exec playwright install --no-shell chromium
pnpm test:e2e
```

Use `pnpm test:e2e:headed` to run the same tests with a visible browser.

### E2E diagnostics

Run a failing spec with diagnostics to collect browser and extension logs:

```sh
pnpm test:e2e:diag -- tests/e2e/mangadex-sidepanel-navigation.spec.ts
```

For live tests, set `TMD_TEST_E2E_DIAG=true`. Diagnostics redact sensitive fields, but can still contain browsing context and free text. Review logs and attachments before sharing them.

### Live chapter validation

To check one site, select its Playwright project:

```sh
pnpm exec playwright test --config=playwright.live.config.ts --project=shonenjumpplus download-workflow.spec.ts
```

Live checks download a chapter and verify the saved archive, metadata and images. Compare transformed pages with the site's reader to check panel and text order. Include the command, result, site and chapter in your pull request, and note whether you inspected the pages visually.

## Pull requests

1. Open an issue first for large changes.
2. Branch from `main` and keep each change focused.
3. Update the relevant documentation and tests.
4. Describe the behavior you changed and the checks you ran.
5. Use concise [Conventional Commit](https://www.conventionalcommits.org/en/v1.0.0/) messages.

## Documentation

Reader and contributor guides live in the [wiki](https://github.com/oovz/Tako/wiki). Update the corresponding files in `wiki/` when behavior changes, keeping translated pages aligned. Keep product instructions direct and focused on what readers need to do.
