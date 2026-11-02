import type { BrowserContext } from "@playwright/test"
import { describe, expect, it, vi } from "vitest"
import {
  mangadexFetchViaBrowser,
  type MangadexFetchResult,
} from "@/tests/live/fixtures/mangadex-request-helpers"

const REQUEST_URL = "https://api.mangadex.org/manga/series-1"

function createContext() {
  const page = {
    goto: vi.fn().mockResolvedValue(null),
    evaluate: vi.fn<() => Promise<MangadexFetchResult>>(),
    waitForTimeout: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  }
  const context = {
    newPage: vi.fn().mockResolvedValue(page),
  } as unknown as BrowserContext
  return { context, page }
}

describe("live MangaDex requests", () => {
  it.each([429, 503])(
    "preserves HTTP %i after the retry limit",
    async (status) => {
      const { context, page } = createContext()
      const result = {
        status,
        ok: false,
        headers: { "retry-after": "3" },
        data: { error: `HTTP ${status}` },
      }
      page.evaluate.mockResolvedValue(result)

      await expect(
        mangadexFetchViaBrowser(context, REQUEST_URL)
      ).resolves.toEqual(result)
      expect(page.evaluate).toHaveBeenCalledTimes(3)
      expect(page.waitForTimeout).toHaveBeenCalledTimes(2)
      expect(page.waitForTimeout).toHaveBeenCalledWith(3_000)
      expect(page.close).toHaveBeenCalledOnce()
    }
  )

  it("returns a successful retry after an invalid Retry-After header", async () => {
    const { context, page } = createContext()
    const success = {
      status: 200,
      ok: true,
      headers: {},
      data: { result: "ok" },
    }
    page.evaluate
      .mockResolvedValueOnce({
        status: 503,
        ok: false,
        headers: { "retry-after": "invalid" },
        data: null,
      })
      .mockResolvedValueOnce(success)

    await expect(
      mangadexFetchViaBrowser(context, REQUEST_URL)
    ).resolves.toEqual(success)
    expect(page.evaluate).toHaveBeenCalledTimes(2)
    expect(page.waitForTimeout).toHaveBeenCalledOnce()
    expect(page.waitForTimeout).toHaveBeenCalledWith(2_000)
    expect(page.close).toHaveBeenCalledOnce()
  })

  it("returns non-retryable failures immediately", async () => {
    const { context, page } = createContext()
    const result = { status: 403, ok: false, headers: {}, data: null }
    page.evaluate.mockResolvedValue(result)

    await expect(
      mangadexFetchViaBrowser(context, REQUEST_URL)
    ).resolves.toEqual(result)
    expect(page.evaluate).toHaveBeenCalledOnce()
    expect(page.waitForTimeout).not.toHaveBeenCalled()
    expect(page.close).toHaveBeenCalledOnce()
  })

  it("closes the page after navigation fails", async () => {
    const { context, page } = createContext()
    const error = new Error("Navigation failed")
    page.goto.mockRejectedValue(error)

    await expect(mangadexFetchViaBrowser(context, REQUEST_URL)).rejects.toBe(
      error
    )
    expect(page.evaluate).not.toHaveBeenCalled()
    expect(page.close).toHaveBeenCalledOnce()
  })
})
