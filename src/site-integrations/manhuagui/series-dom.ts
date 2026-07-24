import logger from "@/src/runtime/logger"
import type { Chapter } from "@/src/types/chapter"
import type { SeriesMetadata } from "@/src/types/series-metadata"
import type { VolumeState } from "@/src/types/tab-state"
import {
  parseChapterIdFromUrl,
  toAbsoluteUrl,
  toAllowedManhuaguiAssetUrl,
} from "./shared"
import {
  parseChapterNumber,
  parseVolumeInfo,
  sanitizeLabel,
} from "@/src/shared/site-integration-utils"

/**
 * A single volume/chapter-list section as rendered on the series page.
 * Manhuagui groups chapters into multiple `.chapter-list` blocks (one per
 * volume/arc), each preceded by an `h4` heading.
 */
type ChapterGroup = {
  title?: string
  volumeId: string
  volumeNumber?: number
  links: Array<{ href: string; title: string }>
}

function getTextContent(
  node: { textContent?: string | null } | null | undefined
): string {
  return sanitizeLabel(node?.textContent ?? "")
}

function getAttribute(
  node:
    | { getAttribute?: (name: string) => string | null | undefined }
    | null
    | undefined,
  attributeName: string
): string {
  return sanitizeLabel(node?.getAttribute?.(attributeName) ?? "")
}

function getDirectTextContent(
  node:
    | {
        childNodes?: ArrayLike<{
          nodeType?: number
          textContent?: string | null
        }>
      }
    | null
    | undefined
): string {
  const directText = Array.from(node?.childNodes ?? [])
    .filter((child) => child.nodeType === 3)
    .map((child) => child.textContent ?? "")
    .join(" ")

  return sanitizeLabel(directText)
}

function getChapterTitle(
  node:
    | {
        childNodes?: ArrayLike<{
          nodeType?: number
          textContent?: string | null
        }>
        getAttribute?: (name: string) => string | null | undefined
        querySelector?: (selector: string) => {
          childNodes?: ArrayLike<{
            nodeType?: number
            textContent?: string | null
          }>
        } | null
        textContent?: string | null
      }
    | null
    | undefined
): string {
  const titleAttribute = getAttribute(node, "title")
  if (titleAttribute) {
    return titleAttribute
  }

  return (
    getDirectTextContent(node?.querySelector?.("span") ?? node) ||
    getTextContent(node)
  )
}

function getHref(
  node:
    | {
        href?: string
        getAttribute?: (name: string) => string | null | undefined
      }
    | null
    | undefined
): string {
  const rawHref = getAttribute(node, "href")
  const absoluteRawHref = toAbsoluteUrl(rawHref)
  if (absoluteRawHref) return absoluteRawHref

  if (typeof node?.href === "string" && sanitizeLabel(node.href)) {
    return node.href
  }

  return ""
}

type ManhuaguiElementLike = {
  tagName?: string
  className?: string
  children?: ArrayLike<ManhuaguiElementLike>
  childNodes?: ArrayLike<{ nodeType?: number; textContent?: string | null }>
  textContent?: string | null
  href?: string
  getAttribute?: (name: string) => string | null | undefined
  matches?: (selector: string) => boolean
  querySelector?: (selector: string) => ManhuaguiElementLike | null
  querySelectorAll?: (selector: string) => ArrayLike<ManhuaguiElementLike>
}

function isHeadingElement(
  node:
    | { matches?: (selector: string) => boolean; tagName?: string }
    | null
    | undefined
): boolean {
  return node?.matches?.("h4") === true || node?.tagName?.toLowerCase() === "h4"
}

function hasClassName(node: ManhuaguiElementLike, className: string): boolean {
  return (
    node.matches?.(`.${className}`) === true ||
    ` ${node.className ?? ""} `.includes(` ${className} `)
  )
}

function getChapterContainers(documentLike: Document): ManhuaguiElementLike[] {
  return Array.from(documentLike.querySelectorAll(".chapter"))
}

