import { usePanelLayoutMotion } from "./hooks/usePanelLayoutMotion"
import { useLayoutEffect, useRef, useState } from "react"
import { t } from "@/src/runtime/i18n"
import { useActiveTaskProgress } from "./hooks/useActiveTaskProgress"
import { useCommandCenterActions } from "./hooks/useCommandCenterActions"
import { useInlineSelectionState } from "./hooks/useInlineSelectionState"
import { useOptionsActionItems } from "./hooks/useOptionsActionItems"
import { useQueueView } from "./hooks/useQueueView"
import { useSidepanelSeriesContext } from "./hooks/useSidepanelSeriesContext"
import { TooltipProvider } from "@/components/ui/tooltip"
import { Toaster } from "@/components/ui/sonner"
import { ErrorBanner } from "./components/ErrorBanner"
import { SidePanelHeader } from "./components/SidePanelHeader"
import { SidePanelQueueRegion } from "./components/SidePanelQueueRegion"
import { resolveSeriesCardMessage } from "./components/SeriesContextCard"
import { SeriesInlineSelection } from "./components/SeriesInlineSelection"
import { RecentDownloads } from "./components/RecentDownloads"
import { QueueUndoProvider, QueueUndoRegion } from "./components/QueueUndo"
import { useSidePanelDocumentPreferences } from "./SidePanelApp-document"

type PanelView = "queue" | "manga" | "recent"

export function SidePanelApp() {
  useSidePanelDocumentPreferences()
  return (
    <TooltipProvider delayDuration={300}>
      <QueueUndoProvider>
        <PanelContent />
      </QueueUndoProvider>
    </TooltipProvider>
  )
}

