import { beforeEach, describe, expect, it, vi } from "vitest"

const probes = vi.hoisted(() => ({
  mangadex: {
    id: "mangadex",
    collect: () => ({ url: globalThis.location.href }),
    parse: (raw: unknown) => raw as { url: string; data?: unknown },
  },
}))

vi.mock("@/src/runtime/generated/site-integration-page-probe-registry", () => ({
  siteIntegrationPageProbesById: probes,
}))

import { executeApprovedPageProbe } from "@/src/site-integrations/page-probe"
import { pageProbe as mangadexPageProbe } from "@/src/site-integrations/mangadex/probe"
import { pageProbe as manhuaguiPageProbe } from "@/src/site-integrations/manhuagui/probe"

describe("approved one-shot page probe", () => {
  const executeScript = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal("chrome", { scripting: { executeScript } })
  })

  it("looks up a provider probe and injects only its self-contained collector", async () => {
    executeScript.mockResolvedValue([
      { result: { url: "https://mangadex.org/title/series" } },
    ])

    await expect(executeApprovedPageProbe(12, "mangadex")).resolves.toEqual({
      url: "https://mangadex.org/title/series",
    })
    expect(executeScript).toHaveBeenCalledWith({
      target: { tabId: 12, frameIds: [0] },
      world: "ISOLATED",
      injectImmediately: true,
      func: probes.mangadex.collect,
    })
  })

  it("rejects an unknown provider probe instead of executing page code", async () => {
    await expect(executeApprovedPageProbe(12, "unknown")).rejects.toThrow(
      "No page probe is registered"
    )
    expect(executeScript).not.toHaveBeenCalled()
  })

  it("collects and parses bounded MangaDex preferences", () => {
    vi.stubGlobal("location", { href: "https://mangadex.org/title/series" })
    vi.stubGlobal("localStorage", {
      getItem: vi.fn(() =>
        JSON.stringify({
          userPreferences: {
            dataSaver: false,
            filteredLanguages: ["en", "ja"],
            ignored: "dropped",
          },
        })
      ),
    })
    const collected = mangadexPageProbe.collect() as {
      url: string
      data: unknown
    }
    expect(collected.url).toBe("https://mangadex.org/title/series")
    expect(mangadexPageProbe.parse(collected)).toEqual({
      url: collected.url,
      data: { dataSaver: false, filteredLanguages: ["en", "ja"] },
    })
  })

  it("rejects hostile MangaDex probe shapes", () => {
    expect(() =>
      mangadexPageProbe.parse({
        url: "https://mangadex.org/title/series",
        data: { token: "must-not-leave-the-page" },
      })
    ).toThrow()
  })

  it("parses only the bounded Manhuagui adult-gate snapshot", () => {
    expect(
      manhuaguiPageProbe.parse({
        url: "https://www.manhuagui.com/comic/21243/",
        data: {
          adultGatePresent: false,
          chapterHtml: '<div class="chapter"></div>',
        },
      })
    ).toEqual({
      url: "https://www.manhuagui.com/comic/21243/",
      data: {
        adultGatePresent: false,
        chapterHtml: '<div class="chapter"></div>',
      },
    })
  })

  it("rejects Manhuagui probe fields outside its approved snapshot", () => {
    expect(() =>
      manhuaguiPageProbe.parse({
        url: "https://www.manhuagui.com/comic/21243/",
        data: { adultGatePresent: false, cookie: "must-not-leave-the-page" },
      })
    ).toThrow()
  })
})
