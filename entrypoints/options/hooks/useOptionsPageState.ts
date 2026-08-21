import { useEffect, useMemo, useReducer, useRef, useState } from "react"
import { toast } from "sonner"

import logger from "@/src/runtime/logger"
import { ExtensionSettingsSchema } from "@/src/domain/settings/schema"
import { validateSettingsDestination } from "@/src/storage/settings-destination-validation"
import type { ExtensionSettings } from "@/src/domain/settings/types"
import type {
  SiteIntegrationEnablementMap,
  SiteIntegrationSettingsMap,
  SiteOverrideRecord,
} from "@/src/domain/site-integrations/storage-schemas"
import {
  initialOptionsConfigurationState,
  optionsConfigurationReducer,
  optionsConfigurationSnapshotsEqual,
} from "../state/options-configuration-reducer"
import { t } from "@/src/runtime/i18n"
import { validateTemplate } from "@/src/shared/template-expander"
import { getDisplayName } from "@/src/site-integrations/catalog"
import { OptionsConfigurationClient } from "../controllers/options-configuration-client"
import { OptionsExternalChangeController } from "../controllers/options-external-change-controller"
import { OptionsFsaController } from "../controllers/options-fsa-controller"
import { OptionsHistoryController } from "../controllers/options-history-controller"
import { OptionsHostPermissionController } from "../controllers/options-host-permission-controller"
import {
  useOptionsHistory,
  type SeriesHistory,
  type HistoryStats,
} from "./useOptionsHistory"
import { useOptionsFolderManagement } from "./useOptionsFolderManagement"

export type { SeriesHistory, HistoryStats }

