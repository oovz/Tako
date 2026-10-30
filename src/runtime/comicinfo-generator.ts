/**
 * ComicInfo.xml Generator Utility
 * Generates ComicInfo.xml metadata files for comic book archives (CBZ)
 *
 * Based on the ComicInfo.xml schema from the Anansi Project:
 * https://github.com/anansi-project/comicinfo
 *
 * This utility creates XML metadata that is compatible with popular comic readers
 * like Komga, Kavita, and other ComicInfo.xml-supporting applications.
 */

import type {
  ComicInfoV2,
  ComicInfoVersionSupport,
  ComicPageInfo,
} from "../types/comic-info"
import logger from "@/src/runtime/logger"

/**
 * ComicInfo version compatibility definitions. Only v2.0 is supported.
 */
export const COMICINFO_VERSION_SUPPORT: Record<"2.0", ComicInfoVersionSupport> =
  {
    "2.0": {
      version: "2.0",
      supportedFields: [
        // All fields from v2.0 spec
        "Title",
        "Series",
        "Number",
        "Count",
        "Volume",
        "AlternateSeries",
        "AlternateNumber",
        "AlternateCount",
        "Summary",
        "Notes",
        "Year",
        "Month",
        "Day",
        "Writer",
        "Penciller",
        "Inker",
        "Colorist",
        "Letterer",
        "CoverArtist",
        "Editor",
        "Publisher",
        "Imprint",
        "Genre",
        "Web",
        "PageCount",
        "LanguageISO",
        "Format",
        "BlackAndWhite",
        "Manga",
        "Characters",
        "Teams",
        "Locations",
        "MainCharacterOrTeam",
        "StoryArc",
        "SeriesGroup",
        "AgeRating",
        "CommunityRating",
        "Review",
        "ScanInformation",
        "Pages",
      ],
      requiredFields: [],
      enumValues: {
        BlackAndWhite: ["Yes", "No", "Unknown"],
        Manga: ["Yes", "No", "Unknown", "YesAndRightToLeft"],
      },
    },
  }

/**
 * Escape XML special characters
 * @param text - Text to escape
 * @returns Escaped text
 */
function escapeXML(text: string | number): string {
  if (typeof text !== "string") {
    return String(text)
  }

  // Strip XML 1.0 forbidden control characters (only HT/LF/CR allowed in C0 range)
  // Ref: https://www.w3.org/TR/xml/#charsets
  // eslint-disable-next-line no-control-regex
  const sanitized = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")

  return sanitized.replace(/[<>&"']/g, (char) => {
    switch (char) {
      case "<":
        return "&lt;"
      case ">":
        return "&gt;"
      case "&":
        return "&amp;"
      case '"':
        return "&quot;"
      case "'":
        return "&apos;"
      default:
        return char
    }
  })
}

/**
 * Filter metadata fields based on version support (always v2.0)
 */
function filterMetadataByVersion(
  metadata: ComicInfoV2,
  versionSupport: (typeof COMICINFO_VERSION_SUPPORT)["2.0"]
): ComicInfoV2 {
  const filtered: ComicInfoV2 = {}

  for (const [fieldKey, value] of Object.entries(metadata) as Array<
    [keyof ComicInfoV2, ComicInfoV2[keyof ComicInfoV2]]
  >) {
    if (versionSupport.supportedFields.includes(fieldKey)) {
      ;(filtered as Record<string, unknown>)[fieldKey] = value
    }
  }

  // Handle enum value filtering for version-specific enums
  if (
    filtered.Manga &&
    !versionSupport.enumValues.Manga.includes(String(filtered.Manga))
  ) {
    // Fallback to 'Yes' if unsupported enum value
    filtered.Manga = "Yes"
  }

  return filtered
}

/**
 * Clean and validate unified metadata
 */
function cleanMetadataValue(key: string, value: unknown): unknown {
  if (typeof value === "string") return value.trim() || undefined
  if (typeof value === "number") {
    return value > 0 ||
      ["Year", "Month", "Day", "Count", "Volume", "PageCount"].includes(key)
      ? value
      : undefined
  }
  return value
}

function cleanUnifiedMetadata(metadata: ComicInfoV2): ComicInfoV2 {
  const cleaned: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(metadata)) {
    const normalized = cleanMetadataValue(key, value)
    if (normalized !== null && normalized !== undefined)
      cleaned[key] = normalized
  }
  return cleaned
}

function renderMetadataField(
  fieldName: string,
  value: ComicInfoV2[keyof ComicInfoV2]
): string {
  if (value === null || value === undefined || value === "") return ""
  const text = typeof value === "object" ? JSON.stringify(value) : String(value)
  return `  <${fieldName}>${escapeXML(text)}</${fieldName}>\n`
}

function renderPageAttribute(
  name: string,
  value: ComicPageInfo[keyof ComicPageInfo],
  type: "string" | "number" | "boolean"
): string | undefined {
  if (type === "string") {
    return value ? `${name}="${escapeXML(String(value))}"` : undefined
  }
  return typeof value === type ? `${name}="${String(value)}"` : undefined
}

