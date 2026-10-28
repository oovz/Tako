# Mangago fixtures

`series.html` and `reader.html` contain public fields captured on 2026-10-25 from [Hunter X Hunter](https://www.mangago.me/read-manga/hunter_x_hunter/) and [Ch.420](https://www.mangago.me/read-manga/hunter_x_hunter/an/nml_chapter-420/pg-1/).

The series preserves metadata and all 423 chapter links, including chapter zero, decimal chapters, legacy `.html` links, and nested paths. The two source series files represent the same catalog page. Navigation, account controls, advertisements, comments, uploader attribution, styling, telemetry, and unrelated scripts have been removed.

The reader preserves the encrypted 19-page image payload, navigation values, its public `https://pic1.mangapicgallery.com/js/chapter.js?895` reference, and two lazy-loaded DOM image URLs. `contract.json` contains a decoder vector from an earlier observation of that script URL; the capture has no script response. Decoding produces all 19 URLs, with the first two matching the DOM sample. The remaining URLs come from the payload rather than independent DOM comparisons.

`series-kenshi.html` and `reader-kenshi.html` retain a second same-date capture from [Kenshi O Mezashite Nyugaku Shitanoni Maho Tekisei 9999 Nandesukedo!?](https://www.mangago.me/read-manga/kenshi_o_mezashite_ny_gaku_shitanoni_mah_tekisei_9999_nandesukedo/): 74 catalog entries and 35 image URLs for `nbt:br_chapter-454512`. They cover fractional routes and older display aliases.

Browser and adapter tests consume these inputs. Browser image responses use generated PNG controls; chapter artwork is excluded from the fixtures.
