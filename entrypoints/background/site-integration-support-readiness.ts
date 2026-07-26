import logger from "@/src/runtime/logger"
import type { SiteIntegrationEnablementMap } from "@/src/site-integrations/registry"

interface SiteIntegrationSupportReadinessDependencies {
  reconcilePermissionEnablement: () => Promise<{
    enablement: SiteIntegrationEnablementMap
  }>
  initializeMetadata: () => Promise<void>
  applyEnablement: (enablement: SiteIntegrationEnablementMap) => void
}

export function createSiteIntegrationSupportReadiness(
  dependencies: SiteIntegrationSupportReadinessDependencies
) {
  let generation = 0
  let ready: Promise<void> | null = null

  const runInitialization = async (
    attemptGeneration: number
  ): Promise<void> => {
    const startedAt = performance.now()
    logger.debug("[site-integrations] Metadata hydration started", {
      phase: "started",
    })

    let enablement: SiteIntegrationEnablementMap
    try {
      const reconciliation =
        await dependencies.reconcilePermissionEnablement()
      enablement = reconciliation.enablement
      await dependencies.initializeMetadata()
    } catch (error) {
      if (attemptGeneration !== generation) {
        await ensureInitialized()
        return
      }
      throw error
    }

    if (attemptGeneration !== generation) {
      await ensureInitialized()
      return
    }

    dependencies.applyEnablement(enablement)
    logger.debug("[site-integrations] Metadata hydration finished", {
      phase: "finished",
      durationMs: Math.round(performance.now() - startedAt),
    })
  }

  function ensureInitialized(): Promise<void> {
    if (!ready) {
      const attempt = runInitialization(generation)
      ready = attempt
      void attempt.catch(() => {
        if (ready === attempt) {
          ready = null
        }
      })
    }
    return ready
  }

  function invalidate(): void {
    generation += 1
    ready = null
  }

  return {
    ensureInitialized,
    invalidate,
  }
}
