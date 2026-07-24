# Supported Sites

Tako supports manga, manhua, and manhwa sites through purpose-built
integrations.

## Live integrations

| Site                                        | Maturity | Fresh-install default                            | Context strategy                                             |
| ------------------------------------------- | -------- | ------------------------------------------------ | ------------------------------------------------------------ |
| [MangaDex](https://mangadex.org)            | Stable   | Off; asks for optional HTTPS access when enabled | URL + official API                                           |
| [Pixiv Comic](https://comic.pixiv.net)      | Stable   | On                                               | URL + internal API/descrambler                               |
| [Shonen Jump+](https://shonenjumpplus.com)  | Stable   | On                                               | Numeric `/episode/{id}` pages; fetched SSR HTML + viewer API |
| [Manhuagui](https://www.manhuagui.com)      | Stable   | On                                               | Fetched SSR HTML + packed chapter data                       |
| [Comic Nettai](https://www.comicnettai.com) | Stable   | On                                               | Fetched SSR HTML + PUBLUS viewer                             |

The bundled set can grow. New integrations begin as Experimental and move to
Stable after deterministic regression fixtures and several days of live smoke
testing. “Stable” describes observed reliability; it does not imply that the
provider publishes an official API.

For Shonen Jump+, open a numeric `/episode/{id}` page before opening Tako. The
homepage and `/series` catalog routes do not expose the episode context required
by the integration and are intentionally shown as unsupported.

## More sites coming

Want a new site?
[Open a feature request](https://github.com/oovz/Tako/issues/new?template=feature_request.md)
or contribute the integration yourself — see the
[Site Integration Guide](Site-Integration-Guide).

[Install Tako from the Chrome Web Store](https://chromewebstore.google.com/detail/tako-manga-downloader/hlodmckfkmbenkknmailfekehgajpmbb)