function getChapterLinks(
  list: ManhuaguiElementLike
): Array<{ href: string; title: string }> {
  return Array.from(list.querySelectorAll?.("li > a, a") ?? [])
    .map((anchor) => ({
      href: getHref(anchor),
      title: getChapterTitle(anchor),
    }))
    .filter((link) => link.href.length > 0)
}

/**
 * Read the N-th `.detail-list span` item's values. Each detail item may either
 * wrap its values in `<a>` tags (genre/author/etc.) or inline them as text.
 */
function readDetailValues(detailItems: unknown[], index: number): string[] {
  const item = detailItems[index] as
    | {
        querySelectorAll?: (
          selector: string
        ) => ArrayLike<{ textContent?: string | null }>
        textContent?: string | null
      }
    | undefined

  if (!item) {
    return []
  }

  const linkedValues = Array.from(item.querySelectorAll?.("a") ?? [])
    .map((anchor) => getTextContent(anchor))
    .filter(Boolean)

  if (linkedValues.length > 0) {
    return linkedValues
  }

  const text = getTextContent(item)
  return text ? [text] : []
}

function extractChapterGroupsFromDocument(
  documentLike: Document
): ChapterGroup[] {
  const groups: ChapterGroup[] = []

  for (const container of getChapterContainers(documentLike)) {
    let currentGroup: ChapterGroup | undefined

    for (const child of Array.from(container.children ?? [])) {
      if (isHeadingElement(child)) {
        const headingText = getTextContent(child)
        const volumeInfo = parseVolumeInfo(headingText)
        currentGroup = {
          title: headingText || undefined,
          volumeId: `manhuagui-volume-${groups.length + 1}`,
          volumeNumber: volumeInfo.volumeNumber,
          links: [],
        }
        groups.push(currentGroup)
        continue
      }

      if (currentGroup && hasClassName(child, "chapter-list")) {
        currentGroup.links.push(...getChapterLinks(child))
      }
    }
  }

  return groups.filter((group) => group.links.length > 0)
}

/**
 * Turn a single chapter group into sorted {@link Chapter}s. Chapters are
 * de-duplicated by canonical ID within the group and ordered by parsed chapter
 * number, then by numeric chapter ID, then by DOM position as a final
 * tiebreaker so adjacent specials stay adjacent.
 */
function mapChapterGroupToChapters(
  group: ChapterGroup,
  groupIndex: number
): Chapter[] {
  const seenIds = new Set<string>()

  const mapped = group.links
    .map((link, linkIndex) => {
      const chapterId = parseChapterIdFromUrl(link.href)
      if (!chapterId || seenIds.has(chapterId)) {
        return null
      }

      seenIds.add(chapterId)
      const chapterTitle = sanitizeLabel(link.title) || `Chapter ${chapterId}`
      const chapterNumber = parseChapterNumber(chapterTitle)

      // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- assertion needed for filter type predicate compatibility
      return {
        id: chapterId,
        url: link.href,
        title: chapterTitle,
        chapterLabel: chapterTitle,
        chapterNumber,
        volumeId: group.volumeId,
        volumeNumber: group.volumeNumber,
        volumeLabel: group.title,
        comicInfo: {
          Title: chapterTitle,
          Volume: group.volumeNumber,
          LanguageISO: "zh",
        },
        __sortOrder: { groupIndex, linkIndex },
      } as Chapter & { __sortOrder: { groupIndex: number; linkIndex: number } }
    })
    .filter(
      (
        chapter
      ): chapter is Chapter & {
        __sortOrder: { groupIndex: number; linkIndex: number }
      } => chapter != null
    )

  mapped.sort((left, right) => {
    const leftNumber = left.chapterNumber
    const rightNumber = right.chapterNumber

    if (
      typeof leftNumber === "number" &&
      typeof rightNumber === "number" &&
      leftNumber !== rightNumber
    ) {
      return leftNumber - rightNumber
    }

    const leftId = Number.parseInt(left.id, 10)
    const rightId = Number.parseInt(right.id, 10)
    if (
      Number.isFinite(leftId) &&
      Number.isFinite(rightId) &&
      leftId !== rightId
    ) {
      return leftId - rightId
    }

    return left.__sortOrder.linkIndex - right.__sortOrder.linkIndex
  })

  return mapped.map((chapter) => {
    const { __sortOrder, ...rest } = chapter
    void __sortOrder
    return rest
  })
}

