import logger from "@/src/runtime/logger"
import type { SiteIntegrationEnablementMap } from "@/src/domain/site-integrations/storage-schemas"
import { SESSION_STORAGE_KEYS } from "@/src/runtime/storage-keys"

export const SITE_INTEGRATION_SESSION_RULE_CONTINUATION_ALARM =
  "site-integration-session-rule-continuation"
const CONTINUATION_ALARM_DELAY_MINUTES = 0.5

interface ProviderNetworkPolicyContinuation {
  revision: number
  consumed: boolean
}

/** Read-only snapshot of the DNR reconciliation state the continuation logic needs. */
export interface ProviderNetworkPolicyStateSnapshot {
  dirty: boolean
  successfulRevision: number
  requestedRevision: number
  lastSuccessfulEnablement?: SiteIntegrationEnablementMap
  isRevisionCurrent: (revision: number) => boolean
}

function normalizeProviderNetworkPolicyContinuation(
  value: unknown
): ProviderNetworkPolicyContinuation | null {
  if (!value || typeof value !== "object") return null
  const candidate = value as Partial<ProviderNetworkPolicyContinuation>
  return typeof candidate.revision === "number" &&
    Number.isInteger(candidate.revision) &&
    candidate.revision >= 0
    ? { revision: candidate.revision, consumed: candidate.consumed === true }
    : null
}

/**
 * Provider-policy queue continuation: the durable wakeup that resumes the
 * queue once DNR reconciliation has installed the rules a provider needs.
 * DNR rule management does not own queue progress; it only reports a
 * successful revision through `noteReconciliationSucceeded`.
 */
export class ProviderNetworkPolicyContinuationCoordinator {
  private readonly state: () => ProviderNetworkPolicyStateSnapshot
  private readonly reconcile: () => Promise<void>
  private readonly onQueueResume: (
    enablement: SiteIntegrationEnablementMap
  ) => void | Promise<void>
  private consumedContinuationRevision: number | null = null
  private continuationAlarmScheduled = false
  private mutationTail: Promise<void> = Promise.resolve()
  private listenersRegistered = false

  constructor(input: {
    state: () => ProviderNetworkPolicyStateSnapshot
    reconcile: () => Promise<void>
    onQueueResume: (
      enablement: SiteIntegrationEnablementMap
    ) => void | Promise<void>
  }) {
    this.state = input.state
    this.reconcile = input.reconcile
    this.onQueueResume = input.onQueueResume
  }

  async noteReconciliationSucceeded(
    revision: number,
    enablement: SiteIntegrationEnablementMap
  ): Promise<void> {
    await this.scheduleContinuationAlarm()
    await this.persistContinuation(revision)
    void this.runContinuation({
      revision,
      enablement,
    }).catch((error) => {
      logger.warn(
        "Failed to continue the queue after provider policy reconciliation",
        error
      )
    })
  }

  private async persistContinuation(revision: number): Promise<void> {
    const mutation = this.mutationTail.then(async () => {
      this.consumedContinuationRevision = null
      await chrome.storage.session.set({
        [SESSION_STORAGE_KEYS.providerNetworkPolicyContinuation]: {
          revision,
          consumed: false,
        },
      })
    })
    this.mutationTail = mutation.catch(() => undefined)
    await mutation
  }

  async readContinuation(): Promise<ProviderNetworkPolicyContinuation | null> {
    const stored = await chrome.storage.session.get(
      SESSION_STORAGE_KEYS.providerNetworkPolicyContinuation
    )
    return normalizeProviderNetworkPolicyContinuation(
      stored[SESSION_STORAGE_KEYS.providerNetworkPolicyContinuation]
    )
  }

  async clearContinuation(revision: number): Promise<void> {
    const mutation = this.mutationTail.then(async () => {
      const continuation = await this.readContinuation()
      if (!continuation || continuation.revision !== revision) return
      this.consumedContinuationRevision = revision
      await chrome.storage.session.set({
        [SESSION_STORAGE_KEYS.providerNetworkPolicyContinuation]: {
          revision,
          consumed: true,
        },
      })
      await this.clearContinuationAlarm()
      await chrome.storage.session.remove(
        SESSION_STORAGE_KEYS.providerNetworkPolicyContinuation
      )
    })
    this.mutationTail = mutation.catch(() => undefined)
    await mutation
  }

  isContinuationCurrent(revision: number): boolean {
    const snapshot = this.state()
    return (
      !snapshot.dirty &&
      snapshot.successfulRevision === snapshot.requestedRevision &&
      snapshot.successfulRevision === revision
    )
  }

