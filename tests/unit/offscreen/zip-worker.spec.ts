/**
 * Zip Worker Unit Tests
 *
 * The worker (`entrypoints/offscreen/zip.worker.ts`) runs as a Web Worker and
 * communicates via `self.postMessage` / `self.onmessage`. These tests load the
 * worker module in a Node environment, stub the worker global (`self`) to
 * capture outbound messages and intercept inbound message dispatch, and drive
 * the worker by invoking its `onmessage` handler directly with crafted
 * `MessageEvent` payloads.
 *
 * The worker is excluded from the coverage gate (see vitest.config.ts), but
 * protocol and real-archive tests still exercise its behavior directly.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { strFromU8, unzipSync } from "fflate"

type WorkerResponse =
  | { type: "progress"; bytes: number; chunks: number; final: boolean }
  | {
      success: true
      filename: string
      size: number
      buffer: ArrayBuffer
      imageCount: number
      format: "cbz" | "zip"
    }
  | { success: false; error: string }
type TerminalWorkerResponse = Extract<WorkerResponse, { success: boolean }>

describe("zip.worker streaming archive protocol", () => {
  let postedMessages: WorkerResponse[] = []
  // The worker assigns `self.onmessage = (ev) => {...}`. We capture that
  // handler via a getter/setter on the stubbed `self` global so we can invoke
  // it directly with synthetic MessageEvents.
  let onmessageHandler: ((ev: MessageEvent) => void) | null = null

  beforeEach(() => {
    postedMessages = []
    onmessageHandler = null

    // Build a minimal `self` stub that the worker module can attach to.
    const selfStub: Record<string, unknown> = {
      postMessage: vi.fn((msg: WorkerResponse) => {
        postedMessages.push(msg)
      }),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }
    // Use defineProperty so assigning `self.onmessage = fn` is captured.
    Object.defineProperty(selfStub, "onmessage", {
      get() {
        return onmessageHandler
      },
      set(fn: ((ev: MessageEvent) => void) | null) {
        onmessageHandler = fn
      },
      configurable: true,
    })

    vi.stubGlobal("self", selfStub)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    onmessageHandler = null
    vi.doUnmock("fflate")
    vi.resetModules()
  })

  function sendMessage(data: unknown): void {
    if (!onmessageHandler) {
      throw new Error("worker onmessage handler was not registered")
    }
    onmessageHandler({ data } as MessageEvent)
  }

  async function installWorkerRuntime(): Promise<void> {
    const { installZipWorkerRuntime } =
      await import("@/entrypoints/offscreen/zip.worker")
    installZipWorkerRuntime(
      self as unknown as Parameters<typeof installZipWorkerRuntime>[0]
    )
  }

  async function waitForTerminalMessage(): Promise<TerminalWorkerResponse> {
    let terminal: TerminalWorkerResponse | undefined
    await vi.waitFor(
      () => {
        terminal = postedMessages.find(
          (message): message is TerminalWorkerResponse => "success" in message
        )
        expect(terminal).toBeDefined()
      },
      { timeout: 5_000, interval: 10 }
    )
    return terminal!
  }

  it("does not reject output solely because cumulative byte accounting exceeds 500 MiB", async () => {
    const reportedByteLength = 500 * 1024 * 1024 + 1
    const reportedChunk = {
      0: 0,
      length: 1,
      byteLength: reportedByteLength,
    } as unknown as Uint8Array

    class AccountingOnlyZip {
      ondata?: (error: Error | null, chunk: Uint8Array, final: boolean) => void

      add(): void {}

      end(): void {
        this.ondata?.(null, reportedChunk, true)
      }
    }

    vi.doMock("fflate", async () => {
      const actual = await vi.importActual<typeof import("fflate")>("fflate")
      return {
        ...actual,
        Zip: AccountingOnlyZip as unknown as typeof actual.Zip,
      }
    })

    await installWorkerRuntime()
    sendMessage({ type: "init", chapterTitle: "Large", extension: "cbz" })
    sendMessage({ type: "finalize" })

    const terminal = await waitForTerminalMessage()
    expect(terminal).toMatchObject({
      success: true,
      filename: "Large.cbz",
      size: 1,
    })
    expect(postedMessages).toContainEqual({
      type: "progress",
      bytes: reportedByteLength,
      chunks: 1,
      final: true,
    })
  })

  it("creates an archive for valid small input", async () => {
    await installWorkerRuntime()

    // Initialize the worker so the Zip instance and its ondata callback exist.
    sendMessage({ type: "init", chapterTitle: "Small", extension: "cbz" })

    // Add a small image and finalize.
    const smallImage = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0])
      .buffer
    sendMessage({
      type: "addImage",
      filename: "001.jpg",
      buffer: smallImage,
      index: 0,
      mimeType: "image/jpeg",
    })
    sendMessage({ type: "finalize" })

    // Wait for the asynchronous deflater to post its terminal response before
    // afterEach removes the worker-global stub.
    const terminal = await waitForTerminalMessage()
    expect(terminal.success).toBe(true)
  })

  it("creates a readable archive containing the streamed images and ComicInfo", async () => {
    await installWorkerRuntime()

    sendMessage({ type: "init", chapterTitle: "Readable", extension: "cbz" })
    sendMessage({
      type: "addComicInfo",
      xml: "<ComicInfo><Title>Readable</Title></ComicInfo>",
    })
    sendMessage({
      type: "addImage",
      filename: "001.jpg",
      buffer: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]).buffer,
      index: 0,
      mimeType: "image/jpeg",
    })
    sendMessage({
      type: "addImage",
      filename: "002.png",
      buffer: new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer,
      index: 1,
      mimeType: "image/png",
    })
    sendMessage({ type: "finalize" })

    const terminal = await waitForTerminalMessage()
    expect(terminal.success).toBe(true)
    if (!terminal.success) return

    const files = unzipSync(new Uint8Array(terminal.buffer))
    expect(strFromU8(files["ComicInfo.xml"]!)).toContain(
      "<Title>Readable</Title>"
    )
    expect(files["001.jpg"]).toEqual(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))
    expect(files["002.png"]).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))
  })

  it("resets archive state between chapters", async () => {
    await installWorkerRuntime()

    sendMessage({ type: "init", chapterTitle: "First", extension: "cbz" })
    // Simulate a reset between chapters.
    sendMessage({ type: "reset" })
    sendMessage({ type: "init", chapterTitle: "Second", extension: "cbz" })

    const smallImage = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]).buffer
    sendMessage({
      type: "addImage",
      filename: "001.jpg",
      buffer: smallImage,
      index: 0,
      mimeType: "image/jpeg",
    })
    sendMessage({ type: "finalize" })

    const terminal = await waitForTerminalMessage()
    expect(terminal.success).toBe(true)
  })
})

describe("zip.worker MV3 compression implementation", () => {
  it("does not rely on nested blob workers for compression", async () => {
    const source = await import("@/entrypoints/offscreen/zip.worker.ts?raw")
    const text = String(source.default)
    expect(text).not.toContain("AsyncZipDeflate")
    expect(text).toContain("ZipDeflate")
    expect(text).toContain("ZipPassThrough")
  })
})
