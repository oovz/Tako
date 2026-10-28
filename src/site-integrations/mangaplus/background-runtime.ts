import type {
  BackgroundSiteAdapter,
  ServiceWorkerIntegration,
} from "@/src/types/site-integrations"
import type { Chapter } from "@/src/types/chapter"
import { assertIntegrationEndpointRequestUrl } from "../request-policy"
import { ProviderContractError } from "../provider-contract-error"
import { fetchMangaPlusTitle, MANGAPLUS_ORIGIN, parseMangaPlusId } from "./api"

const background: ServiceWorkerIntegration = {
  name: "MANGA Plus Background",
  series: {
    async resolveSeriesData(input) {
      const id = parseMangaPlusId(input.seriesUrl, "titles")
      const detail = await fetchMangaPlusTitle(
        id,
        input.rateLimitService,
        input.signal
      )
      const title = detail.title
      if (!title || String(title.id) !== id)
        throw new ProviderContractError("MANGA Plus returned a different title")
      const coverUrl = title.coverUrl
        ? assertIntegrationEndpointRequestUrl(
            "mangaplus",
            "mangaplus-image",
            title.coverUrl
          ).href
        : undefined
      const now = Date.now() / 1000
      const seen = new Set<number>()
      const chapterList: Chapter[] = []
      for (const chapter of detail.chapters) {
        if (chapter.titleId !== title.id)
          throw new ProviderContractError(
            "MANGA Plus returned a chapter from another title"
          )
        if (seen.has(chapter.id)) continue
        seen.add(chapter.id)
        const label = chapter.name.replace(/^#/, "")
        const chapterNumber = /^\d+(?:\.\d+)?$/.test(label)
          ? Number(label)
          : undefined
        chapterList.push({
          id: String(chapter.id),
          url: `${MANGAPLUS_ORIGIN}/viewer/${chapter.id}`,
          title: chapter.subtitle.trim() || chapter.name,
          chapterLabel: label,
          chapterNumber,
          locked:
            !!chapter.locked ||
            chapter.type !== 0 ||
            (chapter.start > 0 && chapter.start > now) ||
            (chapter.end > 0 && chapter.end < now),
          comicInfo: {},
        })
      }
      return {
        seriesId: id,
        seriesMetadata: {
          title: title.name,
          author: title.author,
          description: detail.description,
          coverUrl,
          language: [
            "en",
            "es",
            "fr",
            "id",
            "pt-BR",
            "ru",
            "th",
            "de",
            "it",
            "vi",
          ][title.language],
          publisher: "Shueisha",
        },
        chapterList,
      }
    },
  },
}
export const backgroundSiteAdapter: BackgroundSiteAdapter = { background }
