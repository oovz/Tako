import type { BrowserContext } from "@playwright/test"

const MAX_ATTEMPTS = 3
const RETRY_DELAY_MS = 2_000

export interface MangadexFetchResult {
  status: number
  ok: boolean
  headers: Record<string, string>
  data: unknown
}

export async function mangadexFetchViaBrowser(
  context: BrowserContext,
  url: string
): Promise<MangadexFetchResult> {
  const page = await context.newPage()
  try {
    for (let attempt = 1; ; attempt++) {
      await page.goto("https://mangadex.org", {
        waitUntil: "domcontentloaded",
      })

      const result = await page.evaluate(async (fetchUrl: string) => {
        try {
          const response = await fetch(fetchUrl, {
            headers: { Accept: "application/json" },
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

      if (
        (result.status !== 429 && result.status !== 503) ||
        attempt >= MAX_ATTEMPTS
      ) {
        return result
      }

      const retryAfterSec = Number.parseInt(
        result.headers["retry-after"] ?? "2",
        10
      )
      const delayMs = Number.isFinite(retryAfterSec)
        ? retryAfterSec * 1_000
        : RETRY_DELAY_MS
      await page.waitForTimeout(delayMs)
    }
  } finally {
    await page.close()
  }
}
