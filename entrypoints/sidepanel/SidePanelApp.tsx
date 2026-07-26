import {
  type TransitionEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react"

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

function prefersReducedMotion() {
  if (typeof window === "undefined") return false

  return (
    document.documentElement.dataset.takoMotion === "reduce" ||
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
  )
}

export const INLINE_SELECTION_LAYOUT_TRANSITION_PROPERTY = "flex-grow"

export function shouldUnmountInlineSelectionAfterTransition(
  event: Pick<TransitionEvent, "propertyName">,
  isOpen: boolean,
  state: "open" | "closed"
): boolean {
  return (
    event.propertyName === INLINE_SELECTION_LAYOUT_TRANSITION_PROPERTY &&
    !isOpen &&
    state === "closed"
  )
}

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
  const [isInlineSelectionPresent, setInlineSelectionPresent] = useState(
    isInlineSelectionOpen
  )
  const isInlineSelectionVisible =
    isInlineSelectionOpen || isInlineSelectionPresent
  const updateInlineSelectionOpen = useCallback(
    (open: boolean) => {
      if (open || prefersReducedMotion()) {
        setInlineSelectionPresent(open)
      }
      setInlineSelectionOpen(open)
    },
    [setInlineSelectionOpen]
  )
  const inlineSelectionTriggerRef = useRef<HTMLButtonElement>(null)
  const closeInlineSelectionAndRestoreFocus = useCallback(() => {
    updateInlineSelectionOpen(false)
    inlineSelectionTriggerRef.current?.focus()
  }, [updateInlineSelectionOpen])
  const handleInlineSelectionTransitionEnd = useCallback(
    (event: TransitionEvent<HTMLDivElement>) => {
      if (event.target !== event.currentTarget) return

      const state = event.currentTarget.dataset.state as "open" | "closed"
      if (
        shouldUnmountInlineSelectionAfterTransition(
          event,
          isInlineSelectionOpen,
          state
        )
      ) {
        setInlineSelectionPresent(false)
      }
    },
    [isInlineSelectionOpen]
  )
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
            onOpenChange={updateInlineSelectionOpen}
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
                data-state={isInlineSelectionOpen ? "open" : "closed"}
                className={`relative min-h-0 basis-0 overflow-hidden transition-[flex-grow] duration-[280ms] ease-out ${
                  isInlineSelectionOpen ? "grow" : "grow-0"
                }`}
                onTransitionEnd={handleInlineSelectionTransitionEnd}
              >
                <div
                  id="inline-selection-panel"
                  data-sidepanel-inline-selection
                  data-state={isInlineSelectionOpen ? "open" : "closed"}
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
