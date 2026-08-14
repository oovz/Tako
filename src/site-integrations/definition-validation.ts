import type { SiteIntegrationSessionRefererRule as SessionRefererRuleDeclaration } from "./definition-types"

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
