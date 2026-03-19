/**
 * Downloads Tab - Global Download Task Monitor
 * Centralized view of all download tasks across all tabs
 */

import { useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import type { ExtensionSettings } from '@/src/storage/settings-types'
import { DownloadDestinationSection } from '@/entrypoints/options/components/DownloadDestinationSection'
import { DownloadsFsaBanner } from '@/entrypoints/options/components/DownloadsFsaBanner'
import { DownloadsHistoryActions } from '@/entrypoints/options/components/DownloadsHistoryActions'
import { DownloadTaskGroups } from '@/entrypoints/options/components/DownloadTaskGroups'
import { ClearHistoryDialog } from '@/entrypoints/options/components/ClearHistoryDialog'
import {
  formatBytes,
  getTaskStatusSummaryLabel,
  getTerminalTimestampLabel,
  chapterStatusBadgeClass,
  partitionDownloadTasks,
} from '@/entrypoints/options/components/downloads-tab-helpers'
import { useDownloadsTabState } from '@/entrypoints/options/hooks/useDownloadsTabState'

interface DownloadsTabProps {
  settings: ExtensionSettings
  onChange: (updates: Partial<ExtensionSettings>) => void
  selectedFolderName: string | null
  onPickFolder: () => Promise<void>
  isPickingFolder: boolean
}

export { chapterStatusBadgeClass, formatBytes, getTaskStatusSummaryLabel, getTerminalTimestampLabel }

export function DownloadsTab({
  settings,
  onChange,
  selectedFolderName,
  onPickFolder,
  isPickingFolder,
}: DownloadsTabProps) {
  const [showClearHistoryDialog, setShowClearHistoryDialog] = useState(false)
  const {
    tasks,
    isLoading,
    fsaError,
    historyStorageBytes,
    cancelTask,
    retryTask,
    restartTask,
    removeTask,
    clearAllHistory,
    dismissFsaBanner,
  } = useDownloadsTabState()
  const {
    activeTasks,
    queuedTasks,
    completedTasks,
    failedTasks,
    canceledTasks,
    terminalTasks,
  } = partitionDownloadTasks(tasks)

  const updateDownloads = (updates: Partial<ExtensionSettings['downloads']>) => {
    onChange({ downloads: { ...settings.downloads, ...updates } })
  }

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-12 text-center">
          <div className="h-8 w-8 mx-auto mb-4 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">Loading downloads...</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {fsaError?.active && (
        <DownloadsFsaBanner
          fsaError={fsaError}
          isPickingFolder={isPickingFolder}
          onPickFolder={onPickFolder}
          onDismiss={dismissFsaBanner}
        />
      )}

      <DownloadDestinationSection
        downloads={settings.downloads}
        selectedFolderName={selectedFolderName}
        isPickingFolder={isPickingFolder}
        onDownloadsChange={updateDownloads}
        onPickFolder={onPickFolder}
      />

      <DownloadsHistoryActions
        historyStorageBytes={historyStorageBytes}
        showClearHistory={terminalTasks.length > 0}
        onClearHistory={() => setShowClearHistoryDialog(true)}
      />

      <DownloadTaskGroups
        tasks={tasks}
        activeTasks={activeTasks}
        queuedTasks={queuedTasks}
        completedTasks={completedTasks}
        failedTasks={failedTasks}
        canceledTasks={canceledTasks}
        onCancel={cancelTask}
        onRetry={retryTask}
        onRestart={restartTask}
        onRemove={removeTask}
      />

      <ClearHistoryDialog
        open={showClearHistoryDialog}
        onOpenChange={setShowClearHistoryDialog}
        onConfirm={clearAllHistory}
      />
    </div>
  )
}
