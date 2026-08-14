import logger from "@/src/runtime/logger"
import {
  SITE_INTEGRATION_ENABLEMENT_STORAGE_KEY,
  type SiteIntegrationEnablementService,
} from "@/src/storage/site-integration-enablement-service"
import {
  normalizeEnablementMap,
  type SiteIntegrationEnablementMap,
} from "@/src/domain/site-integrations/storage-schemas"
import { getDefinition, getDefinitions } from "./catalog"
import type {
  SiteIntegrationSessionRefererRule as SessionRefererRuleDeclaration,
  SiteIntegrationDefinition,
} from "./definition-types"
import { assertValidSessionRefererRuleDeclaration } from "./definition-validation"
import { isEnabled } from "./catalog"
import {
  ProviderNetworkPolicyContinuationCoordinator,
  type ProviderNetworkPolicyStateSnapshot,
} from "./provider-network-policy-continuation"

export const SITE_INTEGRATION_SESSION_RULE_RETRY_ALARM =
  "site-integration-session-rule-retry"
const RETRY_DELAYS_MINUTES = [0.5, 1, 2, 4, 8] as const

export class ProviderNetworkPolicyPendingError extends Error {
  readonly retryable = true

  constructor(
    readonly siteIntegrationId: string,
    cause: unknown
  ) {
    super(
      `Provider network policy is temporarily unavailable for ${siteIntegrationId}`,
      {
        cause,
      }
    )
    this.name = "ProviderNetworkPolicyPendingError"
  }
}

export class ProviderNetworkPolicyActionRequiredError extends Error {
  readonly retryable = false

  constructor(
    readonly siteIntegrationId: string,
    readonly reason: "integration_disabled" | "host_permission_denied"
  ) {
    super(
      reason === "integration_disabled"
        ? `Site integration ${siteIntegrationId} is disabled`
        : `Host access is required before ${siteIntegrationId} can download images`
    )
    this.name = "ProviderNetworkPolicyActionRequiredError"
  }
}

function getManagedRuleDeclarations(): Array<{
  manifest: SiteIntegrationDefinition
  declaration: SessionRefererRuleDeclaration
}> {
  const declarations: Array<{
    manifest: SiteIntegrationDefinition
    declaration: SessionRefererRuleDeclaration
  }> = []
  const ids = new Set<number>()

  for (const manifest of getDefinitions()) {
    for (const declaration of manifest.sessionRefererRules ?? []) {
      assertValidSessionRefererRuleDeclaration(declaration)
      if (ids.has(declaration.id)) {
        throw new Error(`Duplicate managed DNR rule id: ${declaration.id}`)
      }
      ids.add(declaration.id)
      declarations.push({ manifest, declaration })
    }
  }

  return declarations.sort(
    (left, right) => left.declaration.id - right.declaration.id
  )
}

export function buildSessionRefererRule(
  declaration: SessionRefererRuleDeclaration,
  extensionId: string
): chrome.declarativeNetRequest.Rule {
  assertValidSessionRefererRuleDeclaration(declaration)
  if (!extensionId) {
    throw new Error("Cannot build an extension-scoped DNR rule without an id")
  }

  return {
    id: declaration.id,
    priority: declaration.priority ?? 1,
    action: {
      type: chrome.declarativeNetRequest.RuleActionType.MODIFY_HEADERS,
      requestHeaders: [
        {
          header: "referer",
          operation: chrome.declarativeNetRequest.HeaderOperation.SET,
          value: declaration.referer,
        },
      ],
    },
    condition: {
      initiatorDomains: [extensionId],
      requestDomains: [...declaration.requestDomains],
      resourceTypes: declaration.resourceTypes.map((resourceType) =>
        resourceType === "xmlhttprequest"
          ? chrome.declarativeNetRequest.ResourceType.XMLHTTPREQUEST
          : chrome.declarativeNetRequest.ResourceType.OTHER
      ),
    },
  }
}

