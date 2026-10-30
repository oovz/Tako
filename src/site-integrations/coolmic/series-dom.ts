import type { Chapter } from "@/src/types/chapter"
import type { SeriesDataResolutionResult } from "@/src/types/site-integrations"
import { ProviderContractError } from "../provider-contract-error"
import { assertIntegrationEndpointRequestUrl } from "../request-policy"
import { CoolmicTitleBootstrapSchema } from "./contracts"
import { COOLMIC_ORIGIN, parseCoolmicId } from "./api"

type TitleBootstrap = ReturnType<typeof CoolmicTitleBootstrapSchema.parse>
type Episode = TitleBootstrap["episodes"][number]

function readTitleBootstrap(document: Document): TitleBootstrap {
  const raw = document
    .querySelector("title-page")
    ?.getAttribute(":page-objects")
  if (!raw || raw.length > 10_000_000)
    throw new ProviderContractError("Coolmic title bootstrap is unavailable")
  let source: unknown
  try {
    source = JSON.parse(raw)
  } catch {
    throw new ProviderContractError("Coolmic title bootstrap is invalid")
  }
  const parsed = CoolmicTitleBootstrapSchema.safeParse(source)
  if (!parsed.success)
    throw new ProviderContractError("Coolmic title response has changed")
  return parsed.data
}

function isEpisodeLocked(
  episode: Episode,
  user: TitleBootstrap["user"]
): boolean {
  return (
    episode.is_closed ||
    episode.images_count === 0 ||
    !(
      episode.is_free ||
      (user.is_login && episode.was_purchased) ||
      (user.is_login &&
        user.is_monthly_ticket_subscribed &&
        episode.is_subscription_free)
    )
  )
}

function readChapters(
  episodes: Episode[],
  user: TitleBootstrap["user"]
): Chapter[] {
  const seen = new Set<number>()
  const chapterList: Chapter[] = [...episodes]
    .sort((a, b) => a.display_order - b.display_order)
    .map((episode) => {
      if (seen.has(episode.id))
        throw new ProviderContractError(
          "Coolmic returned duplicate episode identities"
        )
      seen.add(episode.id)
      return {
        id: String(episode.id),
        url: `${COOLMIC_ORIGIN}/episodes/${episode.id}`,
        title: `${episode.number} ${episode.name}`,
        chapterLabel: episode.number,
        chapterNumber: /^\d+(?:\.\d+)?$/.test(episode.number)
          ? Number(episode.number)
          : undefined,
        locked: isEpisodeLocked(episode, user),
        comicInfo: {},
      }
    })
  return chapterList
}

export function resolveCoolmicDocument(
  document: Document,
  seriesUrl: string
): SeriesDataResolutionResult {
  const id = parseCoolmicId(seriesUrl, "titles")
  const { title, episodes, user, unreadable_title_error_code } =
    readTitleBootstrap(document)
  if (
    String(title.id) !== id ||
    unreadable_title_error_code ||
    title.is_hidden ||
    title.all_closed
  )
    throw new ProviderContractError(
      "Coolmic title is unavailable for this site session"
    )
  const coverUrl = assertIntegrationEndpointRequestUrl(
    "coolmic",
    "coolmic-cover",
    title.vertical_thumbnail_url
  ).href
  const chapterList = readChapters(episodes, user)
  return {
    seriesId: id,
    seriesMetadata: {
      title: title.name,
      description: title.summary,
      author: title.artists.map((artist) => artist.name).join(" / "),
      genres: title.genres.map((genre) => genre.name),
      coverUrl,
      status: title.is_completed ? "Completed" : "Ongoing",
      language: "en",
    },
    chapterList,
  }
}
