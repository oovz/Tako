import {
  CopyCatalogSchema,
  CopyChapterIdSchema,
  CopyImageUrlSchema,
  CopyReaderSchema,
} from "./contracts/api"
import { ProviderContractError } from "../provider-contract-error"
import type { Chapter } from "@/src/types/chapter"
import type { VolumeState } from "@/src/types/tab-state"
import {
  normalizeNumericText,
  parseChapterNumber,
} from "@/src/shared/site-integration-utils"

export function parseCopyUrl(value: string): {
  url: URL
  slug: string
  chapterId?: string
} {
  const url = new URL(value)
  if (
    url.protocol !== "https:" ||
    !["www.copy3000.com", "www.copy4000.com"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.port
  )
    throw new ProviderContractError("Copy origin is unavailable")
  const match = url.pathname.match(
    /^\/comic\/([a-z0-9_-]+)(?:\/chapter\/([a-f0-9-]{36}))?\/?$/
  )
  if (!match)
    throw new ProviderContractError("Copy series route is unavailable")
  return {
    url,
    slug: match[1],
    chapterId: match[2] ? CopyChapterIdSchema.parse(match[2]) : undefined,
  }
}

export async function decodeCopyPayload(
  value: string,
  keyText: string
): Promise<unknown> {
  if (
    value.length > 10_000_000 ||
    !/^[A-Za-z0-9]{16}(?:[a-f0-9]{32})+$/i.test(value) ||
    new TextEncoder().encode(keyText).length !== 16
  )
    throw new ProviderContractError("Copy encrypted reader data is unavailable")
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(keyText),
    { name: "AES-CBC" },
    false,
    ["decrypt"]
  )
  const hex = value.slice(16)
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i++)
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-CBC", iv: new TextEncoder().encode(value.slice(0, 16)) },
      key,
      bytes
    )
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(plain)
    ) as unknown
  } catch {
    throw new ProviderContractError(
      "Copy encrypted reader data could not be decoded"
    )
  }
}

export function readCopyKey(html: string, variable: "ccz" | "cct"): string {
  const key = html.match(
    new RegExp(`\\bvar\\s+${variable}\\s*=\\s*['"]([^'"<>]{16})['"]`)
  )?.[1]
  if (!key) throw new ProviderContractError("Copy reader key is unavailable")
  return key
}

type CopyCatalog = ReturnType<typeof CopyCatalogSchema.parse>
type CopyChapter = CopyCatalog["groups"][string]["chapters"][number]

function readChapter(
  chapter: CopyChapter,
  typeName: string,
  groupId: string,
  groupName: string,
  slug: string,
  source: URL
): Chapter {
  const volumeMatch =
    chapter.type === 2
      ? normalizeNumericText(chapter.name).match(/^第\s*(\d+)\s*卷$/)
      : null
  const volumeNumber = volumeMatch
    ? parseChapterNumber(volumeMatch[1])
    : undefined
  const chapterNumber =
    chapter.type === 1 ? parseChapterNumber(chapter.name) : undefined
  return {
    id: chapter.id,
    title: chapter.name,
    url: new URL(`/comic/${slug}/chapter/${chapter.id}`, source.origin).href,
    language: "zh",
    chapterLabel:
      chapter.type === 1 || chapter.type === 3 ? chapter.name : undefined,
    chapterNumber,
    volumeId: `copy:${groupId}:${chapter.type}`,
    volumeLabel: `${groupName} · ${typeName}`,
    volumeNumber,
    blackAndWhite: /\[全彩\]$/.test(chapter.name) ? "No" : undefined,
    comicInfo: { Title: chapter.name, Volume: volumeNumber },
  }
}

function assertCatalogBounds(
  catalog: CopyCatalog,
  groups: [string, CopyCatalog["groups"][string]][]
): void {
  if (new Set(catalog.build.type.map((type) => type.id)).size !== 3)
    throw new ProviderContractError("Copy catalog categories are unavailable")
  if (Object.keys(catalog.groups).length > 100)
    throw new ProviderContractError("Copy catalog contains too many groups")
  if (
    groups.reduce((total, [, group]) => total + group.chapters.length, 0) >
    20_000
  ) {
    throw new ProviderContractError(
      "Copy chapter catalog exceeds the supported size"
    )
  }
}

function readGroupVolumes(
  groupId: string,
  groupName: string,
  types: CopyCatalog["build"]["type"]
): VolumeState[] {
  const volumes: VolumeState[] = []
  for (const type of types) {
    const label = `${groupName} · ${type.name}`
    volumes.push({ id: `copy:${groupId}:${type.id}`, title: label, label })
  }
  return volumes
}

export function parseCopyChapterCatalog(
  value: unknown,
  source: URL
): { chapters: Chapter[]; volumes: VolumeState[] } {
  const route = parseCopyUrl(source.href)
  const catalog = CopyCatalogSchema.parse(value)
  if (catalog.build.path_word !== route.slug)
    throw new ProviderContractError(
      "Copy catalog identity does not match the requested work"
    )
  const chapters: Chapter[] = []
  const volumes: VolumeState[] = []
  const seen = new Set<string>()
  const groups = Object.entries(catalog.groups)
  assertCatalogBounds(catalog, groups)
  for (const [groupId, group] of groups) {
    if (group.count !== group.chapters.length)
      throw new ProviderContractError("Copy chapter catalog is incomplete")
    volumes.push(...readGroupVolumes(groupId, group.name, catalog.build.type))
    // Keep each category contiguous while preserving its source entry order.
    for (const type of catalog.build.type) {
      for (const chapter of group.chapters.filter(
        (entry) => entry.type === type.id
      )) {
        if (seen.has(chapter.id)) continue
        seen.add(chapter.id)
        chapters.push(
          readChapter(
            chapter,
            type.name,
            groupId,
            group.name,
            route.slug,
            source
          )
        )
      }
    }
  }
  if (!chapters.length || chapters.length > 20_000)
    throw new ProviderContractError("Copy chapter catalog is unavailable")
  return { chapters, volumes }
}

export async function parseCopyReader(html: string): Promise<string[]> {
  const payload = html.match(
    /\bvar\s+contentKey\s*=\s*['"]([A-Za-z0-9]+)['"]/
  )?.[1]
  if (!payload)
    throw new ProviderContractError("Copy chapter content is unavailable")
  const images = CopyReaderSchema.parse(
    await decodeCopyPayload(payload, readCopyKey(html, "cct"))
  )
  return images.map((image) => image.url)
}

export function normalizeCopyImageUrl(value: string): string {
  return CopyImageUrlSchema.parse(value)
}
