import type { SeriesDataResolutionResult } from "@/src/types/site-integrations"
import type { RuntimeMessageResponse } from "@/src/runtime/runtime-message-contracts"
import { sendRuntimeMessage } from "@/src/runtime/send-runtime-message"
import type {
  RateLimitPolicySnapshot,
  RateLimitService,
} from "@/src/runtime/rate-limit"

type OffscreenDocumentAdmission = <T>(operation: () => Promise<T>) => Promise<T>

let runOffscreenDocumentAdmissionExclusive: OffscreenDocumentAdmission = () =>
  Promise.reject(new Error("Offscreen lifecycle adapter is not configured"))

export function configureSeriesDataOffscreenLifecycle(
  runAdmissionExclusive: OffscreenDocumentAdmission
): void {
  runOffscreenDocumentAdmissionExclusive = runAdmissionExclusive
}

export interface ResolveSeriesDataViaOffscreenInput {
  siteIntegrationId: string
  seriesUrl: string
  html: string
  language?: string
  signal?: AbortSignal
  rateLimitService: RateLimitService
}

/**
 * Ask the offscreen document to parse a fetched series page HTML using the
 * integration's DOM-based resolver.
 */
export async function resolveSeriesDataViaOffscreen(
  input: ResolveSeriesDataViaOffscreenInput
): Promise<SeriesDataResolutionResult> {
  const requestId = crypto.randomUUID()
  const rateLimitSettings: RateLimitPolicySnapshot = {
    image: await input.rateLimitService.resolveEffectivePolicy(
      input.siteIntegrationId,
      "image"
    ),
    chapter: await input.rateLimitService.resolveEffectivePolicy(
      input.siteIntegrationId,
      "chapter"
    ),
  }
  let parseSent = false
  const cancel = () => {
    if (!parseSent) return
    void sendRuntimeMessage({
      target: "offscreen",
      type: "OFFSCREEN_CANCEL_SERIES_HTML",
      payload: { requestId },
    }).catch(() => undefined)
  }
  input.signal?.addEventListener("abort", cancel, { once: true })

  let response:
    RuntimeMessageResponse<"OFFSCREEN_PARSE_SERIES_HTML"> | undefined
  try {
    input.signal?.throwIfAborted()
    response = await runOffscreenDocumentAdmissionExclusive(async () => {
      input.signal?.throwIfAborted()
      parseSent = true
      return await sendRuntimeMessage({
        target: "offscreen",
        type: "OFFSCREEN_PARSE_SERIES_HTML",
        payload: {
          requestId,
          siteIntegrationId: input.siteIntegrationId,
          seriesUrl: input.seriesUrl,
          html: input.html,
          language: input.language,
          rateLimitSettings,
        },
      })
    })
    input.signal?.throwIfAborted()
  } finally {
    input.signal?.removeEventListener("abort", cancel)
  }

  if (!response) {
    throw new Error("No response from offscreen series HTML parser")
  }

  if (response.success === false) {
    throw new Error(response.error ?? "Offscreen series HTML parse failed")
  }

  return {
    seriesMetadata: response.seriesMetadata,
    chapterList: response.chapterList,
    metadataError: response.metadataError,
    chapterListError: response.chapterListError,
    chapterListNotice: response.chapterListNotice,
  }
}
