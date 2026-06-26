/**
 * Downloads Tab - Global Download Task Monitor
 * Centralized view of all download tasks across all tabs
 */

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
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
import { t } from '@/src/shared/i18n'

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
          <Loader2 className="size-8 mx-auto mb-4 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">{t('options_loadingDownloads')}</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-foreground">{t('options_downloads')}</h1>
        <p className="text-sm text-muted-foreground">{t('options_downloadsDesc')}</p>
      </div>

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
