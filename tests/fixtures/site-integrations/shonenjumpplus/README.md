# Shonen Jump+ (少年ジャンプ＋) fixtures

`captured-episode.json`, `captured-pagination.json`, and `captured-products.json` preserve the browser inputs for SPY×FAMILY episode `10834108156648240735`, its 71 main image pages, and the 183-entry guest catalog for aggregate `10834108156648240732`.

The catalog retains the API's `status.label === "is_free"` availability values. Captured cover URLs use `cdn-scissors.gigaviewer.com`, and chapter paths use the Shonen Jump+ CDN. Browser routes return controlled PNG bytes for those image requests. Protocol data supplies the page and catalog structure; generated pixels exercise deterministic download and output behavior.
