import { CoverPreview } from "./CoverPreview"
import type { QueueTaskSummary } from "@/src/domain/queue/state"
import type { StorageReadStatus } from "@/src/ui/shared/hooks/useChromeStorageValue"
import { useEffect, useMemo, useState } from "react"
import { PanelIcon } from "./PanelIcon"
import type { DownloadedChapterRecord } from "@/src/domain/history/types"
import { composeDownloadedChapterKey } from "@/src/domain/history/types"
import { getDisplayName } from "@/src/site-integrations/catalog"
import { getUILanguage, t } from "@/src/runtime/i18n"
import { getOutputResultLabel } from "@/src/runtime/output-result-presentation"

export function relativeFinishedTime(
  timestamp: number,
  now: number,
  locale = getUILanguage()
): string {
  const minutes = Math.floor(Math.max(0, now - timestamp) / 60000)
  if (minutes === 0) return t("sidepanel_justNow")
  const formatter = new Intl.RelativeTimeFormat(locale.replace("_", "-"), {
    style: "narrow",
  })
  return minutes < 60
    ? formatter.format(-minutes, "minute")
    : minutes < 1440
      ? formatter.format(-Math.floor(minutes / 60), "hour")
      : formatter.format(-Math.floor(minutes / 1440), "day")
}

export function RecentDownloads({
  chapters,
  onViewHistory,
  status = "ready",
  onRetry,
  coverTasks = [],
}: {
  chapters: DownloadedChapterRecord[]
  status?: StorageReadStatus
  coverTasks?: QueueTaskSummary[]
  onRetry?: () => void
  onViewHistory: () => void | Promise<void>
}) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000)
    return () => clearInterval(timer)
  }, [])
  const recent = useMemo(
    () =>
      [...chapters]
        .sort(
          (a, b) =>
            (b.saveConfirmedAt ?? b.downloadedAt) -
            (a.saveConfirmedAt ?? a.downloadedAt)
        )
        .slice(0, 20),
    [chapters]
  )
  const covers = new Map(
    coverTasks
      .filter((task) => task.coverUrl)
      .map((task) => [task.seriesKey, task])
  )
  return (
    <div className="recent-downloads">
      <div className="recent-list">
        {status === "loading" && (
          <p className="panel-empty" role="status" aria-busy="true">
            {t("common_loading")}
          </p>
        )}
        {(status === "error" || status === "stale") && (
          <div className="panel-context-error" role="alert">
            <p>
              {t(
                status === "error"
                  ? "sidepanel_historyReadFailed"
                  : "sidepanel_historyStale"
              )}
            </p>
            <button type="button" onClick={onRetry}>
              {t("common_retry")}
            </button>
          </div>
        )}
        {status === "ready" && recent.length === 0 && (
          <p className="panel-empty">{t("sidepanel_noRecentDownloads")}</p>
        )}
        <ul>
          {recent.map((chapter) => (
            <li
              className="recent-row"
              key={composeDownloadedChapterKey(
                chapter.siteIntegrationId,
                chapter.seriesId,
                chapter.chapterId
              )}
            >
              <div className="recent-cover">
                <CoverPreview
                  alt=""
                  className="object-cover"
                  identity={(() => {
                    const task = covers.get(
                      chapter.siteIntegrationId + "#" + chapter.seriesId
                    )
                    return task?.coverUrl
                      ? {
                          integrationId: task.siteIntegration,
                          coverUrl: task.coverUrl,
                          source: { kind: "task", taskId: task.id },
                        }
                      : undefined
                  })()}
                />
              </div>
              <div className="recent-copy">
                <strong title={chapter.seriesTitle}>
                  {chapter.seriesTitle}
                </strong>
                <p className="recent-chapter" title={chapter.title}>
                  {chapter.title}
                </p>
                <p className="panel-meta">
                  {chapter.chapterNumber !== undefined && (
                    <>
                      {t("sidepanel_chapterNumber", [
                        String(chapter.chapterNumber),
                      ])}{" "}
                      ·{" "}
                    </>
                  )}
                  {getDisplayName(chapter.siteIntegrationId)}
                  {chapter.saveConfirmedAt !== undefined && (
                    <>
                      {" "}
                      ·{" "}
                      <time
                        dateTime={new Date(
                          chapter.saveConfirmedAt
                        ).toISOString()}
                        title={new Date(chapter.saveConfirmedAt).toLocaleString(
                          getUILanguage().replace("_", "-")
                        )}
                      >
                        {relativeFinishedTime(chapter.saveConfirmedAt, now)}
                      </time>
                    </>
                  )}
                </p>
              </div>
              <span
                className="recent-result"
                title={getOutputResultLabel(
                  chapter.outputDestination,
                  chapter.saveConfirmedAt
                )}
              >
                {chapter.saveConfirmedAt !== undefined && (
                  <PanelIcon name="check" />
                )}
                <span className="recent-result-label">
                  {getOutputResultLabel(
                    chapter.outputDestination,
                    chapter.saveConfirmedAt
                  )}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </div>
      <footer className="recent-footer">
        <button type="button" className="history-link" onClick={onViewHistory}>
          {t("sidepanel_viewHistoryOptions")}
          <PanelIcon name="external" />
        </button>
      </footer>
    </div>
  )
}
