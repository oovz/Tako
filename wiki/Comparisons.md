# Comparisons and Tool Selection

_Last reviewed: August 2026_

Tako is a browser-native manga downloader built into Chrome's Side Panel. This guide compares its architecture, setup, site coverage, output formats, queue behavior, and license with several other downloaders.

## Comparison table

| Tool                                                                                             | Architecture                     | Source / Installation                                                                                                                                        | Site support                                                                   | Output formats               | Queue & retry |    Browser-native    |                               Open source license                               |
| ------------------------------------------------------------------------------------------------ | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ | ---------------------------- | :-----------: | :------------------: | :-----------------------------------------------------------------------------: |
| **[Tako](https://github.com/oovz/Tako)**                                                         | Chrome extension (MV3)           | [Chrome Web Store](https://chromewebstore.google.com/detail/tako-manga-downloader/hlodmckfkmbenkknmailfekehgajpmbb) / [GitHub](https://github.com/oovz/Tako) | MangaDex, Pixiv Comic, Shonen Jump+, Manhuagui, Comic Nettai, and MangaMillion | CBZ, ZIP, loose images       |      ✅       |   ✅ (Side Panel)    |              [MIT](https://github.com/oovz/Tako/blob/main/LICENSE)              |
| **[HakuNeko](https://github.com/manga-download/hakuneko)**                                       | Desktop application (Electron)   | App installer / [GitHub](https://github.com/manga-download/hakuneko)                                                                                         | Broad scraper connectors                                                       | CBZ, PDF, EPUB, loose images |      ✅       | ❌ (Standalone app)  | [The Unlicense](https://github.com/manga-download/hakuneko/blob/master/LICENSE) |
| **[Suwayomi Server](https://github.com/Suwayomi/Suwayomi-Server)** _(formerly Tachidesk-Server)_ | Self-hosted server (Java/Kotlin) | Docker, binary / [GitHub](https://github.com/Suwayomi/Suwayomi-Server)                                                                                       | Tachiyomi extension ecosystem                                                  | CBZ, loose images            |      ✅       | ❌ (Server + Web UI) | [MPL-2.0](https://github.com/Suwayomi/Suwayomi-Server/blob/master/LICENSE.txt)  |
| **[mangadex-downloader](https://github.com/mansuf/mangadex-downloader)**                         | CLI tool (Python)                | `pip install` / [GitHub](https://github.com/mansuf/mangadex-downloader)                                                                                      | MangaDex                                                                       | CBZ, PDF, EPUB, raw images   |      ✅       |  ❌ (Terminal CLI)   |     [MIT](https://github.com/mansuf/mangadex-downloader/blob/main/LICENSE)      |

## Who Tako is for

Tako is for readers who want to download in the browser without setting up a separate desktop runtime or server.

### Choose Tako if:

- Select chapters and monitor downloads in Chrome's Side Panel next to your reading tab.
- Tako runs in Chrome with no Python, Node.js, Java, or Docker setup.
- CBZ exports can include standard `ComicInfo.xml` metadata for Komga, Kavita, and other library managers.
- Save chapters directly to a local library folder through the File System Access API.
- Tako runs no analytics backend and processes archives in an offscreen document. Downloads connect directly to providers, including required MangaDex@Home reports when enabled; see the [privacy policy](https://github.com/oovz/Tako/blob/main/PRIVACY.md).

## Key features of Tako

- **Manifest V3 architecture** — A Service Worker manages state, and an offscreen document handles downloads and archive creation.
- **Durable queue with retry and recovery** — Queue and history state are preserved locally. After a restart, surviving work is reconciled; use **Retry failed** or **Restart task** when processing was lost. Partial image or archive bytes are not resumed after a full browser restart.
- **Path and filename templates** — Use macros such as `<SERIES_TITLE>`, `<CHAPTER_NUMBER>`, and `<VOLUME_NUMBER>` to organize downloads.
- **Privacy** — Configuration and queue data stay in local browser storage.
