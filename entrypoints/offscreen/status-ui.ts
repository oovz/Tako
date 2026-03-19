import logger from '@/src/runtime/logger'

interface OffscreenStatusWorker {
  getActiveJobCount(): number
}

interface OffscreenStatusController {
  initializeDom(): void
  onInitialized(): void
  onInitializationError(errorMessage: string): void
  reportBootstrapError(error: unknown): void
}

export function createOffscreenStatusController(worker: OffscreenStatusWorker): OffscreenStatusController {
  const runtimeUiState = {
    isInitialized: false,
    initializationError: null as string | null,
  }

  const renderOffscreenStatus = (): void => {
    const statusEl = document.getElementById('offscreen-status') as HTMLDivElement | null
    const healthEl = document.getElementById('offscreen-health') as HTMLDivElement | null
    const errorEl = document.getElementById('offscreen-error') as HTMLDivElement | null

    if (statusEl) {
      statusEl.textContent = runtimeUiState.initializationError ? 'Failed' : 'Active'
    }

    if (healthEl) {
      healthEl.dataset.ready = String(runtimeUiState.isInitialized)
      healthEl.dataset.activeJobs = String(worker.getActiveJobCount())
      healthEl.textContent = `ready:${runtimeUiState.isInitialized} activeJobs:${worker.getActiveJobCount()}`
    }

    if (errorEl) {
      errorEl.textContent = runtimeUiState.initializationError ? `Error: ${runtimeUiState.initializationError}` : ''
      errorEl.hidden = runtimeUiState.initializationError === null
    }
  }

  return {
    initializeDom(): void {
      const statusEl = document.getElementById('offscreen-status') as HTMLDivElement | null
      const healthEl = document.getElementById('offscreen-health') as HTMLDivElement | null
      const jobsEl = document.getElementById('jobs') as HTMLDivElement | null
      const jobsEmptyEl = document.getElementById('jobs-empty') as HTMLDivElement | null

      if (jobsEl && jobsEmptyEl) {
        jobsEl.innerHTML = ''
        jobsEmptyEl.textContent = 'No active jobs'
      }

      void statusEl
      void healthEl
      renderOffscreenStatus()
    },

    onInitialized(): void {
      runtimeUiState.isInitialized = true
      runtimeUiState.initializationError = null
      renderOffscreenStatus()
    },

    onInitializationError(errorMessage: string): void {
      runtimeUiState.isInitialized = false
      runtimeUiState.initializationError = errorMessage
      renderOffscreenStatus()
    },

    reportBootstrapError(error: unknown): void {
      logger.error('❌ Failed to initialize offscreen worker:', error)
      runtimeUiState.isInitialized = false
      runtimeUiState.initializationError = error instanceof Error ? error.message : 'Unknown error'
      renderOffscreenStatus()
    },
  }
}

