import { sendRuntimeMessage } from "@/src/runtime/send-runtime-message"
import {
  MAX_COVER_PREVIEW_BYTES,
  COVER_PREVIEW_TIMEOUT_MS,
  type CoverPreviewSource,
  type CoverPreviewResponse,
} from "@/src/runtime/cover-preview-contracts"

export type { CoverPreviewSource } from "@/src/runtime/cover-preview-contracts"

export interface CoverPreviewIdentity {
  integrationId: string
  coverUrl: string
  source: CoverPreviewSource
}

export type CoverPreviewResult =
  { status: "ready"; url: string } | { status: "fallback" }

interface PreviewBoundary {
  fetchPreview: (input: {
    requestId: string
    source: CoverPreviewSource
  }) => Promise<CoverPreviewResponse>
  cancelPreview: (requestId: string) => Promise<void>
  createObjectURL: (blob: Blob) => string
  revokeObjectURL: (url: string) => void
  decode: (url: string) => Promise<void>
}

interface PreviewLimits {
  maxEntries: number
  maxRetainedBytes: number
  maxImageBytes: number
  maxConcurrentRequests: number
}

const DEFAULT_LIMITS: PreviewLimits = {
  maxEntries: 32,
  maxRetainedBytes: 16 * 1024 * 1024,
  maxImageBytes: MAX_COVER_PREVIEW_BYTES,
  maxConcurrentRequests: 2,
}

type Entry = {
  identity: Pick<CoverPreviewIdentity, "integrationId" | "coverUrl">
  requestId: string
  consumers: Map<symbol, CoverPreviewSource>
  state: "pending" | "running" | "settled"
  result: Promise<CoverPreviewResult>
  resolve: (result: CoverPreviewResult) => void
  url?: string
  bytes: number
  controller: AbortController
  deadline: ReturnType<typeof setTimeout>
}

