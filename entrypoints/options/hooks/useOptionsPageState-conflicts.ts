import { useState, type RefObject } from "react"
import { toast } from "sonner"
import logger from "@/src/runtime/logger"
import { t } from "@/src/runtime/i18n"
import type { SiteIntegrationEnablementMap } from "@/src/domain/site-integrations/storage-schemas"
import type { OptionsConfigurationClient } from "../controllers/options-configuration-client"
import type { OptionsExternalChangeController } from "../controllers/options-external-change-controller"
import type { OptionsHostPermissionController } from "../controllers/options-host-permission-controller"
import type { OptionsConfigurationBinding } from "./useOptionsPageState-state"
import type { useOptionsFolderManagement } from "./useOptionsFolderManagement"
import type { useOptionsHistory } from "./useOptionsHistory"

interface ConflictOptions extends OptionsConfigurationBinding {
  client: OptionsConfigurationClient
  external: OptionsExternalChangeController
  permissions: OptionsHostPermissionController
  folder: ReturnType<typeof useOptionsFolderManagement>
  history: ReturnType<typeof useOptionsHistory>
  isSavingRef: RefObject<boolean>
}
type Strategy = "reload" | "keep-mine"

function removeDiscardedPermissions(
  options: ConflictOptions,
  enablement: SiteIntegrationEnablementMap,
  context: string
): void {
  void options.permissions.removeUnused(enablement).catch((error) => {
    logger.warn(
      `Failed to remove unused HTTPS host permission after ${context}:`,
      error
    )
  })
}

function canResolve(options: ConflictOptions, resolving: boolean): boolean {
  return (
    options.configuration.saved !== null &&
    options.configuration.draft !== null &&
    !resolving &&
    !options.isSavingRef.current &&
    !options.folder.isPickingFolderRef.current
  )
}

async function resolveConflict(
  options: ConflictOptions,
  strategy: Strategy,
  resolving: boolean,
  setResolving: (value: boolean) => void
): Promise<boolean> {
  if (!canResolve(options, resolving)) return false
  const draftRevision = options.configurationRef.current.draftRevision
  const externalRevision = options.external.revision
  try {
    setResolving(true)
    const latest = await options.client.load()
    if (
      options.configurationRef.current.draftRevision !== draftRevision ||
      options.external.revision !== externalRevision
    ) {
      toast.info(t("options_externalChangesChangedAgain"))
      return false
    }
    options.external.invalidatePendingReads()
    options.dispatchConfiguration(
      strategy === "keep-mine"
        ? { type: "merge-latest-keeping-local", latest: latest.configuration }
        : { type: "replace-from-external", latest: latest.configuration }
    )
    options.history.setHistoryStats(latest.historyStats)
    options.history.setHistorySeries(latest.historySeries)
    if (strategy === "reload") {
      options.folder.clearPendingFolder()
      removeDiscardedPermissions(
        options,
        latest.configuration.enablement,
        "reloading settings"
      )
    }
    toast.info(
      t(
        strategy === "keep-mine"
          ? "options_externalChangesKept"
          : "options_externalChangesReloaded"
      )
    )
    return true
  } catch (error) {
    logger.error("[OPTIONS] Failed to resolve external settings:", error)
    toast.error(t("options_externalChangesResolveFailed"))
    return false
  } finally {
    setResolving(false)
  }
}

async function discardDraft(
  options: ConflictOptions,
  resolve: (strategy: Strategy) => Promise<boolean>
): Promise<boolean> {
  if (options.isSavingRef.current || options.folder.isPickingFolderRef.current)
    return false
  if (options.configuration.externalChangeKeys.length > 0) {
    const reloaded = await resolve("reload")
    if (reloaded) toast.info(t("options_toastChangesDiscarded"))
    return reloaded
  }
  removeDiscardedPermissions(
    options,
    options.configuration.saved?.enablement ?? {},
    "discarding changes"
  )
  options.folder.clearPendingFolder()
  options.dispatchConfiguration({ type: "discard-to-saved" })
  toast.info(t("options_toastChangesDiscarded"))
  return true
}

export function useOptionsConflicts(options: ConflictOptions) {
  const [isResolvingExternalChanges, setResolving] = useState(false)
  const resolveExternalChanges = (strategy: Strategy) =>
    resolveConflict(options, strategy, isResolvingExternalChanges, setResolving)
  return {
    isResolvingExternalChanges,
    resolveExternalChanges,
    discardChanges: () => discardDraft(options, resolveExternalChanges),
  }
}
