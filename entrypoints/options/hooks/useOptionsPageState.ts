import { useEffect, useMemo, useReducer, useRef, useState } from "react"
import { toast } from "sonner"

import logger from "@/src/runtime/logger"
import {
  DOWNLOAD_ROOT_HANDLE_ID,
  type DirHandle,
} from "@/src/storage/fs-access"
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

export interface SeriesHistory {
  siteIntegrationId: string
  seriesId: string
  seriesTitle: string
  chapterCount: number
}

export interface HistoryStats {
  totalChapters: number
  totalSeries: number
}

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
  const [historyStats, setHistoryStats] = useState<HistoryStats | null>(null)
  const [historySeries, setHistorySeries] = useState<SeriesHistory[]>([])
  const [savedFolderHandle, setSavedFolderHandle] = useState<DirHandle | null>(
    null
  )
  const [pendingFolderHandle, setPendingFolderHandle] =
    useState<DirHandle | null>(null)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [isSaving, setIsSaving] = useState(false)
  const [isClearing, setIsClearing] = useState(false)
  const [isPickingFolder, setIsPickingFolder] = useState(false)
  const [isResolvingExternalChanges, setIsResolvingExternalChanges] =
    useState(false)
  const externalChangeKeys = configuration.externalChangeKeys
  const isLoading = configuration.hydration.status === "loading"
  const loadFailed = configuration.hydration.status === "error"
  const draftRevisionRef = useRef(0)
  const folderDraftRevisionRef = useRef(0)
  const draftDirtyRef = useRef(false)
  const isSavingRef = useRef(false)
  const isPickingFolderRef = useRef(false)
  const savedEnablementRef = useRef<SiteIntegrationEnablementMap>({})
  const hasLoadedEnablementRef = useRef(false)
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
  const selectedFolderName =
    pendingFolderHandle?.name ?? savedFolderHandle?.name ?? null
  const hasUnsavedChanges =
    configuration.saved !== null &&
    configuration.draft !== null &&
    (pendingFolderHandle !== null ||
      !optionsConfigurationSnapshotsEqual(
        configuration.saved,
        configuration.draft
      ))

  function beginFolderAction(): boolean {
    if (isSavingRef.current || isPickingFolderRef.current) return false
    isPickingFolderRef.current = true
    setIsPickingFolder(true)
    return true
  }

  function endFolderAction(): void {
    isPickingFolderRef.current = false
    setIsPickingFolder(false)
  }

  useEffect(() => {
    let canceled = false
    const folderRevisionAtStart = folderDraftRevisionRef.current
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
        if (folderDraftRevisionRef.current === folderRevisionAtStart) {
          setPendingFolderHandle(null)
        }
      })
      .catch((error) => {
        if (canceled) return
        setSavedFolderHandle(null)
        if (folderDraftRevisionRef.current === folderRevisionAtStart) {
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
    hostPermissionController,
    loadAttempt,
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
  }, [externalChangeController, hasUnsavedChanges])

  async function saveConfiguration() {
    if (
      !settingsBuffer ||
      !settings ||
      isSaving ||
      isSavingRef.current ||
      isPickingFolderRef.current
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
        ? (pendingFolderHandle ?? savedFolderHandle)
        : null

      if (wantsCustomFolder && handleToPersist) {
        try {
          fsaMutationRevision = await fsaController.save(handleToPersist)
        } catch (error) {
          fsaMutationRevision = fsaController.revision
          throw error
        }
      }

      if (!wantsCustomFolder && (savedFolderHandle || pendingFolderHandle)) {
        try {
          fsaMutationRevision = await fsaController.clear()
        } catch (error) {
          fsaMutationRevision = fsaController.revision
          throw error
        }
      }

      const destinationValidation = await validateSettingsDestination(
        submittedSettings.downloads.destination
      )
      if (!destinationValidation.isValid) {
        throw new Error(
          destinationValidation.error ?? t("options_toastSaveFailed")
        )
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
      setSavedFolderHandle(handleToPersist)
      if (clearTransientDraft) {
        setPendingFolderHandle(null)
      }
      saveSucceeded = true
      toast.success(t("options_toastSavedSuccessfully"))
    } catch (error) {
      if (fsaMutationRevision !== null) {
        try {
          await fsaController.restore(savedFolderHandle, fsaMutationRevision)
        } catch (rollbackError) {
          logger.error(
            "[OPTIONS] Failed to restore saved folder handle after save error:",
            rollbackError
          )
        }
      }
      logger.error("[OPTIONS] Failed to save settings:", error)
      toast.error(t("options_toastSaveFailed"), {
        description: t("options_toastUnknownError"),
      })
    } finally {
      externalChangeController.completeSave(saveToken, saveSucceeded)
      isSavingRef.current = false
      setIsSaving(false)
    }
  }

  async function handleRefreshHistory() {
    const loaded = await historyController.refresh()
    setHistoryStats(loaded.historyStats)
    setHistorySeries(loaded.historySeries)
    return loaded.historySeries
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

  async function pickDownloadFolder() {
    if (!beginFolderAction()) return
    try {
      const result = await fsaController.requestFromUser()
      if (result.status === "unsupported") {
        toast.error(t("options_toastFsaNotSupported"))
        return
      }
      if (result.status === "denied") {
        toast.error(t("options_toastPermissionDenied"))
        return
      }
      if (result.status === "aborted") return
      if (result.status !== "granted") return
      const handle = result.handle

      folderDraftRevisionRef.current++
      setPendingFolderHandle(handle)

      if (settingsBuffer) {
        handleSettingsChange({
          downloads: {
            ...settingsBuffer.downloads,
            destination: "file-system-access",
            customDirectoryHandleId: DOWNLOAD_ROOT_HANDLE_ID,
          },
        })
      }

      toast.success(t("options_toastCustomFolderSet", [handle.name]))
    } catch (error) {
      if ((error as Error).name !== "AbortError") {
        toast.error(t("options_toastSetFolderFailed"))
      }
    } finally {
      endFolderAction()
    }
  }

  async function repairDownloadFolder(): Promise<boolean> {
    if (!beginFolderAction()) return false
    try {
      const result = await fsaController.requestFromUser()
      if (result.status === "unsupported") {
        toast.error(t("options_toastFsaNotSupported"))
        return false
      }
      if (result.status === "denied") {
        toast.error(t("options_toastPermissionDenied"))
        return false
      }
      if (result.status === "aborted") return false
      if (result.status !== "granted") return false
      const handle = result.handle

      await fsaController.save(handle)
      folderDraftRevisionRef.current++
      setSavedFolderHandle(handle)
      setPendingFolderHandle(null)
      toast.success(t("options_toastCustomFolderSet", [handle.name]))
      return true
    } catch (error) {
      logger.error("[OPTIONS] Failed to repair custom folder:", error)
      toast.error(t("options_toastSetFolderFailed"))
      return false
    } finally {
      endFolderAction()
    }
  }

  async function grantDownloadFolderAccess(): Promise<boolean> {
    if (!beginFolderAction()) return false
    try {
      const result = await fsaController.grantSavedAccess()
      if (result.status === "missing") {
        toast.error(t("settings_customFolderRequired"))
        return false
      }
      if (result.status === "denied") {
        toast.error(t("options_toastPermissionDenied"))
        return false
      }
      const handle = result.handle
      setSavedFolderHandle(handle)
      toast.success(t("destinationIssue_accessGranted"))
      return true
    } catch (error) {
      logger.error("[OPTIONS] Failed to grant custom-folder access:", error)
      toast.error(t("options_toastPermissionDenied"))
      return false
    } finally {
      endFolderAction()
    }
  }

  async function clearAllHistory(): Promise<boolean> {
    try {
      setIsClearing(true)
      const loaded = await historyController.clear({ scope: "all" })
      setHistoryStats(loaded.historyStats)
      setHistorySeries(loaded.historySeries)
      toast.success(t("options_toastAllHistoryCleared"))
      return true
    } catch (error) {
      logger.error("[OPTIONS] Failed to clear history:", error)
      toast.error(t("options_toastClearHistoryFailed"))
      return false
    } finally {
      setIsClearing(false)
    }
  }

  async function clearSeriesHistory(
    siteIntegrationId: string,
    seriesId: string
  ): Promise<boolean> {
    try {
      setIsClearing(true)
      const loaded = await historyController.clear({
        scope: "series",
        siteIntegrationId,
        seriesId,
      })
      setHistoryStats(loaded.historyStats)
      setHistorySeries(loaded.historySeries)
      toast.success(t("options_toastSeriesHistoryCleared"))
      return true
    } catch (error) {
      logger.error("[OPTIONS] Failed to clear series history:", error)
      toast.error(t("options_toastClearSeriesFailed"))
      return false
    } finally {
      setIsClearing(false)
    }
  }

  async function resolveExternalChanges(
    strategy: "reload" | "keep-mine"
  ): Promise<boolean> {
    if (
      !settings ||
      !settingsBuffer ||
      isResolvingExternalChanges ||
      isSaving ||
      isSavingRef.current ||
      isPickingFolderRef.current
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
      setHistoryStats(latest.historyStats)
      setHistorySeries(latest.historySeries)

      if (strategy === "reload") {
        folderDraftRevisionRef.current++
        setPendingFolderHandle(null)
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
    if (isSavingRef.current || isPickingFolderRef.current) return false
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

    folderDraftRevisionRef.current++
    dispatchConfiguration({ type: "discard-to-saved" })
    setPendingFolderHandle(null)
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
    historyStats,
    historySeries,
    selectedFolderName,
    isLoading,
    loadFailed,
    isSaving,
    isClearing,
    isPickingFolder,
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
