import { AlertCircle, CheckCircle, Clock, Download, XCircle } from 'lucide-react'

import { Card, CardContent } from '@/components/ui/card'
import { DownloadTaskSection } from '@/entrypoints/options/components/DownloadTaskSection'
import type { DownloadTaskState } from '@/src/types/queue-state'

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
    <div className="space-y-6">
      <DownloadTaskSection
        icon={<Download className="h-4 w-4" />}
        tasks={activeTasks}
        title="Active Downloads"
        onCancel={onCancel}
        onRetry={onRetry}
        onRestart={onRestart}
        onRemove={onRemove}
      />

      <DownloadTaskSection
        icon={<Clock className="h-4 w-4" />}
        tasks={queuedTasks}
        title="Queued"
        onCancel={onCancel}
        onRetry={onRetry}
        onRestart={onRestart}
        onRemove={onRemove}
      />

      <DownloadTaskSection
        icon={<CheckCircle className="h-4 w-4" />}
        tasks={completedTasks}
        title="Completed"
        titleClassName="text-primary"
        onCancel={onCancel}
        onRetry={onRetry}
        onRestart={onRestart}
        onRemove={onRemove}
      />

      <DownloadTaskSection
        icon={<XCircle className="h-4 w-4" />}
        tasks={failedTasks}
        title="Failed / Partial"
        titleClassName="text-destructive"
        onCancel={onCancel}
        onRetry={onRetry}
        onRestart={onRestart}
        onRemove={onRemove}
      />

      <DownloadTaskSection
        icon={<AlertCircle className="h-4 w-4" />}
        tasks={canceledTasks}
        title="Canceled"
        onCancel={onCancel}
        onRetry={onRetry}
        onRestart={onRestart}
        onRemove={onRemove}
      />

      {tasks.length === 0 && (
        <Card>
          <CardContent className="p-12 text-center">
            <Download className="h-16 w-16 mx-auto mb-4 text-muted-foreground" />
            <h3 className="text-lg font-medium mb-2">No downloads yet</h3>
            <p className="text-sm text-muted-foreground">
              Open a manga series page to start downloading.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
