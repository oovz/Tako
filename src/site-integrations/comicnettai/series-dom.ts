import { parseChapterNumber, sanitizeLabel } from '@/src/shared/site-integration-utils'
import type { Chapter } from '@/src/types/chapter'
import type { SeriesMetadata } from '@/src/types/series-metadata'
import type { SeriesChapterListResult } from '@/src/types/site-integrations'
import {
  COMICNETTAI_ORIGIN,
  extractComicNettaiBookContentId,
  normalizeComicNettaiChapterUrl,
  parseComicNettaiViewerCid,
} from './shared'

function readText(document: Document, selector: string): string | undefined {
  const text = sanitizeLabel(document.querySelector(selector)?.textContent ?? '')
  return text || undefined
}

function readMeta(document: Document, selector: string): string | undefined {
  const content = sanitizeLabel(document.querySelector(selector)?.getAttribute('content') ?? '')
  return content || undefined
}

function readSeriesTitleFromOpenGraph(document: Document): string | undefined {
  const title = readMeta(document, 'meta[property="og:title"]')
  return title?.split(' - ')[0]?.trim() || title
}

export function extractComicNettaiSeriesMetadataFromDocument(document: Document): SeriesMetadata {
  const title = readText(document, '.detail--title')
    ?? readSeriesTitleFromOpenGraph(document)
  if (!title) {
    throw new Error('Comic Nettai series title not found in page DOM')
  }

  return {
    title,
    author: readText(document, '.detail__author__item'),
    description: readText(document, '.detail--discription')
      ?? readMeta(document, 'meta[name="description"]')
      ?? readMeta(document, 'meta[property="og:description"]'),
    coverUrl: readMeta(document, 'meta[property="og:image"]')
      ?? document.querySelector<HTMLImageElement>('.detail-catch__img')?.src,
    language: 'ja',
    readingDirection: 'rtl',
  }
}

export function extractComicNettaiChapterListFromDocument(document: Document): SeriesChapterListResult {
  const chapters: Chapter[] = []
  const seen = new Set<string>()

  for (const anchor of document.querySelectorAll<HTMLAnchorElement>('a.detail--product__item[href]')) {
    const chapterUrl = normalizeComicNettaiChapterUrl(anchor.getAttribute('href') ?? '')
    if (!chapterUrl || !parseComicNettaiViewerCid(chapterUrl)) {
      continue
    }

    const thumbnail = anchor.querySelector<HTMLImageElement>('.detail--product__thum')
    const thumbnailUrl = thumbnail?.getAttribute('data-src') || thumbnail?.src || ''
    const cid = parseComicNettaiViewerCid(chapterUrl)
    const id = extractComicNettaiBookContentId(thumbnailUrl) ?? cid
    if (!id || seen.has(id)) {
      continue
    }

    const title = sanitizeLabel(anchor.querySelector('.detail--product__item__title')?.textContent ?? '')
      || sanitizeLabel(thumbnail?.alt ?? '')
      || `Chapter ${id}`
    const chapterNumber = parseChapterNumber(title)
    seen.add(id)
    chapters.push({
      id,
      url: new URL(chapterUrl, COMICNETTAI_ORIGIN).toString(),
      title,
      locked: !anchor.classList.contains('is-open'),
      chapterLabel: title,
      chapterNumber,
      language: 'ja',
      comicInfo: {
        Title: title,
        Number: typeof chapterNumber === 'number' ? String(chapterNumber) : undefined,
        LanguageISO: 'ja',
        Manga: 'YesAndRightToLeft',
      },
    })
  }

  return chapters
}
