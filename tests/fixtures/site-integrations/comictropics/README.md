# Comic Nettai (COMIC熱帯) fixtures

`series-page-1.html`, `series-page-2.html`, and `series-page-3.html` preserve the captured three-page 煙たい話 catalog. `captured-chapters.json` records its chapter entries. Hidden pagination controls are excluded from discovery so tests follow the visible catalog links.

`contract.json` supplies the PUBLUS configuration vector used by protocol and reconstruction tests. Browser tests combine the captured catalog with controlled viewer-session credentials and image bytes. The generated image responses exercise reconstruction and output without retaining chapter artwork.
