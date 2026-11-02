import { afterEach, describe, expect, it, vi } from "vitest"
import { BinaryWriter } from "@bufbuild/protobuf/wire"
import { HARD_TIMEOUT_MS } from "@/src/constants/timeouts"
import { OffscreenLiveResourceLedger } from "@/src/runtime/offscreen-live-resource-ledger"
import { RateLimitService } from "@/src/runtime/rate-limit"
import { offscreenSiteAdapter as coolmic } from "@/src/site-integrations/coolmic/offscreen-runtime"
import { integrationHttpClient } from "@/src/site-integrations/http-client"
import { offscreenSiteAdapter as mangaplus } from "@/src/site-integrations/mangaplus/offscreen-runtime"
import coolmicContract from "@/tests/fixtures/site-integrations/coolmic/contract.json"

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAABoAAAACCAYAAABGz8w4AAAASUlEQVR4nL3NEQKAQAAAsNM0TYMkTdM0PU3TNE3TNE3TNE3TXlJ7RTBeCEV8E1IyckoqahpaIh09AyMTMwsrGzsHJxc3D+Gv6AOqBmUPS959fwAAAABJRU5ErkJggg==",
  "base64"
)
const mangaPlusImageUrl =
  "https://jumpg-assets3.tokyo-cdn.com/secure/title/100467/chapter/1030661/manga_page/high/1.jpg?hash=synthetic&expires=1"

function mangaPlusViewer(count: number): Response {
  const viewer = new BinaryWriter()
  for (let index = 0; index < count; index++) {
    const image = new BinaryWriter()
      .tag(1, 2)
      .string(mangaPlusImageUrl)
      .tag(2, 0)
      .uint32(26)
      .tag(3, 0)
      .uint32(2)
      .tag(5, 2)
      .string("0102")
      .finish()
    viewer.tag(1, 2).bytes(new BinaryWriter().tag(1, 2).bytes(image).finish())
  }
  viewer.tag(2, 0).uint32(1030661).tag(19, 2).string("synthetic-viewer-token")
  const payload = new BinaryWriter()
    .tag(1, 2)
    .bytes(new BinaryWriter().tag(10, 2).bytes(viewer.finish()).finish())
    .finish()
  return new Response(new Uint8Array(payload).buffer, {
    headers: { "content-type": "application/protobuf" },
  })
}

function coolmicViewer(count: number): Response {
  const viewer = coolmicContract.data.viewer
  return Response.json({
    ...viewer,
    image_data: Array.from({ length: count }, (_, num) => ({
      ...viewer.image_data[0],
      num,
    })),
    signed_cookie: {
      ...viewer.signed_cookie,
      "CloudFront-Policy": Buffer.from(
        JSON.stringify({
          Statement: [
            {
              Condition: {
                DateLessThan: {
                  "AWS:EpochTime": Math.floor(Date.now() / 1000) + 60,
                },
              },
            },
          ],
        })
      ).toString("base64"),
    },
  })
}

const providers = [
  {
    name: "Coolmic",
    id: "coolmic",
    offscreen: coolmic.offscreen,
    chapter: { id: "130687", url: "https://coolmic.me/episodes/130687" },
    viewerEndpoint: "coolmic-viewer",
    viewer: coolmicViewer,
    encode: (bytes: Uint8Array) => bytes,
    lifetime: 60_000,
  },
  {
    name: "MANGA Plus",
    id: "mangaplus",
    offscreen: mangaplus.offscreen,
    chapter: {
      id: "1030661",
      url: "https://mangaplus.shueisha.co.jp/viewer/1030661",
    },
    viewerEndpoint: "mangaplus-api",
    viewer: mangaPlusViewer,
    encode: (bytes: Uint8Array) =>
      Uint8Array.from(bytes, (byte, index) => byte ^ [1, 2][index % 2]),
    lifetime: HARD_TIMEOUT_MS,
  },
]
type Provider = (typeof providers)[number]
const rateLimitService = new RateLimitService({
  resolveEffectivePolicy: async () => ({ concurrency: 1, delayMs: 0 }),
})
const runtime = {
  rateLimitService,
  rateLimitSettings: {
    image: { concurrency: 1, delayMs: 0 },
    chapter: { concurrency: 1, delayMs: 0 },
  },
}
const controllers: AbortController[] = []

