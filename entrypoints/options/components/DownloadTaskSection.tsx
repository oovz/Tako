import type { ReactNode } from 'react'

import { DownloadTaskCard } from '@/entrypoints/options/components/DownloadTaskCard'
import type { DownloadTaskState } from '@/src/types/queue-state'

interface DownloadTaskSectionProps {
  icon: ReactNode
  tasks: DownloadTaskState[]
  title: string
  titleClassName?: string
  onCancel: (taskId: string) => Promise<void>
  onRetry: (taskId: string) => Promise<void>
  onRestart: (taskId: string) => Promise<void>
  onRemove: (taskId: string) => Promise<void>
}

export function DownloadTaskSection({
  icon,
  tasks,
  title,
  titleClassName,
  onCancel,
  onRetry,
  onRestart,
  onRemove,
}: DownloadTaskSectionProps) {
  if (tasks.length === 0) {
    return null
  }

  return (
    <div className="space-y-4">
      <h3 className={`flex items-center gap-2 text-sm font-medium uppercase tracking-wider text-muted-foreground ${titleClassName ?? ''}`.trim()}>
        {icon}
        {title} ({tasks.length})
      </h3>
      <div className="grid gap-4">
        {tasks.map((task) => (
          <DownloadTaskCard
            key={task.id}
            task={task}
            onCancel={onCancel}
            onRetry={onRetry}
            onRestart={onRestart}
            onRemove={onRemove}
          />
        ))}
      </div>
    </div>
  )
}
