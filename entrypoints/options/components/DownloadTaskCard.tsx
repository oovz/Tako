import { useState } from 'react'
import { ChevronDown, ChevronRight, RotateCcw, Trash2, XCircle } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { InlineConfirmation } from '@/src/ui/shared/components/InlineConfirmation'
import { getSiteIntegrationDisplayName } from '@/src/site-integrations/manifest'
import type { DownloadTaskState } from '@/src/types/queue-state'
import {
  chapterStatusBadgeClass,
  formatChapterStatusLabel,
  formatTaskTimestamp,
  getChapterImageSummary,
  getTaskStatusBadge,
  getTaskStatusSummaryLabel,
  getTerminalTimestampLabel,
  shouldShowChapterError,
} from '@/entrypoints/options/components/downloads-tab-helpers'

export interface DownloadTaskCardProps {
  task: DownloadTaskState
  onCancel: (taskId: string) => Promise<void>
  onRetry: (taskId: string) => Promise<void>
  onRestart: (taskId: string) => Promise<void>
  onRemove: (taskId: string) => Promise<void>
}

function StatusBadge({ status }: { status: DownloadTaskState['status'] }) {
  const variant = getTaskStatusBadge(status)

  return <Badge className={variant.className}>{variant.label}</Badge>
}

export function DownloadTaskCard({ task, onCancel, onRetry, onRestart, onRemove }: DownloadTaskCardProps) {
  const [isChapterListExpanded, setIsChapterListExpanded] = useState(false)
  const [confirmingCancel, setConfirmingCancel] = useState(false)
  const completedChapters = task.chapters.filter((chapter) => chapter.status === 'completed').length
  const totalChapters = task.chapters.length
  const siteIntegrationName = getSiteIntegrationDisplayName(task.siteIntegrationId)
  const terminalTimestampLabel = getTerminalTimestampLabel(task.status)
  const isRetried = task.isRetried ?? false

  return (
    <Card className="relative">
      {confirmingCancel && (task.status === 'downloading' || task.status === 'queued') && (
        <InlineConfirmation
          title="Cancel this download?"
          description="Progress for in-flight chapter may be lost."
          onConfirm={() => {
            void onCancel(task.id)
            setConfirmingCancel(false)
          }}
          onCancel={() => setConfirmingCancel(false)}
        />
      )}
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <CardTitle className="text-base">{task.seriesTitle}</CardTitle>
            <div className="mt-1 flex items-center gap-3 text-sm text-muted-foreground">
              <span>{completedChapters}/{totalChapters} chapters</span>
              <span>•</span>
              <span>{siteIntegrationName}</span>
              {terminalTimestampLabel && typeof task.completed === 'number' && (
                <>
                  <span>•</span>
                  <span>
                    {terminalTimestampLabel} {formatTaskTimestamp(task.completed)}
                  </span>
                </>
              )}
              {!(terminalTimestampLabel && typeof task.completed === 'number') && (
                <>
                  <span>•</span>
                  <span>Created at {formatTaskTimestamp(task.created)}</span>
                </>
              )}
              {isRetried && (
                <>
                  <span>•</span>
                  <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">retried</Badge>
                </>
              )}
            </div>
          </div>
          <StatusBadge status={task.status} />
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => setIsChapterListExpanded((currentValue) => !currentValue)}
            className="flex w-full items-center gap-1.5 text-left text-sm text-muted-foreground transition-colors hover:text-foreground"
            aria-expanded={isChapterListExpanded}
          >
            {isChapterListExpanded ? (
              <ChevronDown className="h-4 w-4 shrink-0" />
            ) : (
              <ChevronRight className="h-4 w-4 shrink-0" />
            )}
            <span>{getTaskStatusSummaryLabel(task)}</span>
          </button>

          {isChapterListExpanded && (
            <div className="mt-2 overflow-hidden rounded-md border">
              <div className="grid grid-cols-[minmax(0,1fr)_90px_100px_minmax(0,1fr)] bg-muted/40 px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                <span>Chapter</span>
                <span>Status</span>
                <span>Images</span>
                <span>Error</span>
              </div>
              <div className="max-h-56 overflow-y-auto">
                {task.chapters.map((chapter, index) => {
                  const showError = shouldShowChapterError(chapter.status)
                  return (
                    <div
                      key={chapter.id ?? chapter.url ?? index}
                      className="grid grid-cols-[minmax(0,1fr)_90px_100px_minmax(0,1fr)] items-center gap-2 border-t px-3 py-2 text-xs"
                    >
                      <span className="truncate" title={chapter.title}>{chapter.title}</span>
                      <Badge className={chapterStatusBadgeClass(chapter.status)}>{formatChapterStatusLabel(chapter.status)}</Badge>
                      <span className="font-mono text-[11px]">{getChapterImageSummary(chapter)}</span>
                      <span className="truncate text-muted-foreground" title={showError ? (chapter.errorMessage || '') : ''}>
                        {showError ? (chapter.errorMessage || '-') : '-'}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        {task.errorMessage && <p className="text-sm text-destructive">Error: {task.errorMessage}</p>}

        <div className="flex gap-2 pt-2">
          {task.status === 'downloading' && (
            <Button variant="outline" size="sm" onClick={() => setConfirmingCancel(true)}>
              <XCircle className="mr-1 h-4 w-4" />
              Cancel
            </Button>
          )}

          {task.status === 'queued' && (
            <Button variant="outline" size="sm" onClick={() => setConfirmingCancel(true)}>
              <XCircle className="mr-1 h-4 w-4" />
              Cancel
            </Button>
          )}

          {task.status === 'completed' && (
            <Button variant="outline" size="sm" onClick={() => void onRemove(task.id)}>
              <Trash2 className="mr-1 h-4 w-4" />
              Remove
            </Button>
          )}

          {task.status === 'partial_success' && !isRetried && (
            <>
              <Button variant="outline" size="sm" onClick={() => void onRetry(task.id)}>
                <RotateCcw className="mr-1 h-4 w-4" />
                Retry failed chapters
              </Button>
              <Button variant="outline" size="sm" onClick={() => void onRestart(task.id)}>
                <RotateCcw className="mr-1 h-4 w-4" />
                Restart
              </Button>
              <Button variant="outline" size="sm" onClick={() => void onRemove(task.id)}>
                <Trash2 className="mr-1 h-4 w-4" />
                Remove
              </Button>
            </>
          )}

          {(task.status === 'failed' || task.status === 'canceled') && (
            <>
              {!isRetried && (
                <Button variant="outline" size="sm" onClick={() => void onRestart(task.id)}>
                  <RotateCcw className="mr-1 h-4 w-4" />
                  Restart
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={() => void onRemove(task.id)}>
                <Trash2 className="mr-1 h-4 w-4" />
                Remove
              </Button>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

