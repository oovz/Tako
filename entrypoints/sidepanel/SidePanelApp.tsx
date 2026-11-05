import React from "react"

import { t } from "@/src/runtime/i18n"
import { useActiveTaskProgress } from "@/entrypoints/sidepanel/hooks/useActiveTaskProgress"
import { useCommandCenterActions } from "@/entrypoints/sidepanel/hooks/useCommandCenterActions"
import { useInlineSelectionState } from "@/entrypoints/sidepanel/hooks/useInlineSelectionState"
import { useOptionsActionItems } from "@/entrypoints/sidepanel/hooks/useOptionsActionItems"
import { useQueueView } from "@/entrypoints/sidepanel/hooks/useQueueView"
import {
  useSidepanelSeriesContext,
  type SidepanelSeriesContextData,
} from "@/entrypoints/sidepanel/hooks/useSidepanelSeriesContext"
import { TooltipProvider } from "@/components/ui/tooltip"
import { Toaster } from "@/components/ui/sonner"
import { Collapsible } from "@/components/ui/collapsible"
import { ErrorBanner } from "@/entrypoints/sidepanel/components/ErrorBanner"
import { SidePanelHeader } from "@/entrypoints/sidepanel/components/SidePanelHeader"
import { SidePanelQueueRegion } from "@/entrypoints/sidepanel/components/SidePanelQueueRegion"
import { SeriesContextCard } from "@/entrypoints/sidepanel/components/SeriesContextCard"
import { SeriesInlineSelection } from "@/entrypoints/sidepanel/components/SeriesInlineSelection"
import { useInlineSelectionPresence } from "./SidePanelApp-selection"
import { useSidePanelDocumentPreferences } from "./SidePanelApp-document"

export {
  INLINE_SELECTION_LAYOUT_TRANSITION_PROPERTY,
  shouldUnmountInlineSelectionAfterTransition,
} from "./SidePanelApp-selection"

export function SidePanelApp() {
  useSidePanelDocumentPreferences()

  const seriesData: SidepanelSeriesContextData = useSidepanelSeriesContext()
  const {
    chapterSelectionsBySeries,
    setChapterSelectionsBySeries,
    presentationBySeries,
    setPresentationBySeries,
    isInlineSelectionOpen,
    setInlineSelectionOpen,
  } = useInlineSelectionState(seriesData)
  const {
    isInlineSelectionVisible,
    updateInlineSelectionOpen,
    inlineSelectionTriggerRef,
    closeInlineSelectionAndRestoreFocus,
    handleInlineSelectionTransitionEnd,
  } = useInlineSelectionPresence(isInlineSelectionOpen, setInlineSelectionOpen)
  const {
    cancelingTaskIds,
    retryingTaskIds,
    restartingTaskIds,
    removingTaskIds,
    movingTaskIds,
    handleCancelTask,
    handleRetryFailed,
    handleRestartTask,
    handleRemoveTask,
    handleMoveTaskToTop,
    openSettings,
    openFullHistory,
  } = useCommandCenterActions()

  const {
    queueView,
    historyTasks,
    activeCount,
    queuedCount,
    isLoading,
    status,
    refresh,
  } = useQueueView()
  const { progress: activeTaskProgress } = useActiveTaskProgress()
  const hasOptionsActionItems = useOptionsActionItems()

  const showActiveProgress = activeTaskProgress !== null
  const countsAvailable = status === "ready" || status === "stale"
  const inlineSelectionState = isInlineSelectionOpen ? "open" : "closed"

  return (
    <TooltipProvider delayDuration={300}>
      <Toaster position="top-right" richColors closeButton />
      <div className="relative flex h-full w-full min-w-0 flex-col bg-background text-foreground select-none">
        {/* Keyboard users can skip directly to the queue. */}
        <a
          href="#sidepanel-main"
          className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:top-2 focus:left-2 focus:rounded-md focus:bg-primary focus:px-3 focus:py-1.5 focus:text-sm focus:font-medium focus:text-primary-foreground focus:shadow-md"
        >
          {t("sidepanel_skipToContent")}
        </a>
        <ErrorBanner />
        <SidePanelHeader
          activeCount={countsAvailable ? activeCount : null}
          queuedCount={countsAvailable ? queuedCount : null}
          hasOptionsActionItems={hasOptionsActionItems}
          onOpenSettings={openSettings}
        />

        <div
          id="sidepanel-main"
          className="flex-1 min-h-0 flex flex-col overflow-hidden"
          tabIndex={-1}
        >
          <Collapsible
            open={isInlineSelectionOpen}
            onOpenChange={updateInlineSelectionOpen}
            className="contents"
          >
            <div className="bg-background border-b border-border sticky top-0 z-20">
              <div className="p-4">
                <SeriesContextCard
                  data={seriesData}
                  isExpanded={isInlineSelectionOpen}
                  triggerRef={inlineSelectionTriggerRef}
                />
              </div>
            </div>

            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <div
                data-sidepanel-selection-region
                data-state={inlineSelectionState}
                className={`relative min-h-0 basis-0 overflow-hidden transition-[flex-grow] duration-[280ms] ease-out ${
                  isInlineSelectionOpen ? "grow" : "grow-0"
                }`}
                onTransitionEnd={handleInlineSelectionTransitionEnd}
              >
                <div
                  id="inline-selection-panel"
                  data-sidepanel-inline-selection
                  data-state={inlineSelectionState}
                  aria-hidden={!isInlineSelectionOpen}
                  inert={!isInlineSelectionOpen}
                  className="h-full min-h-0 overflow-hidden"
                >
                  {isInlineSelectionVisible && (
                    <div className="border-t border-border bg-muted/30 flex flex-col h-full">
                      <SeriesInlineSelection
                        data={seriesData}
                        chapterSelectionsBySeries={chapterSelectionsBySeries}
                        setChapterSelectionsBySeries={
                          setChapterSelectionsBySeries
                        }
                        presentationBySeries={presentationBySeries}
                        setPresentationBySeries={setPresentationBySeries}
                        onAfterStart={closeInlineSelectionAndRestoreFocus}
                      />
                    </div>
                  )}
                </div>
              </div>

              <SidePanelQueueRegion
                queueTasks={queueView}
                historyTasks={historyTasks}
                isLoading={isLoading}
                readStatus={status}
                onRefresh={refresh}
                isInlineSelectionOpen={isInlineSelectionOpen}
                cancelingTaskIds={cancelingTaskIds}
                retryingTaskIds={retryingTaskIds}
                restartingTaskIds={restartingTaskIds}
                removingTaskIds={removingTaskIds}
                movingTaskIds={movingTaskIds}
                activeTaskProgress={activeTaskProgress}
                showActiveProgress={showActiveProgress}
                onCancelTask={handleCancelTask}
                onRetryFailed={handleRetryFailed}
                onRestartTask={handleRestartTask}
                onMoveTaskToTop={handleMoveTaskToTop}
                onRemoveTask={handleRemoveTask}
                onViewFullHistory={openFullHistory}
              />
            </div>
          </Collapsible>
        </div>
      </div>
    </TooltipProvider>
  )
}
