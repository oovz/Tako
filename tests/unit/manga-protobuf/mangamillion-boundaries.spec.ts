import { afterEach, describe, expect, it, vi } from "vitest"
import { BinaryWriter } from "@bufbuild/protobuf/wire"
import { RateLimitService } from "@/src/runtime/rate-limit"

const rateLimitService = new RateLimitService({
  resolveEffectivePolicy: async () => ({ concurrency: 1, delayMs: 0 }),
})
const settings = { getAll: async () => ({}), getForSite: async () => ({}) }
function message(field: number, data: Uint8Array): Uint8Array {
  return new BinaryWriter().tag(field, 2).bytes(data).finish()
}
function response(bytes: Uint8Array): Response {
  return new Response(new Uint8Array(bytes).buffer)
}
function token(): Response {
  return response(
    message(170, new BinaryWriter().tag(1, 2).string("token").finish())
  )
}
async function fresh() {
  vi.resetModules()
  const [api, http, background] = await Promise.all([
    import("@/src/site-integrations/mangamillion/api"),
    import("@/src/site-integrations/http-client"),
    import("@/src/site-integrations/mangamillion/background-runtime"),
  ])
  return {
    api,
    http: http.integrationHttpClient,
    resolve:
      background.backgroundSiteAdapter.background.series!.resolveSeriesData,
  }
}
afterEach(() => {
  vi.restoreAllMocks()
  rateLimitService.cleanupRateLimiters()
})

describe("MangaMillion catalog projection boundaries", () => {
  it("projects absent metadata, unnamed chapters and duplicate identities while retaining group locks", async () => {
    const { http, resolve } = await fresh()
    const unnamed = new BinaryWriter().tag(3, 0).uint32(21).finish()
    const numbered = new BinaryWriter()
      .tag(1, 2)
      .string("#2.5")
      .tag(3, 0)
      .uint32(21)
      .finish()
    const group = new BinaryWriter()
      .tag(1, 0)
      .int32(3)
      .raw(message(2, unnamed))
      .raw(message(2, numbered))
      .raw(message(2, new Uint8Array()))
      .raw(message(2, new Uint8Array()))
      .finish()
    const list = message(60, message(2, group))
    vi.spyOn(http, "request").mockImplementation(async (input) => {
      if (input.url.endsWith("/register")) return token()
      if (input.url.includes("/title_detail"))
        return response(message(50, new Uint8Array()))
      return response(list)
    })
    const result = await resolve({
      seriesUrl: "https://mangamillion.shueisha.co.jp/title/7",
      rateLimitService,
      siteIntegrationSettingsReader: settings,
    })
    expect(result.seriesMetadata).toMatchObject({
      title: "MangaMillion 7",
      language: "en",
      readingDirection: "rtl",
    })
    expect(result.seriesMetadata?.coverUrl).toBeUndefined()
    expect(result.chapterList).toMatchObject([
      { id: "21", title: "Chapter", locked: true },
      { id: "21-2", title: "#2.5", chapterNumber: 2.5, locked: true },
      {
        id: "locked-3",
        url: "https://mangamillion.shueisha.co.jp/en/title/7#chapter-3",
        locked: true,
      },
      { id: "locked-4", locked: true },
    ])
  })

  it.each([new Error("catalog unavailable"), "catalog unavailable"])(
    "retains series metadata when chapter-list resolution rejects (%s)",
    async (cause) => {
      const { http, resolve } = await fresh()
      vi.spyOn(http, "request").mockImplementation(async (input) => {
        if (input.url.endsWith("/register")) return token()
        if (input.url.includes("/title_detail"))
          return response(message(50, new Uint8Array()))
        throw cause
      })
      await expect(
        resolve({
          seriesUrl: "https://mangamillion.shueisha.co.jp/title/7",
          rateLimitService,
          siteIntegrationSettingsReader: settings,
        })
      ).resolves.toMatchObject({
        seriesId: "7",
        seriesMetadata: { title: "MangaMillion 7" },
        chapterListError: "catalog unavailable",
      })
    }
  )

  it("rejects unsupported series URLs before requesting the API", async () => {
    const { http, resolve } = await fresh()
    const request = vi.spyOn(http, "request")
    await expect(
      resolve({
        seriesUrl: "https://other.example/title/7",
        rateLimitService,
        siteIntegrationSettingsReader: settings,
      })
    ).rejects.toThrow(/supported/)
    expect(request).not.toHaveBeenCalled()
  })
})

describe("MangaMillion registration result boundaries", () => {
  it.each(["provider message", ""])(
    "rejects unsuccessful protocol registration (%s)",
    async (error) => {
      const { api, http } = await fresh()
      const bytes = new BinaryWriter()
        .tag(1, 0)
        .int32(3)
        .tag(2, 2)
        .string(error)
        .finish()
      vi.spyOn(http, "request").mockResolvedValue(response(bytes))
      await expect(api.getDeviceToken(rateLimitService)).rejects.toThrow(
        error || "status 3"
      )
    }
  )

  it("rejects success without a token and permits a later registration", async () => {
    const { api, http } = await fresh()
    vi.spyOn(http, "request")
      .mockResolvedValueOnce(response(new Uint8Array()))
      .mockResolvedValueOnce(token())
    await expect(api.getDeviceToken(rateLimitService)).rejects.toThrow(/token/)
    await expect(api.getDeviceToken(rateLimitService)).resolves.toBe("token")
  })

  it("normalizes a non-Error rejection while preserving its cause", async () => {
    const { api, http } = await fresh()
    vi.spyOn(http, "request").mockRejectedValue("transport failed")
    await expect(api.getDeviceToken(rateLimitService)).rejects.toMatchObject({
      cause: "transport failed",
    })
  })

  it("honors caller cancellation triggered during registration dispatch", async () => {
    const { api, http } = await fresh()
    const controller = new AbortController()
    const cause = new Error("caller left during dispatch")
    vi.spyOn(http, "request").mockImplementation(async () => {
      controller.abort(cause)
      return token()
    })
    await expect(
      api.getDeviceToken(rateLimitService, controller.signal)
    ).rejects.toBe(cause)
  })
})
