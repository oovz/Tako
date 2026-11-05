import {
  AlertCircle,
  CheckCircle,
  Clock,
  Download,
  XCircle,
} from "lucide-react"

import { DownloadTaskSection } from "@/entrypoints/options/components/DownloadTaskSection"
import type { DownloadTaskState } from "@/src/domain/queue/state"
import { t } from "@/src/runtime/i18n"
import type { DownloadTaskActionResult } from "@/entrypoints/options/types/download-task-actions"

interface DownloadTaskGroupsProps {
  tasks: DownloadTaskState[]
  activeTasks: DownloadTaskState[]
  queuedTasks: DownloadTaskState[]
  completedTasks: DownloadTaskState[]
  failedTasks: DownloadTaskState[]
  canceledTasks: DownloadTaskState[]
  onCancel: (taskId: string) => Promise<DownloadTaskActionResult>
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
        title={t("options_activeDownloads")}
        onCancel={onCancel}
        onRetry={onRetry}
        onRestart={onRestart}
        onRemove={onRemove}
      />

      <DownloadTaskSection
        icon={<Clock className="size-4" />}
        tasks={queuedTasks}
        title={t("options_queued")}
        onCancel={onCancel}
        onRetry={onRetry}
        onRestart={onRestart}
        onRemove={onRemove}
      />

      <DownloadTaskSection
        icon={<CheckCircle className="size-4" />}
        tasks={completedTasks}
        title={t("options_completed")}
        titleClassName="text-primary"
        onCancel={onCancel}
        onRetry={onRetry}
        onRestart={onRestart}
        onRemove={onRemove}
      />

      <DownloadTaskSection
        icon={<XCircle className="size-4" />}
        tasks={failedTasks}
        title={t("options_failedPartial")}
        titleClassName="text-destructive"
        onCancel={onCancel}
        onRetry={onRetry}
        onRestart={onRestart}
        onRemove={onRemove}
      />

      <DownloadTaskSection
        icon={<AlertCircle className="size-4" />}
        tasks={canceledTasks}
        title={t("options_canceled")}
        onCancel={onCancel}
        onRetry={onRetry}
        onRestart={onRestart}
        onRemove={onRemove}
      />

      {tasks.length === 0 && (
        <div className="rounded-lg border px-4 py-5">
          <h3 className="text-sm font-medium">
            {t("options_noDownloadTasks")}
          </h3>
          <p className="mt-1 text-[13px] text-muted-foreground">
            {t("options_openMangaToDownload")}
          </p>
        </div>
      )}
    </div>
  )
}
