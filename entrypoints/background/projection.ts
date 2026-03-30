import { toQueueTaskSummary } from '@/src/runtime/queue-task-summary'
import type { DownloadTaskState, QueueTaskSummary } from '@/src/types/queue-state'

const MAX_BADGE_COUNT = 999

export interface QueueViewProjection {
  queueView: QueueTaskSummary[]
  activeCount: number
  queuedCount: number
  nonTerminalCount: number
  history: QueueTaskSummary[]
}

export function getBadgeText(nonTerminalCount: number): string {
  if (nonTerminalCount <= 0) {
    return ''
  }

  if (nonTerminalCount > MAX_BADGE_COUNT) {
    return `${MAX_BADGE_COUNT}+`
  }

  return String(nonTerminalCount)
}

export async function updateActionBadge(nonTerminalCount: number): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.action?.setBadgeText) {
    return
  }

  const text = getBadgeText(nonTerminalCount)
  await chrome.action.setBadgeText({ text })

  if (text !== '' && chrome.action.setBadgeBackgroundColor) {
    await chrome.action.setBadgeBackgroundColor({ color: '#2563eb' })
  }
}

const TERMINAL_STATUSES = new Set<QueueTaskSummary['status']>([
  'completed',
  'partial_success',
  'failed',
  'canceled',
])

function assertNeverStatus(status: never): never {
  throw new Error(`Unhandled queue status: ${String(status)}`)
}

export function projectToQueueView(downloadQueue: DownloadTaskState[]): QueueViewProjection {
  const summaries = downloadQueue.map((task) => toQueueTaskSummary(task))

  const active: QueueTaskSummary[] = []
  const queued: QueueTaskSummary[] = []
  const terminal: QueueTaskSummary[] = []

  for (const task of summaries) {
    switch (task.status) {
      case 'downloading':
        active.push(task)
        break
      case 'queued':
        queued.push(task)
        break
      case 'completed':
      case 'partial_success':
      case 'failed':
      case 'canceled':
        if (!TERMINAL_STATUSES.has(task.status)) {
          throw new Error(`Unexpected terminal status classification: ${task.status}`)
        }
        terminal.push(task)
        break
      default:
        assertNeverStatus(task.status)
    }
  }

  active.sort((a, b) => a.timestamps.created - b.timestamps.created)
  // Queued tasks preserve array order from downloadQueue (FIFO by default,
  // reorderable via moveTaskToTop). Do NOT sort by timestamps.created here —
  // that would undo manual reordering.
  terminal.sort((a, b) => (b.timestamps.completed ?? 0) - (a.timestamps.completed ?? 0))

  const history = terminal.slice(0, 5)

  return {
    queueView: [...active, ...queued, ...terminal],
    activeCount: active.length,
    queuedCount: queued.length,
    nonTerminalCount: active.length + queued.length,
    history,
  }
}

