import { vi } from "vitest"
import { DEFAULT_SETTINGS } from "@/src/storage/default-settings"
import type { ExtensionSettings } from "@/src/storage/settings-types"

const hoistedMocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
  loadDownloadRootHandle: vi.fn(),
  verifyPermission: vi.fn(),
  runtimeSendMessage: vi.fn(),
  storageOnChangedAddListener: vi.fn(),
}))

const testI18n = chrome.i18n

export const mocks = hoistedMocks

function canonicalizeSettingsDocument(
  value: unknown
): ExtensionSettings | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null
  }

  return mergeSettings(DEFAULT_SETTINGS, value as Partial<ExtensionSettings>)
}

vi.mock("@/src/storage/settings-service", () => ({
  SETTINGS_STORAGE_KEY: "settings:canonical-test",
  canonicalizeSettingsDocument,
  settingsService: {
    getSettings: mocks.getSettings,
    updateSettings: mocks.updateSettings,
  },
}))

vi.mock("@/src/storage/fs-access", () => ({
  loadDownloadRootHandle: mocks.loadDownloadRootHandle,
  verifyPermission: mocks.verifyPermission,
}))

vi.mock("@/src/runtime/logger", () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  },
  applyAdvancedLoggerSettings: vi.fn(),
}))

export let settingsGlobalChangeListener:
  | ((
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: chrome.storage.AreaName
    ) => void)
  | undefined

export function mergeSettings(
  base: ExtensionSettings,
  updates: Partial<ExtensionSettings>
): ExtensionSettings {
  return {
    ...base,
    ...updates,
    downloads: {
      ...base.downloads,
      ...(updates.downloads ?? {}),
    },
    globalPolicy: {
      image: {
        ...base.globalPolicy.image,
        ...(updates.globalPolicy?.image ?? {}),
      },
      chapter: {
        ...base.globalPolicy.chapter,
        ...(updates.globalPolicy?.chapter ?? {}),
      },
    },
    globalRetries: updates.globalRetries
      ? { ...base.globalRetries, ...updates.globalRetries }
      : base.globalRetries,
    notifications:
      typeof updates.notifications === "boolean"
        ? updates.notifications
        : base.notifications,
    advanced: updates.advanced
      ? { ...base.advanced, ...updates.advanced }
      : base.advanced,
  }
}

export function resetSettingsSyncTestEnvironment(): void {
  vi.clearAllMocks()
  settingsGlobalChangeListener = undefined

  mocks.storageOnChangedAddListener.mockImplementation(
    (
      listener: (
        changes: Record<string, chrome.storage.StorageChange>,
        areaName: chrome.storage.AreaName
      ) => void
    ) => {
      settingsGlobalChangeListener = listener
    }
  )

  mocks.runtimeSendMessage.mockResolvedValue({ success: true })
  mocks.getSettings.mockResolvedValue(DEFAULT_SETTINGS)
  mocks.updateSettings.mockImplementation(
    async (updates: Partial<ExtensionSettings>) =>
      mergeSettings(DEFAULT_SETTINGS, updates)
  )
  mocks.loadDownloadRootHandle.mockResolvedValue(undefined)
  mocks.verifyPermission.mockResolvedValue(false)

  vi.stubGlobal("chrome", {
    i18n: testI18n,
    storage: {
      onChanged: {
        addListener: mocks.storageOnChangedAddListener,
      },
    },
    runtime: {
      sendMessage: mocks.runtimeSendMessage,
    },
  })
}
