// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest"
import { unzipSync } from "fflate"
import {
  installZipWorkerRuntime,
  type ZipWorkerRuntimeScope,
  type ZipWorkerResponse,
} from "@/entrypoints/offscreen/zip.worker"

type ZipWorkerMessage = Parameters<
  NonNullable<ZipWorkerRuntimeScope["onmessage"]>
>[0]["data"]

function createRuntime() {
  const postMessage =
    vi.fn<(message: ZipWorkerResponse, transfer?: Transferable[]) => void>()
  const addEventListener =
    vi.fn<
      (
        type: "error" | "unhandledrejection",
        listener:
          | ((event: ErrorEvent) => void)
          | ((event: PromiseRejectionEvent) => void)
      ) => void
    >()
  const scope: ZipWorkerRuntimeScope = {
    onmessage: null,
    postMessage,
    addEventListener,
  }
  installZipWorkerRuntime(scope)
  return { scope, postMessage, addEventListener }
}

describe("archive worker event and normalization boundaries", () => {
  it.each([new Error("deflate failed"), "transport rejected", undefined, ""])(
    "reports an unhandled rejection and marks the event handled",
    (reason) => {
      const runtime = createRuntime()
      const listener = runtime.addEventListener.mock.calls.find(
        ([type]) => type === "unhandledrejection"
      )?.[1] as ((event: PromiseRejectionEvent) => void) | undefined
      const event = new Event("unhandledrejection", {
        cancelable: true,
      }) as PromiseRejectionEvent
      Object.defineProperty(event, "reason", { value: reason })
      expect(listener).toBeTypeOf("function")
      listener?.(event)
      const response = runtime.postMessage.mock.calls[0]?.[0]
      expect(response).toMatchObject({ success: false })
      if (!response || !("error" in response))
        throw new Error("Missing worker failure")
      expect(response.error.length).toBeGreaterThan(0)
      if (reason instanceof Error)
        expect(response.error).toContain(reason.message)
      expect(event.defaultPrevented).toBe(true)
    }
  )

  it.each([
    { message: "outer event", error: new Error("compression failed") },
    {
      message: "worker startup failed",
      error: null,
      filename: "zip.worker.js",
      lineno: 2,
      colno: 4,
    },
  ])(
    "reports worker errors with their original causes and handles the event",
    (details) => {
      const runtime = createRuntime()
      const listener = runtime.addEventListener.mock.calls.find(
        ([type]) => type === "error"
      )?.[1] as ((event: ErrorEvent) => void) | undefined
      const event = new ErrorEvent("error", { ...details, cancelable: true })
      expect(listener).toBeTypeOf("function")
      listener?.(event)
      const response = runtime.postMessage.mock.calls[0]?.[0]
      expect(response).toMatchObject({ success: false })
      if (!response || !("error" in response))
        throw new Error("Missing worker failure")
      expect(response.error).toContain(
        details.error instanceof Error ? details.error.message : details.message
      )
      expect(event.defaultPrevented).toBe(true)
    }
  )

  it("applies image filename normalization to the actual archive entries", async () => {
    const runtime = createRuntime()
    const send = (data: ZipWorkerMessage) =>
      runtime.scope.onmessage?.(new MessageEvent("message", { data }))
    send({
      type: "init",
      chapterTitle: "Normalized",
      extension: "zip",
      normalizeImageFilenames: true,
      imagePaddingDigits: 3,
      totalImages: 1,
    })
    send({
      type: "addImage",
      filename: "source-image.jpg",
      index: 0,
      mimeType: "image/png",
      buffer: new Uint8Array([1, 2, 3]).buffer,
    })
    send({ type: "finalize" })
    await vi.waitFor(() =>
      expect(
        runtime.postMessage.mock.calls.some(
          ([message]) => "success" in message && message.success
        )
      ).toBe(true)
    )
    const response = runtime.postMessage.mock.calls
      .map(([message]) => message)
      .find((message) => "success" in message && message.success)
    if (!response || !("success" in response) || !response.success)
      throw new Error("Missing archive result")
    expect(Object.keys(unzipSync(new Uint8Array(response.buffer)))).toEqual([
      "001.png",
    ])
    expect(response.format).toBe("zip")
  })
})
