import { projectToQueueView, updateActionBadge } from "@/src/runtime/projection"
import { SESSION_STORAGE_KEYS } from "@/src/runtime/storage-keys"
import type { DownloadTaskState } from "@/src/domain/queue/state"

export class QueueProjectionService {
  private publicationTail: Promise<void> = Promise.resolve()

  publish(queue: readonly DownloadTaskState[]): Promise<void> {
    const submittedQueue = [...structuredClone(queue)]
    return this.enqueue(async () => {
      const projection = projectToQueueView(submittedQueue)
      await chrome.storage.session.set({
        [SESSION_STORAGE_KEYS.queueView]: projection.queueView,
        [SESSION_STORAGE_KEYS.historyView]: projection.historyView,
      })
      await updateActionBadge(projection.nonTerminalCount)
    })
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    const publication = this.publicationTail.then(operation, operation)
    this.publicationTail = publication.catch(() => undefined)
    return publication
  }
}
