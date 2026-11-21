# Contributing to Tako

You can help Tako by fixing a download problem, adding support for a site, or improving a guide or translation. For a bug or site request, start with the [issue forms](https://github.com/oovz/Tako/issues/new/choose).

## Quick setup

Clone the repository and run these commands from its root. Use the Node.js version in [`.node-version`](.node-version) and the pnpm version in [`package.json`](package.json).

```sh
pnpm install --frozen-lockfile
```

### Load Tako in Chrome

Use Chrome 150 or later.

```sh
pnpm build
```

In Chrome, open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and select `.output/chrome-mv3`. Pin Tako and click its icon on a [supported page](https://github.com/oovz/Tako/wiki/Supported-Sites) to open the side panel.

### Load Tako in Firefox for testing

Use the stable release of desktop Firefox in a regular window with the default container.

```sh
pnpm zip:firefox
```

1. In Firefox, open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on** and select the `tako-manga-downloader-<version>-firefox.zip` file in `.output`.
3. Open a [supported series](https://github.com/oovz/Tako/wiki/Supported-Sites), then click Tako in the Extensions menu to open the sidebar. Pin Tako to the toolbar for direct access.

The temporary installation lasts until you remove Tako or restart Firefox. The planned public installation path is a signed [Firefox Add-ons listing](https://addons.mozilla.org/firefox/). See [temporary installation in Firefox](https://extensionworkshop.com/documentation/develop/temporary-installation-in-firefox/).

### Find files saved by Firefox

Tako saves CBZ archives by default. In **Tako Options → Storage & Files**, choose CBZ, ZIP, or individual images and preview your subfolder and filename templates. Firefox stores the results under the folder shown in **Save files to** in Firefox Settings. For example, the default subfolder template places a chapter archive in `TMD/<series title>` inside that folder. [Find or change your Firefox download folder](https://support.mozilla.org/en-US/kb/where-find-and-manage-downloaded-files-firefox).

You can close the sidebar while a chapter downloads. A chapter appears as **Saved** only after Firefox confirms all its files. If Tako reports that a save could not be confirmed, check your downloads folder before retrying to avoid duplicates.

## Development workflow

Run `pnpm dev` to start the development build. Use `pnpm build` for a production build or `pnpm zip` to create a release archive.

For a code change, run these checks before opening a pull request:

```sh
pnpm lint
pnpm type-check
pnpm format:check
pnpm test:unit
pnpm test:integration
pnpm build
```

Lint includes generated site-integration and module-boundary checks. Run the relevant browser tests for changes to downloads, settings, site integrations, or other visible behavior. For a prose or translation change, check formatting and follow any links or steps you changed.

## Code style

Use TypeScript strict mode, follow the surrounding code, and keep changes focused. Add a regression test when fixing a bug. Name tests after the behavior they verify.

To add a site, run `pnpm new:site-integration <id>` and follow the [Site Integration Guide](https://github.com/oovz/Tako/wiki/Site-Integration-Guide). [Architecture](https://github.com/oovz/Tako/wiki/Architecture) provides a source map.

## Testing

| Suite        | Command                 | What it checks                                                                |
| ------------ | ----------------------- | ----------------------------------------------------------------------------- |
| Unit         | `pnpm test:unit`        | Individual functions and components                                           |
| Integration  | `pnpm test:integration` | Modules working together with controlled browser and network interfaces       |
| Chromium E2E | `pnpm test:e2e`         | The built extension in Chromium using local site fixtures                     |
| Firefox E2E  | `pnpm test:firefox`     | The packaged extension in desktop Firefox using local site fixtures           |
| Live E2E     | `pnpm test:live`        | The built extension against real sites; run for an intentional provider check |

Run `pnpm test:coverage` to measure unit and integration coverage with Vitest V8. The command checks the coverage thresholds, prints a summary, and writes `coverage/index.html`, `coverage/lcov.info`, and `coverage/coverage-final.json`.

Keep tests for distinct behavior and failures. Captured HTML, protocol samples and image inputs belong in `tests/fixtures/site-integrations/<id>/`, with their sources documented beside them.

Chromium tests run headlessly with disposable profiles. The host-access check loads the production build and uses OpenSSL to serve local HTTPS fixtures on the original provider hostnames. Install Chromium and ensure `openssl` is on your `PATH` before running the suite.

```sh
pnpm exec playwright install --no-shell chromium
pnpm test:e2e
```

Use `pnpm test:e2e:headed` to run the same tests with a visible browser.

For Firefox tests, install stable desktop Firefox and put `geckodriver` and `openssl` on your `PATH`. Run `pnpm test:firefox` to build and test the package in a disposable Firefox profile. Set `FIREFOX_BIN` or `GECKODRIVER` to use a particular binary. [Download geckodriver](https://github.com/mozilla/geckodriver/releases).

### E2E diagnostics

Start with the Playwright console, page errors, and network events when debugging a running extension. Run a failing spec with diagnostics to collect those events and save retained extension history:

```sh
pnpm test:e2e:diag tests/e2e/mangadex-sidepanel-navigation.spec.ts
```

For live tests, set `TMD_TEST_E2E_DIAG=true`. On failures and diagnostic runs, the fixture attempts to save `retained-diagnostics.json` before closing the browser profile when it knows the extension ID. The report requires access to the profile’s diagnostic store.

Playwright console-message tools show live console output. To inspect earlier entries, use the fixture's existing `context` and `extensionId` with the retained report helper:

```ts
import { readRetainedDiagnostics } from "./fixtures/retained-diagnostics"

const report = await readRetainedDiagnostics(context, extensionId)
```

The helper opens Options → Diagnostics in the running profile and returns its exported JSON, bounded by the local retention limit. Pass a third argument, such as `testInfo.outputPath("diagnostics.json")`, to save the file before profile cleanup. When using an interactive Playwright session, open `chrome-extension://<extension-id>/options.html?tab=diagnostics` in that same browser context and choose **Export JSON**. This can retrieve committed entries after a producer closes or when background initialization fails. Review logs and attachments for titles, URL paths, and free text before sharing.

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

Edit reader and developer guides in [`wiki/`](wiki/), then send those changes in a pull request. The wiki publishes from `main`. Keep the five language versions aligned and use the labels readers see in the extension. When you change a screenshot or store description, update the corresponding locale in the [store assets](assets/store/).
