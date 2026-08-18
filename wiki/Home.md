# Tako Wiki

> **Batch-download manga chapters from Chrome's Side Panel. Queue, retry, and export clean CBZ or ZIP files — without leaving your reading tab.**

[![Chrome Web Store](https://developer.chrome.com/static/docs/webstore/branding/image/tbyBjqi7Zu733AAKA5n4.png)](https://chromewebstore.google.com/detail/tako-manga-downloader/hlodmckfkmbenkknmailfekehgajpmbb)
![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)

## Quick Links

| Page                                                                   | Description                                               |
| ---------------------------------------------------------------------- | --------------------------------------------------------- |
| [Quick Start](Quick-Start)                                             | Install and download your first chapter                   |
| [Supported Sites](Supported-Sites)                                     | Current site integrations and status                      |
| [Permissions](Permissions)                                             | Required permissions and MangaDex's optional HTTPS access |
| [Comparisons](Comparisons)                                             | How Tako compares to other manga downloaders              |
| [Template Macros](Template-Macros)                                     | Filename and path-template macro reference                |
| [Architecture](Architecture)                                           | Core runtime, storage, messaging, and state flow          |
| [Site Integration Guide](Site-Integration-Guide)                       | Adding or maintaining site integrations                   |
| [Contributing](https://github.com/oovz/Tako/blob/main/CONTRIBUTING.md) | Development setup and PR guidelines                       |

## What is Tako?

Tako brings a complete manga download workflow directly into Chrome. Browse a series, select chapters, queue downloads, and export ready-to-read archives from the Side Panel next to your active reading tab. For full history, configuration, and destination recovery, the dedicated Options page is always accessible.

No save-dialog spam. No one-by-one image downloads. No external downloaders needed.

## Why Tako

- **Browser-native workflow** — Select chapters and track downloads directly from Chrome's Side Panel, with full history and configuration in Options.
- **Batch queue with auto-retry** — Queue dozens of chapters and let Tako handle retries automatically while keeping your browser responsive.
- **Clean exports** — Export as CBZ, ZIP, or loose image folders with custom path and filename templates.
- **ComicInfo.xml metadata** — Automatically embeds metadata in CBZ archives for comic library managers like Komga and Kavita, plus general CBZ reader compatibility.
- **Direct folder saving** — Save directly to a chosen local library folder via the File System Access API.
- **Curated site support** — Optimized integrations for MangaDex, Pixiv Comic, Shonen Jump+, Manhuagui, Comic Nettai, and MangaMillion.
- **Privacy-first** — Zero analytics, telemetry, or user tracking. All data remains locally in your browser.
- **Open source** — MIT licensed, full source code on GitHub.

## Install

Get Tako free from the [Chrome Web Store](https://chromewebstore.google.com/detail/tako-manga-downloader/hlodmckfkmbenkknmailfekehgajpmbb) or install it from source via the [README](https://github.com/oovz/Tako/blob/main/README.md).
