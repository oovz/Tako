import { afterEach, describe, expect, it, vi } from "vitest"
import {
  createCoverPreviewLoader,
  type CoverPreviewIdentity,
  type CoverPreviewSource,
} from "@/entrypoints/sidepanel/services/cover-preview-loader"
import type { CoverPreviewResponse } from "@/src/runtime/cover-preview-contracts"

const identity: CoverPreviewIdentity = {
  integrationId: "mycomic",
  coverUrl: "https://img.example.com/cover.jpg?signature=one",
  source: { kind: "task", taskId: "task-one" },
}

const smallPng = new Uint8Array([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0,
  0, 0, 1, 8, 4, 0, 0, 0, 181, 28, 12, 2, 0, 0, 0, 11, 73, 68, 65, 84, 120, 218,
  99, 100, 0, 2, 0, 0, 10, 0, 2, 255, 229, 196, 165, 0, 0, 0, 0, 73, 69, 78, 68,
  174, 66, 96, 130,
])
const largePng = atob(
  "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAc0lEQVR4nO3QMREAIBAEMdS9JkQgByUYAlxc8Sm238nYc91kFW4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHQDOHwlW4QAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIAGAA/ZpdJ3wUMJyQAAAABJRU5ErkJggg=="
)

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function imageResponse(
  input = identity,
  bytes = "cover",
  mimeType: Extract<
    CoverPreviewResponse,
    { success: true }
  >["mimeType"] = "image/jpeg"
) {
  return {
    success: true as const,
    integrationId: input.integrationId,
    coverUrl: input.coverUrl,
    base64: btoa(bytes),
    mimeType,
  }
}

function pngResponse(
  input = identity,
  bytes = String.fromCharCode(...smallPng)
) {
  return imageResponse(input, bytes, "image/png")
}

function boundary() {
  return {
    fetchPreview: vi.fn<
      (input: {
        requestId: string
        source: CoverPreviewSource
      }) => Promise<
        ReturnType<typeof imageResponse> | { success: false; error: string }
      >
    >(async () => imageResponse()),
    cancelPreview: vi.fn(async () => {}),
    createObjectURL: vi.fn<(blob: Blob) => string>(() => "blob:preview"),
    revokeObjectURL: vi.fn(),
    decode: vi.fn(async () => {}),
  }
}