async function hasRequiredHostAccess(
  manifest: SiteIntegrationDefinition
): Promise<boolean> {
  if (manifest.requiredOrigins.length === 0) {
    return true
  }
  if (!chrome.permissions?.contains) {
    throw new Error(
      "Required extension capability is unavailable: chrome.permissions.contains"
    )
  }

  try {
    return await chrome.permissions.contains({
      origins: manifest.requiredOrigins,
    })
  } catch (error) {
    throw new Error(
      `Unable to verify host permission for ${manifest.id} DNR rules`,
      { cause: error }
    )
  }
}

export class SiteIntegrationSessionRuleManager {
  private reconciliationTail: Promise<void> = Promise.resolve()
  private activeReconciliation: Promise<void> | null = null
  private listenersRegistered = false
  private initialReconciliation: Promise<void> | null = null
  private requestedRevision = 0
  private successfulRevision = 0
  private requestedEnablement: SiteIntegrationEnablementMap | undefined
  private reconciliationDirty = true
  private lastSuccessfulAt: number | null = null
  private installedManagedRuleIds = new Set<number>()
  private lastSuccessfulEnablement: SiteIntegrationEnablementMap | undefined
  private retryAttempt = 0
  private retryAlarmScheduled = false
  private readonly service: Pick<SiteIntegrationEnablementService, "getAll">
  private readonly continuation: ProviderNetworkPolicyContinuationCoordinator

  constructor(input: {
    service: Pick<SiteIntegrationEnablementService, "getAll">
    onReconciliationSucceeded: (
      enablement: SiteIntegrationEnablementMap
    ) => void | Promise<void>
  }) {
    this.service = input.service
    this.continuation = new ProviderNetworkPolicyContinuationCoordinator({
      state: () => this.getContinuationStateSnapshot(),
      reconcile: () => this.reconcile(undefined),
      onQueueResume: input.onReconciliationSucceeded,
    })
  }

  get continuationCoordinator(): ProviderNetworkPolicyContinuationCoordinator {
    return this.continuation
  }

  private getContinuationStateSnapshot(): ProviderNetworkPolicyStateSnapshot {
    return {
      dirty: this.reconciliationDirty,
      successfulRevision: this.successfulRevision,
      requestedRevision: this.requestedRevision,
      lastSuccessfulEnablement: this.lastSuccessfulEnablement,
      isRevisionCurrent: (revision) =>
        !this.reconciliationDirty &&
        this.successfulRevision === this.requestedRevision &&
        this.successfulRevision === revision,
    }
  }

  private async reconcileSessionRulesNow(
    enablement: SiteIntegrationEnablementMap | undefined
  ): Promise<{
    installedRuleIds: Set<number>
    enablement: SiteIntegrationEnablementMap
  }> {
    const updateSessionRules =
      chrome.declarativeNetRequest?.updateSessionRules?.bind(
        chrome.declarativeNetRequest
      )
    if (!updateSessionRules) {
      throw new Error(
        "Required extension capability is unavailable: chrome.declarativeNetRequest.updateSessionRules"
      )
    }

    const currentEnablement = enablement ?? (await this.service.getAll())
    const declarations = getManagedRuleDeclarations()
    const addRules: chrome.declarativeNetRequest.Rule[] = []

    for (const { manifest, declaration } of declarations) {
      if (!manifest.shipped || !isEnabled(manifest.id, currentEnablement)) {
        continue
      }
      if (!(await hasRequiredHostAccess(manifest))) {
        logger.warn("Skipping provider DNR rule without required host access", {
          siteIntegrationId: manifest.id,
          ruleId: declaration.id,
        })
        continue
      }
      addRules.push(buildSessionRefererRule(declaration, chrome.runtime.id))
    }

    await updateSessionRules({
      removeRuleIds: declarations.map(({ declaration }) => declaration.id),
      addRules,
    })
    logger.debug("Reconciled provider session DNR rules", {
      installedRuleIds: addRules.map((rule) => rule.id),
    })
    return {
      installedRuleIds: new Set(addRules.map((rule) => rule.id)),
      enablement: currentEnablement,
    }
  }

