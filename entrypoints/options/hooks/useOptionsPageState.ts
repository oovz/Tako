import { useMemo, useRef } from "react"
import { OptionsConfigurationClient } from "../controllers/options-configuration-client"
import { OptionsExternalChangeController } from "../controllers/options-external-change-controller"
import { OptionsFsaController } from "../controllers/options-fsa-controller"
import { OptionsHistoryController } from "../controllers/options-history-controller"
import { OptionsHostPermissionController } from "../controllers/options-host-permission-controller"
import { useOptionsHistory } from "./useOptionsHistory"
import { useOptionsFolderManagement } from "./useOptionsFolderManagement"
import {
  optionsDraftView,
  optionsHasUnsavedChanges,
  optionsSavedView,
  useOptionsConfigurationState,
} from "./useOptionsPageState-state"
import {
  useOptionsExternalSubscription,
  useOptionsHydration,
  useOptionsPermissionCleanup,
} from "./useOptionsPageState-lifecycle"
import { useOptionsEdits } from "./useOptionsPageState-edits"
import { useOptionsConflicts } from "./useOptionsPageState-conflicts"
import { useOptionsSave } from "./useOptionsPageState-save"

export type { SeriesHistory, HistoryStats } from "./useOptionsHistory"

function useOptionsControllers() {
  const client = useMemo(() => new OptionsConfigurationClient(), [])
  const historyController = useMemo(
    () => new OptionsHistoryController(client),
    [client]
  )
  const permissions = useMemo(() => new OptionsHostPermissionController(), [])
  const fsa = useMemo(() => new OptionsFsaController(), [])
  const external = useMemo(
    () => new OptionsExternalChangeController(client),
    [client]
  )
  return { client, historyController, permissions, fsa, external }
}

/** Composes configuration, browser capability, and page-lifetime owners. */
export function useOptionsPageState() {
  const binding = useOptionsConfigurationState()
  const { configuration } = binding
  const controllers = useOptionsControllers()
  const saved = optionsSavedView(configuration)
  const draft = optionsDraftView(configuration)
  const isSavingRef = useRef(false)
  const history = useOptionsHistory(controllers.historyController)
  const edits = useOptionsEdits(
    binding.dispatchConfiguration,
    controllers.permissions
  )
  const folder = useOptionsFolderManagement({
    fsaController: controllers.fsa,
    isSavingRef,
    settingsBuffer: draft.settingsBuffer,
    savedHandleId: saved.settings?.downloads.customDirectoryHandleId ?? null,
    onSettingsChange: edits.handleSettingsChange,
  })
  const hasUnsavedChanges = optionsHasUnsavedChanges(
    configuration,
    folder.pendingFolderHandle !== null
  )
  const operations = {
    ...binding,
    ...controllers,
    history,
    folder,
    isSavingRef,
    hasUnsavedChanges,
  }
  const retryLoad = useOptionsHydration(operations)
  useOptionsExternalSubscription(operations)
  useOptionsPermissionCleanup(controllers.permissions, binding.configurationRef)
  const conflicts = useOptionsConflicts(operations)
  const save = useOptionsSave({
    ...operations,
    isResolvingExternalChanges: conflicts.isResolvingExternalChanges,
  })
  return {
    settings: saved.settings,
    ...draft,
    historyStats: history.historyStats,
    historySeries: history.historySeries,
    selectedFolderName: folder.selectedFolderName,
    folderAccessRequired: folder.folderAccessRequired,
    isLoading: configuration.hydration.status === "loading",
    loadFailed: configuration.hydration.status === "error",
    ...save,
    isClearing: history.isClearing,
    isPickingFolder: folder.isPickingFolder,
    hasUnsavedChanges,
    hasExternalChanges: configuration.externalChangeKeys.length > 0,
    ...conflicts,
    ...edits,
    pickDownloadFolder: folder.pickDownloadFolder,
    grantDownloadFolderAccess: folder.grantDownloadFolderAccess,
    clearChapterHistory: history.clearChapterHistory,
    clearSeriesHistory: history.clearSeriesHistory,
    handleRefreshHistory: history.handleRefreshHistory,
    retryLoad,
  }
}
