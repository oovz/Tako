import {
  fetchImageWithStallDetection,
  type FetchImageWithStallDetectionOptions,
} from "@/src/runtime/fetch-image"
import type {
  JsonObject,
  OffscreenIntegration,
} from "@/src/types/site-integrations"

type ImageDownloadPolicy = Pick<
  FetchImageWithStallDetectionOptions,
  "init" | "assertUrlAllowed" | "skipRateLimit"
> & {
  integrationId: string
  endpointId: string
  normalizeUrl?: (value: string) => string
  filename: "page" | "cover"
}

function imageFilename(imageUrl: string, kind: "page" | "cover"): string {
  const segments = new URL(imageUrl).pathname.split("/")
  const name =
    kind === "cover" ? segments.filter(Boolean).pop() : segments.pop()
  return name || `${kind}.jpg`
}

export function createImageDownloadAdapter<
  DispatchContext extends JsonObject = JsonObject,
>(
  policy: ImageDownloadPolicy
): OffscreenIntegration<DispatchContext>["chapter"]["downloadImage"] {
  const { normalizeUrl, filename, ...transport } = policy
  return async (value, opts) => {
    const url = normalizeUrl ? normalizeUrl(value) : value
    const result = await fetchImageWithStallDetection(url, {
      ...transport,
      signal: opts.signal,
      rateLimitService: opts.runtime.rateLimitService,
      skipRateLimit: transport.skipRateLimit ?? opts.skipRateLimit,
      onBytesReceived: opts.onBytesReceived,
      liveResourceLedger: opts.liveResourceLedger,
    })
    return { ...result, filename: imageFilename(url, filename) }
  }
}
