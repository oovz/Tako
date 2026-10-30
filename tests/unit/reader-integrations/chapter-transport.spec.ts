// @vitest-environment happy-dom
import { readFileSync } from "node:fs"
import { afterEach, describe, expect, it, vi } from "vitest"
import { offscreenSiteAdapter as aimanhua } from "@/src/site-integrations/lovemanga/offscreen-runtime"
import { offscreenSiteAdapter as dm5 } from "@/src/site-integrations/animemangahouse/offscreen-runtime"
import dm5Fixture from "@/tests/fixtures/site-integrations/animemangahouse/contract.json"
import type { RateLimitService } from "@/src/runtime/rate-limit"
import { OffscreenLiveResourceLedger } from "@/src/runtime/offscreen-live-resource-ledger"

const rateLimitService = {
  scheduleForIntegrationScope: async <T>(
    _id: string,
    _scope: string,
    task: () => Promise<T>
  ) => task(),
} as unknown as RateLimitService
const runtime = {
  rateLimitService,
  rateLimitSettings: {
    chapter: { concurrency: 1, delayMs: 0 },
    image: { concurrency: 1, delayMs: 0 },
  },
}
const aimChapter = {
  id: "133632",
  url: "https://www.aimanhua.org/chapter/416895/133632",
}
function response(
  body: string | Uint8Array,
  url: string,
  type: string,
  status = 200
) {
  const result = new Response(
    typeof body === "string" ? body : new Uint8Array(body).buffer,
    {
      status,
      headers: { "content-type": type },
    }
  )
  Object.defineProperty(result, "url", { value: url })
  return result
}
afterEach(() => vi.unstubAllGlobals())

describe("reader chapter transport", () => {
  it("resolves Aimanhua's fetched encrypted reader through the chapter adapter", async () => {
    const html = readFileSync(
      "tests/fixtures/site-integrations/lovemanga/reader.html",
      "utf8"
    )
    const fetcher = vi.fn(async (url: string) =>
      response(html, url, "text/html; charset=utf-8")
    )
    vi.stubGlobal("fetch", fetcher)
    const plan = await aimanhua.offscreen.chapter.resolveChapterPlan(
      aimChapter,
      { runtime }
    )
    expect(plan.imageUrls).toHaveLength(73)
    expect(plan.imageUrls[0]).toMatch(
      /^https:\/\/img1\.baipiaoguai\.org\/static\/upload2\/book\//
    )
    expect(fetcher).toHaveBeenCalledOnce()
  })
  it("rejects a mismatched Aimanhua chapter before fetching", async () => {
    const fetcher = vi.fn()
    vi.stubGlobal("fetch", fetcher)
    await expect(
      aimanhua.offscreen.chapter.resolveChapterPlan(
        { ...aimChapter, id: "999" },
        { runtime }
      )
    ).rejects.toThrow(/identity/)
    expect(fetcher).not.toHaveBeenCalled()
  })
  it("discards an unsuccessful Aimanhua response body", async () => {
    const cancel = vi.fn()
    const failed = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("unavailable"))
        },
        cancel,
      }),
      { status: 503, headers: { "content-type": "text/html" } }
    )
    Object.defineProperty(failed, "url", { value: aimChapter.url })
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => failed)
    )
    await expect(
      aimanhua.offscreen.chapter.resolveChapterPlan(aimChapter, { runtime })
    ).rejects.toMatchObject({ status: 503 })
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce())
  })

  it("rejects duplicate required signed-reader pages across responses", async () => {
    const url = "https://www.dm5.com/m521974/"
    const html =
      '<script>DM5_CID=521974;DM5_MID=33991;DM5_IMAGE_COUNT=3;DM5_VIEWSIGN="signature";DM5_VIEWSIGN_DT="date";</script>'
    vi.stubGlobal(
      "fetch",
      vi.fn(async (value: string) =>
        response(
          value.includes("chapterfun") ? dm5Fixture.data.signedResponse : html,
          value,
          "text/html; charset=utf-8"
        )
      )
    )
    await expect(
      dm5.offscreen.chapter.resolveChapterPlan(
        { id: "521974", url },
        { runtime, signal: new AbortController().signal }
      )
    ).rejects.toThrow(/duplicate/)
  })
  it("rejects a signed-reader chapter route with a different selected identity", async () => {
    await expect(
      dm5.offscreen.chapter.resolveChapterPlan(
        { id: "9", url: "https://www.dm5.com/m8/" },
        { runtime }
      )
    ).rejects.toThrow(/chapter URL/)
  })
  it("downloads and retains a signed-reader cover image", async () => {
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAABoAAAACCAYAAABGz8w4AAAASUlEQVR4nL3NEQKAQAAAsNM0TYMkTdM0PU3TNE3TNE3TNE3TXlJ7RTBeCEV8E1IyckoqahpaIh09AyMTMwsrGzsHJxc3D+Gv6AOqBmUPS959fwAAAABJRU5ErkJggg==",
      "base64"
    )
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => response(png, url, "image/png"))
    )
    const ledger = new OffscreenLiveResourceLedger()
    const image = await dm5.offscreen.cover!.downloadImage(
      "https://cdn.cdndm5.com/cover.png",
      { runtime, liveResourceLedger: ledger }
    )
    expect(image.filename).toBe("cover.png")
    expect(new Uint8Array(image.data)).toEqual(new Uint8Array(png))
    image.liveResourceLease.release()
    expect(ledger.getUsedBytes()).toBe(0)
  })
})
