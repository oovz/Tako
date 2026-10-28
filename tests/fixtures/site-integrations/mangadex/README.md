# MangaDex fixtures

`captured-api.json` retains public fields consumed from the Hunter x Hunter title, chapter feed, statistics, and At-Home reader responses. The feed preserves a 96-entry descending window and a reported total of 2,806; this causes resolution to mark the catalog as truncated. Its 82 downloadable entries exclude external chapters.

`series-page.html` and `reader.html` retain stripped public DOM as representative browser context. Navigation, scripts, tracking attributes, uploader identities, library/read state, and reader Blob URLs have been removed. Content resolution uses the API responses.

The representative reader manifest retains 18 original and 18 data-saver filenames. Browser responses contain controlled image bytes. Other captured chapters use explicit synthetic image filenames with their captured page counts. Additional UI and error scenarios use synthetic controls.
