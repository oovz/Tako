import logger from "@/src/runtime/logger"
import { LOCAL_STORAGE_KEYS } from "@/src/runtime/storage-keys"
import {
  adoptDownloadRootHandle,
  collectUnusedDownloadRootHandles,
} from "@/src/storage/fs-access"
import type { QueueRepository } from "@/src/storage/queue-repository"
import type { SettingsRepository } from "@/src/storage/settings-repository"
import { runDestinationAccessExclusive } from "./destination-access"

export class DestinationHandleCollector {
  constructor(
    private readonly deps: {
      queueRepository: Pick<QueueRepository, "getRetainedHandleIds">
      settingsRepository: Pick<SettingsRepository, "reload">
      pendingHandleIds: () => ReadonlySet<string>
    }
  ) {}

  register(waitForReadiness: () => Promise<void>): void {
    const collect = async (): Promise<void> => {
      try {
        await waitForReadiness()
        await this.collect()
      } catch (error) {
        logger.warn("Could not collect unused folder capabilities", error)
      }
    }
    chrome.storage.onChanged.addListener((changes, area) => {
      if (
        area === "local" &&
        [
          LOCAL_STORAGE_KEYS.settings,
          LOCAL_STORAGE_KEYS.downloadQueue,
          LOCAL_STORAGE_KEYS.pendingUndoActions,
          LOCAL_STORAGE_KEYS.activeDispatchLease,
        ].some((key) => Object.hasOwn(changes, key))
      )
        void collect()
    })
    void collect()
  }

  async collect(): Promise<void> {
    await runDestinationAccessExclusive(async () => {
      const [settings, retained] = await Promise.all([
        this.deps.settingsRepository.reload(),
        this.deps.queueRepository.getRetainedHandleIds(),
      ])
      const current = settings.downloads.customDirectoryHandleId
      if (current) retained.add(current)
      for (const id of this.deps.pendingHandleIds()) retained.add(id)
      for (const id of retained) await adoptDownloadRootHandle(id)
      await collectUnusedDownloadRootHandles(retained)
    })
  }
}
