import { Window } from "happy-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { offscreenSiteAdapter } from "@/src/site-integrations/mangago/offscreen-runtime"
import { parseMangagoProtocol } from "@/src/site-integrations/mangago/reader"
import { RateLimitService } from "@/src/runtime/rate-limit"
import contract from "@/tests/fixtures/site-integrations/mangago/contract.json"

const request = vi.hoisted(() => vi.fn())
vi.mock("@/src/site-integrations/http-client", () => ({
  integrationHttpClient: { request },
}))
const rateLimitService = new RateLimitService({
  resolveEffectivePolicy: async () => ({ concurrency: 1, delayMs: 0 }),
})
const input = {
  runtime: {
    rateLimitService,
    rateLimitSettings: {
      image: { concurrency: 1, delayMs: 0 },
      chapter: { concurrency: 1, delayMs: 0 },
    },
  },
}
const chapter = { id: "an:nml_chapter-420", url: contract.data.readerUrl }
const scriptUrl = "https://pic1.mangapicgallery.com/js/chapter.js?895"
const first =
  "https://iweb_9.mangapicgallery.com/r/newpiclink/chapter/first.jpg"
const second =
  "https://iweb_9.mangapicgallery.com/r/newpiclink/chapter/second.jpg"
const third =
  "https://iweb_9.mangapicgallery.com/r/newpiclink/chapter/third.jpg"
const protocol = parseMangagoProtocol(contract.data.protocolScript)

async function encryptedList(entries: string[]): Promise<string> {
  const plaintext = new TextEncoder().encode(entries.join(","))
  const padded = new Uint8Array(Math.ceil(plaintext.length / 16) * 16)
  padded.set(plaintext)
  const key = await crypto.subtle.importKey(
    "raw",
    protocol.key,
    "AES-CBC",
    false,
    ["encrypt"]
  )
  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-CBC", iv: protocol.iv },
      key,
      padded
    )
  )
  // The site uses zero padding; Web Crypto's final PKCS#7 block is omitted.
  return btoa(String.fromCharCode(...encrypted.subarray(0, -16)))
}

async function readerResponse(
  entries: string[],
  currentPage: number,
  totalPages = 3,
  script = scriptUrl
): Promise<Response> {
  const encrypted = await encryptedList(entries)
  return new Response(
    `<input id="curl" value="/an/nml_chapter-420/pg-{page}/"><script>total_pages=${totalPages}; current_page=${currentPage}; var imgsrcs='${encrypted}'</script><script src="${script}"></script>`,
    { headers: { "content-type": "text/html; charset=utf-8" } }
  )
}

beforeEach(() => {
  request.mockReset()
  vi.stubGlobal("DOMParser", new Window().DOMParser)
})
afterEach(() => {
  vi.unstubAllGlobals()
  rateLimitService.cleanupRateLimiters()
})
const resolvePlan = offscreenSiteAdapter.offscreen.chapter.resolveChapterPlan

describe("Mangago missing-page recovery", () => {
  it("merges later pages without replacing already accepted pages", async () => {
    request
      .mockResolvedValueOnce(await readerResponse([first, "", ""], 1))
      .mockResolvedValueOnce(new Response(contract.data.protocolScript))
      .mockResolvedValueOnce(await readerResponse([third, second, third], 2))
    await expect(resolvePlan(chapter, input)).resolves.toMatchObject({
      imageUrls: [first, second, third],
    })
    expect(request).toHaveBeenCalledTimes(3)
    expect(
      request.mock.calls.map(([call]) => ({
        url: call.url,
        endpoint: call.endpointId,
        credentials: call.init.credentials,
      }))
    ).toEqual([
      { url: chapter.url, endpoint: "mangago-page", credentials: "include" },
      { url: scriptUrl, endpoint: "mangago-script", credentials: "omit" },
      {
        url: chapter.url.replace("pg-1", "pg-2"),
        endpoint: "mangago-page",
        credentials: "include",
      },
    ])
  })

  it.each([
    { reason: "total pages", currentPage: 2, totalPages: 4, script: scriptUrl },
    {
      reason: "current page",
      currentPage: 3,
      totalPages: 3,
      script: scriptUrl,
    },
    {
      reason: "protocol version",
      currentPage: 2,
      totalPages: 3,
      script: scriptUrl + "-changed",
    },
  ])(
    "rejects recovery when $reason changes",
    async ({ currentPage, totalPages, script }) => {
      request
        .mockResolvedValueOnce(await readerResponse([first, "", ""], 1))
        .mockResolvedValueOnce(new Response(contract.data.protocolScript))
        .mockResolvedValueOnce(
          await readerResponse(
            [first, second, third],
            currentPage,
            totalPages,
            script
          )
        )
      await expect(resolvePlan(chapter, input)).rejects.toMatchObject({
        category: "provider_changed",
        message: expect.stringContaining("page sequence"),
      })
      expect(request).toHaveBeenCalledTimes(3)
    }
  )

  it("fails the required page when its recovery batch is still empty", async () => {
    request
      .mockResolvedValueOnce(await readerResponse([first, "", third], 1))
      .mockResolvedValueOnce(new Response(contract.data.protocolScript))
      .mockResolvedValueOnce(await readerResponse([first, "", third], 2))
    await expect(resolvePlan(chapter, input)).rejects.toMatchObject({
      category: "provider_changed",
      message: expect.stringContaining("page 2"),
    })
    expect(request).toHaveBeenCalledTimes(3)
  })

  it("observes cancellation before requesting the missing page", async () => {
    const controller = new AbortController()
    const cause = new Error("Chapter canceled")
    request
      .mockResolvedValueOnce(await readerResponse([first, "", third], 1))
      .mockImplementationOnce(async () => {
        controller.abort(cause)
        return new Response(contract.data.protocolScript)
      })
    await expect(
      resolvePlan(chapter, { ...input, signal: controller.signal })
    ).rejects.toBe(cause)
    expect(request).toHaveBeenCalledTimes(2)
  })

  it("releases the rejected protocol response body and preserves its status", async () => {
    const denied = new Response("Denied", { status: 403 })
    const cancel = vi.spyOn(denied.body!, "cancel")
    request
      .mockResolvedValueOnce(await readerResponse([first, second, third], 1))
      .mockResolvedValueOnce(denied)
    await expect(resolvePlan(chapter, input)).rejects.toMatchObject({
      status: 403,
    })
    expect(cancel).toHaveBeenCalledOnce()
  })
})
