import { ProviderContractError } from "./provider-contract-error"
import { siteIntegrationCatalogById } from "@/src/runtime/generated/site-integration-catalog"
import type { SiteIntegrationEndpointPolicy } from "./definition-types"

function parseIpv4(hostname: string): number[] | null {
  const parts = hostname.split(".")
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) {
    return null
  }
  const octets = parts.map(Number)
  return octets.every((octet) => octet >= 0 && octet <= 255) ? octets : null
}

function isNonPublicIpv4(octets: number[]): boolean {
  const [a, b, c] = octets
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  )
}

function parseIpv6(hostname: string): number[] | null {
  let input = hostname.replace(/^\[|\]$/g, "").toLowerCase()
  if (!input.includes(":") || input.includes("%")) return null

  const embeddedIpv4Match = input.match(/(^|:)(\d+\.\d+\.\d+\.\d+)$/)
  if (embeddedIpv4Match) {
    const ipv4 = parseIpv4(embeddedIpv4Match[2])
    if (!ipv4) return null
    input = `${input.slice(0, -embeddedIpv4Match[2].length)}${(
      (ipv4[0] << 8) |
      ipv4[1]
    ).toString(16)}:${((ipv4[2] << 8) | ipv4[3]).toString(16)}`
  }

  const halves = input.split("::")
  if (halves.length > 2) return null
  const left = halves[0] ? halves[0].split(":") : []
  const right = halves[1] ? halves[1].split(":") : []
  const missing = 8 - left.length - right.length
  if ((halves.length === 1 && missing !== 0) || missing < 0) return null

  const raw = [...left, ...Array.from({ length: missing }, () => "0"), ...right]
  if (raw.length !== 8 || raw.some((part) => !/^[0-9a-f]{1,4}$/.test(part))) {
    return null
  }
  return raw.map((part) => Number.parseInt(part, 16))
}

function isNonPublicIpv6(segments: number[]): boolean {
  const allZero = segments.every((segment) => segment === 0)
  const loopback =
    segments.slice(0, 7).every((segment) => segment === 0) && segments[7] === 1
  const mappedIpv4 =
    segments.slice(0, 5).every((segment) => segment === 0) &&
    segments[5] === 0xffff
  if (mappedIpv4) {
    return isNonPublicIpv4([
      segments[6] >>> 8,
      segments[6] & 0xff,
      segments[7] >>> 8,
      segments[7] & 0xff,
    ])
  }

  return (
    allZero ||
    loopback ||
    (segments[0] & 0xfe00) === 0xfc00 ||
    (segments[0] & 0xffc0) === 0xfe80 ||
    (segments[0] & 0xff00) === 0xff00 ||
    (segments[0] === 0x2001 && segments[1] === 0x0db8)
  )
}

export function assertSafePublicHttpsUrl(
  rawUrl: string,
  purpose = "site integration request"
): URL {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    throw new ProviderContractError(`Blocked malformed ${purpose} URL.`)
  }

  if (parsed.protocol !== "https:") {
    throw new ProviderContractError(`Blocked non-HTTPS ${purpose} URL.`)
  }
  if (parsed.username || parsed.password) {
    throw new ProviderContractError(`Blocked credentialed ${purpose} URL.`)
  }

  const hostname = parsed.hostname.toLowerCase().replace(/\.+$/, "")
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname === "home.arpa" ||
    hostname.endsWith(".home.arpa")
  ) {
    throw new ProviderContractError(`Blocked non-public ${purpose} host.`)
  }

  const ipv4 = parseIpv4(hostname)
  if (ipv4 && isNonPublicIpv4(ipv4)) {
    throw new ProviderContractError(`Blocked non-public ${purpose} host.`)
  }
  const ipv6 = parseIpv6(hostname)
  if (ipv6 && isNonPublicIpv6(ipv6)) {
    throw new ProviderContractError(`Blocked non-public ${purpose} host.`)
  }

  return parsed
}

function globPathMatches(pathname: string, glob: string): boolean {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")
  return new RegExp(`^${escaped}$`).test(pathname)
}

