import { describe, expect, it, vi } from "vitest"

import { fetchImageWithStallDetection } from "@/src/runtime/fetch-image-core"

function responseForReader(reader: ReadableStreamDefaultReader<Uint8Array>) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    url: "https://images.example/page.jpg",
    headers: {
      get: (name: string) => (name === "content-type" ? "image/jpeg" : null),
    },
    body: {
      getReader: () => reader,
      cancel: vi.fn(async () => undefined),
    },
  } as unknown as Response
}

describe("fetch image stream cleanup", () => {
  it("does not cancel a locked reader after successful EOF", async () => {
    const reader = {
      read: vi
        .fn()
        .mockResolvedValueOnce({ done: false, value: new Uint8Array([1, 2]) })
        .mockResolvedValueOnce({ done: true, value: undefined }),
      cancel: vi.fn(async () => undefined),
      releaseLock: vi.fn(),
    } as unknown as ReadableStreamDefaultReader<Uint8Array>
    const response = responseForReader(reader)

    await expect(
      fetchImageWithStallDetection("https://images.example/page.jpg", {
        fetcher: vi.fn(async () => response),
        stallTimeoutMs: 100,
        hardTimeoutMs: 500,
      })
    ).resolves.toMatchObject({ mimeType: "image/jpeg" })

    expect(reader.cancel).not.toHaveBeenCalled()
    expect(reader.releaseLock).toHaveBeenCalledOnce()
    expect(response.body?.cancel).not.toHaveBeenCalled()
  })

  it("attempts reader cancellation without replacing the read failure", async () => {
    const failure = new Error("stream failed")
    const reader = {
      read: vi.fn(async () => {
        throw failure
      }),
      cancel: vi.fn(async () => {
        throw new Error("cancel failed")
      }),
      releaseLock: vi.fn(),
    } as unknown as ReadableStreamDefaultReader<Uint8Array>
    const response = responseForReader(reader)

    await expect(
      fetchImageWithStallDetection("https://images.example/page.jpg", {
        fetcher: vi.fn(async () => response),
        stallTimeoutMs: 100,
        hardTimeoutMs: 500,
      })
    ).rejects.toBe(failure)

    expect(reader.cancel).toHaveBeenCalledWith(failure)
    expect(reader.releaseLock).toHaveBeenCalledOnce()
  })
})
