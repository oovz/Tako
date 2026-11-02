import capturedEpisode from "@/tests/fixtures/site-integrations/shonenjumpplus/captured-episode.json" with { type: "json" }
import {
  BASIC_SERIES,
  MINIMAL_SERIES,
  SERIES_AGGREGATE_IDS,
} from "./series-data"

interface BuildEpisodePageHtmlOptions {
  episodeId: string
  seriesTitle: string
  aggregateId: string
  thumbnailUri?: string
  author?: string
  description?: string
  openGraphImage?: string
}

function encodeDataValueAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("'", "&#39;")
}

export function buildShonenJumpPlusEpisodePageHtml(
  options: BuildEpisodePageHtmlOptions
): string {
  const episode = structuredClone(capturedEpisode)
  episode.readableProduct.id = options.episodeId
  episode.readableProduct.series = {
    id: options.aggregateId,
    title: options.seriesTitle,
    thumbnailUri: options.thumbnailUri ?? "",
  }
  const encoded = encodeDataValueAttribute(JSON.stringify(episode))
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>${encodeDataValueAttribute(options.seriesTitle)} | 少年ジャンプ＋</title></head><body>
<div class="js-readable-products-pagination" data-aggregate-id="${options.aggregateId}" data-type="episode"></div>
<script id="episode-json" data-value="${encoded}"></script>
</body></html>`
}

export const BASIC_EPISODE_PAGE_HTML = buildShonenJumpPlusEpisodePageHtml({
  episodeId: BASIC_SERIES.series.seriesId,
  seriesTitle: BASIC_SERIES.series.seriesTitle,
  aggregateId: SERIES_AGGREGATE_IDS[BASIC_SERIES.series.seriesId]!,
  thumbnailUri: BASIC_SERIES.series.coverUrl,
})

export const MINIMAL_EPISODE_PAGE_HTML = buildShonenJumpPlusEpisodePageHtml({
  episodeId: MINIMAL_SERIES.series.seriesId,
  seriesTitle: MINIMAL_SERIES.series.seriesTitle,
  aggregateId: SERIES_AGGREGATE_IDS[MINIMAL_SERIES.series.seriesId]!,
})

// Unsupported landing context used only to exercise navigation reset.
export const HOME_PAGE_HTML =
  '<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>少年ジャンプ＋</title></head><body></body></html>'
