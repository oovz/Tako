import { useCallback, useEffect, useState } from "react"

import {
  checkForChromeWebStoreUpdate,
  getCurrentExtensionVersion,
  getDefaultExtensionUpdateRuntime,
  reloadExtensionForUpdate,
  type ChromeWebStoreUpdateCheckResult,
} from "@/src/runtime/extension-update-check"
import {
  clearExtensionUpdateActionItem,
  markExtensionUpdateActionItemAvailable,
} from "@/src/runtime/options-action-items"

async function synchronizeUpdateActionItem(
  result: ChromeWebStoreUpdateCheckResult
) {
  if (!result.ok) return
  switch (result.status) {
    case "update_available":
      await markExtensionUpdateActionItemAvailable({
        version: result.availableVersion,
      })
      break
    case "no_update":
      await clearExtensionUpdateActionItem()
  }
}

export function useExtensionUpdateState() {
  const [currentVersion, setCurrentVersion] = useState(() =>
    getCurrentExtensionVersion()
  )
  const [lastResult, setLastResult] =
    useState<ChromeWebStoreUpdateCheckResult | null>(null)
  const [isChecking, setIsChecking] = useState(false)

  useEffect(() => {
    const runtime = getDefaultExtensionUpdateRuntime()
    if (!runtime?.onUpdateAvailable) return
    const handleUpdateAvailable = (
      details: chrome.runtime.UpdateAvailableDetails
    ) => {
      const installedVersion = getCurrentExtensionVersion(runtime)
      setCurrentVersion(installedVersion)
      setLastResult({
        ok: true,
        status: "update_available",
        currentVersion: installedVersion,
        availableVersion: details.version,
        checkedAt: Date.now(),
      })
      void markExtensionUpdateActionItemAvailable({ version: details.version })
    }
    runtime.onUpdateAvailable.addListener(handleUpdateAvailable)
    return () =>
      runtime.onUpdateAvailable?.removeListener(handleUpdateAvailable)
  }, [])

  const handleCheckForUpdates = useCallback(async () => {
    setIsChecking(true)
    try {
      const result = await checkForChromeWebStoreUpdate()
      setCurrentVersion(result.currentVersion)
      setLastResult(result)
      await synchronizeUpdateActionItem(result)
    } finally {
      setIsChecking(false)
    }
  }, [])

  const handleApplyUpdate = useCallback(() => {
    void clearExtensionUpdateActionItem().finally(() =>
      reloadExtensionForUpdate()
    )
  }, [])

  return {
    currentVersion,
    lastResult,
    isChecking,
    handleCheckForUpdates,
    handleApplyUpdate,
  }
}
