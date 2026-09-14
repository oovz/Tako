<div align="center">

<img src="public/icon/128.png" alt="Tako" width="128" />

# Tako Manga Downloader

**Batch-download manga chapters from Chrome's Side Panel. Queue, retry, and export CBZ or ZIP files without leaving your reading tab.**

[![Chrome Web Store](https://developer.chrome.com/static/docs/webstore/branding/image/tbyBjqi7Zu733AAKA5n4.png)](https://chromewebstore.google.com/detail/tako-manga-downloader/hlodmckfkmbenkknmailfekehgajpmbb)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Chrome MV3](https://img.shields.io/badge/Chrome-MV3-4285F4?logo=googlechrome&logoColor=white)](https://developer.chrome.com/docs/extensions/mv3/intro/)

[Get Started](#get-started) · [Features](#features) · [Supported Sites](#supported-sites) · [Wiki](https://github.com/oovz/Tako/wiki) · [Privacy](#privacy)

[English](README.md) · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md) · [日本語](README.ja.md)

</div>

---

## Features

- **Side Panel controls** — Select chapters, watch queue status, and track download progress in Chrome's Side Panel. Use the Options page for full history and settings.
- **Queue and retries** — Queue chapters, track image progress, and retry failed downloads automatically or from the queue.
- **Export options** — Save chapters as CBZ, ZIP, or loose images. Use Chrome Downloads or choose a local library folder through the File System Access API.
- **ComicInfo.xml metadata** — CBZ exports can include series metadata, chapter numbers, and titles for Komga, Kavita, and other manga readers.
- **Path and filename templates** — Organize downloads with macros such as `<SERIES_TITLE>`, `<CHAPTER_NUMBER>`, and `<VOLUME_NUMBER>`.
- **Site integrations** — Each supported site has a dedicated adapter for its page structure, image delivery, and metadata.
- **Unified settings** — Set global defaults and per-site overrides for formats, path templates, concurrency, and rate limits.
- **Privacy** — Tako runs no developer analytics, tracking, or telemetry. Settings, queue state, and download history stay in your local browser.

## Supported Sites

| Site                                                | Status |
| --------------------------------------------------- | :----: |
| [MangaDex](https://mangadex.org)*                   |   ✅   |
| [Pixiv Comic](https://comic.pixiv.net)              |   ✅   |
| [Shonen Jump+](https://shonenjumpplus.com)          |   ✅   |
| [Manhuagui](https://www.manhuagui.com)              |   ✅   |
| [Comic Nettai](https://www.comicnettai.com)         |   ✅   |
| [MangaMillion](https://mangamillion.shueisha.co.jp) |   ✅   |

- MangaDex is disabled by default and requests optional HTTPS access when you enable it in Options.

To request another site, [open a feature request](https://github.com/oovz/Tako/issues/new?template=feature_request.md) or contribute an integration using the [Site Integration Guide](https://github.com/oovz/Tako/wiki/Site-Integration-Guide).

## Rights & Site Access

Tako downloads manga and comic pages that your browser session is authorized to access, without bypassing paywalls, login restrictions, DRM, or copyright controls.

## Get Started

1. Install Tako from the [Chrome Web Store](https://chromewebstore.google.com/detail/tako-manga-downloader/hlodmckfkmbenkknmailfekehgajpmbb).
2. Navigate to a supported manga series or chapter page.
3. Click the Tako extension icon to open the Side Panel.
4. Select the chapters you want and click **Download**.

For detailed steps, check the [Quick Start Guide](https://github.com/oovz/Tako/wiki/Quick-Start).

<details>
<summary><b>Install from Source</b></summary>

### From GitHub Releases

1. Go to the repository **Releases** page and download the latest `tako-manga-downloader-vX.Y.Z-chrome.zip`.
2. Extract the archive to a local folder.
3. Open `chrome://extensions` in Chrome.
4. Enable **Developer mode** in the top right.
5. Click **Load unpacked** and select the extracted folder.

### Local Build

Tako targets Chrome 150 or newer. Building locally requires Node.js 22.13+ or Node.js 24+ and pnpm 10.32.1.

```powershell
pnpm install
pnpm build
```

Then open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and select `.output\chrome-mv3`.

</details>

<details>
<summary><b>Development</b></summary>

```powershell
pnpm dev # WXT development server (hot reload)
pnpm test:unit # Unit tests (Vitest)
pnpm test:e2e # E2E tests (Playwright)
pnpm lint # ESLint & architecture checks
pnpm type-check # TypeScript strict checks
```

For the complete development workflow, code conventions, and pull request guidelines, see [`CONTRIBUTING.md`](CONTRIBUTING.md).

</details>

## Documentation

| Wiki Page                                                                          | Description                                      |
| ---------------------------------------------------------------------------------- | ------------------------------------------------ |
| [Quick Start](https://github.com/oovz/Tako/wiki/Quick-Start)                       | Installation and first download guide            |
| [Supported Sites](https://github.com/oovz/Tako/wiki/Supported-Sites)               | Current site integrations and status             |
| [Comparisons](https://github.com/oovz/Tako/wiki/Comparisons)                       | How Tako compares to other downloaders           |
| [Template Macros](https://github.com/oovz/Tako/wiki/Template-Macros)               | Path and filename template macro reference       |
| [Architecture](https://github.com/oovz/Tako/wiki/Architecture)                     | Core runtime, storage, messaging, and state flow |
| [Permissions](https://github.com/oovz/Tako/wiki/Permissions)                       | Explanations for each requested permission       |
| [Site Integration Guide](https://github.com/oovz/Tako/wiki/Site-Integration-Guide) | Creating and maintaining site integrations       |

## Privacy

Tako stores settings, queue state, and download history locally in your browser. Network requests are made directly to supported sites and the infrastructure needed to perform downloads. There are no developer-operated analytics or telemetry services.
When MangaDex is enabled, required MangaDex@Home delivery reports are sent directly to MangaDex.

For the full privacy policy, see [`PRIVACY.md`](PRIVACY.md).

## Contributing

To contribute, read the [`Contributing Guidelines`](CONTRIBUTING.md) before submitting a pull request.

## License

MIT — see [`LICENSE`](LICENSE) for details.
