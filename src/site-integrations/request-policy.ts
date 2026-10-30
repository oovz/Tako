import { ProviderContractError } from "./provider-contract-error"
import { siteIntegrationCatalogById } from "@/src/runtime/generated/site-integration-catalog"
import type { SiteIntegrationEndpointPolicy } from "./definition-types"

function parseIpv4(hostname: string): number[] | null {
  // URL has already validated and canonicalized numeric IPv4 hostnames.
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) return null
  return hostname.split(".").map(Number)
}

const NON_PUBLIC_IPV4_NETWORKS = [
  [0x00000000, 8], // Current network
  [0x0a000000, 8], // Private
  [0x7f000000, 8], // Loopback
  [0x64400000, 10], // Shared address space
  [0xa9fe0000, 16], // Link-local
  [0xac100000, 12], // Private
  [0xc0000000, 24], // IETF protocol assignments
  [0xc0000200, 24], // Documentation
  [0xc0a80000, 16], // Private
  [0xc6120000, 15], // Benchmarking
  [0xc6336400, 24], // Documentation
  [0xcb007100, 24], // Documentation
  [0xe0000000, 3], // Multicast and reserved
] as const

function isNonPublicIpv4(octets: number[]): boolean {
  const address = octets.reduce((value, octet) => value * 256 + octet, 0)
  return NON_PUBLIC_IPV4_NETWORKS.some(
    ([network, prefix]) =>
      address >>> (32 - prefix) === network >>> (32 - prefix)
  )
}

function parseIpv6(hostname: string): number[] | null {
  if (!hostname.startsWith("[")) return null
  // URL validates IPv6 syntax and renders embedded IPv4 as hexadecimal groups.
  const halves = hostname.slice(1, -1).split("::")
  const left = halves[0] ? halves[0].split(":") : []
  const right = halves[1] ? halves[1].split(":") : []
  const missing = 8 - left.length - right.length
  const raw = [...left, ...Array.from({ length: missing }, () => "0"), ...right]
  return raw.map((part) => Number.parseInt(part, 16))
}

function isReservedIpv6(segments: number[]): boolean {
  const allZero = segments.every((segment) => segment === 0)
  const loopback =
    segments.slice(0, 7).every((segment) => segment === 0) && segments[7] === 1
  return (
    allZero ||
    loopback ||
    (segments[0] & 0xfe00) === 0xfc00 ||
    (segments[0] & 0xffc0) === 0xfe80 ||
    (segments[0] & 0xff00) === 0xff00 ||
    (segments[0] === 0x2001 && segments[1] === 0x0db8)
  )
}

function isNonPublicIpv6(segments: number[]): boolean {
  const mappedIpv4 =
    segments.slice(0, 5).every((segment) => segment === 0) &&
    segments[5] === 0xffff
  if (!mappedIpv4) return isReservedIpv6(segments)
  return isNonPublicIpv4([
    segments[6] >>> 8,
    segments[6] & 0xff,
    segments[7] >>> 8,
    segments[7] & 0xff,
  ])
}

function isNonPublicHost(hostname: string): boolean {
  const reservedNames = ["localhost", "home.arpa"]
  const reservedSuffixes = [".localhost", ".local", ".internal", ".home.arpa"]
  if (reservedNames.includes(hostname)) return true
  if (reservedSuffixes.some((suffix) => hostname.endsWith(suffix))) return true
  const ipv4 = parseIpv4(hostname)
  if (ipv4) return isNonPublicIpv4(ipv4)
  const ipv6 = parseIpv6(hostname)
  return ipv6 !== null && isNonPublicIpv6(ipv6)
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
  if (isNonPublicHost(hostname)) {
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
