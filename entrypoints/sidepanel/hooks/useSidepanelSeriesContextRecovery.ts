import type { ActiveTabContextValue } from "./sidepanelSeriesContextHelpers"
import type { RuntimeMessageResponse } from "@/src/runtime/runtime-message-contracts"

export interface SeriesContextRecoveryObservation {
  activeTabContext: ActiveTabContextValue
  hydrated: boolean
  tabId: number | undefined
  windowId: number | undefined
  sourceUrl?: string
}

type RefreshTarget = {
  tabId: number
  windowId: number
  reason?: "sidepanel-retry"
}
type RequestRefresh = (
  target: RefreshTarget
) => Promise<RuntimeMessageResponse<"REQUEST_TAB_CONTEXT_REFRESH">>
type RecoveryAttempt = {
  key: string
  targetKey: string
  pending?: Promise<void>
  errorRecovery: boolean
}

function describeRecoverableSeriesContext(
  context: ActiveTabContextValue
): string {
  switch (context.kind) {
    case "ready":
      return [
        "ready",
        context.mangaState.siteIntegrationId,
        context.mangaState.mangaId,
        context.mangaState.lastUpdated,
      ].join(":")
    case "error":
      return `error:${context.error}`
    default:
      return context.kind
  }
}

function isCompleteContext(context: ActiveTabContextValue): boolean {
  return (
    context.kind === "ready" &&
    typeof context.revision === "number" &&
    context.mangaState.chaptersLoading !== true
  )
}

function recoveryTarget(
  observation: SeriesContextRecoveryObservation
): RefreshTarget | undefined {
  if (
    !observation.hydrated ||
    typeof observation.tabId !== "number" ||
    typeof observation.windowId !== "number"
  )
    return
  return { tabId: observation.tabId, windowId: observation.windowId }
}

class SeriesContextRecoveryCoordinator {
  private activeAttempt: RecoveryAttempt | undefined
  constructor(private readonly requestRefresh: RequestRefresh) {}

  private async request(attempt: RecoveryAttempt, target: RefreshTarget) {
    try {
      const response = await this.requestRefresh(target)
      if (!response.success) this.clearAttempt(attempt)
    } catch (error) {
      this.clearAttempt(attempt)
      throw error
    } finally {
      attempt.pending = undefined
    }
  }

  private clearAttempt(attempt: RecoveryAttempt) {
    if (this.activeAttempt === attempt) this.activeAttempt = undefined
  }

  private async recover(
    observation: SeriesContextRecoveryObservation,
    explicitRetry: boolean
  ) {
    const target = recoveryTarget(observation)
    if (!target) return
    if (isCompleteContext(observation.activeTabContext)) {
      this.activeAttempt = undefined
      return
    }
    const targetKey = [
      target.windowId,
      target.tabId,
      observation.sourceUrl,
    ].join(":")
    const current =
      this.activeAttempt?.targetKey === targetKey
        ? this.activeAttempt
        : undefined
    // Keep the retry UI pending if a refresh already owns this page.
    if (current?.pending) return explicitRetry ? current.pending : undefined
    if (
      !explicitRetry &&
      current?.errorRecovery &&
      (observation.activeTabContext.kind === "error" ||
        observation.activeTabContext.kind === "loading")
    )
      return
    const key = [
      targetKey,
      describeRecoverableSeriesContext(observation.activeTabContext),
    ].join(":")
    if (!explicitRetry && this.activeAttempt?.key === key) return
    const attempt: RecoveryAttempt = {
      key,
      targetKey,
      errorRecovery: observation.activeTabContext.kind === "error",
    }
    this.activeAttempt = attempt
    attempt.pending = this.request(attempt, {
      ...target,
      ...(explicitRetry ? { reason: "sidepanel-retry" } : {}),
    })
    await attempt.pending
  }

  recoverIfNeeded(observation: SeriesContextRecoveryObservation) {
    return this.recover(observation, false)
  }
  retry(observation: SeriesContextRecoveryObservation) {
    return this.recover(observation, true)
  }
}

export function createSeriesContextRecoveryCoordinator(input: {
  requestRefresh: RequestRefresh
}) {
  return new SeriesContextRecoveryCoordinator(input.requestRefresh)
}
