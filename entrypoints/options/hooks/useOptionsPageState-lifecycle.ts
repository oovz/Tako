import { useEffect, useState, type RefObject } from "react"
import { toast } from "sonner"
import logger from "@/src/runtime/logger"
import { t } from "@/src/runtime/i18n"
import type { OptionsConfigurationData } from "@/src/runtime/runtime-message-contracts"
import type { OptionsExternalChangeController } from "../controllers/options-external-change-controller"
import type { OptionsHostPermissionController } from "../controllers/options-host-permission-controller"
import type { OptionsConfigurationBinding } from "./useOptionsPageState-state"
import type { useOptionsHistory } from "./useOptionsHistory"

type History = ReturnType<typeof useOptionsHistory>
interface LifecycleOptions extends OptionsConfigurationBinding {
  external: OptionsExternalChangeController
  permissions: OptionsHostPermissionController
  history: History
  isSavingRef: RefObject<boolean>
  hasUnsavedChanges: boolean
}

async function loadOptions(
  external: OptionsExternalChangeController,
  permissions: OptionsHostPermissionController,
  configurationRef: OptionsConfigurationBinding["configurationRef"],
  isMounted: () => boolean
): Promise<OptionsConfigurationData | null> {
  const revision = configurationRef.current.draftRevision
  await permissions.reconcileOnLoad().catch((error) => {
    logger.warn(
      "[OPTIONS] Could not reconcile optional host permissions during startup:",
      error
    )
  })
  if (!isMounted()) return null
  return external.loadInitial(
    () =>
      configurationRef.current.draftRevision === revision &&
      !configurationRef.current.draftDirty
  )
}

export function useOptionsHydration(options: LifecycleOptions) {
  const [loadAttempt, setLoadAttempt] = useState(0)
  const { external, permissions, configurationRef, dispatchConfiguration } =
    options
  const { setHistoryStats, setHistorySeries } = options.history
  useEffect(() => {
    let canceled = false
    dispatchConfiguration({ type: "load-start" })
    void loadOptions(external, permissions, configurationRef, () => !canceled)
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
    return () => {
      canceled = true
    }
  }, [
    external,
    permissions,
    configurationRef,
    dispatchConfiguration,
    loadAttempt,
    setHistoryStats,
    setHistorySeries,
  ])
  return () => {
    dispatchConfiguration({ type: "load-start" })
    setLoadAttempt((attempt) => attempt + 1)
  }
}

export function useOptionsExternalSubscription(
  options: LifecycleOptions
): void {
  const {
    external,
    configurationRef,
    dispatchConfiguration,
    isSavingRef,
    hasUnsavedChanges,
  } = options
  const { setHistoryStats, setHistorySeries } = options.history
  useEffect(
    () =>
      external.subscribe({
        isSaving: () => isSavingRef.current,
        isDirty: () => configurationRef.current.draftDirty,
        hasUnsavedChanges: () => hasUnsavedChanges,
        draftRevision: () => configurationRef.current.draftRevision,
        onConflict: (keys) =>
          dispatchConfiguration({ type: "record-external-conflict", keys }),
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
      }),
    [
      external,
      configurationRef,
      dispatchConfiguration,
      isSavingRef,
      hasUnsavedChanges,
      setHistoryStats,
      setHistorySeries,
    ]
  )
}

export function useOptionsPermissionCleanup(
  permissions: OptionsHostPermissionController,
  configurationRef: OptionsConfigurationBinding["configurationRef"]
): void {
  useEffect(
    () => () => {
      const saved = configurationRef.current.saved
      if (!saved) return
      // Repeat background startup cleanup if Options closes after a permission gesture.
      void permissions.removeUnused(saved.enablement).catch((error) => {
        logger.warn(
          "Failed to remove unused HTTPS host permission when Options closed:",
          error
        )
      })
    },
    [permissions, configurationRef]
  )
}