describe("cover preview loader", () => {
  afterEach(() => vi.useRealTimers())
  it("shares a fetched and decoded Blob across consumers until the cache is disposed", async () => {
    const io = boundary()
    const response = deferred<ReturnType<typeof imageResponse>>()
    io.fetchPreview.mockImplementation(() => response.promise)
    const loader = createCoverPreviewLoader(io)
    const first = loader.acquire(identity)
    const second = loader.acquire({
      ...identity,
      source: { kind: "task", taskId: "task-two" },
    })
    first.release()
    expect(io.cancelPreview).not.toHaveBeenCalled()
    response.resolve(imageResponse())
    await expect(second.result).resolves.toEqual({
      status: "ready",
      url: "blob:preview",
    })
    expect(io.fetchPreview).toHaveBeenCalledTimes(1)
    expect(io.decode).toHaveBeenCalledWith("blob:preview")
    second.release()
    const cached = loader.acquire(identity)
    await expect(cached.result).resolves.toEqual({
      status: "ready",
      url: "blob:preview",
    })
    expect(io.fetchPreview).toHaveBeenCalledTimes(1)
    cached.release()
    loader.dispose()
    expect(io.revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:preview")
  })

  it("finishes loading and cancels a runtime request that never responds", async () => {
    vi.useFakeTimers()
    const io = boundary()
    io.fetchPreview.mockReturnValue(new Promise(() => {}))
    const loader = createCoverPreviewLoader(io)
    const preview = loader.acquire(identity)
    await vi.advanceTimersByTimeAsync(20_000)
    await expect(preview.result).resolves.toEqual({ status: "fallback" })
    expect(io.cancelPreview).toHaveBeenCalledTimes(1)
    expect(io.createObjectURL).not.toHaveBeenCalled()
    preview.release()
    loader.dispose()
  })

  it("ends a timed-out shared preview without dispatching another retained consumer", async () => {
    vi.useFakeTimers()
    const io = boundary()
    const pending = deferred<CoverPreviewResponse>()
    io.fetchPreview.mockReturnValueOnce(pending.promise)
    io.cancelPreview.mockImplementation(async () => {
      pending.resolve({ success: false, error: "Preview cancelled" })
    })
    const loader = createCoverPreviewLoader(io)
    const first = loader.acquire(identity)
    const second = loader.acquire({
      ...identity,
      source: { kind: "task", taskId: "retained" },
    })
    try {
      await vi.advanceTimersByTimeAsync(20_000)
      await expect(first.result).resolves.toEqual({ status: "fallback" })
      await expect(second.result).resolves.toEqual({ status: "fallback" })
      expect(io.cancelPreview).toHaveBeenCalledExactlyOnceWith(
        io.fetchPreview.mock.calls[0][0].requestId
      )
      expect(io.fetchPreview).toHaveBeenCalledTimes(1)
      expect(io.createObjectURL).not.toHaveBeenCalled()
    } finally {
      first.release()
      second.release()
      loader.dispose()
    }
  })

  it("preserves the fetched image bytes in the Blob passed to the decoder", async () => {
    const io = boundary()
    io.fetchPreview.mockResolvedValueOnce(pngResponse())
    const loader = createCoverPreviewLoader(io)
    const preview = loader.acquire(identity)
    try {
      await expect(preview.result).resolves.toEqual({
        status: "ready",
        url: "blob:preview",
      })
      const blob = io.createObjectURL.mock.calls[0][0]
      expect(blob.type).toBe("image/png")
      expect(new Uint8Array(await blob.arrayBuffer())).toEqual(
        new Uint8Array(smallPng)
      )
      expect(io.decode).toHaveBeenCalledExactlyOnceWith("blob:preview")
    } finally {
      preview.release()
      loader.dispose()
    }
  })

  it("releases abandoned work and ignores its delayed response after a new consumer starts", async () => {
    const io = boundary()
    const oldResponse = deferred<ReturnType<typeof imageResponse>>()
    io.fetchPreview.mockReturnValueOnce(oldResponse.promise)
    const loader = createCoverPreviewLoader(io)
    const abandoned = loader.acquire(identity)
    abandoned.release()
    await expect(abandoned.result).resolves.toEqual({ status: "fallback" })
    expect(io.cancelPreview).toHaveBeenCalledTimes(1)
    const current = loader.acquire(identity)
    await expect(current.result).resolves.toEqual({
      status: "ready",
      url: "blob:preview",
    })
    oldResponse.resolve(imageResponse())
    await Promise.resolve()
    expect(io.createObjectURL).toHaveBeenCalledTimes(1)
    current.release()
    loader.dispose()
  })

  it("revokes a Blob that cannot decode and lets a later consumer retry", async () => {
    const io = boundary()
    io.decode.mockRejectedValueOnce(new Error("Invalid image"))
    const loader = createCoverPreviewLoader(io)
    const failed = loader.acquire(identity)
    await expect(failed.result).resolves.toEqual({ status: "fallback" })
    expect(io.revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:preview")
    failed.release()
    const retry = loader.acquire(identity)
    await expect(retry.result).resolves.toEqual({
      status: "ready",
      url: "blob:preview",
    })
    expect(io.fetchPreview).toHaveBeenCalledTimes(2)
    retry.release()
    loader.dispose()
  })

  it.each([
    { success: false as const, error: "Access denied" },
    { ...imageResponse(), integrationId: "another-site" },
    { ...imageResponse(), coverUrl: `${identity.coverUrl}-changed` },
    { ...imageResponse(), base64: "not-base64!" },
    { ...imageResponse(), base64: "" },
  ])(
    "settles an unavailable or mismatched cover without creating a Blob: %j",
    async (response) => {
      const io = boundary()
      io.fetchPreview.mockResolvedValue(response)
      const loader = createCoverPreviewLoader(io)
      const preview = loader.acquire(identity)
      await expect(preview.result).resolves.toEqual({ status: "fallback" })
      expect(io.createObjectURL).not.toHaveBeenCalled()
      preview.release()
      loader.dispose()
    }
  )

  it("keeps distinct integrations and complete signed URLs as separate cover identities", async () => {
    const io = boundary()
    const alternatives = [
      identity,
      {
        ...identity,
        coverUrl: "https://img.example.com/cover.jpg?signature=two",
        source: { kind: "task" as const, taskId: "signed-two" },
      },
      {
        ...identity,
        integrationId: "lovemanga",
        source: { kind: "task" as const, taskId: "another-site" },
      },
    ]
    io.fetchPreview.mockImplementation(async ({ source }) =>
      imageResponse(
        alternatives.find(
          (item) =>
            item.source.kind === "task" &&
            source.kind === "task" &&
            item.source.taskId === source.taskId
        )!
      )
    )
    const loader = createCoverPreviewLoader(io)
    const previews = alternatives.map((item) => loader.acquire(item))
    expect(
      (await Promise.all(previews.map((item) => item.result))).every(
        (item) => item.status === "ready"
      )
    ).toBe(true)
    expect(io.fetchPreview).toHaveBeenCalledTimes(3)
    previews.forEach((item) => item.release())
    loader.dispose()
  })

  it("bounds cache entries and evicts an unused image while preserving active consumers", async () => {
    const io = boundary()
    let serial = 0
    io.createObjectURL.mockImplementation(() => `blob:preview-${++serial}`)
    const secondIdentity = { ...identity, coverUrl: `${identity.coverUrl}-two` }
    const thirdIdentity = {
      ...identity,
      coverUrl: `${identity.coverUrl}-three`,
    }
    io.fetchPreview
      .mockResolvedValueOnce(imageResponse())
      .mockResolvedValueOnce(imageResponse(secondIdentity))
      .mockResolvedValueOnce(imageResponse(thirdIdentity))
    const loader = createCoverPreviewLoader(io, {
      maxEntries: 2,
      maxRetainedBytes: 16,
      maxImageBytes: 8,
      maxConcurrentRequests: 2,
    })
    const active = loader.acquire(identity)
    const unused = loader.acquire(secondIdentity)
    await Promise.all([active.result, unused.result])
    const denied = loader.acquire(thirdIdentity)
    await expect(denied.result).resolves.toEqual({ status: "fallback" })
    unused.release()
    const admitted = loader.acquire(thirdIdentity)
    await expect(admitted.result).resolves.toEqual({
      status: "ready",
      url: "blob:preview-3",
    })
    expect(io.revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:preview-2")
    active.release()
    admitted.release()
    loader.dispose()
  })

  it("admits images within retained byte limits and rejects oversized payloads", async () => {
    const io = boundary()
    io.fetchPreview.mockResolvedValueOnce(imageResponse(identity, "12345678"))
    const loader = createCoverPreviewLoader(io, {
      maxEntries: 4,
      maxRetainedBytes: 8,
      maxImageBytes: 8,
      maxConcurrentRequests: 1,
    })
    const first = loader.acquire(identity)
    await expect(first.result).resolves.toEqual({
      status: "ready",
      url: "blob:preview",
    })
    const alternate = {
      ...identity,
      coverUrl: `${identity.coverUrl}-alternate`,
    }
    const blocked = loader.acquire(alternate)
    await expect(blocked.result).resolves.toEqual({ status: "fallback" })
    expect(io.fetchPreview).toHaveBeenCalledTimes(1)
    first.release()
    blocked.release()
    io.fetchPreview.mockResolvedValueOnce(imageResponse(alternate, "123456789"))
    const tooLarge = loader.acquire(alternate)
    await expect(tooLarge.result).resolves.toEqual({ status: "fallback" })
    expect(io.revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:preview")
    expect(io.createObjectURL).toHaveBeenCalledTimes(1)
    tooLarge.release()
    loader.dispose()
  })

  it("evicts several small unused covers to reserve an image while preserving a retained cover", async () => {
    const io = boundary()
    let serial = 0
    io.createObjectURL.mockImplementation(() => `blob:preview-${++serial}`)
    const loader = createCoverPreviewLoader(io, {
      maxEntries: 8,
      maxRetainedBytes: 3 * smallPng.byteLength + largePng.length,
      maxImageBytes: largePng.length,
      maxConcurrentRequests: 1,
    })
    try {
      for (const [index, suffix] of ["one", "two", "three"].entries()) {
        const request = {
          ...identity,
          coverUrl: `${identity.coverUrl}-${suffix}`,
        }
        io.fetchPreview.mockResolvedValueOnce(pngResponse(request))
        const unused = loader.acquire(request)
        await expect(unused.result).resolves.toEqual({
          status: "ready",
          url: `blob:preview-${index + 1}`,
        })
        unused.release()
      }
      io.fetchPreview.mockResolvedValueOnce(pngResponse(identity, largePng))
      const retained = loader.acquire(identity)
      await expect(retained.result).resolves.toEqual({
        status: "ready",
        url: "blob:preview-4",
      })
      const request = { ...identity, coverUrl: `${identity.coverUrl}-large` }
      io.fetchPreview.mockResolvedValueOnce(pngResponse(request, largePng))
      const admitted = loader.acquire(request)
      await expect(admitted.result).resolves.toEqual({
        status: "ready",
        url: "blob:preview-5",
      })
      expect(io.revokeObjectURL.mock.calls.map(([url]) => url).sort()).toEqual([
        "blob:preview-1",
        "blob:preview-2",
        "blob:preview-3",
      ])
      await expect(retained.result).resolves.toEqual({
        status: "ready",
        url: "blob:preview-4",
      })
      retained.release()
      admitted.release()
    } finally {
      loader.dispose()
    }
  })

  it("counts retained bytes and in-flight image reservations before dispatching queued covers", async () => {
    const io = boundary()
    const pending = deferred<CoverPreviewResponse>()
    const waitingIdentity = {
      ...identity,
      coverUrl: `${identity.coverUrl}-waiting`,
    }
    const queuedIdentity = {
      ...identity,
      coverUrl: `${identity.coverUrl}-queued`,
    }
    io.fetchPreview
      .mockResolvedValueOnce(pngResponse(identity, largePng))
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce(pngResponse(queuedIdentity, largePng))
    const loader = createCoverPreviewLoader(io, {
      maxEntries: 4,
      maxRetainedBytes: 2 * largePng.length,
      maxImageBytes: largePng.length,
      maxConcurrentRequests: 2,
    })
    const retained = loader.acquire(identity)
    try {
      await retained.result
      const waiting = loader.acquire(waitingIdentity)
      const queued = loader.acquire(queuedIdentity)
      expect(io.fetchPreview).toHaveBeenCalledTimes(2)
      expect(io.revokeObjectURL).not.toHaveBeenCalled()
      pending.resolve({ success: false, error: "HTTP 503" })
      await expect(waiting.result).resolves.toEqual({ status: "fallback" })
      await expect(queued.result).resolves.toEqual({
        status: "ready",
        url: "blob:preview",
      })
      expect(io.fetchPreview).toHaveBeenCalledTimes(3)
      expect(io.revokeObjectURL).not.toHaveBeenCalled()
      waiting.release()
      queued.release()
    } finally {
      retained.release()
      loader.dispose()
    }
  })

  it("keeps a queued cover pending until an in-flight reservation finishes", async () => {
    const io = boundary()
    const pending = deferred<CoverPreviewResponse>()
    const queuedIdentity = {
      ...identity,
      coverUrl: `${identity.coverUrl}-queued`,
    }
    io.fetchPreview
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce(pngResponse(queuedIdentity, largePng))
    const loader = createCoverPreviewLoader(io, {
      maxEntries: 4,
      maxRetainedBytes: largePng.length,
      maxImageBytes: largePng.length,
      maxConcurrentRequests: 2,
    })
    const first = loader.acquire(identity)
    const queued = loader.acquire(queuedIdentity)
    const settled = vi.fn()
    void queued.result.then(settled)
    try {
      await Promise.resolve()
      expect(settled).not.toHaveBeenCalled()
      expect(io.fetchPreview).toHaveBeenCalledTimes(1)
      pending.resolve({ success: false, error: "HTTP 503" })
      await expect(first.result).resolves.toEqual({ status: "fallback" })
      await expect(queued.result).resolves.toEqual({
        status: "ready",
        url: "blob:preview",
      })
      expect(io.fetchPreview).toHaveBeenCalledTimes(2)
    } finally {
      first.release()
      queued.release()
      loader.dispose()
    }
  })

  it("bounds concurrent requests and clears pending work when the panel closes", async () => {
    const io = boundary()
    const response = deferred<ReturnType<typeof imageResponse>>()
    io.fetchPreview.mockReturnValue(response.promise)
    const loader = createCoverPreviewLoader(io, {
      maxEntries: 4,
      maxRetainedBytes: 32,
      maxImageBytes: 8,
      maxConcurrentRequests: 1,
    })
    const first = loader.acquire(identity)
    const second = loader.acquire({
      ...identity,
      coverUrl: `${identity.coverUrl}-two`,
    })
    expect(io.fetchPreview).toHaveBeenCalledTimes(1)
    loader.dispose()
    await expect(first.result).resolves.toEqual({ status: "fallback" })
    await expect(second.result).resolves.toEqual({ status: "fallback" })
    response.resolve(imageResponse())
    await Promise.resolve()
    expect(io.createObjectURL).not.toHaveBeenCalled()
    expect(io.cancelPreview).toHaveBeenCalledTimes(1)
    await expect(loader.acquire(identity).result).resolves.toEqual({
      status: "fallback",
    })
  })

  it.each(["first", "second"])(
    "authorizes a queued shared cover through its retained task after the %s consumer is removed",
    async (removedConsumer) => {
      const io = boundary()
      const occupied = {
        ...identity,
        coverUrl: `${identity.coverUrl}-occupied`,
        source: { kind: "task" as const, taskId: "occupied" },
      }
      const firstIdentity = {
        ...identity,
        source: { kind: "task" as const, taskId: "first" },
      }
      const secondIdentity = {
        ...identity,
        source: { kind: "task" as const, taskId: "second" },
      }
      const gate = deferred<ReturnType<typeof imageResponse>>()
      const authorizedTasks = new Set(["first", "second"])
      io.fetchPreview.mockImplementation(async ({ source }) => {
        if (source.kind === "task" && source.taskId === "occupied")
          return gate.promise
        return source.kind === "task" && authorizedTasks.has(source.taskId)
          ? imageResponse(identity)
          : { success: false, error: "Task no longer exists" }
      })
      const loader = createCoverPreviewLoader(io, {
        maxEntries: 3,
        maxRetainedBytes: 32,
        maxImageBytes: 8,
        maxConcurrentRequests: 1,
      })
      const occupier = loader.acquire(occupied)
      const first = loader.acquire(firstIdentity)
      const second = loader.acquire(secondIdentity)
      authorizedTasks.delete(removedConsumer)
      const removed = removedConsumer === "first" ? first : second
      const retained = removedConsumer === "first" ? second : first
      removed.release()
      gate.resolve(imageResponse(occupied))
      try {
        await occupier.result
        await expect(retained.result).resolves.toEqual({
          status: "ready",
          url: "blob:preview",
        })
      } finally {
        occupier.release()
        retained.release()
        loader.dispose()
      }
    }
  )

  it("uses the latest retained series revision when its shared request leaves the queue", async () => {
    const io = boundary()
    const occupied = {
      ...identity,
      coverUrl: `${identity.coverUrl}-occupied`,
      source: { kind: "task" as const, taskId: "occupied" },
    }
    const gate = deferred<ReturnType<typeof imageResponse>>()
    io.fetchPreview.mockImplementation(async ({ source }) => {
      if (source.kind === "task") return gate.promise
      return source.seriesRevision === 2
        ? imageResponse(identity)
        : { success: false, error: "Series revision is stale" }
    })
    const loader = createCoverPreviewLoader(io, {
      maxEntries: 3,
      maxRetainedBytes: 32,
      maxImageBytes: 8,
      maxConcurrentRequests: 1,
    })
    const occupier = loader.acquire(occupied)
    const source = {
      kind: "series" as const,
      tabId: 1,
      windowId: 1,
      seriesId: "series-one",
      seriesRevision: 1,
    }
    const earlier = loader.acquire({ ...identity, source })
    const latest = loader.acquire({
      ...identity,
      source: { ...source, seriesRevision: 2 },
    })
    gate.resolve(imageResponse(occupied))
    try {
      await occupier.result
      await expect(latest.result).resolves.toEqual({
        status: "ready",
        url: "blob:preview",
      })
    } finally {
      occupier.release()
      earlier.release()
      latest.release()
      loader.dispose()
    }
  })

  it("retries through a retained task when the dispatched task is removed before authorization completes", async () => {
    const io = boundary()
    const authorization = deferred<{ success: false; error: string }>()
    io.fetchPreview.mockReturnValueOnce(authorization.promise)
    const loader = createCoverPreviewLoader(io)
    const removed = loader.acquire(identity)
    const retained = loader.acquire({
      ...identity,
      source: { kind: "task", taskId: "retained" },
    })
    removed.release()
    authorization.resolve({ success: false, error: "Task no longer exists" })
    try {
      await expect(retained.result).resolves.toEqual({
        status: "ready",
        url: "blob:preview",
      })
      expect(io.fetchPreview).toHaveBeenCalledTimes(2)
      const [initial, replacement] = io.fetchPreview.mock.calls
      expect(replacement[0].source).toEqual({
        kind: "task",
        taskId: "retained",
      })
      expect(replacement[0].requestId).not.toBe(initial[0].requestId)
    } finally {
      retained.release()
      loader.dispose()
    }
  })

  it("settles an ordinary shared-cover HTTP failure without trying another retained source", async () => {
    const io = boundary()
    io.fetchPreview.mockResolvedValue({ success: false, error: "HTTP 403" })
    const loader = createCoverPreviewLoader(io)
    const first = loader.acquire(identity)
    const second = loader.acquire({
      ...identity,
      source: { kind: "task", taskId: "second" },
    })
    try {
      await expect(second.result).resolves.toEqual({ status: "fallback" })
      expect(io.fetchPreview).toHaveBeenCalledTimes(1)
    } finally {
      first.release()
      second.release()
      loader.dispose()
    }
  })

  it("tries each source once when consumer ownership alternates during authorization", async () => {
    const io = boundary()
    const firstAuthorization = deferred<{ success: false; error: string }>()
    const secondAuthorization = deferred<{ success: false; error: string }>()
    io.fetchPreview
      .mockReturnValueOnce(firstAuthorization.promise)
      .mockReturnValueOnce(secondAuthorization.promise)
    const loader = createCoverPreviewLoader(io)
    const first = loader.acquire(identity)
    const second = loader.acquire({
      ...identity,
      source: { kind: "task", taskId: "second" },
    })
    first.release()
    firstAuthorization.resolve({
      success: false,
      error: "Task no longer exists",
    })
    await vi.waitFor(() => expect(io.fetchPreview).toHaveBeenCalledTimes(2))
    const returning = loader.acquire(identity)
    second.release()
    secondAuthorization.resolve({
      success: false,
      error: "Task no longer exists",
    })
    try {
      await expect(returning.result).resolves.toEqual({ status: "fallback" })
      expect(io.fetchPreview).toHaveBeenCalledTimes(2)
    } finally {
      returning.release()
      loader.dispose()
    }
  })

  it("keeps the original loading deadline when authorization switches consumers", async () => {
    vi.useFakeTimers()
    const io = boundary()
    const authorization = deferred<{ success: false; error: string }>()
    io.fetchPreview
      .mockReturnValueOnce(authorization.promise)
      .mockReturnValueOnce(new Promise(() => {}))
    const loader = createCoverPreviewLoader(io)
    const first = loader.acquire(identity)
    const retained = loader.acquire({
      ...identity,
      source: { kind: "task", taskId: "retained" },
    })
    await vi.advanceTimersByTimeAsync(10_000)
    first.release()
    authorization.resolve({ success: false, error: "Task no longer exists" })
    await vi.advanceTimersByTimeAsync(0)
    expect(io.fetchPreview).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(10_000)
    try {
      await expect(retained.result).resolves.toEqual({ status: "fallback" })
      expect(io.cancelPreview).toHaveBeenCalledExactlyOnceWith(
        io.fetchPreview.mock.calls[1][0].requestId
      )
    } finally {
      retained.release()
      loader.dispose()
    }
  })
})
