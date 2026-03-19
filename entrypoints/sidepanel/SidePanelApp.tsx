import { cn } from '@/src/shared/utils'
import { useActiveTaskProgress } from '@/entrypoints/sidepanel/hooks/useActiveTaskProgress'
import { useCommandCenterActions } from '@/entrypoints/sidepanel/hooks/useCommandCenterActions'
import {
  shouldMountInlineSelection,
  useInlineSelectionState,
} from '@/entrypoints/sidepanel/hooks/useInlineSelectionState'
import { useQueueView } from '@/entrypoints/sidepanel/hooks/useQueueView'
import { useSidepanelSeriesContext, type SidepanelSeriesContextData } from '@/entrypoints/sidepanel/hooks/useSidepanelSeriesContext'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ErrorBanner } from '@/entrypoints/sidepanel/components/ErrorBanner'
import { FsaBanner } from '@/entrypoints/sidepanel/components/FsaBanner'
import { SidePanelHeader } from '@/entrypoints/sidepanel/components/SidePanelHeader'
import { SidePanelQueueRegion } from '@/entrypoints/sidepanel/components/SidePanelQueueRegion'
import { SeriesContextCard } from '@/entrypoints/sidepanel/components/SeriesContextCard'
import { SeriesInlineSelection } from '@/entrypoints/sidepanel/components/SeriesInlineSelection'

export { shouldMountInlineSelection }

export function SidePanelApp() {
  const {
    chapterSelectionsBySeries,
    setChapterSelectionsBySeries,
    isInlineSelectionOpen,
    closeInlineSelection,
    toggleInlineSelection,
  } = useInlineSelectionState()
  const {
    cancelingTaskIds,
    handleCancelTask,
    handleRetryFailed,
    handleRestartTask,
    handleRemoveTask,
    handleMoveTaskToTop,
    openSettings,
    openFullHistory,
  } = useCommandCenterActions()

  const seriesData: SidepanelSeriesContextData = useSidepanelSeriesContext()
  const { activeTasks, queuedTasks, historyTasks, activeCount, queuedCount, isLoading } = useQueueView()
  const { progress: activeTaskProgress } = useActiveTaskProgress()

  const showActiveProgress = activeTaskProgress !== null

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex flex-col h-full w-full bg-background text-foreground select-none relative">
        <ErrorBanner />
        <div className="px-2 pt-2">
          <FsaBanner />
        </div>
        {/* Header with queue status badges - enlarged for better visibility */}
        <SidePanelHeader
          activeCount={activeCount}
          queuedCount={queuedCount}
          onOpenSettings={openSettings}
        />

        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          {/* Context-aware Series Card */}
          <div className="bg-background border-b border-border shadow-sm sticky top-0 z-20">
            <div className="p-4">
              <SeriesContextCard
                data={seriesData}
                isExpanded={isInlineSelectionOpen}
                onToggleInlineSelection={toggleInlineSelection}
              />
            </div>
          </div>

          {/* Inline Selection Panel */}
          <div
            className={cn(
              "overflow-hidden transition-all duration-300 ease-out flex-shrink-0 will-change-[height,opacity]",
              isInlineSelectionOpen ? "flex-1 min-h-0 opacity-100" : "h-0 opacity-0"
            )}
          >
            {shouldMountInlineSelection(isInlineSelectionOpen) && (
              <div className="border-t border-border bg-muted/30 flex flex-col h-full">
                <SeriesInlineSelection
                  data={seriesData}
                  chapterSelectionsBySeries={chapterSelectionsBySeries}
                  setChapterSelectionsBySeries={setChapterSelectionsBySeries}
                  onAfterStart={closeInlineSelection}
                />
              </div>
            )}
          </div>

          {/* Queue + History region */}
          <SidePanelQueueRegion
            activeTasks={activeTasks}
            queuedTasks={queuedTasks}
            historyTasks={historyTasks}
            isLoading={isLoading}
            isInlineSelectionOpen={isInlineSelectionOpen}
            cancelingTaskIds={cancelingTaskIds}
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
      </div>
    </TooltipProvider>
  )
}