function mapChapterGroupsToVolumes(groups: ChapterGroup[]): VolumeState[] {
  return groups.map((group) => ({
    id: group.volumeId,
    title: group.title,
    label: group.title,
  }))
}

/**
 * Walk every `.chapter-list` group on the (possibly adult-gated) series page
 * and return a de-duplicated chapter list plus explicit volume groups.
 * Duplicate chapter IDs across groups are logged as errors since Manhuagui
 * should not emit them.
 */
export function extractChapterListFromDocument(documentLike: Document): {
  chapters: Chapter[]
  volumes: VolumeState[]
} {
  if (documentLike.querySelector("#checkAdult")) {
    return { chapters: [], volumes: [] }
  }
  const chapterDocument = documentLike
  const groups = extractChapterGroupsFromDocument(chapterDocument)
  const duplicateChapterIds = new Set<string>()
  const chapterById = new Map<string, Chapter>()

  groups.forEach((group, groupIndex) => {
    for (const chapter of mapChapterGroupToChapters(group, groupIndex)) {
      if (chapterById.has(chapter.id)) {
        duplicateChapterIds.add(chapter.id)
        continue
      }

      chapterById.set(chapter.id, chapter)
    }
  })

  if (duplicateChapterIds.size > 0) {
    logger.error(
      "[manhuagui] Duplicate chapter ids detected in extractChapterList",
      {
        duplicateChapterIds: [...duplicateChapterIds],
      }
    )
  }

  return {
    chapters: Array.from(chapterById.values()),
    volumes: mapChapterGroupsToVolumes(groups),
  }
}

/**
 * Extract series-level metadata from the `.book-cont` container on the series
 * page. Throws if the container or title are missing since those are required
 * fields for a valid {@link SeriesMetadata}.
 */
export function extractSeriesMetadataFromDocument(
  documentLike: Document
): SeriesMetadata {
  const bookContainer = documentLike.querySelector(".book-cont")
  if (!bookContainer) {
    throw new Error("Manhuagui series metadata container not found")
  }

  const title =
    getTextContent(bookContainer.querySelector(".book-title h1")) ||
    getAttribute(
      documentLike.querySelector('meta[property="og:title"]'),
      "content"
    )
  if (!title) {
    throw new Error("Manhuagui series title not found")
  }

  const subtitle = getTextContent(bookContainer.querySelector(".book-title h2"))
  const detailItems = Array.from(
    documentLike.querySelectorAll(".detail-list span")
  )
  const yearValue = readDetailValues(detailItems, 0)[0]
  const genres = readDetailValues(detailItems, 3)
  const authors = readDetailValues(detailItems, 4)
  const status = readDetailValues(detailItems, 7)[0]

  return {
    title,
    author: authors[0],
    description:
      getTextContent(bookContainer.querySelector("#intro-all")) ||
      getTextContent(bookContainer.querySelector(".book-intro")) ||
      undefined,
    coverUrl: toAllowedManhuaguiAssetUrl(
      getAttribute(bookContainer.querySelector(".hcover img"), "src") ||
        getAttribute(
          documentLike.querySelector('meta[property="og:image"]'),
          "content"
        )
    ),
    alternativeTitles: subtitle ? [subtitle] : undefined,
    year: yearValue ? Number.parseInt(yearValue, 10) : undefined,
    genres: genres.length > 0 ? genres : undefined,
    status,
    language: "zh",
  }
}