function awaitWhileActive<T>(
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

export function coverPreviewKey(
  identity: Pick<CoverPreviewIdentity, "integrationId" | "coverUrl">
): string {
  return JSON.stringify([identity.integrationId, identity.coverUrl])
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

export function createCoverPreviewLoader(
  boundary: PreviewBoundary,
  limits: PreviewLimits = DEFAULT_LIMITS
) {
  const entries = new Map<string, Entry>()
  let retainedBytes = 0
  let running = 0
  let disposed = false

  function remove(key: string, entry: Entry) {
    if (entries.get(key) !== entry) return
    entries.delete(key)
    clearTimeout(entry.deadline)
    entry.controller.abort()
    retainedBytes -= entry.bytes
    if (entry.url) {
      boundary.revokeObjectURL(entry.url)
      entry.url = undefined
    }
    if (entry.state === "running") {
      void boundary.cancelPreview(entry.requestId).catch(() => {})
    }
    entry.resolve({ status: "fallback" })
  }

  function evictUnused() {
    for (const [key, entry] of entries) {
      if (entry.consumers.size === 0) {
        remove(key, entry)
        return true
      }
    }
    return false
  }

  async function fetchForRetainedConsumer(entry: Entry) {
    const attemptedSources = new Set<string>()
    for (;;) {
      const source = Array.from(entry.consumers.values())
        .reverse()
        .find((candidate) => !attemptedSources.has(sourceKey(candidate)))
      if (!source) throw new Error("Cover preview has no active consumer")
      const selectedKey = sourceKey(source)
      attemptedSources.add(selectedKey)
      try {
        const response = await awaitWhileActive(
          boundary.fetchPreview({ requestId: entry.requestId, source }),
          entry.controller.signal
        )
        if (!response.success) throw new Error(response.error)
        return response
      } catch (error) {
        const retainedSources = Array.from(entry.consumers.values())
        if (
          entry.controller.signal.aborted ||
          retainedSources.some(
            (candidate) => sourceKey(candidate) === selectedKey
          ) ||
          !retainedSources.some(
            (candidate) => !attemptedSources.has(sourceKey(candidate))
          )
        ) {
          throw error
        }
        entry.requestId = crypto.randomUUID()
      }
    }
  }

  async function load(key: string, entry: Entry) {
    try {
      const response = await fetchForRetainedConsumer(entry)
      if (entries.get(key) !== entry) return
      if (
        response.integrationId !== entry.identity.integrationId ||
        response.coverUrl !== entry.identity.coverUrl ||
        response.base64.length > 4 * Math.ceil(limits.maxImageBytes / 3)
      ) {
        throw new Error("Cover preview is unavailable")
      }
      const binary = atob(response.base64)
      if (binary.length === 0 || binary.length > limits.maxImageBytes)
        throw new Error("Cover preview exceeds its byte limit")
      const bytes = Uint8Array.from(binary, (character) =>
        character.charCodeAt(0)
      )
      entry.url = boundary.createObjectURL(
        new Blob([bytes], { type: response.mimeType })
      )
      await awaitWhileActive(
        boundary.decode(entry.url),
        entry.controller.signal
      )
      if (entries.get(key) !== entry || !entry.url) return
      entry.bytes = bytes.byteLength
      retainedBytes += entry.bytes
      entry.resolve({ status: "ready", url: entry.url })
    } catch {
      if (entry.url) {
        boundary.revokeObjectURL(entry.url)
        entry.url = undefined
      }
      entry.resolve({ status: "fallback" })
    } finally {
      clearTimeout(entry.deadline)
      entry.state = "settled"
      running -= 1
      pump()
    }
  }

  function pump() {
    if (disposed) return
    for (const [key, entry] of entries) {
      if (entry.state !== "pending") continue
      if (running >= limits.maxConcurrentRequests) return
      while (
        retainedBytes + (running + 1) * limits.maxImageBytes >
          limits.maxRetainedBytes &&
        evictUnused()
      ) {
        // Unused least-recently-used images make room for a new request.
      }
      if (
        retainedBytes + (running + 1) * limits.maxImageBytes >
        limits.maxRetainedBytes
      ) {
        if (running > 0) return
        entry.state = "settled"
        entry.resolve({ status: "fallback" })
        continue
      }
      entry.state = "running"
      running += 1
      void load(key, entry)
    }
  }

  return {
    acquire(identity: CoverPreviewIdentity) {
      const key = coverPreviewKey(identity)
      let entry = entries.get(key)
      if (!entry && !disposed) {
        while (entries.size >= limits.maxEntries && evictUnused()) {
          // Only consumers with active interest retain admission priority.
        }
        if (entries.size < limits.maxEntries) {
          let resolve!: Entry["resolve"]
          const result = new Promise<CoverPreviewResult>((done) => {
            resolve = done
          })
          const controller = new AbortController()
          const deadline = setTimeout(() => {
            const expired = entries.get(key)
            if (!expired || expired.controller !== controller) return
            if (expired.state === "running") {
              void boundary.cancelPreview(expired.requestId).catch(() => {})
            }
            controller.abort(new Error("Cover preview timed out"))
            expired.state = "settled"
            expired.resolve({ status: "fallback" })
            pump()
          }, COVER_PREVIEW_TIMEOUT_MS + 5_000)
          entry = {
            identity: {
              integrationId: identity.integrationId,
              coverUrl: identity.coverUrl,
            },
            requestId: crypto.randomUUID(),
            consumers: new Map(),
            state: "pending",
            result,
            resolve,
            bytes: 0,
            controller,
            deadline,
          }
          entries.set(key, entry)
        }
      }
      if (!entry)
        return {
          result: Promise.resolve<CoverPreviewResult>({ status: "fallback" }),
          release() {},
        }
      const current = entry
      entries.delete(key)
      entries.set(key, current)
      const consumer = Symbol()
      current.consumers.set(consumer, identity.source)
      pump()
      let released = false
      return {
        result: current.result,
        release() {
          if (released) return
          released = true
          current.consumers.delete(consumer)
          if (
            current.consumers.size === 0 &&
            (current.state !== "settled" || !current.url)
          )
            remove(key, current)
          pump()
        },
      }
    },
    dispose() {
      disposed = true
      for (const [key, entry] of entries) remove(key, entry)
    },
  }
}

let panelLoader: ReturnType<typeof createCoverPreviewLoader> | undefined

export function getCoverPreviewLoader() {
  if (!panelLoader) {
    panelLoader = createCoverPreviewLoader({
      fetchPreview: (payload) =>
        sendRuntimeMessage({
          target: "background",
          type: "GET_COVER_PREVIEW",
          payload,
        }),
      cancelPreview: async (requestId) => {
        await sendRuntimeMessage({
          target: "background",
          type: "CANCEL_COVER_PREVIEW",
          payload: { requestId },
        })
      },
      createObjectURL: (blob) => URL.createObjectURL(blob),
      revokeObjectURL: (url) => URL.revokeObjectURL(url),
      decode: async (url) => {
        const image = new Image()
        image.src = url
        try {
          await image.decode()
          if (image.naturalWidth === 0 || image.naturalHeight === 0)
            throw new Error("Cover preview could not be decoded")
        } finally {
          image.removeAttribute("src")
        }
      },
    })
    window.addEventListener(
      "pagehide",
      () => {
        panelLoader?.dispose()
        panelLoader = undefined
      },
      { once: true }
    )
  }
  return panelLoader
}
