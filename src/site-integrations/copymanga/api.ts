import {
  CopyCatalogSchema,
  CopyChapterIdSchema,
  CopyImageUrlSchema,
  CopyReaderSchema,
} from "./contracts/api"
import { ProviderContractError } from "../provider-contract-error"
import type { Chapter } from "@/src/types/chapter"

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

export function parseCopyChapterCatalog(
  value: unknown,
  source: URL
): Chapter[] {
  const route = parseCopyUrl(source.href)
  const catalog = CopyCatalogSchema.parse(value)
  if (catalog.build.path_word !== route.slug)
    throw new ProviderContractError(
      "Copy catalog identity does not match the requested work"
    )
  const chapters: Chapter[] = []
  const seen = new Set<string>()
  if (Object.keys(catalog.groups).length > 100)
    throw new ProviderContractError("Copy catalog contains too many groups")
  const groups = Object.values(catalog.groups)
  if (
    groups.reduce((total, group) => total + group.chapters.length, 0) > 20_000
  ) {
    throw new ProviderContractError(
      "Copy chapter catalog exceeds the supported size"
    )
  }
  for (const group of groups) {
    if (group.count !== group.chapters.length)
      throw new ProviderContractError("Copy chapter catalog is incomplete")
    for (const chapter of group.chapters) {
      if (seen.has(chapter.id)) continue
      seen.add(chapter.id)
      chapters.push({
        id: chapter.id,
        title: chapter.name,
        url: new URL(
          `/comic/${route.slug}/chapter/${chapter.id}`,
          source.origin
        ).href,
        language: "zh",
        comicInfo: { Title: chapter.name },
      })
    }
  }
  if (!chapters.length || chapters.length > 20_000)
    throw new ProviderContractError("Copy chapter catalog is unavailable")
  return chapters
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
