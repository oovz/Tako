import {
  OptionsDownloadStateSchema,
  SidepanelDownloadStateSchema,
  type OptionsDownloadState,
  type SidepanelDownloadState,
} from "@/src/runtime/runtime-message-contracts"
import { LOCAL_STORAGE_KEYS } from "@/src/runtime/storage-keys"
import type { HistoryQueryService } from "@/src/storage/history-query-service"
import type { QueueRepository } from "@/src/storage/queue-repository"

export interface DownloadStateQueryService {
  getOptionsDownloadState(): Promise<OptionsDownloadState>
  getSidepanelDownloadState(): Promise<SidepanelDownloadState>
}

export class BackgroundDownloadStateQueryService implements DownloadStateQueryService {
  constructor(
    private readonly queueRepository: QueueRepository,
    private readonly historyQueryService: HistoryQueryService
  ) {}

  async getOptionsDownloadState(): Promise<OptionsDownloadState> {
    const [tasks, queueStorageBytes] = await Promise.all([
      this.queueRepository.getQueue(),
      chrome.storage.local.getBytesInUse(LOCAL_STORAGE_KEYS.downloadQueue),
    ])
    const destinationIssue =
      tasks.find((task) => task.destinationIssue)?.destinationIssue ?? null

    return OptionsDownloadStateSchema.parse({
      tasks,
      destinationIssue,
      queueStorageBytes,
    })
  }

  async getSidepanelDownloadState(): Promise<SidepanelDownloadState> {
    const [downloadedChapters, tasks] = await Promise.all([
      this.historyQueryService.getDownloadedChapters(),
      this.queueRepository.getQueue(),
    ])
    const destinationIssue =
      tasks.find((task) => task.destinationIssue)?.destinationIssue ?? null

    return SidepanelDownloadStateSchema.parse({
      downloadedChapters,
      destinationIssue,
    })
  }
}
