# MangaDex fixtures

`captured-api.json` contains public Hunter x Hunter title, feed, statistics, and At-Home responses. Its 96-entry feed window reports 2,806 chapters and contains 82 downloadable entries, allowing tests to check a truncated catalog.

`series-page.html` and `reader.html` provide stripped browser context. Content resolution uses the API responses. Account state, uploader identities, scripts, tracking data, and reader Blob URLs have been removed.

The reader manifest retains 18 original and 18 data-saver filenames. Browser tests use generated image bytes. Other chapters use synthetic filenames with captured page counts; additional UI and error scenarios are synthetic.
