import { TAB_NOT_SUPPORTED_MSG } from "../messages"
import { useState } from "react"
import { CoverPreview } from "./CoverPreview"
import type { SidepanelSeriesContextData } from "../hooks/useSidepanelSeriesContext"
import { getInlineSelectionViewSummary } from "./series-inline-selection-helpers"
import { t } from "@/src/runtime/i18n"

export function SeriesContextCard({
  data,
}: {
  data: SidepanelSeriesContextData
}) {
  const [details, setDetails] = useState(false)
  const { chapterCount, volumeCount } = getInlineSelectionViewSummary(
    data.items
  )
  if (data.isLoading)
    return (
      <header className="manga-header manga-header-loading" aria-hidden="true">
        <div className="manga-cover" />
        <div className="manga-loading-title" />
        <div className="manga-info manga-loading-info">
          <span />
          <span />
        </div>
      </header>
    )
  return (
    <header className="manga-header" data-details={details}>
      <div className="manga-cover">
        <CoverPreview
          alt=""
          className="object-cover"
          identity={
            data.coverUrl &&
            data.siteId &&
            data.seriesId &&
            data.windowId !== undefined &&
            data.tabId !== undefined &&
            data.seriesRevision !== undefined
              ? {
                  integrationId: data.siteId,
                  coverUrl: data.coverUrl,
                  source: {
                    kind: "series",
                    windowId: data.windowId,
                    tabId: data.tabId,
                    seriesRevision: data.seriesRevision,
                    seriesId: data.seriesId,
                  },
                }
              : undefined
          }
        />
      </div>
      <h1 title={data.mangaTitle}>{data.mangaTitle}</h1>
      <div className="manga-info">
        {data.author?.trim() && (
          <p className="manga-author">{data.author.trim()}</p>
        )}
        {!data.isChaptersLoading && (
          <p className="panel-meta">
            {volumeCount > 0 && (
              <>
                {t(
                  volumeCount === 1
                    ? "sidepanel_oneVolume"
                    : "sidepanel_volumeCount",
                  [String(volumeCount)]
                )}{" "}
                ·{" "}
              </>
            )}
            {t(
              chapterCount === 1
                ? "sidepanel_oneChapter"
                : "sidepanel_chapterCount",
              [String(chapterCount)]
            )}
          </p>
        )}
        {data.chapterListNotice === "adult-consent-required" && (
          <p className="panel-meta">{t("sidepanel_adultConsentRequired")}</p>
        )}
      </div>
      <button
        className="manga-details-toggle"
        type="button"
        aria-expanded={details}
        onClick={() => setDetails(!details)}
      >
        {t(details ? "sidepanel_lessDetail" : "sidepanel_moreDetails")}
      </button>
    </header>
  )
}

export function resolveSeriesCardMessage(blockingMessage: string | undefined) {
  if (!blockingMessage) return null
  return {
    title: t(
      blockingMessage === TAB_NOT_SUPPORTED_MSG
        ? "sidepanel_noSeriesDetected"
        : "sidepanel_pageNotRecognized"
    ),
    description: t("sidepanel_openSupportedPage"),
  }
}