function PanelContent() {
  const data = useSidepanelSeriesContext()
  const selection = useInlineSelectionState(data)
  const actions = useCommandCenterActions()
  const queue = useQueueView()
  const { progress } = useActiveTaskProgress()
  const hasOptionsActionItems = useOptionsActionItems()
  const [view, setView] = useState<PanelView>("queue")
  const queueTab = useRef<HTMLButtonElement>(null)
  const navigation = useRef<HTMLElement>(null)
  const recognizedManga = Boolean(
    data.siteId && data.seriesId && data.mangaTitle && !data.blockingMessage
  )
  const [knownManga, setKnownManga] = useState(false)
  const hasManga = data.isLoading ? knownManga : recognizedManga
  if (!data.isLoading && knownManga !== recognizedManga)
    setKnownManga(recognizedManga)
  const contextNotice = resolveSeriesCardMessage(data.blockingMessage)
  const available = queue.status === "ready" || queue.status === "stale"
  const visibleView = view === "manga" && !hasManga ? "queue" : view
  if (visibleView !== view) {
    setView(visibleView)
  }
  const wasManga = useRef(false)
  useLayoutEffect(() => {
    if (wasManga.current && !hasManga) queueTab.current?.focus()
    wasManga.current = view === "manga"
  }, [hasManga, view])
  const tabs: PanelView[] = hasManga
    ? ["queue", "manga", "recent"]
    : ["queue", "recent"]
  usePanelLayoutMotion(navigation, '[role="tab"]', tabs.join(","))
  const openQueue = () => {
    setView("queue")
    queueMicrotask(() => queueTab.current?.focus())
  }
  return (
    <div className="tako-sidepanel">
      <Toaster position="top-right" richColors closeButton />
      <a className="sr-only focus:not-sr-only" href="#sidepanel-main">
        {t("sidepanel_skipToContent")}
      </a>
      <ErrorBanner />
      <SidePanelHeader
        activeCount={available ? queue.activeCount : null}
        queuedCount={available ? queue.queuedCount : null}
        hasOptionsActionItems={hasOptionsActionItems}
        onOpenSettings={actions.openSettings}
      />
      <nav
        className="panel-tabs"
        ref={navigation}
        role="tablist"
        aria-label={t("sidepanel_navigation")}
        onKeyDown={(event) => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
            return
          event.preventDefault()
          const index = tabs.indexOf(visibleView)
          const next =
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? tabs.length - 1
                : (index +
                    (event.key === "ArrowRight" ? 1 : -1) +
                    tabs.length) %
                  tabs.length
          setView(tabs[next])
          event.currentTarget
            .querySelector<HTMLButtonElement>(
              '[data-view="' + tabs[next] + '"]'
            )
            ?.focus()
        }}
      >
        {tabs.map((tab) => (
          <button
            key={tab}
            ref={tab === "queue" ? queueTab : undefined}
            id={"panel-tab-" + tab}
            type="button"
            role="tab"
            data-view={tab}
            aria-selected={visibleView === tab}
            aria-controls={"panel-view-" + tab}
            tabIndex={visibleView === tab ? 0 : -1}
            onClick={() => setView(tab)}
          >
            {t("sidepanel_tab_" + tab)}
          </button>
        ))}
      </nav>
      <main id="sidepanel-main" className="panel-main" tabIndex={-1}>
        <section
          className="panel-page"
          role="tabpanel"
          id="panel-view-queue"
          aria-labelledby="panel-tab-queue"
          hidden={visibleView !== "queue"}
        >
          {contextNotice &&
            !data.retrySeriesContext &&
            queue.queueView.length === 0 && (
              <p className="panel-empty">{contextNotice.description}</p>
            )}
          {data.retrySeriesContext && (
            <div className="panel-context-error" role="status">
              <span>{t("sidepanel_seriesLoadFailed")}</span>
              <button type="button" onClick={data.retrySeriesContext}>
                {t("common_retry")}
              </button>
            </div>
          )}
          <SidePanelQueueRegion
            queueTasks={queue.queueView}
            historyTasks={queue.historyTasks}
            isLoading={queue.isLoading}
            readStatus={queue.status}
            onRefresh={queue.refresh}
            activeTaskProgress={progress}
            showActiveProgress={progress !== null}
            cancelingTaskIds={actions.cancelingTaskIds}
            retryingTaskIds={actions.retryingTaskIds}
            restartingTaskIds={actions.restartingTaskIds}
            removingTaskIds={actions.removingTaskIds}
            movingTaskIds={actions.movingTaskIds}
            onCancelTask={actions.handleCancelTask}
            onRetryFailed={actions.handleRetryFailed}
            onRestartTask={actions.handleRestartTask}
            onMoveTaskToTop={actions.handleMoveTaskToTop}
            onRemoveTask={actions.handleRemoveTask}
          />
        </section>
        {hasManga && (
          <section
            className="panel-page panel-manga"
            role="tabpanel"
            id="panel-view-manga"
            aria-labelledby="panel-tab-manga"
            hidden={visibleView !== "manga"}
          >
            <SeriesInlineSelection
              key={[data.windowId, data.tabId, data.seriesRevision].join(":")}
              data={data}
              chapterSelectionsBySeries={selection.chapterSelectionsBySeries}
              setChapterSelectionsBySeries={
                selection.setChapterSelectionsBySeries
              }
              presentationBySeries={selection.presentationBySeries}
              setPresentationBySeries={selection.setPresentationBySeries}
              onAfterStart={openQueue}
            />
          </section>
        )}
        <section
          className="panel-page"
          role="tabpanel"
          id="panel-view-recent"
          aria-labelledby="panel-tab-recent"
          hidden={visibleView !== "recent"}
        >
          <RecentDownloads
            chapters={data.downloadedChapters ?? []}
            coverTasks={[...queue.queueView, ...queue.historyTasks]}
            status={data.historyReadStatus}
            onRetry={data.retryHistory}
            onViewHistory={actions.openFullHistory}
          />
        </section>
      </main>
      <QueueUndoRegion />
    </div>
  )
}
