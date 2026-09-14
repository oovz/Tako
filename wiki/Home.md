# Tako Wiki

> **Batch-download manga chapters from Chrome's Side Panel. Queue, retry, and export CBZ or ZIP files without leaving your reading tab.**

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

Tako adds manga downloads to Chrome. Browse a series, select chapters, queue them, and export archives from the Side Panel next to your reading tab. The Options page contains full history, configuration, and destination recovery.

The download workflow stays in the Side Panel. You do not need to save images one by one or run another downloader.

## Why Tako

- **Browser-native workflow** — Select chapters and track downloads in Chrome's Side Panel. Options contains full history and configuration.
- **Batch queue with auto-retry** — Queue chapters and let Tako retry failed images while your browser remains available for reading.
- **Export options** — Export CBZ, ZIP, or loose image folders with custom path and filename templates.
- **ComicInfo.xml metadata** — CBZ archives can include metadata for Komga, Kavita, and other CBZ readers.
- **Direct folder saving** — Save to a local library folder through the File System Access API.
- **Site support** — Use the MangaDex, Pixiv Comic, Shonen Jump+, Manhuagui, Comic Nettai, and MangaMillion integrations.
- **Privacy** — Settings, queue state, and history stay local. Downloads connect directly to providers. When MangaDex is enabled, required MangaDex@Home reports go directly to MangaDex. See the [privacy policy](https://github.com/oovz/Tako/blob/main/PRIVACY.md).
- **Open source** — Tako is MIT licensed, with the full source code on GitHub.

## Install

Get Tako free from the [Chrome Web Store](https://chromewebstore.google.com/detail/tako-manga-downloader/hlodmckfkmbenkknmailfekehgajpmbb) or install it from source via the [README](https://github.com/oovz/Tako/blob/main/README.md).
