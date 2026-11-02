import { afterEach, expect, it, vi } from "vitest"
import { HistoryRepository } from "@/src/storage/history-repository"
import { SiteIntegrationEnablementService } from "@/src/storage/site-integration-enablement-service"
import { matchUrl } from "@/src/site-integrations/url-matcher"
import { initializeSiteIntegrationEnablement } from "@/src/runtime/site-integration-initialization"

const stored: Record<string, unknown> = {}
function installStorage() {
  vi.stubGlobal("chrome", {
    storage: {
      local: {
        get: async (keys: string | string[]) =>
          Object.fromEntries(
            (Array.isArray(keys) ? keys : [keys])
              .filter((key) => key in stored)
              .map((key) => [key, structuredClone(stored[key])])
          ),
        set: async (value: Record<string, unknown>) => {
          Object.assign(stored, structuredClone(value))
        },
      },
    },
  })
}
afterEach(() => {
  vi.unstubAllGlobals()
  for (const key of Object.keys(stored)) delete stored[key]
})

it("keeps both site enablement choices and matching chapter identities independent", async () => {
  installStorage()
  const enablement = new SiteIntegrationEnablementService()
  await enablement.setEnabled("manganato", false)
  await enablement.setEnabled("mangakakalot", true)
  await initializeSiteIntegrationEnablement(() => enablement.getAll())
  const slug = "s-class-hunter-heals-with-monsters"
  expect(matchUrl(`https://www.manganato.gg/manga/${slug}`)).toBeNull()
  expect(matchUrl(`https://www.mangakakalove.com/manga/${slug}`)).toEqual({
    integrationId: "mangakakalot",
    role: "series",
  })
  const history = new HistoryRepository()
  await history.markChapterAsDownloaded({
    siteIntegrationId: "manganato",
    seriesId: slug,
    seriesTitle: "S-Class Hunter Heals with Monsters",
    chapterId: "chapter-57",
    title: "Chapter 57",
    url: `https://www.manganato.gg/manga/${slug}/chapter-57`,
    downloadedAt: 100,
    saveConfirmedAt: 100,
    outputDestination: "fsa",
    format: "cbz",
  })
  expect(
    await history.isChapterDownloaded("manganato", slug, "chapter-57")
  ).toBe(true)
  expect(
    await history.isChapterDownloaded("mangakakalot", slug, "chapter-57")
  ).toBe(false)
  await history.markChapterAsDownloaded({
    siteIntegrationId: "mangakakalot",
    seriesId: slug,
    seriesTitle: "S-Class Hunter Heals with Monsters",
    chapterId: "chapter-57",
    title: "Chapter 57",
    url: `https://www.mangakakalove.com/manga/${slug}/chapter-57`,
    downloadedAt: 101,
    saveConfirmedAt: 101,
    outputDestination: "fsa",
    format: "cbz",
  })
  await history.clearSeriesDownloadHistory("manganato", slug)
  expect(
    await history.isChapterDownloaded("manganato", slug, "chapter-57")
  ).toBe(false)
  expect(
    await history.isChapterDownloaded("mangakakalot", slug, "chapter-57")
  ).toBe(true)
})
