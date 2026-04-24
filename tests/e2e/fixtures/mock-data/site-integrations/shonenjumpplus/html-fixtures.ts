/**
 * @file html-fixtures.ts
 * @description HTML fixtures for Shonen Jump+ routes.
 *
 * The content script extracts series metadata from:
 * - `<script id="episode-json" data-value="...">` (JSON-escaped payload with
 *   `readableProduct.series.title` and `.thumbnailUri`)
 * - `.series-header-title` / `.series-header-author` / `.series-header-description`
 * - `.js-readable-products-pagination[data-aggregate-id]` (for chapter list
 *   pagination calls)
 *
 * This Layer-1 fixture omits the scrambled-image payload (`pageStructure.pages`)
 * since Layer-1 e2e tests do not download images. Phase 3 extends the
 * episode-json builder with real page entries and scramble seeds.
 */

import { BASIC_SERIES, MINIMAL_SERIES, SERIES_AGGREGATE_IDS } from './series-data';

interface BuildEpisodePageHtmlOptions {
  episodeId: string;
  seriesTitle: string;
  aggregateId: string;
  author?: string;
  description?: string;
  thumbnailUri?: string;
}

function encodeDataValueAttribute(json: string): string {
  return json
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Construct a Shonen Jump+ episode page HTML that mirrors the structural
 * elements the content script reads. Extra DOM surface beyond these
 * selectors is intentional (matches the real page noise) but nothing else
 * is required for extraction.
 */
export function buildShonenJumpPlusEpisodePageHtml(options: BuildEpisodePageHtmlOptions): string {
  const episodeJson = JSON.stringify({
    readableProduct: {
      series: {
        id: options.aggregateId,
        title: options.seriesTitle,
        thumbnailUri: options.thumbnailUri ?? '',
      },
      pageStructure: {
        // Layer-1 mocks intentionally leave pages empty — download pipeline
        // is exercised only in Phase 3 specs with pre-scrambled fixtures.
        pages: [],
      },
    },
  });

  const encodedEpisodeJson = encodeDataValueAttribute(episodeJson);

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <title>${options.seriesTitle} - 第1話 | 少年ジャンプ+</title>
  <meta property="og:title" content="${options.seriesTitle}">
  ${options.thumbnailUri ? `<meta property="og:image" content="${options.thumbnailUri}">` : ''}
  ${options.description ? `<meta property="og:description" content="${options.description}">` : ''}
</head>
<body>
  <header class="series-header">
    <h1 class="series-header-title">${options.seriesTitle}</h1>
    ${options.author ? `<p class="series-header-author">${options.author}</p>` : ''}
    ${options.description ? `<p class="series-header-description">${options.description}</p>` : ''}
  </header>
  <div
    class="js-readable-products-pagination"
    data-aggregate-id="${options.aggregateId}"
  ></div>
  <script id="episode-json" type="application/json" data-value="${encodedEpisodeJson}"></script>
</body>
</html>`;
}

export const BASIC_EPISODE_PAGE_HTML = buildShonenJumpPlusEpisodePageHtml({
  episodeId: BASIC_SERIES.series.seriesId,
  seriesTitle: BASIC_SERIES.series.seriesTitle,
  aggregateId: SERIES_AGGREGATE_IDS[BASIC_SERIES.series.seriesId]!,
  author: BASIC_SERIES.series.author,
  description: BASIC_SERIES.series.description,
  thumbnailUri: BASIC_SERIES.series.coverUrl,
});

export const MINIMAL_EPISODE_PAGE_HTML = buildShonenJumpPlusEpisodePageHtml({
  episodeId: MINIMAL_SERIES.series.seriesId,
  seriesTitle: MINIMAL_SERIES.series.seriesTitle,
  aggregateId: SERIES_AGGREGATE_IDS[MINIMAL_SERIES.series.seriesId]!,
});

export const HOME_PAGE_HTML = `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <title>少年ジャンプ+</title>
</head>
<body>
  <main>Shonen Jump+ Home</main>
</body>
</html>`;
