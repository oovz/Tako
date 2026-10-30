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
  pending: boolean
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

function suppressRecovery(
  attempt: RecoveryAttempt | undefined,
  targetKey: string,
  observation: SeriesContextRecoveryObservation,
  explicitRetry: boolean
) {
  if (attempt?.targetKey !== targetKey) return false
  if (attempt.pending) return true
  return (
    !explicitRetry &&
    attempt.errorRecovery &&
    (observation.activeTabContext.kind === "error" ||
      observation.activeTabContext.kind === "loading")
  )
}

class SeriesContextRecoveryCoordinator {
  private activeAttempt: RecoveryAttempt | undefined
  constructor(private readonly requestRefresh: RequestRefresh) {}

  private async request(attempt: RecoveryAttempt, target: RefreshTarget) {
    this.activeAttempt = attempt
    try {
      const response = await this.requestRefresh(target)
      if (!response.success) this.clearAttempt(attempt)
    } catch (error) {
      this.clearAttempt(attempt)
      throw error
    } finally {
      attempt.pending = false
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
    if (
      suppressRecovery(
        this.activeAttempt,
        targetKey,
        observation,
        explicitRetry
      )
    )
      return
    const key = [
      targetKey,
      describeRecoverableSeriesContext(observation.activeTabContext),
    ].join(":")
    if (!explicitRetry && this.activeAttempt?.key === key) return
    await this.request(
      {
        key,
        targetKey,
        pending: true,
        errorRecovery: observation.activeTabContext.kind === "error",
      },
      {
        ...target,
        ...(explicitRetry ? { reason: "sidepanel-retry" } : {}),
      }
    )
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
