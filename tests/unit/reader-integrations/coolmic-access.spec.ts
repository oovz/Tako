// @vitest-environment happy-dom
import { readFileSync } from "node:fs"
import { afterEach, describe, expect, it, vi } from "vitest"
import { resolveCoolmicDocument } from "@/src/site-integrations/coolmic/series-dom"
import { offscreenSiteAdapter } from "@/src/site-integrations/coolmic/offscreen-runtime"
import { OffscreenLiveResourceLedger } from "@/src/runtime/offscreen-live-resource-ledger"
import type { RateLimitService } from "@/src/runtime/rate-limit"
import contract from "@/tests/fixtures/site-integrations/coolmic/contract.json"

const titleHtml = readFileSync(
  "tests/fixtures/site-integrations/coolmic/title-page.html",
  "utf8"
)
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
    image: { concurrency: 1, delayMs: 0 },
    chapter: { concurrency: 1, delayMs: 0 },
  },
}
const chapter = { id: "130687", url: "https://coolmic.me/episodes/130687" }
const aborts: AbortController[] = []
function policy(epoch: unknown) {
  return {
    Statement: [{ Condition: { DateLessThan: { "AWS:EpochTime": epoch } } }],
  }
}
function viewer(accessPolicy: unknown) {
  return {
    ...contract.data.viewer,
    image_data: [contract.data.viewer.image_data[0]],
    signed_cookie: {
      ...contract.data.viewer.signed_cookie,
      "CloudFront-Policy": Buffer.from(JSON.stringify(accessPolicy)).toString(
        "base64"
      ),
    },
  }
}
function imageResponse(data: Uint8Array, url: string) {
  const response = new Response(new Uint8Array(data).buffer, {
    headers: { "content-type": "binary/octet-stream" },
  })
  Object.defineProperty(response, "url", { value: url })
  return response
}
async function install(accessPolicy: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json(viewer(accessPolicy)))
  )
  const abort = new AbortController()
  aborts.push(abort)
  return {
    abort,
    plan: await offscreenSiteAdapter.offscreen.chapter.resolveChapterPlan(
      chapter,
      { runtime, signal: abort.signal }
    ),
  }
}
afterEach(() => {
  aborts.splice(0).forEach((abort) => abort.abort())
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe("Coolmic ComicInfo source data", () => {
  it("reads the title publisher, all credits, and the dated episode releases", () => {
    const document = new DOMParser().parseFromString(titleHtml, "text/html")
    const result = resolveCoolmicDocument(
      document,
      "https://coolmic.me/titles/5101"
    )

    expect(result.seriesMetadata).toMatchObject({
      author: "BILIBILI COMICS, h5.17k.com",
      publisher: "BILIBILI COMICS",
      readingDirection: "vertical",
    })
    expect(result.seriesMetadata?.communityRating).toBeUndefined()
    expect(result.chapterList).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "130687", releaseDate: "2025-07-24" }),
        expect.objectContaining({ id: "130735", releaseDate: "2025-08-07" }),
      ])
    )
  })

  it("preserves a voted five-star rating and omits an invalid release date", () => {
    const document = new DOMParser().parseFromString(titleHtml, "text/html")
    const node = document.querySelector("title-page")!
    const source = JSON.parse(node.getAttribute(":page-objects")!)
    source.title.rating_average = 4.25
    source.title.rating_records_count = 10
    source.title.agency = ""
    source.episodes[0].start_at = "02/30/25"
    node.setAttribute(":page-objects", JSON.stringify(source))

    const result = resolveCoolmicDocument(
      document,
      "https://coolmic.me/titles/5101"
    )
    expect(result.seriesMetadata?.communityRating).toBe(4.25)
    expect(result.seriesMetadata?.publisher).toBeUndefined()
    expect(result.chapterList).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "130687", releaseDate: undefined }),
      ])
    )
  })
})

