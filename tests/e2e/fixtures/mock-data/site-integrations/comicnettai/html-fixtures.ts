import { BASIC_CHAPTERS } from './chapter-data'
import { BASIC_SERIES } from './series-data'

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function renderChapterItem(chapter: typeof BASIC_CHAPTERS.chapters[number]): string {
  return `<a class="js-open-next-url detail--product__item is-open" href="${escapeHtml(chapter.url)}">
    <div class="detail--product__item__left">
      <img class="lazyload detail--product__thum" data-src="https://cdn.comicnettai.com/9_hash/book_contents/${chapter.id}/icon.jpg" alt="${escapeHtml(chapter.title)} - ${escapeHtml(BASIC_SERIES.series.seriesTitle)}">
    </div>
    <div class="detail--product__item__center">
      <h2 class="detail--product__item__title">${escapeHtml(chapter.title)}</h2>
    </div>
    <div class="detail--product__item__right">
      <span class="btn--detail--read">読む</span>
    </div>
  </a>`
}

export const BASIC_SERIES_PAGE_HTML = `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(BASIC_SERIES.series.seriesTitle)} - ${escapeHtml(BASIC_SERIES.series.author ?? '')} | COMIC熱帯</title>
  <meta name="description" content="${escapeHtml(BASIC_SERIES.series.description ?? '')}">
  <meta property="og:title" content="${escapeHtml(BASIC_SERIES.series.seriesTitle)} - ${escapeHtml(BASIC_SERIES.series.author ?? '')} | COMIC熱帯">
  <meta property="og:image" content="${escapeHtml(BASIC_SERIES.series.coverUrl ?? '')}">
</head>
<body>
  <main>
    <h1 class="detail--title">${escapeHtml(BASIC_SERIES.series.seriesTitle)}</h1>
    <div class="detail__author__list">
      <span class="detail__author__item">${escapeHtml(BASIC_SERIES.series.author ?? '')}</span>
    </div>
    <p class="detail--discription">${escapeHtml(BASIC_SERIES.series.description ?? '')}</p>
    <div class="container detail--product__list">
      ${BASIC_CHAPTERS.chapters.map(renderChapterItem).join('\n')}
    </div>
  </main>
</body>
</html>`

export const HOME_PAGE_HTML = `<!doctype html>
<html lang="ja">
<head><meta charset="utf-8"><title>COMIC熱帯</title></head>
<body><main>COMIC熱帯 Home</main></body>
</html>`
