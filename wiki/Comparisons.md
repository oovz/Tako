# Comparisons

Tako is a manga downloader built directly into Chrome's Side Panel. Here's how it compares to other tools.

## How Tako differs

Most manga downloaders are desktop apps or self-hosted servers. Tako keeps the entire workflow inside Chrome — chapter selection, queue, retry, and export — without leaving your reading tab. No separate application to install, no server to run.

## Comparison table

| Tool | Type | Installation | Site support | Output formats | Queue / retry | Browser-native | Open source |
|------|------|--------------|--------------|----------------|:-------------:|:--------------:|:-----------:|
| **Tako** | Chrome extension (MV3) | Chrome Web Store or GitHub | 5 sites and growing | CBZ, ZIP, images | ✅ | ✅ | ✅ MIT |
| HakuNeko | Desktop app | App installer | Various | Various | ✅ | ❌ | ✅ MIT |
| Tachidesk / Suwayomi | Self-hosted server | Server + client | Various via extensions | Various | ✅ | ❌ | ✅ |
| mangadex-downloader (CLI) | Python CLI | pip install | MangaDex | CBZ, EPUB, PDF, raw | ✅ | ❌ | ✅ |
| AllaliAdil Manga Downloader | Chrome extension (MV2) | Deprecated | Various | PDF, ZIP | ❌ | ✅ | ✅ |
| Yui007 MangaDex Extension | Chrome extension | GitHub | MangaDex only | Multiple | ✅ | ✅ | ✅ |

## Tako advantages

- **No separate app or server** — runs entirely inside Chrome as a Side Panel extension.
- **Modern MV3 architecture** — built on Chrome's latest extension platform, not deprecated MV2.
- **Privacy-first** — no analytics, no telemetry, no developer-run backend.
- **ComicInfo.xml support** — embeds metadata in CBZ archives for library managers like Komga and Kavita.
- **Template system** — customizable path and filename templates with macro support.
- **File System Access** — write directly to a chosen folder without download shelf spam.

---

Try Tako by [installing it from the Chrome Web Store](https://chromewebstore.google.com/detail/tako-manga-downloader/hlodmckfkmbenkknmailfekehgajpmbb).
