import logger from '@/src/runtime/logger';
import type { Chapter } from '@/src/types/chapter';
import type { SeriesMetadata } from '@/src/types/series-metadata';
import { parseChapterNumber, sanitizeLabel } from '@/src/shared/site-integration-utils';
import { decompressFromBase64 } from './lz-string';
import { parseChapterIdFromUrl, toAbsoluteUrl } from './shared';

/**
 * A single volume/chapter-list section as rendered on the series page.
 * Manhuagui groups chapters into multiple `.chapter-list` blocks (one per
 * volume/arc), each preceded by an `h4` heading.
 */
type ChapterGroup = {
  title?: string;
  links: Array<{ href: string; title: string }>;
};

function getTextContent(node: { textContent?: string | null } | null | undefined): string {
  return sanitizeLabel(node?.textContent ?? '');
}

function getAttribute(
  node: { getAttribute?: (name: string) => string | null | undefined } | null | undefined,
  attributeName: string,
): string {
  return sanitizeLabel(node?.getAttribute?.(attributeName) ?? '');
}

function getHref(node: { href?: string; getAttribute?: (name: string) => string | null | undefined } | null | undefined): string {
  const rawHref = getAttribute(node, 'href');
  const absoluteRawHref = toAbsoluteUrl(rawHref);
  if (absoluteRawHref) return absoluteRawHref;

  if (typeof node?.href === 'string' && sanitizeLabel(node.href)) {
    return node.href;
  }

  return '';
}

/**
 * Read the N-th `.detail-list span` item's values. Each detail item may either
 * wrap its values in `<a>` tags (genre/author/etc.) or inline them as text.
 */
function readDetailValues(detailItems: unknown[], index: number): string[] {
  const item = detailItems[index] as {
    querySelectorAll?: (selector: string) => ArrayLike<{ textContent?: string | null }>;
    textContent?: string | null;
  } | undefined;

  if (!item) {
    return [];
  }

  const linkedValues = Array.from(item.querySelectorAll?.('a') ?? [])
    .map((anchor) => getTextContent(anchor))
    .filter(Boolean);

  if (linkedValues.length > 0) {
    return linkedValues;
  }

  const text = getTextContent(item);
  return text ? [text] : [];
}

/**
 * Prepare the lz-string-compressed `__VIEWSTATE` payload for DOM parsing.
 * Strips the leading `//` comment Manhuagui prepends and wraps bare chapter
 * list markup in a `<div class="chapter">` container so downstream
 * `.chapter-list` selectors still match.
 */
