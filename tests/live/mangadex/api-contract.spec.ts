import { test, expect } from "../../e2e/fixtures/extension"
import { redactDiagnosticText } from "../../../src/runtime/diagnostic-redaction"
import {
  mangadexFetchViaBrowser,
  type MangadexFetchResult,
} from "../fixtures/mangadex-request-helpers"

const MANGA_ID = "db692d58-4b13-4174-ae8c-30c515c0689c"

function assertMangadexResponseIsUsable(
  result: MangadexFetchResult,
  endpointName: string
): void {
  if (result.status === 429) {
    test.skip(true, "MangaDex API rate limit reached (HTTP 429)")
    return
  }

  expect(
    result.ok,
    result.status === 0
      ? `MangaDex ${endpointName} request failed: ${redactDiagnosticText(result.data)}`
      : `MangaDex ${endpointName} returned HTTP ${result.status}`
  ).toBe(true)
}

test.describe("MangaDex API contract (live)", () => {
  test("returns the manga ID and English title", async ({ context }) => {
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
        }
      }
    }

    expect(payload.result).toBe("ok")
    expect(payload.data?.id).toBe(MANGA_ID)
    expect(payload.data?.type).toBe("manga")
    expect(payload.data?.attributes?.title).toBeTruthy()
    expect(typeof payload.data?.attributes?.title?.en).toBe("string")
  })

  test("returns chapter IDs and numbers from the manga feed", async ({
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
          chapter?: string | null
        }
      }>
      total?: number
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

  test("returns an image server and chapter filenames", async ({ context }) => {
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