  private async clearRetryAlarmAfterSuccess(): Promise<void> {
    this.retryAttempt = 0
    this.retryAlarmScheduled = false
    if (!chrome.alarms?.clear) return

    try {
      await chrome.alarms.clear(SITE_INTEGRATION_SESSION_RULE_RETRY_ALARM)
    } catch (error) {
      logger.warn("Unable to clear the provider DNR retry alarm", error)
    }
  }

  private async scheduleRetryAlarm(): Promise<void> {
    if (this.retryAlarmScheduled) return
    if (!chrome.alarms?.create) {
      throw new Error(
        "Required extension capability is unavailable: chrome.alarms.create"
      )
    }

    const delayInMinutes =
      RETRY_DELAYS_MINUTES[
        Math.min(this.retryAttempt, RETRY_DELAYS_MINUTES.length - 1)
      ]
    await chrome.alarms.create(SITE_INTEGRATION_SESSION_RULE_RETRY_ALARM, {
      delayInMinutes,
      persistAcrossSessions: true,
    })
    this.retryAlarmScheduled = true
    this.retryAttempt = Math.min(
      this.retryAttempt + 1,
      RETRY_DELAYS_MINUTES.length - 1
    )
  }

  private async runRequestedReconciliations(): Promise<void> {
    try {
      while (true) {
        while (this.successfulRevision < this.requestedRevision) {
          const targetRevision = this.requestedRevision
          const enablement = this.requestedEnablement
          const outcome = await this.reconcileSessionRulesNow(enablement)
          this.installedManagedRuleIds = outcome.installedRuleIds
          this.lastSuccessfulEnablement = outcome.enablement
          this.successfulRevision = targetRevision
          this.lastSuccessfulAt = Date.now()
        }

        if (this.successfulRevision === this.requestedRevision) {
          this.reconciliationDirty = false
          if (this.lastSuccessfulEnablement) {
            await this.continuation.noteReconciliationSucceeded(
              this.successfulRevision,
              this.lastSuccessfulEnablement
            )
          }
          await this.clearRetryAlarmAfterSuccess()
          return
        }
      }
    } catch (error) {
      this.reconciliationDirty = true
      try {
        await this.scheduleRetryAlarm()
      } catch (alarmError) {
        logger.warn("Unable to schedule provider DNR reconciliation retry", {
          error: alarmError,
        })
      }
      throw error
    }
  }

  /**
   * Serialize and coalesce DNR updates so storage, permission, alarm, and
   * dispatch-time readiness requests cannot race.
   */
  reconcile(enablement?: SiteIntegrationEnablementMap): Promise<void> {
    this.requestedRevision += 1
    this.requestedEnablement = enablement
    this.reconciliationDirty = true

    if (this.activeReconciliation) {
      return this.activeReconciliation
    }

    const run = this.reconciliationTail.then(() =>
      this.runRequestedReconciliations()
    )
    const trackedRun = run.finally(() => {
      if (this.activeReconciliation === trackedRun) {
        this.activeReconciliation = null
      }
    })
    this.activeReconciliation = trackedRun
    this.reconciliationTail = trackedRun.catch(() => undefined)
    return trackedRun
  }

  private hasSameEnablement(
    left: SiteIntegrationEnablementMap | undefined,
    right: SiteIntegrationEnablementMap
  ): boolean {
    if (!left) return false
    const keys = new Set([...Object.keys(left), ...Object.keys(right)])
    for (const key of keys) {
      if (left[key] !== right[key]) return false
    }
    return true
  }

  private affectsManagedSessionRules(
    permissions: chrome.permissions.Permissions
  ): boolean {
    if (
      permissions.permissions?.some(
        (permission) =>
          permission === "declarativeNetRequest" ||
          permission === "declarativeNetRequestWithHostAccess"
      )
    ) {
      return true
    }

    const relevantOrigins = new Set(
      getManagedRuleDeclarations().flatMap(
        ({ manifest }) => manifest.requiredOrigins
      )
    )
    return (
      permissions.origins?.some((origin) => relevantOrigins.has(origin)) ??
      false
    )
  }