function decodeAdultViewStateMarkup(encodedViewState: string): string | null {
  const decoded = decompressFromBase64(encodedViewState);
  if (!decoded) {
    return null;
  }

  let sanitized = decoded.trim().replace(/^\/\/+/, '').trim();
  if (!sanitized) {
    return null;
  }

  if (!/class=['"]chapter['"]/.test(sanitized)) {
    sanitized = `<div class="chapter">${sanitized}</div>`;
  }

  return sanitized;
}

/**
 * When the series page is served behind the adult-content warning, the real
 * chapter markup is lz-string-compressed into the `#__VIEWSTATE` input. Decode
 * it and parse it into a DOM so chapter extraction can operate uniformly.
 * Returns `undefined` when no warning is present or decoding fails, letting
 * callers fall back to the original document.
 */
export function resolveAdultChapterDocument(documentLike: Document): Document | undefined {
  const adultWarning = documentLike.querySelector('#checkAdult');
  const viewStateElement = documentLike.querySelector('#__VIEWSTATE');
  if (!adultWarning || !viewStateElement) {
    return undefined;
  }

  const encodedViewState = getAttribute(viewStateElement, 'value');
  if (!encodedViewState) {
    return undefined;
  }

  const decodedMarkup = decodeAdultViewStateMarkup(encodedViewState);
  if (!decodedMarkup || typeof DOMParser === 'undefined') {
    return undefined;
  }

  try {
    return new DOMParser().parseFromString(decodedMarkup, 'text/html');
  } catch (error) {
    logger.warn('[manhuagui] Failed to parse adult chapter markup from __VIEWSTATE', error);
    return undefined;
  }
}

function extractChapterGroupsFromDocument(documentLike: Document): ChapterGroup[] {
  const chapterLists = Array.from(documentLike.querySelectorAll('.chapter-list'));
  if (chapterLists.length === 0) {
    return [];
  }

  return chapterLists
    .map((list) => {
      const headingText = sanitizeLabel(
        list.previousElementSibling?.textContent
        || list.parentElement?.querySelector('h4')?.textContent
        || '',
      ) || undefined;

      const links = Array.from(list.querySelectorAll('li > a, a'))
        .map((anchor) => ({
          href: getHref(anchor),
          title: getTextContent(anchor),
        }))
        .filter((link) => link.href && link.title);

      return {
        title: headingText,
        links,
      } satisfies ChapterGroup;
    })
    .filter((group) => group.links.length > 0);
}

/**
 * Turn a single chapter group into sorted {@link Chapter}s. Chapters are
 * de-duplicated by canonical ID within the group and ordered by parsed chapter
 * number, then by numeric chapter ID, then by DOM position as a final
 * tiebreaker so adjacent specials stay adjacent.
 */
function mapChapterGroupToChapters(group: ChapterGroup, groupIndex: number): Chapter[] {
  const seenIds = new Set<string>();

  const mapped = group.links
    .map((link, linkIndex) => {
      const chapterId = parseChapterIdFromUrl(link.href);
      if (!chapterId || seenIds.has(chapterId)) {
        return null;
      }

      seenIds.add(chapterId);
      const chapterTitle = sanitizeLabel(link.title) || `Chapter ${chapterId}`;
      const chapterNumber = parseChapterNumber(chapterTitle);

      return {
        id: chapterId,
        url: link.href,
        title: chapterTitle,
        chapterLabel: chapterTitle,
        chapterNumber,
        volumeLabel: group.title,
        comicInfo: {
          Title: chapterTitle,
          LanguageISO: 'zh',
          Manga: 'YesAndRightToLeft',
        },
        __sortOrder: { groupIndex, linkIndex },
      } as Chapter & { __sortOrder: { groupIndex: number; linkIndex: number } };
    })
    .filter((chapter): chapter is Chapter & { __sortOrder: { groupIndex: number; linkIndex: number } } => chapter != null);

  mapped.sort((left, right) => {
    const leftNumber = left.chapterNumber;
    const rightNumber = right.chapterNumber;

    if (typeof leftNumber === 'number' && typeof rightNumber === 'number' && leftNumber !== rightNumber) {
      return leftNumber - rightNumber;
    }

    const leftId = Number.parseInt(left.id, 10);
    const rightId = Number.parseInt(right.id, 10);
    if (Number.isFinite(leftId) && Number.isFinite(rightId) && leftId !== rightId) {
      return leftId - rightId;
    }

    return left.__sortOrder.linkIndex - right.__sortOrder.linkIndex;
  });

  return mapped.map((chapter) => {
    const { __sortOrder, ...rest } = chapter;
    void __sortOrder;
    return rest;
  });
}

/**
 * Walk every `.chapter-list` group on the (possibly adult-gated) series page
 * and return a de-duplicated chapter list. Duplicate chapter IDs across groups
 * are logged as errors since Manhuagui should not emit them.
 */
export function extractChaptersFromDocument(documentLike: Document): Chapter[] {
  const chapterDocument = resolveAdultChapterDocument(documentLike) ?? documentLike;
  const groups = extractChapterGroupsFromDocument(chapterDocument);
  const duplicateChapterIds = new Set<string>();
  const chapterById = new Map<string, Chapter>();

  groups.forEach((group, groupIndex) => {
    for (const chapter of mapChapterGroupToChapters(group, groupIndex)) {
      if (chapterById.has(chapter.id)) {
        duplicateChapterIds.add(chapter.id);
        continue;
      }

      chapterById.set(chapter.id, chapter);
    }
  });

  if (duplicateChapterIds.size > 0) {
    logger.error('[manhuagui] Duplicate chapter ids detected in extractChapterList', {
      duplicateChapterIds: [...duplicateChapterIds],
    });
  }

  return Array.from(chapterById.values());
}

/**
 * Extract series-level metadata from the `.book-cont` container on the series
 * page. Throws if the container or title are missing since those are required
 * fields for a valid {@link SeriesMetadata}.
 */
export function extractSeriesMetadataFromDocument(documentLike: Document): SeriesMetadata {
  const bookContainer = documentLike.querySelector('.book-cont');
  if (!bookContainer) {
    throw new Error('Manhuagui series metadata container not found');
  }

  const title = getTextContent(bookContainer.querySelector('.book-title h1'))
    || getAttribute(documentLike.querySelector('meta[property="og:title"]'), 'content');
  if (!title) {
    throw new Error('Manhuagui series title not found');
  }

  const subtitle = getTextContent(bookContainer.querySelector('.book-title h2'));
  const detailItems = Array.from(documentLike.querySelectorAll('.detail-list span'));
  const yearValue = readDetailValues(detailItems, 0)[0];
  const genres = readDetailValues(detailItems, 3);
  const authors = readDetailValues(detailItems, 4);
  const status = readDetailValues(detailItems, 7)[0];

  return {
    title,
    author: authors[0],
    description: getTextContent(bookContainer.querySelector('#intro-all'))
      || getTextContent(bookContainer.querySelector('.book-intro'))
      || undefined,
    coverUrl: toAbsoluteUrl(
      getAttribute(bookContainer.querySelector('.hcover img'), 'src')
      || getAttribute(documentLike.querySelector('meta[property="og:image"]'), 'content'),
    ),
    alternativeTitles: subtitle ? [subtitle] : undefined,
    year: yearValue ? Number.parseInt(yearValue, 10) : undefined,
    genres: genres.length > 0 ? genres : undefined,
    status,
    language: 'zh',
    readingDirection: 'rtl',
  };
}
