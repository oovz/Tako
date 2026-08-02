import { rateLimitedFetchForIntegration } from "@/src/runtime/rate-limit"
import type { EffectivePolicy } from "@/src/runtime/rate-limit"
import {
  MANHUAGUI_CONFIG_HOST,
  MANHUAGUI_IMAGE_HOSTS,
  toAbsoluteUrl,
} from "./shared"
import { sanitizeLabel } from "@/src/shared/site-integration-utils"
import { MANHUAGUI_CREDENTIAL_POLICY } from "./policy"
import { readResponseBytes } from "@/src/shared/html-response-decoder"

/**
 * Weighted image host (e.g. `eu`, `us1`) used to build `{host}.hamreus.com`
 * image URLs. Hosts with weight <= 0 are skipped during host selection.
 */
export type ReaderHostConfig = {
  name: string
  weight: number
}

/**
 * Logical service that groups hosts (e.g. "自动" / "电信" / "联通"). The chapter
 * HTML's `curServ` index selects which service's host list to use.
 */
export type ReaderServiceConfig = {
  name: string
  hosts: ReaderHostConfig[]
}

/**
 * Fully-resolved reader configuration derived from the live `config_*.js`
 * script. The reader viewer exposes `curServ`/`curHost` indexes that pin the
 * selected service and host at page load time.
 */
export type ReaderConfig = {
  curHost: number
  curServ: number
  services: ReaderServiceConfig[]
}

/**
 * Fallback reader config used when the external `config_*.js` script cannot be
 * fetched or parsed. Derived from Manhuagui's shipped defaults so that at least
 * one host candidate is always available for URL construction.
 */
const CONFIG_SCRIPT_URL_REGEX =
  /<script[^>]+src=["']([^"'<>]*\/scripts\/config_[^"'<>]+\.js)["'][^>]*>/i

/**
 * Decode arbitrary response bytes using the encoding declared by the
 * `Content-Type` charset, defaulting to UTF-8. Used for the `config_*.js`
 * JavaScript response where we cannot rely on `<meta charset>` inspection.
 */
function decodeTextBytes(
  bytes: Uint8Array,
  contentType: string | null
): string {
  const encodingMatch = contentType?.match(/charset\s*=\s*([^;\s]+)/i)?.[1]
  const encoding = sanitizeLabel(encodingMatch ?? "") || "utf-8"

  try {
    return new TextDecoder(encoding).decode(bytes)
  } catch {
    return new TextDecoder("utf-8").decode(bytes)
  }
}

function extractConfigScriptUrl(chapterHtml: string): string | undefined {
  const url = toAbsoluteUrl(chapterHtml.match(CONFIG_SCRIPT_URL_REGEX)?.[1])
  if (!url) return undefined
  const parsed = new URL(url)
  if (
    parsed.protocol !== "https:" ||
    parsed.hostname !== MANHUAGUI_CONFIG_HOST
  ) {
    throw new Error("Manhuagui reader config origin is not allowed")
  }
  return parsed.toString()
}

function parseHostWeight(value: string): number {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : 0
}

/**
 * Parse the inline JavaScript in `config_*.js` to extract the picserv service
 * list. Schema is brittle on purpose: we pin the exact `{name:"…",hosts:[…]}`
 * literal so we fail loudly if Manhuagui changes its config format.
 */
function parseReaderConfigScript(scriptText: string): ReaderConfig {
  const serviceMatches = [
    ...scriptText.matchAll(
      /\{name:"([^"]+)",hosts:\[((?:\{h:"[^"]+",w:[0-9.]+\},?)+)\]\}/g
    ),
  ]
  if (serviceMatches.length === 0) {
    throw new Error("Manhuagui config format changed (picserv hosts missing)")
  }

  const services = serviceMatches.map((serviceMatch) => {
    const [, serviceName, hostsBlock] = serviceMatch
    const hosts = [
      ...(hostsBlock ?? "").matchAll(/\{h:"([^"]+)",w:([0-9.]+)\}/g),
    ]
      .map((hostMatch) => ({
        name: hostMatch[1] ?? "",
        weight: parseHostWeight(hostMatch[2] ?? "0"),
      }))
      .filter(
        (host) =>
          host.name && MANHUAGUI_IMAGE_HOSTS.has(`${host.name}.hamreus.com`)
      )

    if (!serviceName || hosts.length === 0) {
      throw new Error(
        "Manhuagui config format changed (picserv host entry missing)"
      )
    }

    return {
      name: serviceName,
      hosts,
    } satisfies ReaderServiceConfig
  })

  const curServ = Number.parseInt(
    scriptText.match(/curServ:(\d+)/)?.[1] ?? "",
    10
  )
  const curHost = Number.parseInt(
    scriptText.match(/curHost:(\d+)/)?.[1] ?? "",
    10
  )

  return {
    curHost: Number.isFinite(curHost) ? curHost : 0,
    curServ: Number.isFinite(curServ) ? curServ : 0,
    services,
  }
}

/**
 * Fetch the current Manhuagui reader config by locating the `config_*.js`
 * script reference in chapter HTML and parsing it. Failures are surfaced so a
 * stale host map cannot mask a site format or delivery change.
 */
export async function fetchReaderConfig(
  chapterHtml: string,
  chapterPolicy?: EffectivePolicy
): Promise<ReaderConfig> {
  const configScriptUrl = extractConfigScriptUrl(chapterHtml)
  if (!configScriptUrl) {
    throw new Error("Manhuagui reader config script missing")
  }

  const response = await rateLimitedFetchForIntegration(
    "manhuagui",
    configScriptUrl,
    "chapter",
    { credentials: MANHUAGUI_CREDENTIAL_POLICY.configuration },
    chapterPolicy
  )
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`)
  }

  const bytes = await readResponseBytes(response)
  const scriptText = decodeTextBytes(
    bytes,
    response.headers.get("content-type")
  )
  return parseReaderConfigScript(scriptText)
}

/**
 * Pick the active image host from a {@link ReaderConfig}. Prefers
 * `curServ`/`curHost` when the selected host has non-zero weight, otherwise
 * falls back to the first host with weight > 0, then the first listed host.
 */
export function selectReaderHost(config: ReaderConfig): string {
  const service = config.services[config.curServ]
  if (!service) {
    throw new Error(
      "Manhuagui config format changed (selected service is unavailable)"
    )
  }

  const currentHost = service.hosts[config.curHost]
  if (currentHost && currentHost.weight > 0) {
    return currentHost.name
  }

  const firstAvailableHost = service.hosts.find((host) => host.weight > 0)
  if (!firstAvailableHost) {
    throw new Error("Manhuagui config format changed (no enabled image hosts)")
  }

  return firstAvailableHost.name
}
