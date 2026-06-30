import { AlertCircle, CheckCircle, Clock, Download, XCircle } from 'lucide-react'

import { Card, CardContent } from '@/components/ui/card'
import { DownloadTaskSection } from '@/entrypoints/options/components/DownloadTaskSection'
import type { DownloadTaskState } from '@/src/types/queue-state'
import { t } from '@/src/runtime/i18n'

interface DownloadTaskGroupsProps {
  tasks: DownloadTaskState[]
  activeTasks: DownloadTaskState[]
  queuedTasks: DownloadTaskState[]
  completedTasks: DownloadTaskState[]
  failedTasks: DownloadTaskState[]
  canceledTasks: DownloadTaskState[]
  onCancel: (taskId: string) => Promise<void>
  onRetry: (taskId: string) => Promise<void>
  onRestart: (taskId: string) => Promise<void>
  onRemove: (taskId: string) => Promise<void>
}

export function DownloadTaskGroups({
  tasks,
  activeTasks,
  queuedTasks,
  completedTasks,
  failedTasks,
  canceledTasks,
  onCancel,
  onRetry,
  onRestart,
  onRemove,
}: DownloadTaskGroupsProps) {
  return (
    <div className="flex flex-col gap-6">
      <DownloadTaskSection
        icon={<Download className="size-4" />}
        tasks={activeTasks}
        title={t('options_activeDownloads')}
        onCancel={onCancel}
        onRetry={onRetry}
        onRestart={onRestart}
        onRemove={onRemove}
      />

      <DownloadTaskSection
        icon={<Clock className="size-4" />}
        tasks={queuedTasks}
        title={t('options_queued')}
        onCancel={onCancel}
        onRetry={onRetry}
        onRestart={onRestart}
        onRemove={onRemove}
      />

      <DownloadTaskSection
        icon={<CheckCircle className="size-4" />}
        tasks={completedTasks}
        title={t('options_completed')}
        titleClassName="text-primary"
        onCancel={onCancel}
        onRetry={onRetry}
        onRestart={onRestart}
        onRemove={onRemove}
      />

      <DownloadTaskSection
        icon={<XCircle className="size-4" />}
        tasks={failedTasks}
        title={t('options_failedPartial')}
        titleClassName="text-destructive"
        onCancel={onCancel}
        onRetry={onRetry}
        onRestart={onRestart}
        onRemove={onRemove}
      />

      <DownloadTaskSection
        icon={<AlertCircle className="size-4" />}
        tasks={canceledTasks}
        title={t('options_canceled')}
        onCancel={onCancel}
        onRetry={onRetry}
        onRestart={onRestart}
        onRemove={onRemove}
      />

      {tasks.length === 0 && (
        <Card>
          <CardContent className="p-12 text-center">
            <Download className="size-16 mx-auto mb-4 text-muted-foreground" />
            <h3 className="text-lg font-medium mb-2">{t('sidepanel_noDownloadsYet')}</h3>
            <p className="text-sm text-muted-foreground">
              {t('options_openMangaToDownload')}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
