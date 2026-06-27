<div align="center">

<img src="public/icon/128.png" alt="Tako" width="128" />

# Tako Manga Downloader

**Batch-download manga chapters from Chrome's Side Panel. Queue, retry, and export clean CBZ/ZIP files — without leaving your reading tab.**

[![Chrome Web Store](https://developer.chrome.com/static/docs/webstore/branding/image/tbyBjqi7Zu733AAKA5n4.png)](https://chromewebstore.google.com/detail/tako-manga-downloader/hlodmckfkmbenkknmailfekehgajpmbb)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Chrome MV3](https://img.shields.io/badge/Chrome-MV3-4285F4?logo=googlechrome&logoColor=white)](https://developer.chrome.com/docs/extensions/mv3/intro/)

[Install](#get-started) · [Features](#features) · [Supported Sites](#supported-sites) · [Wiki](https://github.com/oovz/Tako/wiki) · [Privacy](#privacy)

</div>

---

## Features

- **Side Panel command center** — Chapter selection, queue, and progress live in Chrome's Side Panel, right next to the page you're reading. No extra tabs, no save-dialog spam.
- **Real queue with retry** — Queue dozens of chapters, watch per-image progress, and retry failed downloads automatically or manually. One active task at a time keeps things stable.
- **Clean exports** — Save as CBZ, ZIP, or loose image folders. Custom path and filename templates work with Komga, Kavita, Calibre, and other library tools.
- **Optimized site integrations** — Each supported site gets purpose-built handling for its page structure, image CDN, and metadata — not generic scraping.
- **One settings page** — Global defaults and per-site overrides for output format, templates, rate limits, and retries all live in the Options page.
- **File System Access support** — Pick a custom download folder and Tako writes directly there. Falls back to Chrome's download shelf if needed.
- **ComicInfo.xml generation** — Embeds series metadata, chapter numbers, authors, and more in CBZ archives for library manager compatibility.
- **Privacy-first** — No analytics, no telemetry, no data collection. Everything stays local in your browser.

## Supported Sites

| Site | Status |
|---|:---:|
| [MangaDex](https://mangadex.org) | ✅ |
| [Pixiv Comic](https://comic.pixiv.net) | ✅ |
| [Shonen Jump+](https://shonenjumpplus.com) | ✅ |
| [Manhuagui](https://www.manhuagui.com) | ✅ |
| [Comic Nettai](https://comic-nettai.com) | ✅ |

Want a new site? [Open a request](https://github.com/oovz/Tako/issues/new?template=feature_request.md) or contribute an integration — see the [Site Integration Guide](https://github.com/oovz/Tako/wiki/Site-Integration-Guide).

## Rights and Site Access

Tako is intended for pages you can already access in your own browser session on supported sites.

- It is **not** a tool for bypassing paywalls, login restrictions, DRM, or copyright controls.
- It does **not** grant access rights you do not already have.

## Get Started

1. Install from the [Chrome Web Store](https://chromewebstore.google.com/detail/tako-manga-downloader/hlodmckfkmbenkknmailfekehgajpmbb).
2. Open a supported series page.
3. Click the Tako icon to open the Side Panel.
4. Select chapters, click **Download**, and watch the queue.

For a detailed walkthrough, see the [Quick Start wiki page](https://github.com/oovz/Tako/wiki/Quick-Start).

<details>
<summary><b>Install from source</b></summary>

### From GitHub Releases

1. Go to the repository **Releases** page and download the latest `tako-manga-downloader-vX.Y.Z-chrome.zip`.
2. Extract the zip to a folder on your machine.
3. Open `chrome://extensions`.
4. Enable **Developer mode**.
5. Choose **Load unpacked** and select the extracted folder.

### Build locally

```powershell
pnpm install
pnpm build
```

Then open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select `.output\chrome-mv3`.

</details>

<details>
<summary><b>Development</b></summary>

```powershell
pnpm dev          # WXT dev server with hot reload
pnpm test:unit    # Fast unit tests (Vitest)
pnpm test:e2e     # E2E tests with mocked routes (Playwright)
pnpm lint         # ESLint
pnpm type-check   # TypeScript strict mode
```

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the full development workflow, code style rules, and PR guidelines.

</details>

## Documentation

| Wiki Page | Description |
|---|---|
| [Quick Start](https://github.com/oovz/Tako/wiki/Quick-Start) | Installation and first download walkthrough |
| [Supported Sites](https://github.com/oovz/Tako/wiki/Supported-Sites) | Current site integrations and status |
| [Comparisons](https://github.com/oovz/Tako/wiki/Comparisons) | How Tako compares to other manga downloaders |
| [Template Macros](https://github.com/oovz/Tako/wiki/Template-Macros) | Filename and path-template macro reference |
| [Architecture](https://github.com/oovz/Tako/wiki/Architecture) | Core runtime, storage, messaging, and state flow |
| [Site Integration Guide](https://github.com/oovz/Tako/wiki/Site-Integration-Guide) | Adding or maintaining supported-site integrations |

## Privacy

Tako stores settings, queue state, and history locally in the browser. Network requests go directly to supported sites and related infrastructure needed for your download workflow. No analytics backend, no telemetry, no data collection.

See [`PRIVACY.md`](PRIVACY.md) for the full privacy policy.

## Contributing

Contributions are welcome. Please read the [`contributing guidelines`](CONTRIBUTING.md) before submitting a pull request.

## License

MIT — see [`LICENSE`](LICENSE) for details.
