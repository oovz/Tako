import { describe, expect, it } from "vitest"
import {
  resolveMangadexChapterFeedOptions,
  parseMangadexPagePreferences,
} from "@/src/site-integrations/mangadex/preferences"
import { waitForMangadexDelay } from "@/src/site-integrations/mangadex/api-delay"
import { afterEach, vi } from "vitest"

const preferences = {
  dataSaver: false,
  filteredLanguages: ["ja"],
  showSafe: true,
  showSuggestive: false,
  showErotic: true,
  showHentai: false,
}

describe("MangaDex preference precedence", () => {
  it("preserves explicit false ratings and fills only absent required preferences", () => {
    expect(
      parseMangadexPagePreferences({
        showSafe: false,
        showSuggestive: true,
        showErotic: false,
        showHentai: true,
      })
    ).toEqual({
      dataSaver: true,
      filteredLanguages: [],
      showSafe: false,
      showSuggestive: true,
      showErotic: false,
      showHentai: true,
    })
    expect(parseMangadexPagePreferences({})).toEqual({
      dataSaver: true,
      filteredLanguages: [],
    })
  })

  it("keeps an explicit empty language configuration ahead of page preferences", async () => {
    const reader = {
      getAll: async () => ({ mangadex: { chapterLanguageFilter: [] } }),
      getForSite: async () => ({}),
    }
    await expect(
      resolveMangadexChapterFeedOptions(undefined, preferences, reader)
    ).resolves.toEqual({
      languages: undefined,
      contentRatings: ["safe", "erotica"],
    })
    await expect(
      resolveMangadexChapterFeedOptions("en", preferences, reader)
    ).resolves.toEqual({
      languages: ["en"],
      contentRatings: ["safe", "erotica"],
    })
  })

  it("uses page preferences after settings reads fail and ignores them when auto-read is disabled", async () => {
    const reader = {
      getAll: async () => {
        throw new Error("unavailable")
      },
      getForSite: async () => ({}),
    }
    await expect(
      resolveMangadexChapterFeedOptions(undefined, preferences, reader)
    ).resolves.toEqual({
      languages: ["ja"],
      contentRatings: ["safe", "erotica"],
    })
    const disabledReader = {
      getAll: async () => ({
        mangadex: {
          autoReadMangaDexSettings: false,
          chapterLanguageFilter: ["en", 1],
        },
      }),
      getForSite: async () => ({}),
    }
    await expect(
      resolveMangadexChapterFeedOptions(undefined, preferences, disabledReader)
    ).resolves.toEqual({ languages: ["en"], contentRatings: undefined })
  })
})

describe("MangaDex provider wait", () => {
  afterEach(() => vi.useRealTimers())

  it("cleans its abort listener when a wait completes", async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const remove = vi.spyOn(controller.signal, "removeEventListener")
    const pending = waitForMangadexDelay(250, controller.signal)
    await vi.advanceTimersByTimeAsync(250)
    await pending
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function))
    expect(vi.getTimerCount()).toBe(0)
  })

  it("cancels an already aborted wait and treats nonpositive delays as complete", async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    controller.abort()
    await expect(waitForMangadexDelay(250, controller.signal)).rejects.toThrow(
      "aborted"
    )
    await expect(
      waitForMangadexDelay(0, controller.signal)
    ).resolves.toBeUndefined()
    await expect(waitForMangadexDelay(-1)).resolves.toBeUndefined()
    expect(vi.getTimerCount()).toBe(0)
  })
})