type CustomSettingValue = SiteIntegrationSettingsMap[string][string]
export function useOptionsPageState() {
  const [configuration, dispatchConfiguration] = useReducer(
    optionsConfigurationReducer,
    initialOptionsConfigurationState
  )
  const configurationClient = useMemo(
    () => new OptionsConfigurationClient(),
    []
  )
  const historyController = useMemo(
    () => new OptionsHistoryController(configurationClient),
    [configurationClient]
  )
  const hostPermissionController = useMemo(
    () => new OptionsHostPermissionController(),
    []
  )
  const fsaController = useMemo(() => new OptionsFsaController(), [])
  const settings = configuration.saved?.settings ?? null
  const settingsBuffer = configuration.draft?.settings ?? null
  const overrides = configuration.draft?.overrides ?? {}
  const savedSiteIntegrationEnablement = configuration.saved?.enablement ?? {}
  const siteIntegrationEnablement = configuration.draft?.enablement ?? {}
  const siteIntegrationSettingsByIntegration =
    configuration.draft?.integrationSettings ?? {}
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [isSaving, setIsSaving] = useState(false)
  const [isResolvingExternalChanges, setIsResolvingExternalChanges] =
    useState(false)
  const externalChangeKeys = configuration.externalChangeKeys
  const isLoading = configuration.hydration.status === "loading"
  const loadFailed = configuration.hydration.status === "error"
  const draftRevisionRef = useRef(0)
  const draftDirtyRef = useRef(false)
  const isSavingRef = useRef(false)
  const savedEnablementRef = useRef<SiteIntegrationEnablementMap>({})
  const hasLoadedEnablementRef = useRef(false)
  const history = useOptionsHistory(historyController)
  const handleFolderSettingsChange = useCallback(
    (updates: Partial<ExtensionSettings>) => {
      dispatchConfiguration({ type: "edit-settings", updates })
    },
    []
  )
  const folder = useOptionsFolderManagement({
    fsaController,
    isSavingRef,
    settingsBuffer,
    onSettingsChange: handleFolderSettingsChange,
  })
  const { setHistoryStats, setHistorySeries } = history
  const {
    setSavedFolderHandle,
    setPendingFolderHandle,
    getFolderDraftRevision,
  } = folder
  const externalChangeController = useMemo(
    () => new OptionsExternalChangeController(configurationClient),
    [configurationClient]
  )
  useEffect(() => {
    draftRevisionRef.current = configuration.draftRevision
    draftDirtyRef.current = configuration.draftDirty
    savedEnablementRef.current = configuration.saved?.enablement ?? {}
    if (configuration.saved) hasLoadedEnablementRef.current = true
  }, [
    configuration.draftDirty,
    configuration.draftRevision,
    configuration.saved,
  ])
  const selectedFolderName = folder.selectedFolderName
  const hasUnsavedChanges =
    configuration.saved !== null &&
    configuration.draft !== null &&
    (folder.pendingFolderHandle !== null ||
      !optionsConfigurationSnapshotsEqual(
        configuration.saved,
        configuration.draft
      ))
  useEffect(() => {
    let canceled = false
    const folderRevisionAtStart = getFolderDraftRevision()
    const draftRevisionAtStart = draftRevisionRef.current
    const fsaRevisionAtStart = fsaController.revision

    dispatchConfiguration({ type: "load-start" })

    void hostPermissionController
      .reconcileOnLoad()
      .catch((error) => {
        logger.warn(
          "[OPTIONS] Could not reconcile optional host permissions during startup:",
          error
        )
      })
      .then(() => {
        if (canceled) return null
        return externalChangeController.loadInitial(
          () =>
            draftRevisionRef.current === draftRevisionAtStart &&
            !draftDirtyRef.current
        )
      })
      .then((loaded) => {
        if (canceled || !loaded) return

        dispatchConfiguration({
          type: "hydrate",
          configuration: loaded.configuration,
        })
        setHistoryStats(loaded.historyStats)
        setHistorySeries(loaded.historySeries)
      })
      .catch((error) => {
        if (canceled) return
        logger.error("[OPTIONS] Failed to load configuration:", error)
        dispatchConfiguration({ type: "hydrate-error", error })
        toast.error(t("options_toastLoadFailed"))
      })

    void fsaController
      .loadSaved()
      .then((handle) => {
        if (canceled) return
        if (fsaController.revision !== fsaRevisionAtStart) return
        setSavedFolderHandle(handle ?? null)
        if (getFolderDraftRevision() === folderRevisionAtStart) {
          setPendingFolderHandle(null)
        }
      })
      .catch((error) => {
        if (canceled) return
        setSavedFolderHandle(null)
        if (getFolderDraftRevision() === folderRevisionAtStart) {
          setPendingFolderHandle(null)
        }
        logger.error("[OPTIONS] Failed to load custom folder handle:", error)
      })

    return () => {
      canceled = true
    }
  }, [
    configurationClient,
    externalChangeController,
    fsaController,
    getFolderDraftRevision,
    hostPermissionController,
    loadAttempt,
    setHistorySeries,
    setHistoryStats,
    setPendingFolderHandle,
    setSavedFolderHandle,
  ])

  useEffect(() => {
    return () => {
      if (!hasLoadedEnablementRef.current) return
      // Permission requests must happen in a user gesture, but a user can
      // close Options before saving the matching enablement change. Cleanup is
      // best-effort here and is repeated during background/Options startup.
      void hostPermissionController
        .removeUnused(savedEnablementRef.current)
        .catch((error) => {
          logger.warn(
            "Failed to remove unused HTTPS host permission when Options closed:",
            error
          )
        })
    }
  }, [hostPermissionController])

  useEffect(() => {
    return externalChangeController.subscribe({
      isSaving: () => isSavingRef.current,
      isDirty: () => draftDirtyRef.current,
      hasUnsavedChanges: () => hasUnsavedChanges,
      draftRevision: () => draftRevisionRef.current,
      onConflict: (keys) => {
        dispatchConfiguration({
          type: "record-external-conflict",
          keys,
        })
      },
      onSync: (latest) => {
        dispatchConfiguration({
          type: "sync-external",
          latest: latest.configuration,
        })
        setHistoryStats(latest.historyStats)
        setHistorySeries(latest.historySeries)
      },
      onError: (error, keys) => {
        logger.error("[OPTIONS] Failed to apply external settings:", error)
        dispatchConfiguration({ type: "record-external-conflict", keys })
      },
    })
  }, [
    externalChangeController,
    hasUnsavedChanges,
    setHistorySeries,
    setHistoryStats,
  ])

  async function saveConfiguration() {
    if (
      !settingsBuffer ||
      !settings ||
      isSaving ||
      isSavingRef.current ||
      folder.isPickingFolderRef.current
    )
      return
    if (externalChangeKeys.length > 0 || isResolvingExternalChanges) {
      toast.error(t("options_externalChangesSaveBlocked"))
      return
    }

    const pathValidation = validateTemplate(
      settingsBuffer.downloads.pathTemplate
    )
    const filenameValidation = validateTemplate(
      settingsBuffer.downloads.fileNameTemplate
    )
    if (!pathValidation.valid || !filenameValidation.valid) {
      toast.error(t("options_invalidTemplate"))
      return
    }
    const schemaValidation = ExtensionSettingsSchema.safeParse(settingsBuffer)
    if (!schemaValidation.success) {
      toast.error(t("options_toastSaveFailed"), {
        description:
          schemaValidation.error.issues[0]?.message ??
          t("options_toastUnknownError"),
      })
      return
    }

    if (
      settingsBuffer.downloads.destination === "file-system-access" &&
      !folder.pendingFolderHandle &&
      !folder.savedFolderHandle
    ) {
      toast.error(t("options_toastSaveFailed"), {
        description: t("settings_customFolderRequired"),
      })
      return
    }

    let fsaMutationRevision: number | null = null
    let saveSucceeded = false
    const submittedConfiguration = {
      settings: settingsBuffer,
      overrides,
      enablement: siteIntegrationEnablement,
      integrationSettings: siteIntegrationSettingsByIntegration,
    }
    const saveToken = externalChangeController.beginSave(
      submittedConfiguration,
      {
        expectStorageChange:
          configuration.saved === null ||
          !optionsConfigurationSnapshotsEqual(
            configuration.saved,
            submittedConfiguration
          ),
      }
    )

    try {
      isSavingRef.current = true
      setIsSaving(true)
      const submittedRevision = configuration.draftRevision
      const submittedSettings = settingsBuffer
      const submittedEnablement = siteIntegrationEnablement
      const wantsCustomFolder =
        submittedSettings.downloads.destination === "file-system-access"
      const handleToPersist = wantsCustomFolder
        ? (folder.pendingFolderHandle ?? folder.savedFolderHandle)
        : null
      const destinationValidation = await validateSettingsDestination(
        submittedSettings.downloads.destination,
        handleToPersist
      )
      if (!destinationValidation.isValid) {
        throw new Error(
          destinationValidation.error ?? t("options_toastSaveFailed")
        )
      }

      if (wantsCustomFolder && handleToPersist) {
        try {
          fsaMutationRevision = await fsaController.save(handleToPersist)
        } catch (error) {
          fsaMutationRevision = fsaController.revision
          throw error
        }
      }

      if (
        !wantsCustomFolder &&
        (folder.savedFolderHandle || folder.pendingFolderHandle)
      ) {
        try {
          fsaMutationRevision = await fsaController.clear()
        } catch (error) {
          fsaMutationRevision = fsaController.revision
          throw error
        }
      }
      const response = await configurationClient.save({
        ...submittedConfiguration,
      })
      try {
        await hostPermissionController.removeUnused(submittedEnablement)
      } catch (error) {
        // A disabled integration remains safely disabled if Chrome declines to
        // remove now-unused permission; retain permission cleanup as best effort.
        logger.warn("Failed to remove unused HTTPS host permission:", error)
      }

      const clearTransientDraft = draftRevisionRef.current === submittedRevision
      dispatchConfiguration({
        type: "save-commit",
        submitted: submittedConfiguration,
        submittedRevision,
        persisted: response,
      })
      folder.setSavedFolderHandle(handleToPersist)
      if (clearTransientDraft) {
        folder.setPendingFolderHandle(null)
      }
      saveSucceeded = true
      toast.success(t("options_toastSavedSuccessfully"))
    } catch (error) {
      if (fsaMutationRevision !== null) {
        try {
          await fsaController.restore(
            folder.savedFolderHandle,
            fsaMutationRevision
          )
        } catch (rollbackError) {
          logger.error(
            "[OPTIONS] Failed to restore saved folder handle after save error:",
            rollbackError
          )
        }
      }
      logger.error("[OPTIONS] Failed to save settings:", error)
      const description =
        error instanceof Error && error.message
          ? error.message
          : t("options_toastUnknownError")
      toast.error(t("options_toastSaveFailed"), {
        description,
      })
    } finally {
      externalChangeController.completeSave(saveToken, saveSucceeded)
      isSavingRef.current = false
      setIsSaving(false)
    }
  }

  function handleSettingsChange(updates: Partial<ExtensionSettings>) {
    if (!settingsBuffer) return

    dispatchConfiguration({ type: "edit-settings", updates })
  }

  function handleSiteIntegrationSettingsChange(
    siteIntegrationId: string,
    settingId: string,
    enabled: boolean,
    value: CustomSettingValue
  ) {
    dispatchConfiguration({
      type: "set-integration-setting",
      siteIntegrationId,
      settingId,
      enabled,
      value,
    })
  }

  function handleOverrideChange(
    siteIntegrationId: string,
    override: SiteOverrideRecord | null
  ) {
    dispatchConfiguration({
      type: "set-override",
      siteIntegrationId,
      override,
    })
  }

  async function handleSiteIntegrationEnablementChange(
    siteIntegrationId: string,
    enabled: boolean
  ): Promise<void> {
    if (enabled) {
      try {
        // This is intentionally the first awaited operation: Chrome requires
        // optional permission requests to originate from the user's gesture.
        const granted =
          await hostPermissionController.requestForEnablement(siteIntegrationId)
        if (!granted) {
          toast.error(
            t("options_toastIntegrationHostPermissionDenied", [
              getDisplayName(siteIntegrationId),
            ])
          )
          return
        }
      } catch (error) {
        logger.error(
          `[OPTIONS] Failed to request host permission for ${siteIntegrationId}:`,
          error
        )
        toast.error(
          t("options_toastIntegrationHostPermissionFailed", [
            getDisplayName(siteIntegrationId),
          ])
        )
        return
      }
    }

    dispatchConfiguration({
      type: "set-enablement",
      siteIntegrationId,
      enabled,
    })
  }

  const {
    pickDownloadFolder,
    repairDownloadFolder,
    grantDownloadFolderAccess,
  } = folder
  const { clearAllHistory, clearSeriesHistory, handleRefreshHistory } = history

  async function resolveExternalChanges(
    strategy: "reload" | "keep-mine"
  ): Promise<boolean> {
    if (
      !settings ||
      !settingsBuffer ||
      isResolvingExternalChanges ||
      isSaving ||
      isSavingRef.current ||
      folder.isPickingFolderRef.current
    ) {
      return false
    }

    const draftRevisionAtStart = draftRevisionRef.current
    const externalRevisionAtStart = externalChangeController.revision

    try {
      setIsResolvingExternalChanges(true)
      const latest = await configurationClient.load()
      if (
        draftRevisionRef.current !== draftRevisionAtStart ||
        externalChangeController.revision !== externalRevisionAtStart
      ) {
        toast.info(t("options_externalChangesChangedAgain"))
        return false
      }

      externalChangeController.invalidatePendingReads()
      dispatchConfiguration(
        strategy === "keep-mine"
          ? { type: "merge-latest-keeping-local", latest: latest.configuration }
          : { type: "replace-from-external", latest: latest.configuration }
      )
      history.setHistoryStats(latest.historyStats)
      history.setHistorySeries(latest.historySeries)

      if (strategy === "reload") {
        folder.clearPendingFolder()
        void hostPermissionController
          .removeUnused(latest.configuration.enablement)
          .catch((error) => {
            logger.warn(
              "Failed to remove unused HTTPS host permission after reloading settings:",
              error
            )
          })
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
      setIsResolvingExternalChanges(false)
    }
  }

  async function discardChanges(): Promise<boolean> {
    if (isSavingRef.current || folder.isPickingFolderRef.current) return false
    if (externalChangeKeys.length > 0) {
      const reloaded = await resolveExternalChanges("reload")
      if (reloaded) toast.info(t("options_toastChangesDiscarded"))
      return reloaded
    }

    void hostPermissionController
      .removeUnused(savedSiteIntegrationEnablement)
      .catch((error) => {
        logger.warn(
          "Failed to remove unused HTTPS host permission after discarding changes:",
          error
        )
      })

    folder.clearPendingFolder()
    dispatchConfiguration({ type: "discard-to-saved" })
    toast.info(t("options_toastChangesDiscarded"))
    return true
  }

  function retryLoad() {
    dispatchConfiguration({ type: "load-start" })
    setLoadAttempt((attempt) => attempt + 1)
  }

  return {
    settings,
    settingsBuffer,
    overrides,
    siteIntegrationEnablement,
    siteIntegrationSettingsByIntegration,
    historyStats: history.historyStats,
    historySeries: history.historySeries,
    selectedFolderName,
    isLoading,
    loadFailed,
    isSaving,
    isClearing: history.isClearing,
    isPickingFolder: folder.isPickingFolder,
    hasUnsavedChanges,
    hasExternalChanges: externalChangeKeys.length > 0,
    isResolvingExternalChanges,
    handleSettingsChange,
    handleSiteIntegrationSettingsChange,
    handleOverrideChange,
    handleSiteIntegrationEnablementChange,
    pickDownloadFolder,
    repairDownloadFolder,
    grantDownloadFolderAccess,
    saveConfiguration,
    clearAllHistory,
    clearSeriesHistory,
    handleRefreshHistory,
    discardChanges,
    resolveExternalChanges,
    retryLoad,
  }
}