function matchesEndpointOriginPattern(
  parsed: URL,
  policy: SiteIntegrationEndpointPolicy,
  pattern: string
): boolean {
  // A provider-issued endpoint may deliberately receive an origin selected by
  // the provider. The definition still has to opt into the broad wildcard;
  // public-HTTPS validation below remains mandatory.
  if (pattern === "https://*/*" && policy.originKind === "provider-issued") {
    return parsed.protocol === "https:"
  }
  return matchesRequiredOriginPattern(parsed, pattern)
}

function requireEndpointPolicy(
  integrationId: string,
  endpointId: string
): SiteIntegrationEndpointPolicy {
  const definition = siteIntegrationCatalogById[integrationId]
  if (!definition || !definition.shipped) {
    throw new ProviderContractError(
      `Unknown or unshipped site integration: ${integrationId}`
    )
  }
  const endpoint = definition.endpointPolicies.find(
    (candidate) => candidate.id === endpointId
  )
  if (!endpoint) {
    throw new ProviderContractError(
      `Unknown endpoint "${endpointId}" for site integration "${integrationId}".`
    )
  }
  return endpoint
}

export function getIntegrationEndpointPolicy(
  integrationId: string,
  endpointId: string
): SiteIntegrationEndpointPolicy {
  return requireEndpointPolicy(integrationId, endpointId)
}

export function assertIntegrationEndpointRequestUrl(
  integrationId: string,
  endpointId: string,
  rawUrl: string
): URL {
  const endpoint = requireEndpointPolicy(integrationId, endpointId)
  const parsed = assertSafePublicHttpsUrl(rawUrl, `${endpoint.purpose} request`)
  if (
    !endpoint.origins.some((pattern) =>
      matchesEndpointOriginPattern(parsed, endpoint, pattern)
    )
  ) {
    throw new ProviderContractError(
      `Blocked untrusted ${endpoint.purpose} request URL.`
    )
  }
  return parsed
}

export function assertIntegrationEndpointResponseUrl(
  integrationId: string,
  endpointId: string,
  requestUrl: string,
  responseUrl: string | undefined
): URL {
  const endpoint = requireEndpointPolicy(integrationId, endpointId)
  const parsed = assertSafePublicHttpsUrl(
    responseUrl?.trim() ? responseUrl : requestUrl,
    `${endpoint.purpose} response`
  )
  if (
    !endpoint.origins.some((pattern) =>
      matchesEndpointOriginPattern(parsed, endpoint, pattern)
    )
  ) {
    throw new ProviderContractError(
      `Blocked untrusted ${endpoint.purpose} response URL.`
    )
  }
  return parsed
}

export function matchesRequiredOriginPattern(
  parsed: URL,
  pattern: string
): boolean {
  const match = pattern.match(/^https:\/\/(\*\.)?([^/]+)(\/.*)$/i)
  if (!match) return false

  const wildcardSubdomains = Boolean(match[1])
  let expected: URL
  try {
    expected = new URL(`https://${match[2]}`)
  } catch {
    return false
  }
  const hostMatches = wildcardSubdomains
    ? parsed.hostname === expected.hostname ||
      parsed.hostname.endsWith(`.${expected.hostname}`)
    : parsed.hostname === expected.hostname
  return (
    parsed.protocol === "https:" &&
    hostMatches &&
    parsed.port === expected.port &&
    globPathMatches(parsed.pathname, match[3])
  )
}

export function createIntegrationEndpointUrlAssertion(
  integrationId: string,
  endpointId: string
): (url: string) => void {
  return (url) => {
    assertIntegrationEndpointRequestUrl(integrationId, endpointId, url)
  }
}

export function createSameOriginDynamicAssetAssertion(
  initialUrl: string,
  purpose: string
): (url: string) => void {
  const initial = assertSafePublicHttpsUrl(initialUrl, purpose)
  return (rawUrl) => {
    const parsed = assertSafePublicHttpsUrl(rawUrl, purpose)
    if (parsed.origin !== initial.origin) {
      throw new ProviderContractError(
        `Blocked cross-origin redirect for ${purpose}.`
      )
    }
  }
}