  private async clearContinuationAlarm(): Promise<void> {
    this.continuationAlarmScheduled = false
    if (!chrome.alarms?.clear) return
    try {
      await chrome.alarms.clear(
        SITE_INTEGRATION_SESSION_RULE_CONTINUATION_ALARM
      )
    } catch (error) {
      logger.warn("Unable to clear provider queue continuation alarm", error)
    }
  }

  private async clearContinuationAlarmIfCurrent(
    revision?: number
  ): Promise<void> {
    const mutation = this.mutationTail.then(async () => {
      const snapshot = this.state()
      if (
        revision !== undefined
          ? !snapshot.isRevisionCurrent(revision)
          : snapshot.dirty
      ) {
        return
      }
      const continuation = await this.readContinuation()
      if (
        continuation &&
        (revision === undefined || continuation.revision !== revision)
      ) {
        return
      }
      await this.clearContinuationAlarm()
    })
    this.mutationTail = mutation.catch(() => undefined)
    await mutation
  }

  private async scheduleContinuationAlarm(): Promise<void> {
    if (this.continuationAlarmScheduled) return
    if (!chrome.alarms?.create) {
      throw new Error(
        "Required extension capability is unavailable: chrome.alarms.create"
      )
    }
    await chrome.alarms.create(
      SITE_INTEGRATION_SESSION_RULE_CONTINUATION_ALARM,
      {
        delayInMinutes: CONTINUATION_ALARM_DELAY_MINUTES,
        persistAcrossSessions: true,
      }
    )
    this.continuationAlarmScheduled = true
  }

  private async runContinuation(input?: {
    revision: number
    enablement: SiteIntegrationEnablementMap
  }): Promise<void> {
    try {
      const continuation = input
        ? { revision: input.revision, consumed: false }
        : await this.readContinuation()
      if (!continuation) {
        const snapshot = this.state()
        if (this.consumedContinuationRevision === snapshot.successfulRevision) {
          await this.clearContinuationAlarmIfCurrent()
          return
        }
        if (
          snapshot.lastSuccessfulEnablement &&
          !snapshot.dirty &&
          snapshot.successfulRevision === snapshot.requestedRevision
        ) {
          // The alarm can fire in the crash window after its creation but before
          // the session marker is persisted. Recreate both durable pieces from
          // the already successful in-memory revision instead of clearing the
          // only wakeup.
          await this.scheduleContinuationAlarm()
          await this.persistContinuation(snapshot.successfulRevision)
          return
        }
        if (
          snapshot.dirty ||
          snapshot.successfulRevision < snapshot.requestedRevision
        ) {
          // A worker restart may deliver an orphaned continuation alarm before
          // initial reconciliation has rebuilt the in-memory revision. Keep the
          // alarm useful by rebuilding the durable marker through reconciliation.
          await this.reconcile()
          return
        }
        await this.clearContinuationAlarmIfCurrent()
        return
      }
      if (continuation.consumed) {
        await this.clearContinuation(continuation.revision)
        return
      }
      if (!this.isContinuationCurrent(continuation.revision)) {
        await this.clearContinuation(continuation.revision)
        return
      }
      const enablement =
        input?.enablement ?? this.state().lastSuccessfulEnablement
      if (!enablement) {
        return
      }
      await this.onQueueResume(enablement)
      // The queue callback owns acknowledgement. It clears the marker only
      // after a durable queued-task admission, or when it proves that no
      // runnable work remains. Keep the continuation alarm alive across the
      // in-memory scheduler handoff so worker termination can replay it.
      const remaining = await this.readContinuation()
      if (remaining?.revision === continuation.revision) {
        await this.scheduleContinuationAlarm()
      }
    } catch (error) {
      try {
        await this.scheduleContinuationAlarm()
      } catch (alarmError) {
        logger.warn("Unable to schedule provider queue continuation retry", {
          error,
          alarmError,
        })
      }
      throw error
    }
  }

  /**
   * Handle the continuation alarm. Returns whether the alarm was consumed.
   */
  async handleContinuationAlarm(): Promise<void> {
    this.continuationAlarmScheduled = false
    await this.runContinuation()
  }

  /**
   * Register the alarm listener synchronously from the service-worker
   * entrypoint.
   */
  registerListeners(): void {
    if (this.listenersRegistered) return
    chrome.alarms?.onAlarm?.addListener((alarm) => {
      if (alarm.name !== SITE_INTEGRATION_SESSION_RULE_CONTINUATION_ALARM) {
        return
      }
      void this.handleContinuationAlarm().catch((error) => {
        logger.warn(
          "Failed to continue the queue from provider policy alarm",
          error
        )
      })
    })
    this.listenersRegistered = true
  }
}
