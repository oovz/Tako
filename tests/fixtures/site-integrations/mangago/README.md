# Mangago fixtures

`series.html` and `reader.html` contain public fields from [Hunter X Hunter](https://www.mangago.me/read-manga/hunter_x_hunter/) and [Ch.420](https://www.mangago.me/read-manga/hunter_x_hunter/an/nml_chapter-420/pg-1/), captured on 2026-10-25. They preserve 423 chapter links, the encrypted 19-page reader payload, and two DOM image URLs. The decoder vector in `contract.json` comes from an earlier observation of `https://pic1.mangapicgallery.com/js/chapter.js?895`; the reader capture does not include that script response.

`series-kenshi.html` and `reader-kenshi.html` contain a same-date capture from [Kenshi O Mezashite Nyugaku Shitanoni Maho Tekisei 9999 Nandesukedo!?](https://www.mangago.me/read-manga/kenshi_o_mezashite_ny_gaku_shitanoni_mah_tekisei_9999_nandesukedo/), with 74 catalog entries and the 35-page reader for `nbt:br_chapter-454512`. Its author, genres, year, and synopsis were refreshed from a public response on 2026-10-27.

The community score and synopsis expand control in `series-kenshi.html` were captured on 2026-11-12. The fixture preserves the site's displayed release year.

`series-ultra-black.html` retains the 21 catalog links and displayed year from [#000000 - Ultra Black](https://www.mangago.me/read-manga/000000_ultra_black/), captured on 2026-11-12. Chapters 1–3 use separate volume and chapter segments. Their readers use a numeric page suffix, as in `/mf/v01/c001/2/`.

The captures retain older HTML links, nested routes, and fractional chapter labels. Account state and unrelated page content have been removed. Browser tests use generated PNG images; no chapter artwork is stored.
