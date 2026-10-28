# Architecture

[English](Architecture) · [日本語](Architecture.ja) · [简体中文](Architecture.zh-CN) · [繁體中文](Architecture.zh-TW) · [한국어](Architecture.ko)

Tako is a WXT Manifest V3 extension for Chrome 150 or newer. This page helps contributors find the code they need. For download help, see [Quick Start](Quick-Start) and [Troubleshooting](Troubleshooting).

## Extension components

| Component                 | Responsibility                                                      |
| ------------------------- | ------------------------------------------------------------------- |
| Side Panel and Options    | Chapter selection, download progress, history and settings          |
| Background service worker | Queue management, stored state, permissions and Chrome Downloads    |
| Offscreen document        | Chapter images, image processing, archives and custom-folder saves  |
| Site integrations         | Site recognition, series metadata, chapter lists and image handling |

## Source map

| Work on                      | Start here                                                                                                                                                                     |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Side Panel and Options       | [`entrypoints/sidepanel/`](https://github.com/oovz/Tako/tree/main/entrypoints/sidepanel), [`entrypoints/options/`](https://github.com/oovz/Tako/tree/main/entrypoints/options) |
| Background tasks             | [`entrypoints/background/`](https://github.com/oovz/Tako/tree/main/entrypoints/background)                                                                                     |
| Image and archive processing | [`entrypoints/offscreen/`](https://github.com/oovz/Tako/tree/main/entrypoints/offscreen)                                                                                       |
| Site support                 | [`src/site-integrations/`](https://github.com/oovz/Tako/tree/main/src/site-integrations)                                                                                       |
| Domain logic                 | [`src/domain/`](https://github.com/oovz/Tako/tree/main/src/domain)                                                                                                             |
| Stored settings and history  | [`src/storage/`](https://github.com/oovz/Tako/tree/main/src/storage)                                                                                                           |
| Shared runtime services      | [`src/runtime/`](https://github.com/oovz/Tako/tree/main/src/runtime)                                                                                                           |
| Integration interfaces       | [`src/types/site-integrations.ts`](https://github.com/oovz/Tako/blob/main/src/types/site-integrations.ts)                                                                      |

See the [contributor guide](https://github.com/oovz/Tako/blob/main/CONTRIBUTING.md) for setup and tests, or the [Site Integration Guide](Site-Integration-Guide) to add a site.

## References

- [Chrome extensions Manifest V3](https://developer.chrome.com/docs/extensions/mv3/intro/)
- [Chrome side panel API](https://developer.chrome.com/docs/extensions/reference/api/sidePanel)
- [Chrome offscreen API](https://developer.chrome.com/docs/extensions/reference/api/offscreen)
- [Chrome downloads API](https://developer.chrome.com/docs/extensions/reference/api/downloads)
