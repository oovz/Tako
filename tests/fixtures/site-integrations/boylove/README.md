# BoyLove (香香腐宅) fixtures

`series.html` and `reader.html` contain public fields captured on 2026-10-25 from [猎人只想安静生活【台版】](https://boylove.cc/home/book/index/id/32391) and its [first chapter](https://boylove.cc/home/book/capter/id/2671926).

The series preserves metadata and all 68 catalog entries, from chapter `2671926` through `2741402`, including titles and VIP flags. The reader preserves 35 numbered pages, image URLs and dimensions, `imageData`, and `randomClass = 13`. The HTML retains the selectors used by the parser. Account state, navigation, controls, advertisements, comments, styling, telemetry, and unrelated scripts have been removed.

`series-shagua-tiandi.html` and `reader-shagua-tiandi.html` provide a second catalog and reader from [傻瓜天地](https://boylove.cc/home/book/index/id/34260), captured on the same date. They retain nine chapters and the 88-page reader for chapter `2699104`. The two-page HTML vectors in `contract.json` are synthetic inputs for malformed-data and resource-ownership tests.

Browser tests serve the captured HTML with generated PNG images at the declared dimensions. The URLs and dimensions exercise parsing, transport, and reconstruction; the generated pixels exercise output production. Chapter artwork is excluded from these fixtures.
