import type { DestinationService } from "@/entrypoints/background/destination"
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
    private readonly historyQueryService: HistoryQueryService,
    private readonly destinationService: DestinationService
  ) {}

  async getOptionsDownloadState(): Promise<OptionsDownloadState> {
    const [tasks, destinationIssues, queueStorageBytes] = await Promise.all([
      this.queueRepository.getQueue(),
      this.destinationService.getIssues(),
      chrome.storage.local.getBytesInUse(LOCAL_STORAGE_KEYS.downloadQueue),
    ])

    return OptionsDownloadStateSchema.parse({
      tasks,
      destinationIssue: destinationIssues[0] ?? null,
      queueStorageBytes,
    })
  }

  async getSidepanelDownloadState(): Promise<SidepanelDownloadState> {
    const [downloadedChapters, destinationIssues] = await Promise.all([
      this.historyQueryService.getDownloadedChapters(),
      this.destinationService.getIssues(),
    ])

    return SidepanelDownloadStateSchema.parse({
      downloadedChapters,
      destinationIssue: destinationIssues[0] ?? null,
    })
  }
}
