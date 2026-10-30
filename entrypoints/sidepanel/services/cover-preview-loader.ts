import {
  awaitWhileActive,
  fetchForRetainedConsumer,
  decodeCoverPreviewBytes,
} from "./cover-preview-loader-authorization"
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

export function coverPreviewKey(
  identity: Pick<CoverPreviewIdentity, "integrationId" | "coverUrl">
): string {
  return JSON.stringify([identity.integrationId, identity.coverUrl])
}

function createEntry(
  identity: CoverPreviewIdentity,
  expire: () => void
): Entry {
  let resolve!: Entry["resolve"]
  const result = new Promise<CoverPreviewResult>((done) => {
    resolve = done
  })
  return {
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
    controller: new AbortController(),
    deadline: setTimeout(expire, COVER_PREVIEW_TIMEOUT_MS + 5_000),
  }
}

class CoverPreviewCache {
  readonly entries = new Map<string, Entry>()
  retainedBytes = 0
  constructor(private readonly boundary: PreviewBoundary) {}

  revoke(entry: Entry) {
    if (!entry.url) return
    this.boundary.revokeObjectURL(entry.url)
    entry.url = undefined
  }

  cancel(entry: Entry) {
    if (entry.state === "running")
      void this.boundary.cancelPreview(entry.requestId).catch(() => {})
  }

  remove(key: string, entry: Entry) {
    if (this.entries.get(key) !== entry) return
    this.entries.delete(key)
    clearTimeout(entry.deadline)
    entry.controller.abort()
    this.retainedBytes -= entry.bytes
    this.revoke(entry)
    this.cancel(entry)
    entry.resolve({ status: "fallback" })
  }

  evictUnused() {
    for (const [key, entry] of this.entries) {
      if (entry.consumers.size === 0) {
        this.remove(key, entry)
        return true
      }
    }
    return false
  }
}

class CoverPreviewLoader {
  private readonly cache: CoverPreviewCache
  private running = 0
  private disposed = false
  constructor(
    private readonly boundary: PreviewBoundary,
    private readonly limits: PreviewLimits
  ) {
    this.cache = new CoverPreviewCache(boundary)
  }

  private expire(key: string, entry: Entry) {
    if (this.cache.entries.get(key) !== entry) return
    this.cache.cancel(entry)
    entry.controller.abort(new Error("Cover preview timed out"))
    entry.state = "settled"
    entry.resolve({ status: "fallback" })
    this.pump()
  }

  private async load(key: string, entry: Entry) {
    try {
      const response = await fetchForRetainedConsumer(entry, (payload) =>
        this.boundary.fetchPreview(payload)
      )
      if (this.cache.entries.get(key) !== entry) return
      const bytes = decodeCoverPreviewBytes(
        response,
        entry.identity,
        this.limits.maxImageBytes
      )
      entry.url = this.boundary.createObjectURL(
        new Blob([bytes], { type: response.mimeType })
      )
      await awaitWhileActive(
        this.boundary.decode(entry.url),
        entry.controller.signal
      )
      if (this.cache.entries.get(key) !== entry || !entry.url) return
      entry.bytes = bytes.byteLength
      this.cache.retainedBytes += entry.bytes
      entry.resolve({ status: "ready", url: entry.url })
    } catch {
      this.cache.revoke(entry)
      entry.resolve({ status: "fallback" })
    } finally {
      clearTimeout(entry.deadline)
      entry.state = "settled"
      this.running -= 1
      this.pump()
    }
  }

  private canReserveImage() {
    return (
      this.cache.retainedBytes +
        (this.running + 1) * this.limits.maxImageBytes <=
      this.limits.maxRetainedBytes
    )
  }

  private reserveImage() {
    while (!this.canReserveImage() && this.cache.evictUnused()) {
      // Unused least-recently-used images make room for a new request.
    }
    return this.canReserveImage()
  }

  private pump() {
    if (this.disposed) return
    for (const [key, entry] of this.cache.entries) {
      if (entry.state !== "pending") continue
      if (this.running >= this.limits.maxConcurrentRequests) return
      if (!this.reserveImage()) {
        if (this.running > 0) return
        entry.state = "settled"
        entry.resolve({ status: "fallback" })
        continue
      }
      entry.state = "running"
      this.running += 1
      void this.load(key, entry)
    }
  }

  private admit(key: string, identity: CoverPreviewIdentity) {
    if (this.disposed) return
    while (
      this.cache.entries.size >= this.limits.maxEntries &&
      this.cache.evictUnused()
    ) {
      // Active consumers retain admission priority.
    }
    if (this.cache.entries.size >= this.limits.maxEntries) return
    const entry = createEntry(identity, () => this.expire(key, entry))
    this.cache.entries.set(key, entry)
    return entry
  }

  private release(key: string, entry: Entry, consumer: symbol) {
    entry.consumers.delete(consumer)
    if (entry.consumers.size === 0 && (entry.state !== "settled" || !entry.url))
      this.cache.remove(key, entry)
    this.pump()
  }

  acquire(identity: CoverPreviewIdentity) {
    const key = coverPreviewKey(identity)
    const entry = this.cache.entries.get(key) ?? this.admit(key, identity)
    if (!entry)
      return {
        result: Promise.resolve<CoverPreviewResult>({ status: "fallback" }),
        release() {},
      }
    this.cache.entries.delete(key)
    this.cache.entries.set(key, entry)
    const consumer = Symbol()
    entry.consumers.set(consumer, identity.source)
    this.pump()
    let released = false
    return {
      result: entry.result,
      release: () => {
        if (released) return
        released = true
        this.release(key, entry, consumer)
      },
    }
  }

  dispose() {
    this.disposed = true
    for (const [key, entry] of this.cache.entries) this.cache.remove(key, entry)
  }
}

export function createCoverPreviewLoader(
  boundary: PreviewBoundary,
  limits: PreviewLimits = DEFAULT_LIMITS
) {
  return new CoverPreviewLoader(boundary, limits)
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
