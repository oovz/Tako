/**
 * @file html-fixtures.ts
 * @description HTML fixtures for Pixiv Comic routes.
 *
 * Pixiv Comic is a Next.js SPA — the content script only needs the work id
 * surfaced via canonical metadata (`<meta property="og:url">` or
 * `<link rel="canonical">`). The Next.js build id referenced in
 * `chapter-api.ts` is only required for chapter-image resolution (Phase 3);
 * Layer-1 mocks can omit it.
 */

import { BASIC_SERIES, MINIMAL_SERIES } from './series-data';

export function buildPixivComicWorkPageHtml(workId: string, title: string): string {
  const canonicalUrl = `https://comic.pixiv.net/works/${workId}`;
  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta property="og:url" content="${canonicalUrl}">
  <meta property="og:title" content="${title} | Pixiv Comic">
  <meta property="og:type" content="website">
  <link rel="canonical" href="${canonicalUrl}">
  <title>${title} | Pixiv Comic</title>
</head>
<body>
  <div id="__next">
    <main>
      <h1>${title}</h1>
      <a href="${canonicalUrl}">${title}</a>
    </main>
  </div>
</body>
</html>`;
}

export const BASIC_WORK_PAGE_HTML = buildPixivComicWorkPageHtml(
  BASIC_SERIES.series.seriesId,
  BASIC_SERIES.series.seriesTitle,
);

export const MINIMAL_WORK_PAGE_HTML = buildPixivComicWorkPageHtml(
  MINIMAL_SERIES.series.seriesId,
  MINIMAL_SERIES.series.seriesTitle,
);

export const HOME_PAGE_HTML = `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <title>Pixiv Comic</title>
</head>
<body>
  <div id="__next"><main>Pixiv Comic Home</main></div>
</body>
</html>`;

/**
 * Viewer HTML shell used for `/viewer/stories/{id}` routes. Layer-1 mocks
 * do not need the embedded reader payload — Phase 3 extends this fixture
 * with Next.js build-id markers and reader scripts.
 */
export const VIEWER_PAGE_HTML = `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <title>Pixiv Comic Viewer</title>
</head>
<body>
  <div id="__next"><main>Viewer</main></div>
</body>
</html>`;
