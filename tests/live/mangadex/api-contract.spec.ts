import { test, expect } from "../../e2e/fixtures/extension"
import type { BrowserContext } from "@playwright/test"

const MANGA_ID = "db692d58-4b13-4174-ae8c-30c515c0689c"
const MANGADEX_LIVE_REQUEST_RETRIES = 3
const MANGADEX_LIVE_RETRY_DELAY_MS = 2_000

interface MangadexFetchResult {
  status: number
  ok: boolean
  headers: Record<string, string>
  data: unknown
}

async function mangadexFetchViaBrowser(
  context: BrowserContext,
  url: string
): Promise<MangadexFetchResult> {
  const page = await context.newPage()
  try {
    for (let attempt = 1; attempt <= MANGADEX_LIVE_REQUEST_RETRIES; attempt++) {
      await page.goto("https://mangadex.org", {
        waitUntil: "domcontentloaded",
      })

      const result = await page.evaluate(async (fetchUrl: string) => {
        try {
          const response = await fetch(fetchUrl, {
            headers: {
              Accept: "application/json",
            },
          })
          const headers: Record<string, string> = {}
          response.headers.forEach((value, key) => {
            headers[key] = value
          })
          let data: unknown = null
          try {
            data = await response.json()
          } catch {
            data = null
          }
          return {
            status: response.status,
            ok: response.ok,
            headers,
            data,
          }
        } catch (error) {
          return {
            status: 0,
            ok: false,
            headers: {},
            data: error instanceof Error ? error.message : String(error),
          }
        }
      }, url)

      if (result.status !== 429 && result.status !== 503) {
        return result
      }

      if (attempt < MANGADEX_LIVE_REQUEST_RETRIES) {
        const retryAfterSec = parseInt(result.headers["retry-after"] ?? "2", 10)
        const delayMs = Number.isFinite(retryAfterSec)
          ? retryAfterSec * 1_000
          : MANGADEX_LIVE_RETRY_DELAY_MS
        await page.waitForTimeout(delayMs)
      }
    }

    return {
      status: 429,
      ok: false,
      headers: {},
      data: "Rate-limited after all retries",
    }
  } finally {
    await page.close()
  }
}

function assertMangadexResponseIsUsable(
  result: MangadexFetchResult,
  _endpointName: string
): void {
  if (result.status === 429) {
    test.skip(true, "MangaDex API rate limit reached (HTTP 429)")
    return
  }

  expect(result.ok).toBe(true)
}

test.describe("MangaDex API contract (live)", () => {
  test("manga endpoint returns expected core fields", async ({ context }) => {
    const url = `https://api.mangadex.org/manga/${MANGA_ID}?includes[]=cover_art`
    const result = await mangadexFetchViaBrowser(context, url)
    assertMangadexResponseIsUsable(result, "manga")

    const payload = result.data as {
      result?: string
      data?: {
        id?: string
        type?: string
        attributes?: {
          title?: Record<string, string>
          description?: Record<string, string>
          originalLanguage?: string
          status?: string
          publicationDemographic?: string
          contentRating?: string
          tags?: Array<{
            id?: string
            type?: string
            attributes?: { name?: Record<string, string> }
          }>
        }
        relationships?: Array<{
          id?: string
          type?: string
          attributes?: { fileName?: string }
        }>
      }
    }

    expect(payload.result).toBe("ok")
    expect(payload.data?.id).toBe(MANGA_ID)
    expect(payload.data?.type).toBe("manga")
    expect(payload.data?.attributes?.title).toBeTruthy()
    expect(typeof payload.data?.attributes?.title?.en).toBe("string")
  })

  test("manga feed endpoint returns chapter payload shape", async ({
    context,
  }) => {
    const url =
      `https://api.mangadex.org/manga/${MANGA_ID}/feed?` +
      "limit=10&translatedLanguage[]=en&order[chapter]=desc&includeExternalUrl=0"
    const result = await mangadexFetchViaBrowser(context, url)
    assertMangadexResponseIsUsable(result, "feed")

    const payload = result.data as {
      result?: string
      data?: Array<{
        id?: string
        type?: string
        attributes?: {
          volume?: string | null
          chapter?: string | null
          title?: string | null
          translatedLanguage?: string
          externalUrl?: string | null
          pages?: number
        }
      }>
      total?: number
      limit?: number
      offset?: number
    }

    expect(payload.result).toBe("ok")
    expect(Array.isArray(payload.data)).toBe(true)
    expect(payload.data?.length).toBeGreaterThan(0)
    expect(typeof payload.total).toBe("number")
    expect(payload.total).toBeGreaterThan(0)

    const firstChapter = payload.data?.[0]
    expect(firstChapter?.type).toBe("chapter")
    expect(typeof firstChapter?.id).toBe("string")
    expect(typeof firstChapter?.attributes?.chapter).toBe("string")
  })

  test("at-home endpoint returns server data or rate-limit headers", async ({
    context,
  }) => {
    const feedUrl =
      `https://api.mangadex.org/manga/${MANGA_ID}/feed?` +
      "limit=1&translatedLanguage[]=en&order[chapter]=desc&includeExternalUrl=0"
    const feedResult = await mangadexFetchViaBrowser(context, feedUrl)
    assertMangadexResponseIsUsable(feedResult, "feed-for-at-home")

    const feedData = feedResult.data as {
      data?: Array<{ id?: string }>
    }
    const chapterId = feedData?.data?.[0]?.id
    if (!chapterId) {
      test.skip(true, "No chapter ID available to test at-home endpoint")
      return
    }

    const atHomeUrl = `https://api.mangadex.org/at-home/server/${chapterId}`
    const result = await mangadexFetchViaBrowser(context, atHomeUrl)
    assertMangadexResponseIsUsable(result, "at-home")

    const payload = result.data as {
      result?: string
      baseUrl?: string
      chapter?: {
        hash?: string
        data?: string[]
        dataSaver?: string[]
      }
    }

    expect(payload.result).toBe("ok")
    expect(typeof payload.baseUrl).toBe("string")
    expect(payload.baseUrl?.startsWith("https://")).toBe(true)
    expect(typeof payload.chapter?.hash).toBe("string")
    expect(Array.isArray(payload.chapter?.data)).toBe(true)
    expect(payload.chapter?.data?.length).toBeGreaterThan(0)
    expect(Array.isArray(payload.chapter?.dataSaver)).toBe(true)
    expect(payload.chapter?.dataSaver?.length).toBeGreaterThan(0)
  })
})
