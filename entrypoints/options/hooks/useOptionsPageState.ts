import { useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"

import logger from "@/src/runtime/logger"
import { isRecord } from "@/src/shared/type-guards"
import { chapterPersistenceService } from "@/src/storage/chapter-persistence-service"
import {
  saveDownloadRootHandle,
  loadDownloadRootHandle,
  clearDownloadRootHandle,
  verifyPermission,
  DOWNLOAD_ROOT_HANDLE_ID,
  type DirHandle,
} from "@/src/storage/fs-access"
import {
  SITE_INTEGRATION_ENABLEMENT_STORAGE_KEY,
  siteIntegrationEnablementService,
  type SiteIntegrationEnablementMap,
} from "@/src/storage/site-integration-enablement-service"
import {
  SITE_INTEGRATION_SETTINGS_STORAGE_KEY,
  siteIntegrationSettingsService,
  type SiteIntegrationSettingsMap,
} from "@/src/storage/site-integration-settings-service"
import {
  settingsService,
  SETTINGS_STORAGE_KEY,
} from "@/src/storage/settings-service"
import { settingsSyncService } from "@/src/storage/settings-sync-service"
import type { ExtensionSettings } from "@/src/storage/settings-types"
import {
  SITE_OVERRIDES_STORAGE_KEY,
  siteOverridesService,
  type SiteOverrideRecord,
} from "@/src/storage/site-overrides-service"
import { reconcileOptionsSave } from "./options-save-reconciliation"
import {
  mergeOptionsDraftOntoLatest,
  type OptionsConfigurationSnapshot,
} from "./options-external-change"
import { t } from "@/src/runtime/i18n"
import { validateTemplate } from "@/src/shared/template-expander"
import {
  integrationRequiresBroadHttpsPermission,
  reconcileBroadHttpsPermissionEnablement,
  removeBroadHttpsPermissionIfUnused,
  requestIntegrationHostPermission,
} from "@/src/site-integrations/host-permission-service"
import { getSiteIntegrationDisplayName } from "@/src/site-integrations/manifest"

export interface SeriesHistory {
  seriesId: string
  seriesTitle: string
  chapterCount: number
}

export interface HistoryStats {
  totalChapters: number
  totalSeries: number
}

type CustomSettingValue = SiteIntegrationSettingsMap[string][string]

const OPTIONS_CONFIGURATION_STORAGE_KEYS = [
  SETTINGS_STORAGE_KEY,
  SITE_OVERRIDES_STORAGE_KEY,
  SITE_INTEGRATION_ENABLEMENT_STORAGE_KEY,
  SITE_INTEGRATION_SETTINGS_STORAGE_KEY,
] as const

type OptionsConfigurationStorageKey =
  (typeof OPTIONS_CONFIGURATION_STORAGE_KEYS)[number]

function stableSerialize(value: unknown): string {
  return JSON.stringify(value, (_key, candidate: unknown) => {
    if (!isRecord(candidate)) return candidate
    return Object.fromEntries(
      Object.entries(candidate).sort(([left], [right]) =>
        left.localeCompare(right)
      )
    )
  })
}

async function loadSeriesHistory(): Promise<SeriesHistory[]> {
  try {
    const result = await chrome.storage.local.get(["seriesDownloadHistory"])
    const rawHistory = result.seriesDownloadHistory
    const allHistory = isRecord(rawHistory) ? rawHistory : {}

    return Object.values(allHistory)
      .map((entry) => {
        if (!isRecord(entry)) return null
        const seriesId =
          typeof entry.seriesId === "string" ? entry.seriesId : ""
        const seriesTitle =
          typeof entry.seriesTitle === "string" ? entry.seriesTitle : ""
        const downloadedChapters = Array.isArray(entry.downloadedChapters)
          ? entry.downloadedChapters
          : []
        if (!seriesId || !seriesTitle) return null
        return {
          seriesId,
          seriesTitle,
          chapterCount: downloadedChapters.length,
        }
      })
      .filter((entry): entry is SeriesHistory => entry !== null)
      .sort((a, b) => a.seriesTitle.localeCompare(b.seriesTitle))
  } catch (error) {
    logger.error("[OPTIONS] Failed to load series history:", error)
    return []
  }
}

async function loadPersistedOptionsConfiguration(
  reloadSettings = false
): Promise<OptionsConfigurationSnapshot> {
  const [
    loadedSettings,
    loadedOverrides,
    loadedIntegrationEnablement,
    loadedIntegrationSettings,
  ] = await Promise.all([
    reloadSettings ? settingsService.reload() : settingsService.getSettings(),
    siteOverridesService.getAll(),
    siteIntegrationEnablementService.getAll(),
    siteIntegrationSettingsService.getAll(),
  ])

  return {
    settings: loadedSettings,
    overrides: loadedOverrides,
    enablement: loadedIntegrationEnablement,
    integrationSettings: loadedIntegrationSettings,
  }
}

async function loadInitialOptionsState() {
  try {
    await reconcileBroadHttpsPermissionEnablement()
  } catch (error) {
    logger.warn(
      "[OPTIONS] Could not reconcile optional host permissions during startup:",
      error
    )
  }

  const configuration = await loadPersistedOptionsConfiguration()
  const [stats, series] = await Promise.all([
    chapterPersistenceService.getStorageStats().catch((error) => {
      logger.warn("[OPTIONS] Could not load storage statistics:", error)
      return { totalChapters: 0, totalSeries: 0 }
    }),
    loadSeriesHistory(),
  ])

  return {
    loadedSettings: configuration.settings,
    loadedOverrides: configuration.overrides,
    loadedIntegrationEnablement: configuration.enablement,
    loadedIntegrationSettings: configuration.integrationSettings,
    historyStats: {
      totalChapters: stats.totalChapters,
      totalSeries: stats.totalSeries,
    },
    series,
  }
}

export function useOptionsPageState() {
  const [settings, setSettings] = useState<ExtensionSettings | null>(null)
  const [settingsBuffer, setSettingsBuffer] =
    useState<ExtensionSettings | null>(null)
  const [savedOverrides, setSavedOverrides] = useState<
    Record<string, SiteOverrideRecord>
  >({})
  const [overrides, setOverrides] = useState<
    Record<string, SiteOverrideRecord>
  >({})
  const [savedSiteIntegrationEnablement, setSavedSiteIntegrationEnablement] =
    useState<SiteIntegrationEnablementMap>({})
  const [siteIntegrationEnablement, setSiteIntegrationEnablement] =
    useState<SiteIntegrationEnablementMap>({})
  const [
    savedSiteIntegrationSettingsByIntegration,
    setSavedSiteIntegrationSettingsByIntegration,
  ] = useState<Record<string, Record<string, CustomSettingValue>>>({})
  const [
    siteIntegrationSettingsByIntegration,
    setSiteIntegrationSettingsByIntegration,
  ] = useState<Record<string, Record<string, CustomSettingValue>>>({})
  const [historyStats, setHistoryStats] = useState<HistoryStats | null>(null)
  const [historySeries, setHistorySeries] = useState<SeriesHistory[]>([])
  const [savedFolderHandle, setSavedFolderHandle] = useState<DirHandle | null>(
    null
  )
  const [pendingFolderHandle, setPendingFolderHandle] =
    useState<DirHandle | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [isSaving, setIsSaving] = useState(false)
  const [isClearing, setIsClearing] = useState(false)
  const [isPickingFolder, setIsPickingFolder] = useState(false)
  const [externalChangeKeys, setExternalChangeKeys] = useState<
    OptionsConfigurationStorageKey[]
  >([])
  const [isResolvingExternalChanges, setIsResolvingExternalChanges] =
    useState(false)
  const draftRevisionRef = useRef(0)
  const folderDraftRevisionRef = useRef(0)
  const draftDirtyRef = useRef(false)
  const isSavingRef = useRef(false)
  const externalReloadRequestRef = useRef(0)
  const externalChangeRevisionRef = useRef(0)
  const savedEnablementRef = useRef<SiteIntegrationEnablementMap>({})
  const hasLoadedEnablementRef = useRef(false)
  const selectedFolderName =
    pendingFolderHandle?.name ?? savedFolderHandle?.name ?? null
  const hasUnsavedChanges = useMemo(() => {
    if (!settings || !settingsBuffer) return false
    return (
      pendingFolderHandle !== null ||
      stableSerialize(settings) !== stableSerialize(settingsBuffer) ||
      stableSerialize(savedOverrides) !== stableSerialize(overrides) ||
      stableSerialize(savedSiteIntegrationEnablement) !==
        stableSerialize(siteIntegrationEnablement) ||
      stableSerialize(savedSiteIntegrationSettingsByIntegration) !==
        stableSerialize(siteIntegrationSettingsByIntegration)
    )
  }, [
    overrides,
    pendingFolderHandle,
    savedOverrides,
    savedSiteIntegrationEnablement,
    savedSiteIntegrationSettingsByIntegration,
    settings,
    settingsBuffer,
    siteIntegrationEnablement,
    siteIntegrationSettingsByIntegration,
  ])

  useEffect(() => {
    let canceled = false
    const folderRevisionAtStart = folderDraftRevisionRef.current

    void loadInitialOptionsState()
      .then((loaded) => {
        if (canceled) return

        setSettings(loaded.loadedSettings)
        setSettingsBuffer(loaded.loadedSettings)
        setSavedOverrides(loaded.loadedOverrides)
        setOverrides(loaded.loadedOverrides)
        setSavedSiteIntegrationEnablement(loaded.loadedIntegrationEnablement)
        savedEnablementRef.current = loaded.loadedIntegrationEnablement
        hasLoadedEnablementRef.current = true
        setSiteIntegrationEnablement(loaded.loadedIntegrationEnablement)
        setSavedSiteIntegrationSettingsByIntegration(
          loaded.loadedIntegrationSettings
        )
        setSiteIntegrationSettingsByIntegration(
          loaded.loadedIntegrationSettings
        )
        setHistoryStats(loaded.historyStats)
        setHistorySeries(loaded.series)
        draftDirtyRef.current = false
        setExternalChangeKeys([])
        setLoadFailed(false)
      })
      .catch((error) => {
        if (canceled) return
        logger.error("[OPTIONS] Failed to load configuration:", error)
        setLoadFailed(true)
        toast.error(t("options_toastLoadFailed"))
      })
      .finally(() => {
        if (!canceled) {
          setIsLoading(false)
        }
      })

    void loadDownloadRootHandle()
      .then((handle) => {
        if (canceled) return
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
  }, [loadAttempt])

  useEffect(() => {
    return () => {
      if (!hasLoadedEnablementRef.current) return
      // Permission requests must happen in a user gesture, but a user can
      // close Options before saving the matching enablement change. Cleanup is
      // best-effort here and is repeated during background/Options startup.
      void removeBroadHttpsPermissionIfUnused(savedEnablementRef.current).catch(
        (error) => {
          logger.warn(
            "Failed to remove unused HTTPS host permission when Options closed:",
            error
          )
        }
      )
    }
  }, [])

  useEffect(() => {
    let canceled = false
    const handleStorageChange = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: chrome.storage.AreaName
    ) => {
      if (areaName !== "local") return
      const changedKeys = OPTIONS_CONFIGURATION_STORAGE_KEYS.filter(
        (key) => changes[key] !== undefined
      )
      if (changedKeys.length === 0 || isSavingRef.current) return
      externalChangeRevisionRef.current++

      const recordConflict = () => {
        setExternalChangeKeys((current) => [
          ...new Set([...current, ...changedKeys]),
        ])
      }

      if (draftDirtyRef.current || hasUnsavedChanges) {
        recordConflict()
        return
      }

      const draftRevisionAtStart = draftRevisionRef.current
      const requestId = ++externalReloadRequestRef.current
      void loadPersistedOptionsConfiguration(true)
        .then((latest) => {
          if (canceled || requestId !== externalReloadRequestRef.current) return
          if (
            draftDirtyRef.current ||
            draftRevisionRef.current !== draftRevisionAtStart
          ) {
            recordConflict()
            return
          }

          setSettings(latest.settings)
          setSettingsBuffer(latest.settings)
          setSavedOverrides(latest.overrides)
          setOverrides(latest.overrides)
          setSavedSiteIntegrationEnablement(latest.enablement)
          setSiteIntegrationEnablement(latest.enablement)
          setSavedSiteIntegrationSettingsByIntegration(
            latest.integrationSettings
          )
          setSiteIntegrationSettingsByIntegration(latest.integrationSettings)
          draftDirtyRef.current = false
          setExternalChangeKeys([])
        })
        .catch((error) => {
          if (canceled) return
          logger.error("[OPTIONS] Failed to apply external settings:", error)
          recordConflict()
        })
    }
    chrome.storage.onChanged.addListener(handleStorageChange)
    return () => {
      canceled = true
      chrome.storage.onChanged.removeListener(handleStorageChange)
    }
  }, [hasUnsavedChanges])

  async function saveConfiguration() {
    if (!settingsBuffer || !settings || isSaving) return
    if (externalChangeKeys.length > 0 || isResolvingExternalChanges) {
      toast.error(t("options_externalChangesSaveBlocked"))
      return
    }

    const pathValidation = validateTemplate(
      settingsBuffer.downloads.pathTemplate
    )
    const filenameValidation = validateTemplate(
      settingsBuffer.downloads.fileNameTemplate || "<CHAPTER_TITLE>"
    )
    if (!pathValidation.valid || !filenameValidation.valid) {
      toast.error(t("options_invalidTemplate"))
      return
    }

    try {
      isSavingRef.current = true
      setIsSaving(true)
      const submittedRevision = draftRevisionRef.current
      const submittedSettings = settingsBuffer
      const submittedOverrides = overrides
      const submittedEnablement = siteIntegrationEnablement
      const submittedIntegrationSettings = siteIntegrationSettingsByIntegration
      const wantsCustomFolder =
        submittedSettings.downloads.destination === "file-system-access"
      const handleToPersist = wantsCustomFolder
        ? (pendingFolderHandle ?? savedFolderHandle)
        : null

      if (wantsCustomFolder && handleToPersist) {
        await saveDownloadRootHandle(handleToPersist)
      }

      if (!wantsCustomFolder && (savedFolderHandle || pendingFolderHandle)) {
        await clearDownloadRootHandle()
      }

      const result =
        await settingsSyncService.updateSettingsWithSync(submittedSettings)

      if (!result.success) {
        throw new Error(result.error || t("options_toastSaveFailed"))
      }
      const persistedSettings = result.settings ?? submittedSettings

      await siteOverridesService.setAll(submittedOverrides)
      await siteIntegrationEnablementService.setAll(submittedEnablement)
      savedEnablementRef.current = submittedEnablement
      await siteIntegrationSettingsService.setAll(submittedIntegrationSettings)
      try {
        await removeBroadHttpsPermissionIfUnused(submittedEnablement)
      } catch (error) {
        // A disabled integration remains safely disabled if Chrome declines to
        // remove now-unused permission; retain permission cleanup as best effort.
        logger.warn("Failed to remove unused HTTPS host permission:", error)
      }

      const reconciliation = reconcileOptionsSave({
        submitted: {
          settings: submittedSettings,
          overrides: submittedOverrides,
          enablement: submittedEnablement,
          integrationSettings: submittedIntegrationSettings,
          folderHandle: handleToPersist,
        },
        persisted: {
          settings: persistedSettings,
          overrides: submittedOverrides,
          enablement: submittedEnablement,
          integrationSettings: submittedIntegrationSettings,
          folderHandle: handleToPersist,
        },
        submittedRevision,
        currentRevision: draftRevisionRef.current,
      })
      setSettings(reconciliation.saved.settings)
      setSavedOverrides(reconciliation.saved.overrides)
      setSavedSiteIntegrationEnablement(reconciliation.saved.enablement)
      setSavedSiteIntegrationSettingsByIntegration(
        reconciliation.saved.integrationSettings
      )
      setSavedFolderHandle(reconciliation.saved.folderHandle)
      draftDirtyRef.current = !reconciliation.clearTransientDraft
      if (reconciliation.clearTransientDraft) {
        setSettingsBuffer(reconciliation.saved.settings)
        setOverrides(reconciliation.saved.overrides)
        setSiteIntegrationEnablement(reconciliation.saved.enablement)
        setSiteIntegrationSettingsByIntegration(
          reconciliation.saved.integrationSettings
        )
        setPendingFolderHandle(null)
      }
      toast.success(t("options_toastSavedSuccessfully"))
    } catch (error) {
      const rollbackFailures: unknown[] = []
      try {
        if (savedFolderHandle) {
          await saveDownloadRootHandle(savedFolderHandle)
        } else {
          await clearDownloadRootHandle()
        }
      } catch (rollbackError) {
        rollbackFailures.push(rollbackError)
        logger.error(
          "[OPTIONS] Failed to restore saved folder handle after save error:",
          rollbackError
        )
      }
      const rollbackResults = await Promise.allSettled([
        settingsSyncService.updateSettingsWithSync(settings),
        siteOverridesService.setAll(savedOverrides),
        siteIntegrationEnablementService.setAll(savedSiteIntegrationEnablement),
        siteIntegrationSettingsService.setAll(
          savedSiteIntegrationSettingsByIntegration
        ),
      ])
      savedEnablementRef.current = savedSiteIntegrationEnablement
      for (const rollbackResult of rollbackResults) {
        if (rollbackResult.status === "rejected") {
          rollbackFailures.push(rollbackResult.reason)
        } else if (
          typeof rollbackResult.value === "object" &&
          rollbackResult.value !== null &&
          "success" in rollbackResult.value &&
          rollbackResult.value.success === false
        ) {
          rollbackFailures.push(rollbackResult.value.error)
        }
      }
      if (rollbackFailures.length > 0) {
        logger.error(
          "[OPTIONS] Configuration rollback was incomplete:",
          rollbackFailures
        )
      }
      logger.error("[OPTIONS] Failed to save settings:", error)
      toast.error(t("options_toastSaveFailed"), {
        description: t("options_toastUnknownError"),
      })
    } finally {
      isSavingRef.current = false
      setIsSaving(false)
    }
  }

  async function handleRefreshHistory() {
    const series = await loadSeriesHistory()
    setHistorySeries(series)
    try {
      const stats = await chapterPersistenceService.getStorageStats()
      setHistoryStats({
        totalChapters: stats.totalChapters,
        totalSeries: stats.totalSeries,
      })
    } catch (error) {
      logger.error("[OPTIONS] Failed to refresh storage stats:", error)
    }
    return series
  }

  function handleSettingsChange(updates: Partial<ExtensionSettings>) {
    if (!settingsBuffer) return

    draftRevisionRef.current++
    draftDirtyRef.current = true
    setSettingsBuffer({ ...settingsBuffer, ...updates })
  }

  function handleSiteIntegrationSettingsChange(
    siteIntegrationId: string,
    settingId: string,
    enabled: boolean,
    value: CustomSettingValue
  ) {
    draftRevisionRef.current++
    draftDirtyRef.current = true
    setSiteIntegrationSettingsByIntegration((previous) => {
      const siteIntegrationSettings = {
        ...(previous[siteIntegrationId] ?? {}),
      }

      if (enabled) {
        siteIntegrationSettings[settingId] = value
      } else {
        delete siteIntegrationSettings[settingId]
      }

      if (Object.keys(siteIntegrationSettings).length === 0) {
        const next = { ...previous }
        delete next[siteIntegrationId]
        return next
      }

      return {
        ...previous,
        [siteIntegrationId]: siteIntegrationSettings,
      }
    })
  }

  function handleOverrideChange(
    siteIntegrationId: string,
    override: SiteOverrideRecord | null
  ) {
    draftRevisionRef.current++
    draftDirtyRef.current = true
    const nextOverrides = { ...overrides }
    if (override === null || Object.keys(override).length === 0) {
      delete nextOverrides[siteIntegrationId]
    } else {
      nextOverrides[siteIntegrationId] = override
    }
    setOverrides(nextOverrides)
  }

  async function handleSiteIntegrationEnablementChange(
    siteIntegrationId: string,
    enabled: boolean
  ): Promise<void> {
    if (enabled && integrationRequiresBroadHttpsPermission(siteIntegrationId)) {
      try {
        // This is intentionally the first awaited operation: Chrome requires
        // optional permission requests to originate from the user's gesture.
        const granted =
          await requestIntegrationHostPermission(siteIntegrationId)
        if (!granted) {
          toast.error(
            t("options_toastIntegrationHostPermissionDenied", [
              getSiteIntegrationDisplayName(siteIntegrationId),
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
            getSiteIntegrationDisplayName(siteIntegrationId),
          ])
        )
        return
      }
    }

    draftRevisionRef.current++
    draftDirtyRef.current = true
    setSiteIntegrationEnablement((previous) => ({
      ...previous,
      [siteIntegrationId]: enabled,
    }))
  }

  async function requestDownloadFolderFromUser(): Promise<
    DirHandle | undefined
  > {
    const picker = (
      window as Window & {
        showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>
      }
    ).showDirectoryPicker
    if (!picker) {
      toast.error(t("options_toastFsaNotSupported"))
      return undefined
    }

    const handle = await picker().catch((error: unknown) => {
      const normalized = error as { name?: string; code?: number }
      if (
        normalized &&
        (normalized.name === "AbortError" || normalized.code === 20)
      ) {
        return undefined
      }
      throw error
    })
    if (!handle) return undefined

    const ok = await verifyPermission(handle, true)
    if (!ok) {
      toast.error(t("options_toastPermissionDenied"))
      return undefined
    }
    return handle
  }

  async function pickDownloadFolder() {
    try {
      setIsPickingFolder(true)
      const handle = await requestDownloadFolderFromUser()
      if (!handle) return

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
      } else {
        draftRevisionRef.current++
        draftDirtyRef.current = true
      }

      toast.success(t("options_toastCustomFolderSet", [handle.name]))
    } catch (error) {
      if ((error as Error).name !== "AbortError") {
        toast.error(t("options_toastSetFolderFailed"))
      }
    } finally {
      setIsPickingFolder(false)
    }
  }

  async function repairDownloadFolder(): Promise<boolean> {
    try {
      setIsPickingFolder(true)
      const handle = await requestDownloadFolderFromUser()
      if (!handle) return false

      await saveDownloadRootHandle(handle)
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
      setIsPickingFolder(false)
    }
  }

  async function grantDownloadFolderAccess(): Promise<boolean> {
    try {
      setIsPickingFolder(true)
      const handle = await loadDownloadRootHandle()
      if (!handle) {
        toast.error(t("settings_customFolderRequired"))
        return false
      }
      const granted = await verifyPermission(handle, true)
      if (!granted) {
        toast.error(t("options_toastPermissionDenied"))
        return false
      }
      setSavedFolderHandle(handle)
      toast.success(t("destinationIssue_accessGranted"))
      return true
    } catch (error) {
      logger.error("[OPTIONS] Failed to grant custom-folder access:", error)
      toast.error(t("options_toastPermissionDenied"))
      return false
    } finally {
      setIsPickingFolder(false)
    }
  }

  async function clearAllHistory(): Promise<boolean> {
    try {
      setIsClearing(true)
      await chapterPersistenceService.clearAllDownloadHistory()
      const stats = await chapterPersistenceService.getStorageStats()
      setHistoryStats({
        totalChapters: stats.totalChapters,
        totalSeries: stats.totalSeries,
      })
      const series = await loadSeriesHistory()
      setHistorySeries(series)
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

  async function clearSeriesHistory(seriesId: string): Promise<boolean> {
    try {
      setIsClearing(true)
      await chapterPersistenceService.clearSeriesDownloadHistory(seriesId)
      const stats = await chapterPersistenceService.getStorageStats()
      setHistoryStats({
        totalChapters: stats.totalChapters,
        totalSeries: stats.totalSeries,
      })
      const series = await loadSeriesHistory()
      setHistorySeries(series)
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
      isSaving
    ) {
      return false
    }

    const draftRevisionAtStart = draftRevisionRef.current
    const externalRevisionAtStart = externalChangeRevisionRef.current
    const baseline: OptionsConfigurationSnapshot = {
      settings,
      overrides: savedOverrides,
      enablement: savedSiteIntegrationEnablement,
      integrationSettings: savedSiteIntegrationSettingsByIntegration,
    }
    const draft: OptionsConfigurationSnapshot = {
      settings: settingsBuffer,
      overrides,
      enablement: siteIntegrationEnablement,
      integrationSettings: siteIntegrationSettingsByIntegration,
    }

    try {
      setIsResolvingExternalChanges(true)
      const latest = await loadPersistedOptionsConfiguration(true)
      if (
        draftRevisionRef.current !== draftRevisionAtStart ||
        externalChangeRevisionRef.current !== externalRevisionAtStart
      ) {
        toast.info(t("options_externalChangesChangedAgain"))
        return false
      }

      const nextDraft =
        strategy === "keep-mine"
          ? mergeOptionsDraftOntoLatest(baseline, draft, latest)
          : latest
      const draftRemainsDirty =
        stableSerialize(nextDraft) !== stableSerialize(latest)

      externalReloadRequestRef.current++
      draftRevisionRef.current++
      draftDirtyRef.current = draftRemainsDirty
      setSettings(latest.settings)
      setSettingsBuffer(nextDraft.settings)
      setSavedOverrides(latest.overrides)
      setOverrides(nextDraft.overrides)
      setSavedSiteIntegrationEnablement(latest.enablement)
      savedEnablementRef.current = latest.enablement
      setSiteIntegrationEnablement(nextDraft.enablement)
      setSavedSiteIntegrationSettingsByIntegration(latest.integrationSettings)
      setSiteIntegrationSettingsByIntegration(nextDraft.integrationSettings)
      setExternalChangeKeys([])

      if (strategy === "reload") {
        folderDraftRevisionRef.current++
        setPendingFolderHandle(null)
        void removeBroadHttpsPermissionIfUnused(latest.enablement).catch(
          (error) => {
            logger.warn(
              "Failed to remove unused HTTPS host permission after reloading settings:",
              error
            )
          }
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
      setIsResolvingExternalChanges(false)
    }
  }

  async function discardChanges(): Promise<boolean> {
    if (externalChangeKeys.length > 0) {
      const reloaded = await resolveExternalChanges("reload")
      if (reloaded) toast.info(t("options_toastChangesDiscarded"))
      return reloaded
    }

    void removeBroadHttpsPermissionIfUnused(
      savedSiteIntegrationEnablement
    ).catch((error) => {
      logger.warn(
        "Failed to remove unused HTTPS host permission after discarding changes:",
        error
      )
    })

    draftRevisionRef.current++
    folderDraftRevisionRef.current++
    draftDirtyRef.current = false
    setSettingsBuffer(settings)
    setOverrides(savedOverrides)
    setSiteIntegrationEnablement(savedSiteIntegrationEnablement)
    setSiteIntegrationSettingsByIntegration(
      savedSiteIntegrationSettingsByIntegration
    )
    setPendingFolderHandle(null)
    setExternalChangeKeys([])
    toast.info(t("options_toastChangesDiscarded"))
    return true
  }

  function retryLoad() {
    setIsLoading(true)
    setLoadFailed(false)
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
