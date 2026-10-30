import { useOptionsDownloadRead } from "./useDownloadsTabState-read"
import { useOptionsDownloadActions } from "./useDownloadsTabState-actions"

export function useDownloadsTabState() {
  const read = useOptionsDownloadRead()
  const actions = useOptionsDownloadActions(read.refreshDownloadState)
  return {
    tasks: read.downloadState.tasks,
    isLoading: read.readStatus === "loading",
    readStatus: read.readStatus,
    retryRead: read.retryRead,
    historyStorageBytes: read.downloadState.queueStorageBytes,
    ...actions,
  }
}
