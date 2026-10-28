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

    return OptionsDownloadStateSchema.parse({
      tasks,
      queueStorageBytes,
    })
  }

  async getSidepanelDownloadState(): Promise<SidepanelDownloadState> {
    const downloadedChapters =
      await this.historyQueryService.getDownloadedChapters()

    return SidepanelDownloadStateSchema.parse({
      downloadedChapters,
    })
  }
}
