import { beforeEach, describe, expect, it, vi } from "vitest"

import { OPTIONAL_BROAD_HTTPS_ORIGIN } from "@/src/site-integrations/host-permission-service"
import {
  collectApprovedPageProbeData,
  executeApprovedPageProbe,
} from "@/src/site-integrations/page-probe"

describe("approved one-shot page probe", () => {
  const executeScript = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal("chrome", { scripting: { executeScript } })
  })

  it("injects a fixed isolated-world function without selectors or code input", async () => {
    executeScript.mockResolvedValue([
      {
        result: {
          url: "https://mangadex.org/title/series",
          mangadexPreferences: {
            dataSaver: false,
            filteredLanguages: ["en"],
          },
        },
      },
    ])

    await expect(executeApprovedPageProbe(12, "mangadex")).resolves.toEqual({
      url: "https://mangadex.org/title/series",
      mangadexPreferences: {
        dataSaver: false,
        filteredLanguages: ["en"],
      },
    })
    expect(executeScript).toHaveBeenCalledWith({
      target: { tabId: 12, frameIds: [0] },
      world: "ISOLATED",
      injectImmediately: true,
      func: collectApprovedPageProbeData,
      args: ["mangadex"],
    })
    expect(OPTIONAL_BROAD_HTTPS_ORIGIN).toBe("https://*/*")
  })

  it("rejects malformed probe output", async () => {
    executeScript.mockResolvedValue([{ result: { url: 42 } }])
    await expect(executeApprovedPageProbe(12, "mangadex")).rejects.toThrow(
      "invalid URL"
    )
  })

  it("rejects probe data that includes fields outside the approved preference shape", async () => {
    executeScript.mockResolvedValue([
      {
        result: {
          url: "https://mangadex.org/title/series",
          mangadexPreferences: {
            dataSaver: false,
            authToken: "must-not-leave-the-page",
          },
        },
      },
    ])

    await expect(executeApprovedPageProbe(12, "mangadex")).rejects.toThrow(
      "invalid MangaDex preferences"
    )
  })

  it("accepts only the bounded Manhuagui live chapter snapshot shape", async () => {
    executeScript.mockResolvedValue([
      {
        result: {
          url: "https://www.manhuagui.com/comic/21243/",
          integrationContext: {
            adultGatePresent: false,
            chapterHtml:
              '<div class="chapter"><h4>Volume 1</h4><div class="chapter-list"></div></div>',
          },
        },
      },
    ])

    await expect(executeApprovedPageProbe(12, "manhuagui")).resolves.toEqual({
      url: "https://www.manhuagui.com/comic/21243/",
      integrationContext: {
        adultGatePresent: false,
        chapterHtml:
          '<div class="chapter"><h4>Volume 1</h4><div class="chapter-list"></div></div>',
      },
    })
  })

  it("rejects Manhuagui probe fields outside its approved snapshot", async () => {
    executeScript.mockResolvedValue([
      {
        result: {
          url: "https://www.manhuagui.com/comic/21243/",
          integrationContext: {
            adultGatePresent: false,
            cookie: "must-not-leave-the-page",
          },
        },
      },
    ])

    await expect(executeApprovedPageProbe(12, "manhuagui")).rejects.toThrow(
      "invalid Manhuagui context"
    )
  })
})
