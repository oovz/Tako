import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import logger from '@/src/runtime/logger'
import { initializeSiteIntegrationMetadataOnly } from '@/src/runtime/site-integration-initialization'
import { isRecord, type StorageValue } from '@/src/shared/type-guards'
import { chapterPersistenceService } from '@/src/storage/chapter-persistence-service'
import {
  saveDownloadRootHandle,
  loadDownloadRootHandle,
  clearDownloadRootHandle,
  verifyPermission,
  DOWNLOAD_ROOT_HANDLE_ID,
  type DirHandle,
} from '@/src/storage/fs-access'
import { siteIntegrationEnablementService, type SiteIntegrationEnablementMap } from '@/src/storage/site-integration-enablement-service'
import { siteIntegrationSettingsService, type SiteIntegrationSettingsMap } from '@/src/storage/site-integration-settings-service'
import { settingsService } from '@/src/storage/settings-service'
import { settingsSyncService } from '@/src/storage/settings-sync-service'
import type { ExtensionSettings } from '@/src/storage/settings-types'
import { siteOverridesService, type SiteOverrideRecord } from '@/src/storage/site-overrides-service'

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

async function loadSeriesHistory(): Promise<SeriesHistory[]> {
  try {
    const result = await chrome.storage.local.get(['seriesDownloadHistory']) as Record<string, StorageValue>
    const rawHistory = result.seriesDownloadHistory
    const allHistory = isRecord(rawHistory) ? rawHistory : {}

    return Object.values(allHistory)
      .map((entry) => {
        if (!isRecord(entry)) return null
        const seriesId = typeof entry.seriesId === 'string' ? entry.seriesId : ''
        const seriesTitle = typeof entry.seriesTitle === 'string' ? entry.seriesTitle : ''
        const downloadedChapters = Array.isArray(entry.downloadedChapters) ? entry.downloadedChapters : []
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
    logger.error('[OPTIONS] Failed to load series history:', error)
    return []
  }
}

export function useOptionsPageState() {
  const [settings, setSettings] = useState<ExtensionSettings | null>(null)
  const [settingsBuffer, setSettingsBuffer] = useState<ExtensionSettings | null>(null)
  const [savedOverrides, setSavedOverrides] = useState<Record<string, SiteOverrideRecord>>({})
  const [overrides, setOverrides] = useState<Record<string, SiteOverrideRecord>>({})
  const [savedSiteIntegrationEnablement, setSavedSiteIntegrationEnablement] = useState<SiteIntegrationEnablementMap>({})
  const [siteIntegrationEnablement, setSiteIntegrationEnablement] = useState<SiteIntegrationEnablementMap>({})
  const [savedSiteIntegrationSettingsByIntegration, setSavedSiteIntegrationSettingsByIntegration] = useState<Record<string, Record<string, CustomSettingValue>>>({})
  const [siteIntegrationSettingsByIntegration, setSiteIntegrationSettingsByIntegration] = useState<Record<string, Record<string, CustomSettingValue>>>({})
  const [historyStats, setHistoryStats] = useState<HistoryStats | null>(null)
  const [historySeries, setHistorySeries] = useState<SeriesHistory[]>([])
  const [savedFolderHandle, setSavedFolderHandle] = useState<DirHandle | null>(null)
  const [pendingFolderHandle, setPendingFolderHandle] = useState<DirHandle | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [isClearing, setIsClearing] = useState(false)
  const [isPickingFolder, setIsPickingFolder] = useState(false)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const selectedFolderName = pendingFolderHandle?.name ?? savedFolderHandle?.name ?? null

  useEffect(() => {
    void loadConfiguration()
    void initializeSiteIntegrationMetadataOnly()
    void loadFolderHandle()
  }, [])

  async function loadConfiguration() {
    try {
      setIsLoading(true)
      const [loadedSettings, loadedOverrides, loadedIntegrationEnablement, loadedIntegrationSettings] = await Promise.all([
        settingsService.getSettings(),
        siteOverridesService.getAll(),
        siteIntegrationEnablementService.getAll(),
        siteIntegrationSettingsService.getAll(),
      ])
      setSettings(loadedSettings)
      setSettingsBuffer(loadedSettings)
      setSavedOverrides(loadedOverrides)
      setOverrides(loadedOverrides)
      setSavedSiteIntegrationEnablement(loadedIntegrationEnablement)
      setSiteIntegrationEnablement(loadedIntegrationEnablement)
      setSavedSiteIntegrationSettingsByIntegration(loadedIntegrationSettings)
      setSiteIntegrationSettingsByIntegration(loadedIntegrationSettings)

      const stats = await chapterPersistenceService.getStorageStats()
      setHistoryStats({ totalChapters: stats.totalChapters, totalSeries: stats.totalSeries })

      const series = await loadSeriesHistory()
      setHistorySeries(series)
    } catch (error) {
      logger.error('[OPTIONS] Failed to load configuration:', error)
      toast.error('Failed to load settings')
    } finally {
      setIsLoading(false)
    }
  }

  async function loadFolderHandle() {
    try {
      const handle = await loadDownloadRootHandle()
      setSavedFolderHandle(handle ?? null)
      setPendingFolderHandle(null)
    } catch {
      setSavedFolderHandle(null)
      setPendingFolderHandle(null)
      logger.debug('[OPTIONS] No custom folder configured')
    }
  }

  async function saveConfiguration() {
    if (!settingsBuffer) return

    try {
      setIsSaving(true)
      const wantsCustomFolder = settingsBuffer.downloads.downloadMode === 'custom'
      const handleToPersist = wantsCustomFolder ? (pendingFolderHandle ?? savedFolderHandle) : null

      if (wantsCustomFolder && handleToPersist) {
        await saveDownloadRootHandle(handleToPersist)
      }

      if (!wantsCustomFolder && (savedFolderHandle || pendingFolderHandle)) {
        await clearDownloadRootHandle()
      }

      const result = await settingsSyncService.updateSettingsWithSync(settingsBuffer)

      if (!result.success) {
        throw new Error(result.error || 'Failed to save settings')
      }

      await siteOverridesService.setAll(overrides)
      await siteIntegrationEnablementService.setAll(siteIntegrationEnablement)
      await siteIntegrationSettingsService.setAll(siteIntegrationSettingsByIntegration as SiteIntegrationSettingsMap)

      setSettings(settingsBuffer)
      setSavedOverrides(overrides)
      setSavedSiteIntegrationEnablement(siteIntegrationEnablement)
      setSavedSiteIntegrationSettingsByIntegration(siteIntegrationSettingsByIntegration)
      setSavedFolderHandle(handleToPersist)
      setPendingFolderHandle(null)
      setHasUnsavedChanges(false)

      toast.success('Settings saved successfully')
    } catch (error) {
      try {
        if (savedFolderHandle) {
          await saveDownloadRootHandle(savedFolderHandle)
        } else {
          await clearDownloadRootHandle()
        }
      } catch (rollbackError) {
        logger.error('[OPTIONS] Failed to restore saved folder handle after save error:', rollbackError)
      }
      logger.error('[OPTIONS] Failed to save settings:', error)
      toast.error('Failed to save settings', {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    } finally {
      setIsSaving(false)
    }
  }

  async function handleRefreshHistory() {
    const series = await loadSeriesHistory()
    setHistorySeries(series)
    const stats = await chapterPersistenceService.getStorageStats()
    setHistoryStats({ totalChapters: stats.totalChapters, totalSeries: stats.totalSeries })
    return series
  }

  function handleSettingsChange(updates: Partial<ExtensionSettings>) {
    if (!settingsBuffer) return

    setSettingsBuffer({ ...settingsBuffer, ...updates })
    setHasUnsavedChanges(true)
  }

  function handleSiteIntegrationSettingsChange(
    siteIntegrationId: string,
    settingId: string,
    enabled: boolean,
    value: CustomSettingValue,
  ) {
    setSiteIntegrationSettingsByIntegration((previous) => {
      const siteIntegrationSettings = { ...(previous[siteIntegrationId] ?? {}) }

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
    setHasUnsavedChanges(true)
  }

  function handleOverrideChange(siteIntegrationId: string, override: SiteOverrideRecord | null) {
    const nextOverrides = { ...overrides }
    if (override === null || Object.keys(override).length === 0) {
      delete nextOverrides[siteIntegrationId]
    } else {
      nextOverrides[siteIntegrationId] = override
    }
    setOverrides(nextOverrides)
    setHasUnsavedChanges(true)
  }

  function handleSiteIntegrationEnablementChange(siteIntegrationId: string, enabled: boolean) {
    setSiteIntegrationEnablement((previous) => ({
      ...previous,
      [siteIntegrationId]: enabled,
    }))
    setHasUnsavedChanges(true)
  }

  async function pickDownloadFolder() {
    try {
      setIsPickingFolder(true)

      const picker = (window as Window & { showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker
      if (!picker) {
        toast.error('File System Access API not supported')
        return
      }

      const handle = await picker().catch((error: unknown) => {
        const normalized = error as { name?: string; code?: number }
        if (normalized && (normalized.name === 'AbortError' || normalized.code === 20)) {
          return undefined
        }
        throw error
      })

      if (!handle) return

      const ok = await verifyPermission(handle, true)
      if (!ok) {
        toast.error('Permission denied')
        return
      }

      setPendingFolderHandle(handle)

      if (settingsBuffer) {
        handleSettingsChange({
          downloads: {
            ...settingsBuffer.downloads,
            downloadMode: 'custom',
            customDirectoryEnabled: true,
            customDirectoryHandleId: DOWNLOAD_ROOT_HANDLE_ID,
          },
        })
      }

      toast.success(`Custom download folder set: ${handle.name}`)
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        toast.error('Failed to set download folder')
      }
    } finally {
      setIsPickingFolder(false)
    }
  }

  async function clearAllHistory() {
    try {
      setIsClearing(true)
      await chapterPersistenceService.clearAllDownloadHistory()
      const stats = await chapterPersistenceService.getStorageStats()
      setHistoryStats({ totalChapters: stats.totalChapters, totalSeries: stats.totalSeries })
      const series = await loadSeriesHistory()
      setHistorySeries(series)
      toast.success('All download history cleared')
    } catch (error) {
      logger.error('[OPTIONS] Failed to clear history:', error)
      toast.error('Failed to clear history')
    } finally {
      setIsClearing(false)
    }
  }

  async function clearSeriesHistory(seriesId: string) {
    try {
      setIsClearing(true)
      await chapterPersistenceService.clearSeriesDownloadHistory(seriesId)
      const stats = await chapterPersistenceService.getStorageStats()
      setHistoryStats({ totalChapters: stats.totalChapters, totalSeries: stats.totalSeries })
      const series = await loadSeriesHistory()
      setHistorySeries(series)
      toast.success('Series history cleared')
    } catch (error) {
      logger.error('[OPTIONS] Failed to clear series history:', error)
      toast.error('Failed to clear series history')
    } finally {
      setIsClearing(false)
    }
  }

  function discardChanges() {
    setSettingsBuffer(settings)
    setOverrides(savedOverrides)
    setSiteIntegrationEnablement(savedSiteIntegrationEnablement)
    setSiteIntegrationSettingsByIntegration(savedSiteIntegrationSettingsByIntegration)
    setPendingFolderHandle(null)
    setHasUnsavedChanges(false)
    toast.info('Changes discarded')
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
    isSaving,
    isClearing,
    isPickingFolder,
    hasUnsavedChanges,
    handleSettingsChange,
    handleSiteIntegrationSettingsChange,
    handleOverrideChange,
    handleSiteIntegrationEnablementChange,
    pickDownloadFolder,
    saveConfiguration,
    clearAllHistory,
    clearSeriesHistory,
    handleRefreshHistory,
    discardChanges,
  }
}

