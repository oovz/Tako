import type {
  SessionRefererRuleDeclaration,
  SiteIntegrationManifest,
} from "./manifest"

export const MANAGED_SESSION_RULE_ID_MIN = 41_000
export const MANAGED_SESSION_RULE_ID_MAX = 41_999

function assertValidRequestDomain(domain: string): void {
  if (!domain || domain !== domain.toLowerCase()) {
    throw new Error(`Invalid DNR request domain: ${domain}`)
  }
  const parsed = new URL(`https://${domain}`)
  if (parsed.hostname !== domain || parsed.pathname !== "/") {
    throw new Error(`Invalid DNR request domain: ${domain}`)
  }
}

export function assertValidSessionRefererRuleDeclaration(
  declaration: SessionRefererRuleDeclaration
): void {
  if (
    !Number.isSafeInteger(declaration.id) ||
    declaration.id < MANAGED_SESSION_RULE_ID_MIN ||
    declaration.id > MANAGED_SESSION_RULE_ID_MAX
  ) {
    throw new Error(
      `DNR rule id ${declaration.id} must be in the extension-managed range ${MANAGED_SESSION_RULE_ID_MIN}-${MANAGED_SESSION_RULE_ID_MAX}`
    )
  }
  if (
    declaration.priority !== undefined &&
    (!Number.isSafeInteger(declaration.priority) || declaration.priority <= 0)
  ) {
    throw new Error(`Invalid DNR rule priority: ${declaration.priority}`)
  }
  if (declaration.requestDomains.length === 0) {
    throw new Error(`DNR rule ${declaration.id} requires request domains`)
  }
  for (const domain of declaration.requestDomains) {
    assertValidRequestDomain(domain)
  }
  if (declaration.resourceTypes.length === 0) {
    throw new Error(`DNR rule ${declaration.id} requires resource types`)
  }
  for (const resourceType of declaration.resourceTypes) {
    if (resourceType !== "xmlhttprequest" && resourceType !== "other") {
      throw new Error(
        `Unsupported DNR resource type in rule ${declaration.id}: ${String(resourceType)}`
      )
    }
  }
  const referer = new URL(declaration.referer)
  if (referer.protocol !== "https:" || referer.username || referer.password) {
    throw new Error(`DNR rule ${declaration.id} requires an HTTPS referer`)
  }
}

function requiredOriginCoversDomain(
  requiredOrigin: string,
  domain: string
): boolean {
  const match = /^https:\/\/([^/]+)\/\*$/.exec(requiredOrigin)
  const hostPattern = match?.[1]
  if (!hostPattern) return false
  if (hostPattern === "*" || hostPattern === domain) return true
  if (!hostPattern.startsWith("*.")) return false

  const baseDomain = hostPattern.slice(2)
  return domain === baseDomain || domain.endsWith(`.${baseDomain}`)
}

/**
 * Validate provider networking invariants while WXT evaluates its build
 * configuration. Runtime reconciliation still validates individual rule shape
 * so malformed state cannot be installed even outside the normal build path.
 */
export function assertValidSiteIntegrationNetworkCapabilities(
  manifests: readonly SiteIntegrationManifest[]
): void {
  const managedRuleIds = new Set<number>()

  for (const manifest of manifests) {
    for (const declaration of manifest.network?.sessionRefererRules ?? []) {
      assertValidSessionRefererRuleDeclaration(declaration)
      if (managedRuleIds.has(declaration.id)) {
        throw new Error(`Duplicate managed DNR rule id: ${declaration.id}`)
      }
      managedRuleIds.add(declaration.id)

      for (const domain of declaration.requestDomains) {
        if (
          !manifest.requiredOrigins.some((origin) =>
            requiredOriginCoversDomain(origin, domain)
          )
        ) {
          throw new Error(
            `DNR request domain ${domain} is not covered by requiredOrigins for ${manifest.id}`
          )
        }
      }

      const refererHost = new URL(declaration.referer).hostname
      if (!manifest.patterns.domains.includes(refererHost)) {
        throw new Error(
          `DNR referer host ${refererHost} is not a declared page domain for ${manifest.id}`
        )
      }
    }
  }
}
