import logger from "@/src/runtime/logger"
import {
  normalizeEnablementMap,
  SITE_INTEGRATION_ENABLEMENT_STORAGE_KEY,
  siteIntegrationEnablementService,
  type SiteIntegrationEnablementMap,
} from "@/src/storage/site-integration-enablement-service"
import {
  getSiteIntegrationManifestById,
  SITE_INTEGRATION_MANIFESTS,
  type SessionRefererRuleDeclaration,
  type SiteIntegrationManifest,
} from "./manifest"
import { assertValidSessionRefererRuleDeclaration } from "./manifest-validation"
import { isEnabled } from "./registry"

let reconciliationTail: Promise<void> = Promise.resolve()
let activeReconciliation: Promise<void> | null = null
let listenersRegistered = false
let initialReconciliation: Promise<void> | null = null
let requestedRevision = 0
let successfulRevision = 0
let requestedEnablement: SiteIntegrationEnablementMap | undefined
let reconciliationDirty = true
let lastSuccessfulAt: number | null = null
let installedManagedRuleIds = new Set<number>()
let lastSuccessfulEnablement: SiteIntegrationEnablementMap | undefined
let retryAttempt = 0
let retryAlarmScheduled = false
let onReconciliationSucceeded:
  | ((enablement: SiteIntegrationEnablementMap) => void | Promise<void>)
  | undefined

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
  manifest: SiteIntegrationManifest
  declaration: SessionRefererRuleDeclaration
}> {
  const declarations: Array<{
    manifest: SiteIntegrationManifest
    declaration: SessionRefererRuleDeclaration
  }> = []
  const ids = new Set<number>()

  for (const manifest of SITE_INTEGRATION_MANIFESTS) {
    for (const declaration of manifest.network?.sessionRefererRules ?? []) {
      assertValidSessionRefererRuleDeclaration(declaration)
      if (ids.has(declaration.id)) {
        throw new Error(`Duplicate managed DNR rule id: ${declaration.id}`)
      }
      ids.add(declaration.id)
      declarations.push({ manifest, declaration })
    }
  }

  return declarations
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
  manifest: SiteIntegrationManifest
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

async function reconcileSessionRulesNow(
  enablement?: SiteIntegrationEnablementMap
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

  const currentEnablement =
    enablement ?? (await siteIntegrationEnablementService.getAll())
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

async function clearRetryAlarmAfterSuccess(): Promise<void> {
  retryAttempt = 0
  retryAlarmScheduled = false
  if (!chrome.alarms?.clear) return

  try {
    await chrome.alarms.clear(SITE_INTEGRATION_SESSION_RULE_RETRY_ALARM)
  } catch (error) {
    logger.warn("Unable to clear the provider DNR retry alarm", error)
  }
}

async function scheduleRetryAlarm(): Promise<void> {
  if (retryAlarmScheduled) return
  if (!chrome.alarms?.create) {
    throw new Error(
      "Required extension capability is unavailable: chrome.alarms.create"
    )
  }

  const delayInMinutes =
    RETRY_DELAYS_MINUTES[
      Math.min(retryAttempt, RETRY_DELAYS_MINUTES.length - 1)
    ]
  await chrome.alarms.create(SITE_INTEGRATION_SESSION_RULE_RETRY_ALARM, {
    delayInMinutes,
    persistAcrossSessions: true,
  })
  retryAlarmScheduled = true
  retryAttempt = Math.min(retryAttempt + 1, RETRY_DELAYS_MINUTES.length - 1)
}

async function runRequestedReconciliations(): Promise<void> {
  try {
    while (true) {
      while (successfulRevision < requestedRevision) {
        const targetRevision = requestedRevision
        const enablement = requestedEnablement
        const outcome = await reconcileSessionRulesNow(enablement)
        installedManagedRuleIds = outcome.installedRuleIds
        lastSuccessfulEnablement = outcome.enablement
        successfulRevision = targetRevision
        lastSuccessfulAt = Date.now()
      }

      await clearRetryAlarmAfterSuccess()
      if (successfulRevision === requestedRevision) {
        reconciliationDirty = false
        if (onReconciliationSucceeded && lastSuccessfulEnablement) {
          void Promise.resolve(
            onReconciliationSucceeded(lastSuccessfulEnablement)
          ).catch((error) => {
            logger.warn(
              "Failed to continue the queue after provider policy reconciliation",
              error
            )
          })
        }
        return
      }
    }
  } catch (error) {
    reconciliationDirty = true
    try {
      await scheduleRetryAlarm()
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
export function reconcileSiteIntegrationSessionRules(
  enablement?: SiteIntegrationEnablementMap
): Promise<void> {
  requestedRevision += 1
  requestedEnablement = enablement
  reconciliationDirty = true

  if (activeReconciliation) {
    return activeReconciliation
  }

  const run = reconciliationTail.then(runRequestedReconciliations)
  const trackedRun = run.finally(() => {
    if (activeReconciliation === trackedRun) {
      activeReconciliation = null
    }
  })
  activeReconciliation = trackedRun
  reconciliationTail = trackedRun.catch(() => undefined)
  return trackedRun
}

/**
 * Register lifecycle listeners synchronously from the service-worker entrypoint.
 * The returned promise is the initial session-rule readiness dependency.
 */
function hasSameEnablement(
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

function affectsManagedSessionRules(
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
    permissions.origins?.some((origin) => relevantOrigins.has(origin)) ?? false
  )
}

export function initializeSiteIntegrationSessionRuleManager(input?: {
  onReconciled?: (
    enablement: SiteIntegrationEnablementMap
  ) => void | Promise<void>
}): Promise<void> {
  if (input?.onReconciled) {
    onReconciliationSucceeded = input.onReconciled
  }
  if (!listenersRegistered) {
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
      void reconcileSiteIntegrationSessionRules(enablement).catch((error) => {
        logger.warn(
          "Failed to reconcile DNR rules after enablement change",
          error
        )
      })
    })

    const reconcileAfterPermissionChange = (
      permissions: chrome.permissions.Permissions
    ) => {
      if (!affectsManagedSessionRules(permissions)) return
      void reconcileSiteIntegrationSessionRules().catch((error) => {
        logger.warn(
          "Failed to reconcile DNR rules after permission change",
          error
        )
      })
    }
    chrome.permissions?.onAdded?.addListener(reconcileAfterPermissionChange)
    chrome.permissions?.onRemoved?.addListener(reconcileAfterPermissionChange)

    chrome.alarms?.onAlarm?.addListener((alarm) => {
      if (alarm.name !== SITE_INTEGRATION_SESSION_RULE_RETRY_ALARM) {
        return
      }
      retryAlarmScheduled = false
      void reconcileSiteIntegrationSessionRules().catch((error) => {
        logger.warn("Failed to reconcile DNR rules from retry alarm", error)
      })
    })
    listenersRegistered = true
  }

  initialReconciliation ??= reconcileSiteIntegrationSessionRules().catch(
    (error) => {
      initialReconciliation = null
      throw error
    }
  )
  return initialReconciliation
}

/**
 * Block only providers that declare session-scoped network rules. A fresh
 * enablement read closes enable-and-dispatch races; DNR is rewritten only when
 * that input changed or the current service-worker revision is dirty.
 */
export async function ensureSiteIntegrationNetworkReady(
  siteIntegrationId: string
): Promise<void> {
  const manifest = getSiteIntegrationManifestById(siteIntegrationId)
  const declarations = manifest?.network?.sessionRefererRules ?? []
  if (declarations.length === 0) return

  let currentEnablement: SiteIntegrationEnablementMap
  try {
    currentEnablement = await siteIntegrationEnablementService.getAll()
  } catch (error) {
    let cause = error
    try {
      // Route the failure through reconciliation so the durable retry alarm is
      // armed for the task that is about to wait.
      await reconcileSiteIntegrationSessionRules()
    } catch (reconciliationError) {
      cause = reconciliationError
    }
    throw new ProviderNetworkPolicyPendingError(siteIntegrationId, cause)
  }

  try {
    if (!hasSameEnablement(lastSuccessfulEnablement, currentEnablement)) {
      await reconcileSiteIntegrationSessionRules(currentEnablement)
    } else if (
      activeReconciliation ||
      reconciliationDirty ||
      lastSuccessfulAt === null ||
      successfulRevision < requestedRevision
    ) {
      await (activeReconciliation ??
        reconcileSiteIntegrationSessionRules(currentEnablement))
    }
  } catch (error) {
    throw new ProviderNetworkPolicyPendingError(siteIntegrationId, error)
  }

  const missingRuleIds = declarations
    .map((declaration) => declaration.id)
    .filter((ruleId) => !installedManagedRuleIds.has(ruleId))
  if (missingRuleIds.length > 0) {
    if (lastSuccessfulEnablement?.[siteIntegrationId] === false) {
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
