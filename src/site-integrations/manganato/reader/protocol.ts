import { z } from "zod"
import { MAX_CHAPTER_IMAGES } from "@/src/constants/timeouts"
import { ProviderContractError } from "../../provider-contract-error"

export type ManganatoSite = {
  id: "manganato" | "mangakakalot"
  name: string
  domain: string
}

export function canonicalManganatoUrl(
  value: string,
  site: ManganatoSite,
  reader = false
): URL {
  const url = new URL(value)
  const path = reader
    ? /^\/manga\/([a-z0-9-]+)\/(chapter-[a-z0-9.-]+)\/?$/
    : /^\/manga\/([a-z0-9-]+)\/?$/
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    ![site.domain, `www.${site.domain}`].includes(url.hostname) ||
    !path.test(url.pathname)
  ) {
    throw new ProviderContractError(
      `${site.name} URL does not match its supported ${reader ? "reader" : "series"} route`
    )
  }
  return new URL(url.pathname.replace(/\/$/, ""), `https://www.${site.domain}`)
}

export function assertManganatoImageUrl(value: string): URL {
  const url = new URL(value)
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    !(
      url.hostname.endsWith(".2xstorage.com") ||
      url.hostname === "storage.waitst.com"
    )
  ) {
    throw new ProviderContractError("Reader image destination is not allowed")
  }
  return url
}

const ChapterPageSchema = z.object({
  success: z.literal(true),
  data: z.object({
    chapters: z
      .array(
        z.object({
          chapter_name: z.string().trim().min(1).max(1000),
          chapter_slug: z.string().regex(/^chapter-[a-z0-9.-]+$/),
          chapter_num: z.number().finite().nonnegative(),
        })
      )
      .max(500),
    pagination: z.object({
      total: z.number().int().nonnegative().max(50_000),
      limit: z.number().int().positive().max(500),
      offset: z.number().int().nonnegative().max(50_000),
      has_more: z.boolean(),
    }),
  }),
})

export function parseManganatoChapterPage(value: unknown) {
  return ChapterPageSchema.parse(value)
}

export function parseManganatoChapterImages(html: string): string[] {
  const cdns = html.match(/\bvar\s+cdns\s*=\s*(\[[^;]*\])\s*;/)?.[1]
  const images = html.match(/\bvar\s+chapterImages\s*=\s*(\[[^;]*\])\s*;/)?.[1]
  if (!cdns || !images)
    throw new ProviderContractError("Reader image data is unavailable")
  const servers = z
    .array(z.string().max(2048))
    .min(1)
    .max(10)
    .parse(JSON.parse(cdns))
  const paths = z
    .array(z.string().min(1).max(4096))
    .min(1)
    .max(MAX_CHAPTER_IMAGES)
    .parse(JSON.parse(images))
  const server = assertManganatoImageUrl(servers[0])
  const urls = paths.map(
    (path) => assertManganatoImageUrl(new URL(path, server).href).href
  )
  if (new Set(urls).size !== urls.length)
    throw new ProviderContractError(
      "Reader image list contains duplicate pages"
    )
  return urls
}
