import { useCallback, useEffect, useRef } from "react"

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
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible"
import { ErrorBanner } from "@/entrypoints/sidepanel/components/ErrorBanner"
import { FsaBanner } from "@/entrypoints/sidepanel/components/FsaBanner"
import { SidePanelHeader } from "@/entrypoints/sidepanel/components/SidePanelHeader"
import { SidePanelQueueRegion } from "@/entrypoints/sidepanel/components/SidePanelQueueRegion"
import { SeriesContextCard } from "@/entrypoints/sidepanel/components/SeriesContextCard"
import { SeriesInlineSelection } from "@/entrypoints/sidepanel/components/SeriesInlineSelection"
import { useUiPreferences } from "@/src/ui/shared/hooks/useUiPreferences"
import { useI18n } from "@/src/ui/shared/hooks/useI18n"
import {
  applyUiPreferences,
  toDocumentLanguageTag,
} from "@/src/ui/shared/ui-preferences"

export function SidePanelApp() {
  const { value: uiPreferences, hydrated: uiPreferencesHydrated } =
    useUiPreferences()
  const { locale } = useI18n()
  useEffect(() => {
    if (!uiPreferencesHydrated) return
    void applyUiPreferences(uiPreferences)
  }, [uiPreferences, uiPreferencesHydrated])
  useEffect(() => {
    document.documentElement.lang = toDocumentLanguageTag(locale)
    document.title = t("extName")
  }, [locale])

  const {
    chapterSelectionsBySeries,
    setChapterSelectionsBySeries,
    presentationBySeries,
    setPresentationBySeries,
    isInlineSelectionOpen,
    setInlineSelectionOpen,
  } = useInlineSelectionState()
  const inlineSelectionTriggerRef = useRef<HTMLButtonElement>(null)
  const closeInlineSelectionAndRestoreFocus = useCallback(() => {
    setInlineSelectionOpen(false)
    inlineSelectionTriggerRef.current?.focus()
  }, [setInlineSelectionOpen])
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

  const seriesData: SidepanelSeriesContextData = useSidepanelSeriesContext()
  const { queueView, historyTasks, activeCount, queuedCount, isLoading } =
    useQueueView()
  const { progress: activeTaskProgress } = useActiveTaskProgress()
  const hasOptionsActionItems = useOptionsActionItems()

  const showActiveProgress = activeTaskProgress !== null

  return (
    <TooltipProvider delayDuration={300}>
      {/* Sonner Toaster: required to render toast.error() calls from
          useCommandCenterActions (retry/restart/move-top/remove).
          Without a mounted <Toaster />, sonner toasts are never visible. */}
      <Toaster position="top-right" richColors closeButton />
      <div className="relative flex h-full w-full min-w-0 flex-col bg-background text-foreground select-none">
        {/* Skip-to-content link for keyboard users — visually hidden until
            focused, then jumps focus past the header/banners to the main
            queue region. */}
        <a
          href="#sidepanel-main"
          className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:top-2 focus:left-2 focus:rounded-md focus:bg-primary focus:px-3 focus:py-1.5 focus:text-sm focus:font-medium focus:text-primary-foreground focus:shadow-md"
        >
          {t("sidepanel_skipToContent")}
        </a>
        <ErrorBanner />
        <div className="px-2 pt-2">
          <FsaBanner />
        </div>
        {/* Header with queue status badges - enlarged for better visibility */}
        <SidePanelHeader
          activeCount={activeCount}
          queuedCount={queuedCount}
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
            onOpenChange={setInlineSelectionOpen}
            className="contents"
          >
            {/* Context-aware Series Card */}
            <div className="bg-background border-b border-border shadow-sm sticky top-0 z-20">
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
                className={`relative min-h-0 basis-0 ${
                  isInlineSelectionOpen
                    ? "grow overflow-hidden"
                    : "grow-0 overflow-visible"
                }`}
              >
                <CollapsibleContent
                  id="inline-selection-panel"
                  data-sidepanel-inline-selection
                  aria-hidden={!isInlineSelectionOpen}
                  inert={!isInlineSelectionOpen}
                  className="h-full min-h-0 overflow-hidden"
                >
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
                </CollapsibleContent>
              </div>

              {/* Queue + History region */}
              <SidePanelQueueRegion
                queueTasks={queueView}
                historyTasks={historyTasks}
                isLoading={isLoading}
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
