import type {
  CoverPreviewResponse,
  CoverPreviewSource,
} from "@/src/runtime/cover-preview-contracts"

export function awaitWhileActive<T>(
  operation: Promise<T>,
  signal: AbortSignal
): Promise<T> {
  if (signal.aborted) return Promise.reject(new Error("Cover preview released"))
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener("abort", onAbort)
      reject(new Error("Cover preview released"))
    }
    signal.addEventListener("abort", onAbort, { once: true })
    void operation
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", onAbort))
  })
}

function sourceKey(source: CoverPreviewSource): string {
  return JSON.stringify(
    source.kind === "task"
      ? [source.kind, source.taskId]
      : [
          source.kind,
          source.windowId,
          source.tabId,
          source.seriesId,
          source.seriesRevision,
        ]
  )
}

type AuthorizedRequest = {
  requestId: string
  consumers: ReadonlyMap<symbol, CoverPreviewSource>
  controller: AbortController
}
type FetchPreview = (input: {
  requestId: string
  source: CoverPreviewSource
}) => Promise<CoverPreviewResponse>

function nextSource(entry: AuthorizedRequest, attempted: ReadonlySet<string>) {
  return Array.from(entry.consumers.values())
    .reverse()
    .find((source) => !attempted.has(sourceKey(source)))
}

function canReplaceSource(
  entry: AuthorizedRequest,
  selectedKey: string,
  attempted: ReadonlySet<string>
) {
  if (entry.controller.signal.aborted) return false
  const retained = Array.from(entry.consumers.values())
  if (retained.some((source) => sourceKey(source) === selectedKey)) return false
  return nextSource(entry, attempted) !== undefined
}

export async function fetchForRetainedConsumer(
  entry: AuthorizedRequest,
  fetchPreview: FetchPreview
) {
  const attempted = new Set<string>()
  for (;;) {
    const source = nextSource(entry, attempted)
    if (!source) throw new Error("Cover preview has no active consumer")
    const selectedKey = sourceKey(source)
    attempted.add(selectedKey)
    try {
      const response = await awaitWhileActive(
        fetchPreview({ requestId: entry.requestId, source }),
        entry.controller.signal
      )
      if (!response.success) throw new Error(response.error)
      return response
    } catch (error) {
      if (!canReplaceSource(entry, selectedKey, attempted)) throw error
      entry.requestId = crypto.randomUUID()
    }
  }
}

export function decodeCoverPreviewBytes(
  response: Extract<CoverPreviewResponse, { success: true }>,
  identity: { integrationId: string; coverUrl: string },
  maxBytes: number
) {
  if (
    response.integrationId !== identity.integrationId ||
    response.coverUrl !== identity.coverUrl ||
    response.base64.length > 4 * Math.ceil(maxBytes / 3)
  ) {
    throw new Error("Cover preview is unavailable")
  }
  const binary = atob(response.base64)
  if (binary.length === 0 || binary.length > maxBytes)
    throw new Error("Cover preview exceeds its byte limit")
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}