describe("Coolmic episode availability", () => {
  it.each([
    {
      label: "free",
      loggedIn: false,
      ticket: false,
      free: true,
      purchased: false,
      subscription: false,
      closed: false,
      pages: 1,
      locked: false,
    },
    {
      label: "purchase for a signed-in user",
      loggedIn: true,
      ticket: false,
      free: false,
      purchased: true,
      subscription: false,
      closed: false,
      pages: 1,
      locked: false,
    },
    {
      label: "purchase while logged out",
      loggedIn: false,
      ticket: false,
      free: false,
      purchased: true,
      subscription: false,
      closed: false,
      pages: 1,
      locked: true,
    },
    {
      label: "subscribed episode",
      loggedIn: true,
      ticket: true,
      free: false,
      purchased: false,
      subscription: true,
      closed: false,
      pages: 1,
      locked: false,
    },
    {
      label: "episode outside subscription",
      loggedIn: true,
      ticket: true,
      free: false,
      purchased: false,
      subscription: false,
      closed: false,
      pages: 1,
      locked: true,
    },
    {
      label: "subscription while logged out",
      loggedIn: false,
      ticket: true,
      free: false,
      purchased: false,
      subscription: true,
      closed: false,
      pages: 1,
      locked: true,
    },
    {
      label: "closed free episode",
      loggedIn: true,
      ticket: true,
      free: true,
      purchased: true,
      subscription: true,
      closed: true,
      pages: 1,
      locked: true,
    },
    {
      label: "free episode without pages",
      loggedIn: false,
      ticket: false,
      free: true,
      purchased: false,
      subscription: false,
      closed: false,
      pages: 0,
      locked: true,
    },
  ])("respects $label access", (control) => {
    const document = new DOMParser().parseFromString(titleHtml, "text/html")
    const node = document.querySelector("title-page")!
    const bootstrap = JSON.parse(node.getAttribute(":page-objects")!)
    bootstrap.user = {
      is_login: control.loggedIn,
      is_monthly_ticket_subscribed: control.ticket,
    }
    bootstrap.episodes = [
      {
        ...bootstrap.episodes[0],
        is_free: control.free,
        was_purchased: control.purchased,
        is_subscription_free: control.subscription,
        is_closed: control.closed,
        images_count: control.pages,
      },
    ]
    node.setAttribute(":page-objects", JSON.stringify(bootstrap))
    const result = resolveCoolmicDocument(
      document,
      "https://coolmic.me/titles/5101"
    )
    expect(result.chapterList).toEqual([
      expect.objectContaining({ id: "130687", locked: control.locked }),
    ])
  })
})

describe("Coolmic signed image access", () => {
  it.each([null, {}, policy("not-a-number"), policy(1)])(
    "rejects unusable signed policy %j",
    async (accessPolicy) => {
      await expect(install(accessPolicy)).rejects.toThrow(/invalid or expired/)
    }
  )
  it("expires the retained credentials at their policy deadline", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-10-29T12:00:00Z"))
    const { plan } = await install(policy(Date.now() / 1000 + 5))
    await vi.advanceTimersByTimeAsync(5000)
    await expect(
      offscreenSiteAdapter.offscreen.chapter.downloadImage(plan.imageUrls[0], {
        runtime,
        liveResourceLedger: new OffscreenLiveResourceLedger(),
      })
    ).rejects.toThrow(/expired/)
  })
  it("releases transport ownership for invalid image content", async () => {
    const { plan } = await install(policy(Math.floor(Date.now() / 1000) + 60))
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        imageResponse(Uint8Array.of(1, 2, 3, 4), url)
      )
    )
    const ledger = new OffscreenLiveResourceLedger()
    await expect(
      offscreenSiteAdapter.offscreen.chapter.downloadImage(plan.imageUrls[0], {
        runtime,
        liveResourceLedger: ledger,
      })
    ).rejects.toThrow(/invalid image content/)
    expect(ledger.getUsedBytes()).toBe(0)
  })
  it("recognizes JPEG covers without attaching chapter signatures", async () => {
    const jpeg = Uint8Array.of(
      0xff,
      0xd8,
      0xff,
      0xc0,
      0,
      0x0b,
      8,
      0,
      2,
      0,
      2,
      3,
      1,
      0x11,
      0,
      0xff,
      0xd9
    )
    const fetcher = vi.fn(async (url: string) => imageResponse(jpeg, url))
    vi.stubGlobal("fetch", fetcher)
    const ledger = new OffscreenLiveResourceLedger()
    const image = await offscreenSiteAdapter.offscreen.cover!.downloadImage(
      "https://en-img.coolmic.me/cover.bin",
      {
        runtime,
        signal: new AbortController().signal,
        liveResourceLedger: ledger,
      }
    )
    expect(image.mimeType).toBe("image/jpeg")
    expect(image.filename).toBe("cover.jpg")
    expect(new URL(String(fetcher.mock.calls[0][0])).search).toBe("")
    image.liveResourceLease.release()
    expect(ledger.getUsedBytes()).toBe(0)
  })
  it("preserves a transport HTTP status while removing signed URL details", async () => {
    const { plan } = await install(policy(Math.floor(Date.now() / 1000) + 60))
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw Object.assign(new Error("Signature=secret"), { status: 403 })
      })
    )
    await expect(
      offscreenSiteAdapter.offscreen.chapter.downloadImage(plan.imageUrls[0], {
        runtime,
        signal: new AbortController().signal,
        liveResourceLedger: new OffscreenLiveResourceLedger(),
      })
    ).rejects.toMatchObject({
      message: "Coolmic image request failed",
      status: 403,
    })
  })
})
