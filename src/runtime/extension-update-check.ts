import { t } from '@/src/runtime/i18n'

export type ChromeWebStoreUpdateStatus = chrome.runtime.RequestUpdateCheckStatus

export interface ExtensionUpdateRuntime {
  getManifest?: () => Pick<chrome.runtime.Manifest, 'version'>
  requestUpdateCheck?: () => Promise<Partial<chrome.runtime.RequestUpdateCheckResult>>
  reload?: () => void
  onUpdateAvailable?: {
    addListener: (callback: (details: chrome.runtime.UpdateAvailableDetails) => void) => void
    removeListener: (callback: (details: chrome.runtime.UpdateAvailableDetails) => void) => void
  }
}

export type ChromeWebStoreUpdateCheckResult =
  | {
      ok: true
      status: 'no_update' | 'throttled'
      currentVersion: string
      checkedAt: number
    }
  | {
      ok: true
      status: 'update_available'
      currentVersion: string
      availableVersion?: string
      checkedAt: number
    }
  | {
      ok: false
      status: 'unsupported' | 'error'
      currentVersion: string
      checkedAt: number
      error: string
    }

export interface ChromeWebStoreUpdateStatusCopy {
  tone: 'neutral' | 'success' | 'warning' | 'error'
  title: string
  description: string
}

interface CheckForUpdateOptions {
  runtime?: ExtensionUpdateRuntime
  now?: () => number
}

const UNKNOWN_VERSION = 'unknown'
const UNSUPPORTED_ERROR = 'Chrome Web Store update checks are only available in Chromium extension runtimes.'

export function getDefaultExtensionUpdateRuntime(): ExtensionUpdateRuntime | undefined {
  return (globalThis as { chrome?: { runtime?: ExtensionUpdateRuntime } }).chrome?.runtime
}

export function getCurrentExtensionVersion(runtime: ExtensionUpdateRuntime | undefined = getDefaultExtensionUpdateRuntime()): string {
  return runtime?.getManifest?.().version ?? UNKNOWN_VERSION
}

export async function checkForChromeWebStoreUpdate({
  runtime = getDefaultExtensionUpdateRuntime(),
  now = Date.now,
}: CheckForUpdateOptions = {}): Promise<ChromeWebStoreUpdateCheckResult> {
  const currentVersion = getCurrentExtensionVersion(runtime)
  const checkedAt = now()

  if (!runtime?.requestUpdateCheck) {
    return {
      ok: false,
      status: 'unsupported',
      currentVersion,
      checkedAt,
      error: UNSUPPORTED_ERROR,
    }
  }

  try {
    const result = await runtime.requestUpdateCheck()
    if (result.status === 'update_available') {
      return {
        ok: true,
        status: 'update_available',
        currentVersion,
        availableVersion: result.version || undefined,
        checkedAt,
      }
    }

    if (result.status === 'throttled') {
      return {
        ok: true,
        status: 'throttled',
        currentVersion,
        checkedAt,
      }
    }

    return {
      ok: true,
      status: 'no_update',
      currentVersion,
      checkedAt,
    }
  } catch (error) {
    return {
      ok: false,
      status: 'error',
      currentVersion,
      checkedAt,
      error: error instanceof Error ? error.message : 'Chrome could not complete the update check.',
    }
  }
}

export function getChromeWebStoreUpdateStatusCopy(
  result: ChromeWebStoreUpdateCheckResult,
): ChromeWebStoreUpdateStatusCopy {
  if (!result.ok) {
    return {
      tone: 'error',
      title: result.status === 'unsupported' ? t('options_updateCheckUnavailable') : t('options_updateCheckFailed'),
      description: result.error,
    }
  }

  if (result.status === 'update_available') {
    const version = result.availableVersion ? t('options_version', [result.availableVersion]) : t('options_anUpdate')
    return {
      tone: 'warning',
      title: t('options_updateReady'),
      description: t('options_updateReadyDesc', [version]),
    }
  }

  if (result.status === 'throttled') {
    return {
      tone: 'warning',
      title: t('options_checkThrottled'),
      description: t('options_checkThrottledDesc'),
    }
  }

  return {
    tone: 'neutral',
    title: t('options_noUpdateAvailable'),
    description: t('options_noUpdateAvailableDesc', [result.currentVersion]),
  }
}

export function reloadExtensionForUpdate(runtime: ExtensionUpdateRuntime | undefined = getDefaultExtensionUpdateRuntime()): void {
  runtime?.reload?.()
}