function renderComicPage(page: ComicPageInfo): string {
  const attributes = [
    `Image="${page.Image}"`,
    renderPageAttribute("Type", page.Type, "string"),
    renderPageAttribute("DoublePage", page.DoublePage, "boolean"),
    renderPageAttribute("ImageSize", page.ImageSize, "number"),
    renderPageAttribute("Key", page.Key, "string"),
    renderPageAttribute("Bookmark", page.Bookmark, "string"),
    renderPageAttribute("ImageWidth", page.ImageWidth, "number"),
    renderPageAttribute("ImageHeight", page.ImageHeight, "number"),
  ].filter((attribute) => attribute !== undefined)
  return `    <Page ${attributes.join(" ")} />\n`
}

function renderComicPages(
  metadata: ComicInfoV2,
  hasCoverImage: boolean
): string {
  if (Array.isArray(metadata.Pages) && metadata.Pages.length > 0) {
    let pages = ""
    for (const page of metadata.Pages) pages += renderComicPage(page)
    return `  <Pages>\n${pages}  </Pages>\n`
  }
  if (!hasCoverImage || !metadata.PageCount || metadata.PageCount <= 0)
    return ""
  let pages = '    <Page Image="0" Type="FrontCover" />\n'
  for (let index = 1; index < metadata.PageCount; index += 1) {
    pages += `    <Page Image="${index}" />\n`
  }
  return `  <Pages>\n${pages}  </Pages>\n`
}

/**
 * Generate version-specific XML content
 * @param metadata - Cleaned metadata
 * @param hasCoverImage - Whether to mark cover page
 */
function generateVersionSpecificXML(
  metadata: ComicInfoV2,
  hasCoverImage: boolean = false
): string {
  // Always generates ComicInfo v2.0 XML.
  let xml = '<?xml version="1.0" encoding="utf-8"?>\n'
  xml +=
    '<ComicInfo xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">\n'

  // Field order optimized for ComicInfo v2.0 specification
  const fieldOrder: (keyof ComicInfoV2)[] = [
    "Title",
    "Series",
    "Number",
    "Count",
    "Volume",
    "AlternateSeries",
    "AlternateNumber",
    "AlternateCount",
    "Summary",
    "Notes",
    "Year",
    "Month",
    "Day",
    "Writer",
    "Penciller",
    "Inker",
    "Colorist",
    "Letterer",
    "CoverArtist",
    "Editor",
    "Publisher",
    "Imprint",
    "Genre",
    "Characters",
    "Teams",
    "Locations",
    "MainCharacterOrTeam",
    "Web",
    "Format",
    "LanguageISO",
    "AgeRating",
    "BlackAndWhite",
    "Manga",
    "StoryArc",
    "SeriesGroup",
    "CommunityRating",
    "Review",
    "ScanInformation",
    "PageCount",
  ]

  for (const fieldName of fieldOrder) {
    xml += renderMetadataField(fieldName, metadata[fieldName])
  }

  xml += renderComicPages(metadata, hasCoverImage)

  xml += "</ComicInfo>"
  return xml
}

/**
 * Generate ComicInfo.xml content from metadata
 * @param metadata - Metadata object from the site integration
 * @param pageCount - Number of pages in the chapter
 * @param version - ComicInfo schema version (always '2.0')
 * @param hasCoverImage - Whether a cover image is included
 * @returns ComicInfo.xml content or null if metadata is empty
 */
export function generateComicInfo(
  metadata: ComicInfoV2 = {},
  pageCount: number = 0,
  version: "2.0" = "2.0",
  hasCoverImage: boolean = false // Cover image marker
): string | null {
  try {
    // Filter fields based on version
    const versionSupport = COMICINFO_VERSION_SUPPORT[version]
    const filteredMetadata = filterMetadataByVersion(metadata, versionSupport)

    // Clean and validate metadata
    const cleanedMetadata = cleanUnifiedMetadata(filteredMetadata)

    // Minimum metadata contract for downstream library indexing
    if (!cleanedMetadata.Series) {
      cleanedMetadata.Series = "Unknown Series"
    }
    if (
      typeof cleanedMetadata.LanguageISO === "string" &&
      cleanedMetadata.LanguageISO.toLowerCase().startsWith("ja") &&
      !cleanedMetadata.Manga
    ) {
      cleanedMetadata.Manga = "Yes"
    }

    // Add pageCount if provided
    if (pageCount > 0) {
      cleanedMetadata.PageCount = pageCount
    }

    // Add generation notes
    const currentDate = new Date()
    cleanedMetadata.Notes = cleanedMetadata.Notes || ""
    cleanedMetadata.Notes += `\nGenerated by Tako Manga Downloader (TMD) (https://github.com/oovz/Tako) on ${currentDate.toISOString()}`

    // Generate version-specific XML with cover marker if needed
    return generateVersionSpecificXML(cleanedMetadata, hasCoverImage)
  } catch (error) {
    logger.error("Failed to generate ComicInfo.xml:", error)
    // Return null when metadata extraction fails - no fallback generation
    return null
  }
}