  /**
   * Register lifecycle listeners synchronously from the service-worker
   * entrypoint. This method intentionally performs no asynchronous work.
   */
  registerListeners(): void {
    if (this.listenersRegistered) return
    chrome.storage?.onChanged?.addListener((changes, areaName) => {
      if (
        areaName !== "local" ||
        !(SITE_INTEGRATION_ENABLEMENT_STORAGE_KEY in changes)
      ) {
        return
      }
      const enablement = normalizeEnablementMap(
        changes[SITE_INTEGRATION_ENABLEMENT_STORAGE_KEY]?.newValue
      )
      void this.reconcile(enablement).catch((error) => {
        logger.warn(
          "Failed to reconcile DNR rules after enablement change",
          error
        )
      })
    })

    const reconcileAfterPermissionChange = (
      permissions: chrome.permissions.Permissions
    ) => {
      if (!this.affectsManagedSessionRules(permissions)) return
      void this.reconcile().catch((error) => {
        logger.warn(
          "Failed to reconcile DNR rules after permission change",
          error
        )
      })
    }
    chrome.permissions?.onAdded?.addListener(reconcileAfterPermissionChange)
    chrome.permissions?.onRemoved?.addListener(reconcileAfterPermissionChange)

    chrome.alarms?.onAlarm?.addListener((alarm) => {
      if (alarm.name !== SITE_INTEGRATION_SESSION_RULE_RETRY_ALARM) return
      this.retryAlarmScheduled = false
      void this.reconcile().catch((error) => {
        logger.warn("Failed to reconcile DNR rules from retry alarm", error)
      })
    })
    this.continuation.registerListeners()
    this.listenersRegistered = true
  }

  start(): Promise<void> {
    this.initialReconciliation ??= this.reconcile().catch((error) => {
      this.initialReconciliation = null
      throw error
    })
    return this.initialReconciliation
  }

  /**
   * Block only providers that declare session-scoped network rules. A fresh
   * enablement read closes enable-and-dispatch races; DNR is rewritten only when
   * that input changed or the current service-worker revision is dirty.
   */
  async ensureNetworkReady(siteIntegrationId: string): Promise<void> {
    const manifest = getDefinition(siteIntegrationId)
    const declarations = manifest?.sessionRefererRules ?? []
    if (declarations.length === 0) return

    let currentEnablement: SiteIntegrationEnablementMap
    try {
      currentEnablement = await this.service.getAll()
    } catch (error) {
      let cause = error
      try {
        // Route the failure through reconciliation so the durable retry alarm is
        // armed for the task that is about to wait.
        await this.reconcile()
      } catch (reconciliationError) {
        cause = reconciliationError
      }
      throw new ProviderNetworkPolicyPendingError(siteIntegrationId, cause)
    }

    try {
      if (
        !this.hasSameEnablement(
          this.lastSuccessfulEnablement,
          currentEnablement
        )
      ) {
        await this.reconcile(currentEnablement)
      } else if (
        this.activeReconciliation ||
        this.reconciliationDirty ||
        this.lastSuccessfulAt === null ||
        this.successfulRevision < this.requestedRevision
      ) {
        await (this.activeReconciliation ?? this.reconcile(currentEnablement))
      }
    } catch (error) {
      throw new ProviderNetworkPolicyPendingError(siteIntegrationId, error)
    }

    const missingRuleIds = declarations
      .map((declaration) => declaration.id)
      .filter((ruleId) => !this.installedManagedRuleIds.has(ruleId))
    if (missingRuleIds.length > 0) {
      if (!isEnabled(siteIntegrationId, this.lastSuccessfulEnablement ?? {})) {
        throw new ProviderNetworkPolicyActionRequiredError(
          siteIntegrationId,
          "integration_disabled"
        )
      }
      let hostAccess: boolean
      try {
        hostAccess = manifest ? await hasRequiredHostAccess(manifest) : false
      } catch (error) {
        throw new ProviderNetworkPolicyPendingError(siteIntegrationId, error)
      }
      if (!hostAccess) {
        throw new ProviderNetworkPolicyActionRequiredError(
          siteIntegrationId,
          "host_permission_denied"
        )
      }
      throw new Error(
        `Provider network policy is not ready for ${siteIntegrationId}; missing DNR rule(s): ${missingRuleIds.join(", ")}`
      )
    }
  }
}