function imageResponse(provider: Provider, bytes = png): Response {
  return new Response(new Uint8Array(provider.encode(bytes)).buffer, {
    headers: { "content-type": "application/octet-stream" },
  })
}

function requests(
  count = 1,
  image: (provider: Provider) => Promise<Response> = async (provider) =>
    imageResponse(provider)
) {
  return vi
    .spyOn(integrationHttpClient, "request")
    .mockImplementation((request) => {
      const provider = providers.find(
        (item) => item.id === request.integrationId
      )
      if (!provider) throw new Error("Unexpected provider")
      return request.endpointId === provider.viewerEndpoint
        ? Promise.resolve(provider.viewer(count))
        : image(provider)
    })
}

async function install(provider: Provider) {
  const controller = new AbortController()
  controllers.push(controller)
  const plan = await provider.offscreen.chapter.resolveChapterPlan(
    provider.chapter,
    { runtime, signal: controller.signal }
  )
  return { controller, url: plan.imageUrls[0] }
}

async function download(provider: Provider, url: string) {
  const ledger = new OffscreenLiveResourceLedger()
  const image = await provider.offscreen.chapter.downloadImage(url, {
    runtime,
    liveResourceLedger: ledger,
  })
  expect(new Uint8Array(image.data)).toEqual(new Uint8Array(png))
  image.liveResourceLease.release()
  expect(ledger.getUsedBytes()).toBe(0)
}

afterEach(() => {
  controllers.splice(0).forEach((controller) => controller.abort())
  rateLimitService.cleanupRateLimiters()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe.each(providers)("$name image access batches", (provider) => {
  it("keeps replacement access after an older download finishes", async () => {
    const started = Promise.withResolvers<void>()
    const pending = Promise.withResolvers<Response>()
    let first = true
    requests(1, async (item) => {
      if (!first) return imageResponse(item)
      first = false
      started.resolve()
      return pending.promise
    })
    const old = await install(provider)
    const finishing = download(provider, old.url)
    await started.promise
    const fresh = await install(provider)
    old.controller.abort()
    pending.resolve(imageResponse(provider))
    await finishing
    await download(provider, fresh.url)
  })

  it("retains access after invalid content so a retry can succeed", async () => {
    let valid = false
    requests(1, async (item) =>
      imageResponse(item, valid ? png : Buffer.from([1, 2, 3, 4]))
    )
    const { url } = await install(provider)
    const ledger = new OffscreenLiveResourceLedger()
    await expect(
      provider.offscreen.chapter.downloadImage(url, {
        runtime,
        liveResourceLedger: ledger,
      })
    ).rejects.toThrow(/invalid image content/)
    expect(ledger.getUsedBytes()).toBe(0)
    valid = true
    await download(provider, url)
  })

  it("consumes one authorization per duplicate URL occurrence", async () => {
    requests(2)
    const { url } = await install(provider)
    await download(provider, url)
    await download(provider, url)
    await expect(download(provider, url)).rejects.toThrow(/expired/)
  })

  it("keeps replacement access past the old deadline and cancellation", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-10-29T12:00:00Z"))
    requests()
    const old = await install(provider)
    await vi.advanceTimersByTimeAsync(1000)
    const fresh = await install(provider)
    old.controller.abort()
    await vi.advanceTimersByTimeAsync(provider.lifetime - 1000)
    await download(provider, fresh.url)
  })
})

it("keeps provider authorization batches independent", async () => {
  requests()
  const coolmicPlan = await install(providers[0])
  const mangaPlusPlan = await install(providers[1])
  coolmicPlan.controller.abort()
  await download(providers[1], mangaPlusPlan.url)
  await expect(download(providers[0], coolmicPlan.url)).rejects.toThrow(
    /expired/
  )
})
