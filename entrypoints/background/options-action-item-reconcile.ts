import logger from "@/src/runtime/logger"
import { checkDestinationHealth } from "./destination"
import { hasIntegrationOptionalHostPermission } from "@/src/site-integrations/host-permission-service"
import {
  clearFsaDestinationActionItem,
  clearHostPermissionActionItem,
  markFsaDestinationActionItem,
  markHostPermissionActionItem,
  readHostPermissionActionItem,
} from "@/src/runtime/options-action-items"
import type { SettingsRepository } from "@/src/storage/settings-repository"
import { StorageMutationQueue } from "@/src/storage/storage-mutation-queue"

const destinationChecks = new StorageMutationQueue()
const hostPermissionChecks = new StorageMutationQueue()

/**
 * Reflect the configured download destination's health on the settings
 * button. Serialize the read, permission check and publication so a stale
 * folder check cannot overwrite the result for a later settings change.
 */
export async function reconcileFsaDestinationActionItem({
  settingsRepository,
}: {
  settingsRepository: Pick<SettingsRepository, "getSettings">
}): Promise<void> {
  return destinationChecks.run(async () => {
    const settings = await settingsRepository.getSettings()
    const { downloads } = settings
    if (downloads.destination !== "file-system-access") {
      await clearFsaDestinationActionItem()
      return
    }

    const health = await checkDestinationHealth({
      kind: "file-system-access",
      handleId: downloads.customDirectoryHandleId,
    })
    if (health.ready) {
      await clearFsaDestinationActionItem()
      return
    }

    await markFsaDestinationActionItem({
      issue:
        health.reason === "permission_prompt" ||
        health.reason === "permission_denied"
          ? "permission_required"
          : "unavailable",
    })
  })
}

/**
 * Keep unresolved losses across separate permission removals and prune them
 * when Chrome reports a grant. Checking and writing share one worker queue.
 */
export async function reconcileHostPermissionActionItem(
  disabledIntegrationIds: string[] = []
): Promise<void> {
  await hostPermissionChecks
    .run(async () => {
      const stored = await readHostPermissionActionItem()
      const previous = stored?.integrationIds ?? []
      const candidates = [
        ...new Set([...previous, ...disabledIntegrationIds]),
      ].sort()
      if (candidates.length === 0) return

      const unresolved = (
        await Promise.all(
          candidates.map(async (integrationId) =>
            (await hasIntegrationOptionalHostPermission(integrationId))
              ? null
              : integrationId
          )
        )
      ).filter(
        (integrationId): integrationId is string => integrationId !== null
      )

      if (
        unresolved.length === previous.length &&
        unresolved.every((id, i) => id === previous[i])
      )
        return
      if (unresolved.length === 0) {
        await clearHostPermissionActionItem()
        return
      }
      await markHostPermissionActionItem({ integrationIds: unresolved })
    })
    .catch((error) => {
      logger.warn("Failed to reconcile host permission action item:", error)
    })
}
