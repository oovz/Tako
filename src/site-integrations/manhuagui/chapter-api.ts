import type { ParseImageUrlsFromHtmlInput } from "@/src/types/site-integrations"
import {
  getRateLimitPolicyFromContext,
  getRateLimitPolicyFromSnapshot,
  rateLimitedFetchForIntegration,
  type EffectivePolicy,
} from "@/src/runtime/rate-limit"
import { fetchImageWithStallDetection } from "@/src/runtime/fetch-image"
import type { TaskSettingsSnapshot } from "@/src/types/state-snapshots"
import { decodeHtmlResponse } from "@/src/shared/html-response-decoder"
import { resolveImageUrlsFromChapterHtml } from "./chapter-viewer"
import { assertManhuaguiChapterUrl, isAllowedManhuaguiImageUrl } from "./shared"
import { filterValidImageUrls } from "@/src/shared/site-integration-utils"
import { createIntegrationUrlAssertion } from "../request-policy"
import { MANHUAGUI_CREDENTIAL_POLICY } from "./policy"

const assertManhuaguiRequestUrl = createIntegrationUrlAssertion("manhuagui")

/**
 * Fetch the chapter viewer HTML and reconstruct the signed image URL list.
 * Mirrors the background integration's `resolveImageUrls` contract: caller
 * receives absolute CDN URLs ready to be downloaded in order.
 */
export async function resolveManhuaguiChapterImageUrls(
  chapter: { id: string; url: string },
  settingsSnapshot?: Partial<TaskSettingsSnapshot>
): Promise<string[]> {
  assertManhuaguiChapterUrl(chapter.url)
  const chapterPolicy = getRateLimitPolicyFromSnapshot(
    settingsSnapshot,
    "chapter"
  )
  const response = await rateLimitedFetchForIntegration(
    "manhuagui",
    chapter.url,
    "chapter",
    { credentials: MANHUAGUI_CREDENTIAL_POLICY.pageHtml },
    chapterPolicy
  )
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`)
  }

  const { html } = await decodeHtmlResponse(response)
  return resolveImageUrlsFromChapterHtml(html, chapterPolicy)
}

/**
 * HTML-only fallback used when offscreen has already fetched the chapter
 * body. Delegates to the same viewer decoder as
 * {@link resolveManhuaguiChapterImageUrls}.
 */
export function parseManhuaguiImageUrlsFromHtml(
  { chapterHtml }: ParseImageUrlsFromHtmlInput,
  chapterPolicy?: EffectivePolicy
): Promise<string[]> {
  return resolveImageUrlsFromChapterHtml(chapterHtml, chapterPolicy)
}

/** Filter out malformed entries before download (shared URL validity check). */
export function processManhuaguiImageUrls(urls: string[]): Promise<string[]> {
  return Promise.resolve(
    filterValidImageUrls(urls).filter(isAllowedManhuaguiImageUrl)
  )
}

/**
 * Download a single Manhuagui chapter image. Fetch cannot manufacture the
 * provider's cross-origin Referer value; the provider-declared,
 * extension-initiated DNR session rule supplies it. The request itself omits
 * ambient credentials and remains constrained by the provider URL allowlist.
 */
export async function downloadManhuaguiChapterImage(
  imageUrl: string,
  opts?: {
    signal?: AbortSignal
    context?: Record<string, unknown>
    skipRateLimit?: boolean
    onBytesReceived?: (bytesReceived: number) => void | Promise<void>
  }
): Promise<{ data: ArrayBuffer; filename: string; mimeType: string }> {
  if (!isAllowedManhuaguiImageUrl(imageUrl)) {
    throw new Error("Manhuagui image URL origin is not allowed")
  }
  if (opts?.signal?.aborted) {
    throw new Error("aborted")
  }

  const { data, mimeType } = await fetchImageWithStallDetection(imageUrl, {
    integrationId: "manhuagui",
    signal: opts?.signal,
    rateLimitPolicy: getRateLimitPolicyFromContext(opts?.context, "image"),
    skipRateLimit: opts?.skipRateLimit,
    onBytesReceived: opts?.onBytesReceived,
    assertUrlAllowed: assertManhuaguiRequestUrl,
    init: {
      credentials: MANHUAGUI_CREDENTIAL_POLICY.image,
    },
  })
  const filename =
    new URL(imageUrl).pathname.split("/").filter(Boolean).pop() || "image.jpg"

  return { data, filename, mimeType }
}
