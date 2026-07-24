import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  processArchiveFormatChapter,
  processNoneFormatChapter,
  type ChapterDownloadImageFn,
  type ChapterProcessingRuntime,
  type ProcessChapterStreamingOptions,
} from "@/entrypoints/offscreen/chapter-processing"
import { createTaskSettingsSnapshot } from "@/src/runtime/settings-snapshot"
import { DEFAULT_SETTINGS } from "@/src/storage/default-settings"
import { writeBlobToPath } from "@/src/storage/fs-access"

const workerState = vi.hoisted(() => ({
  instances: [] as Array<{
    messages: Array<{
      message: Record<string, unknown>
      transfer?: unknown[]
    }>
    terminate: ReturnType<typeof vi.fn>
  }>,
  finalizeBehavior: "success" as
    "success" | "failure" | "error-event" | "silent",
  terminateThrows: false,
}))

const buildComicInfoMock = vi.hoisted(() => vi.fn())

vi.mock("@/src/runtime/logger", () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock("@/src/storage/fs-access", () => ({
  writeBlobToPath: vi.fn(async () => ({ status: "written" as const })),
}))

vi.mock(
  "@/entrypoints/offscreen/chapter-processing-helpers",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("@/entrypoints/offscreen/chapter-processing-helpers")
      >()
    return {
      ...actual,
      buildOptionalComicInfoXml: buildComicInfoMock,
    }
  }
)

vi.mock("@/entrypoints/offscreen/archive-worker-factory", () => ({
  default: () =>
    new (class MockZipWorker {
      onmessage: ((event: MessageEvent<unknown>) => void) | null = null
      onerror: ((event: ErrorEvent) => void) | null = null
      readonly messages: Array<{
        message: Record<string, unknown>
        transfer?: unknown[]
      }> = []
      terminate = vi.fn(() => {
        if (workerState.terminateThrows) throw new Error("terminate failed")
      })

      constructor() {
        workerState.instances.push(this)
      }

      postMessage(message: Record<string, unknown>, transfer?: unknown[]) {
        this.messages.push({ message, transfer })
        if (message.type !== "finalize") return

        if (workerState.finalizeBehavior === "silent") return
        if (workerState.finalizeBehavior === "error-event") {
          this.onerror?.({
            error: null,
            message: "worker exploded",
            filename: "zip.worker.js",
            lineno: 17,
            colno: 4,
          } as ErrorEvent)
          return
        }
        if (workerState.finalizeBehavior === "failure") {
          this.onmessage?.({
            data: { success: false, error: "deflate failed" },
          } as MessageEvent<unknown>)
          return
        }

        this.onmessage?.({
          data: {
            success: true,
            filename: "chapter.cbz",
            size: 4,
            buffer: new Uint8Array([0x50, 0x4b, 0x03, 0x04]).buffer,
            imageCount: 1,
            format: "cbz",
          },
        } as MessageEvent<unknown>)
      }
    })(),
}))

function createRuntime(): ChapterProcessingRuntime {
  return {
    withImageRetries: async (fn) => fn(),
    resolveWritableDownloadRoot: vi.fn(),
    requestBrowserBlobDownload: vi.fn(async () => ({ success: true })),
    getMemoryStats: vi.fn(() => null),
  }
}

function createOptions<TFormat extends "cbz" | "zip" | "none">(
  format: TFormat
): ProcessChapterStreamingOptions & { format: TFormat } {
  return {
    taskId: "task-edge",
    jobId: "job-edge",
    attempt: 1,
    chapter: {
      id: "chapter-edge",
      title: "Chapter: Edge",
      url: "https://example.com/chapter",
      resolvedPath: `Series/Chapter Edge${format === "none" ? "" : `.${format}`}`,
      comicInfo: {},
    },
    seriesTitle: "Series",
    format,
    includeComicInfo: false,
    downloadMode: "browser",
    comicInfoVersion: "2.0",
    onProgress: vi.fn(async () => undefined),
    onArchiveProgress: vi.fn(async () => undefined),
    normalizeImageFilenames: true,
    imagePaddingDigits: 3,
    settingsSnapshot: {
      ...createTaskSettingsSnapshot(DEFAULT_SETTINGS, "test-site"),
      archiveFormat: format,
      rateLimitSettings: {
        image: { concurrency: 1, delayMs: 0 },
        chapter: { concurrency: 1, delayMs: 0 },
      },
    },
  }
}

function successfulImage(filename = "source.jpg"): ChapterDownloadImageFn {
  return vi.fn(async () => ({
    filename,
    data: new Uint8Array([1, 2, 3]).buffer,
    mimeType: "image/jpeg",
  }))
}

function archiveInput(
  opts: ProcessChapterStreamingOptions & { format: "cbz" | "zip" },
  downloadImage: ChapterDownloadImageFn = successfulImage()
) {
  return {
    opts,
    urls: ["https://example.com/1.jpg"],
    integrationId: "test-site",
    downloadImage,
    normalizeSettings: {
      normalizeImageFilenames: true,
      imagePaddingDigits: 3 as const,
    },
  }
}

function noneInput(
  opts: ProcessChapterStreamingOptions & { format: "none" },
  downloadImage: ChapterDownloadImageFn = successfulImage()
) {
  return {
    opts,
    urls: ["https://example.com/1.jpg"],
    integrationId: "test-site",
    downloadImage,
    normalizeSettings: {
      normalizeImageFilenames: true,
      imagePaddingDigits: 3 as const,
    },
  }
}

beforeEach(() => {
  workerState.instances.length = 0
  workerState.finalizeBehavior = "success"
  workerState.terminateThrows = false
  vi.mocked(writeBlobToPath).mockReset()
  vi.mocked(writeBlobToPath).mockResolvedValue({ status: "written" })
  buildComicInfoMock.mockReset()
  buildComicInfoMock.mockImplementation(
    ({ includeComicInfo }: { includeComicInfo?: boolean }) =>
      includeComicInfo
        ? "<ComicInfo><Title>Edge</Title></ComicInfo>"
        : undefined
  )
})

describe("archive chapter edge cases", () => {
  it("streams ComicInfo, cover, and image entries in archive order and terminates the worker", async () => {
    const runtime = createRuntime()
    const opts = {
      ...createOptions("zip"),
      includeComicInfo: true,
      coverImage: {
        data: new Uint8Array([9, 8]).buffer,
        mimeType: "image/png",
      },
    }

    await expect(
      processArchiveFormatChapter(runtime, archiveInput(opts))
    ).resolves.toEqual({
      status: "completed",
      outputsRequested: 1,
      outputsFailedBeforeHandoff: 0,
      outputsCommitted: 0,
    })

    const worker = workerState.instances[0]!
    expect(worker.messages.map(({ message }) => message.type)).toEqual([
      "init",
      "addComicInfo",
      "addImage",
      "addImage",
      "finalize",
    ])
    expect(worker.messages[0]?.message).toMatchObject({
      extension: "zip",
      totalImages: 2,
    })
    expect(worker.messages[2]?.message).toMatchObject({
      filename: "000-cover.png",
      index: 0,
    })
    expect(worker.messages[3]?.message).toMatchObject({ index: 1 })
    expect(worker.messages[2]?.transfer).toHaveLength(1)
    expect(worker.terminate).toHaveBeenCalledOnce()
  })

  it("omits ComicInfo when disabled", async () => {
    await processArchiveFormatChapter(
      createRuntime(),
      archiveInput(createOptions("cbz"))
    )

    expect(
      workerState.instances[0]?.messages.some(
        ({ message }) => message.type === "addComicInfo"
      )
    ).toBe(false)
    expect(buildComicInfoMock).toHaveBeenCalledWith(
      expect.objectContaining({ includeComicInfo: false })
    )
  })

  it("propagates ComicInfo generation errors before image downloads and still terminates", async () => {
    const downloadImage = successfulImage()
    buildComicInfoMock.mockImplementationOnce(() => {
      throw new Error("invalid XML metadata")
    })

    await expect(
      processArchiveFormatChapter(
        createRuntime(),
        archiveInput(
          { ...createOptions("cbz"), includeComicInfo: true },
          downloadImage
        )
      )
    ).rejects.toThrow("invalid XML metadata")

    expect(downloadImage).not.toHaveBeenCalled()
    expect(workerState.instances[0]?.terminate).toHaveBeenCalledOnce()
  })

  it("rejects a worker error with its diagnostic location and terminates", async () => {
    workerState.finalizeBehavior = "error-event"

    await expect(
      processArchiveFormatChapter(
        createRuntime(),
        archiveInput(createOptions("cbz"))
      )
    ).rejects.toThrow("worker exploded (zip.worker.js:17:4)")

    expect(workerState.instances[0]?.terminate).toHaveBeenCalledOnce()
  })

  it("rejects an unsuccessful archive result after consulting memory statistics", async () => {
    workerState.finalizeBehavior = "failure"
    const runtime = createRuntime()
    vi.mocked(runtime.getMemoryStats).mockReturnValue({
      usedMB: 12,
      totalMB: 64,
      limitMB: 128,
    })

    await expect(
      processArchiveFormatChapter(runtime, archiveInput(createOptions("zip")))
    ).rejects.toThrow(
      "Archive creation failed: deflate failed (1/1 images, 0 failed)"
    )

    expect(runtime.getMemoryStats).toHaveBeenCalledOnce()
    expect(workerState.instances[0]?.terminate).toHaveBeenCalledOnce()
  })

  it("discards a partial archive and includes bounded image failure details", async () => {
    const downloadImage = vi.fn(async () => {
      throw new Error("HTTP 503")
    })

    const outcome = await processArchiveFormatChapter(
      createRuntime(),
      archiveInput(createOptions("cbz"), downloadImage)
    )

    expect(outcome).toEqual({
      status: "failed",
      errorMessage: expect.stringContaining(
        "1/1 images could not be downloaded"
      ),
      imagesFailed: 1,
    })
    expect(outcome.errorMessage).toContain("HTTP 503")
    expect(
      workerState.instances[0]?.messages.some(
        ({ message }) => message.type === "finalize"
      )
    ).toBe(false)
    expect(workerState.instances[0]?.terminate).toHaveBeenCalledOnce()
  })

  it("treats a malformed downloaded image as a failed image instead of finalizing", async () => {
    const malformedDownload = vi.fn(
      async () => null
    ) as unknown as ChapterDownloadImageFn

    const outcome = await processArchiveFormatChapter(
      createRuntime(),
      archiveInput(createOptions("cbz"), malformedDownload)
    )

    expect(outcome).toMatchObject({ status: "failed", imagesFailed: 1 })
    expect(
      workerState.instances[0]?.messages.some(
        ({ message }) => message.type === "finalize"
      )
    ).toBe(false)
  })

  it("supports an empty archive request without invoking the image downloader", async () => {
    const runtime = createRuntime()
    const downloadImage = successfulImage()
    const input = archiveInput(createOptions("cbz"), downloadImage)
    input.urls = []

    await expect(processArchiveFormatChapter(runtime, input)).resolves.toEqual({
      status: "completed",
      outputsRequested: 1,
      outputsFailedBeforeHandoff: 0,
      outputsCommitted: 0,
    })
    expect(downloadImage).not.toHaveBeenCalled()
    expect(workerState.instances[0]?.messages[0]?.message).toMatchObject({
      totalImages: 0,
    })
  })

  it("surfaces native download handoff failures and always terminates", async () => {
    const runtime = createRuntime()
    vi.mocked(runtime.requestBrowserBlobDownload).mockResolvedValue({
      success: false,
      error: "downloads permission denied",
    })

    await expect(
      processArchiveFormatChapter(runtime, archiveInput(createOptions("cbz")))
    ).rejects.toThrow("downloads permission denied")
    expect(workerState.instances[0]?.terminate).toHaveBeenCalledOnce()
  })

  it("uses the uniquify collision policy for a custom archive outcome", async () => {
    const runtime = createRuntime()
    const root = {} as FileSystemDirectoryHandle
    vi.mocked(runtime.resolveWritableDownloadRoot).mockResolvedValue(root)
    vi.mocked(writeBlobToPath).mockResolvedValue({ status: "written" })
    const opts = {
      ...createOptions("cbz"),
      downloadMode: "custom" as const,
      settingsSnapshot: {
        ...createOptions("cbz").settingsSnapshot,
        conflictPolicy: "uniquify" as const,
      },
    }

    await expect(
      processArchiveFormatChapter(runtime, archiveInput(opts))
    ).resolves.toEqual({
      status: "completed",
      outputsRequested: 1,
      outputsFailedBeforeHandoff: 0,
      outputsCommitted: 1,
    })
    expect(writeBlobToPath).toHaveBeenCalledWith(
      root,
      "Series/Chapter Edge.cbz",
      expect.any(Blob),
      "uniquify",
      expect.any(Object)
    )
    expect(runtime.requestBrowserBlobDownload).not.toHaveBeenCalled()
  })

  it("preserves a structured custom archive write failure without a Downloads retry", async () => {
    const runtime = createRuntime()
    vi.mocked(runtime.resolveWritableDownloadRoot).mockResolvedValue(
      {} as FileSystemDirectoryHandle
    )
    vi.mocked(writeBlobToPath).mockRejectedValue(new Error("disk full"))
    const opts = {
      ...createOptions("zip"),
      downloadMode: "custom" as const,
    }

    await expect(
      processArchiveFormatChapter(runtime, archiveInput(opts))
    ).rejects.toMatchObject({
      name: "FsaWriteError",
      category: "disk_full",
      message: "There is not enough disk space in the selected folder.",
    })
    expect(runtime.requestBrowserBlobDownload).not.toHaveBeenCalled()
  })

  it("blocks custom archive access before creating a worker", async () => {
    const runtime = createRuntime()
    vi.mocked(runtime.resolveWritableDownloadRoot).mockRejectedValue(
      new Error("permission expired")
    )
    const opts = {
      ...createOptions("cbz"),
      downloadMode: "custom" as const,
    }

    await expect(
      processArchiveFormatChapter(runtime, archiveInput(opts))
    ).rejects.toThrow("permission expired")
    expect(workerState.instances).toHaveLength(0)
  })

  it("preserves cancellation during custom archive preflight without falling back", async () => {
    const runtime = createRuntime()
    const controller = new AbortController()
    vi.mocked(runtime.resolveWritableDownloadRoot).mockImplementation(
      async () => {
        controller.abort()
        throw new Error("permission prompt interrupted")
      }
    )
    const opts = {
      ...createOptions("cbz"),
      downloadMode: "custom" as const,
      abortSignal: controller.signal,
    }

    await expect(
      processArchiveFormatChapter(runtime, archiveInput(opts))
    ).rejects.toThrow("job-cancelled")
  })

  it("uses a stable fallback error when the native handoff returns no response", async () => {
    const runtime = createRuntime()
    vi.mocked(runtime.requestBrowserBlobDownload).mockResolvedValue(undefined)

    await expect(
      processArchiveFormatChapter(runtime, archiveInput(createOptions("zip")))
    ).rejects.toThrow("background downloads.download failed")
  })

  it("does not retry a custom archive write after its abort signal fires", async () => {
    const runtime = createRuntime()
    const controller = new AbortController()
    vi.mocked(runtime.resolveWritableDownloadRoot).mockResolvedValue(
      {} as FileSystemDirectoryHandle
    )
    vi.mocked(writeBlobToPath).mockImplementation(async () => {
      controller.abort()
      throw new Error("write interrupted")
    })
    const opts = {
      ...createOptions("cbz"),
      downloadMode: "custom" as const,
      abortSignal: controller.signal,
    }

    await expect(
      processArchiveFormatChapter(runtime, archiveInput(opts))
    ).rejects.toThrow("job-cancelled")
  })

  it("removes the abort listener even when worker termination throws", async () => {
    workerState.terminateThrows = true
    const controller = new AbortController()
    const removeSpy = vi.spyOn(controller.signal, "removeEventListener")
    const opts = { ...createOptions("cbz"), abortSignal: controller.signal }

    await expect(
      processArchiveFormatChapter(createRuntime(), archiveInput(opts))
    ).resolves.toEqual({
      status: "completed",
      outputsRequested: 1,
      outputsFailedBeforeHandoff: 0,
      outputsCommitted: 0,
    })

    expect(removeSpy).toHaveBeenCalledWith("abort", expect.any(Function))
    expect(workerState.instances[0]?.terminate).toHaveBeenCalledOnce()
  })
})

describe("no-archive chapter edge cases", () => {
  it("does not create ComicInfo output when metadata is disabled", async () => {
    const runtime = createRuntime()

    await processNoneFormatChapter(runtime, noneInput(createOptions("none")))

    expect(runtime.requestBrowserBlobDownload).toHaveBeenCalledTimes(1)
    expect(buildComicInfoMock).not.toHaveBeenCalled()
  })

  it("counts cover and ComicInfo handoff failures alongside a successful page", async () => {
    const runtime = createRuntime()
    vi.mocked(runtime.requestBrowserBlobDownload).mockImplementation(
      async ({ filename }) =>
        filename.endsWith(".jpg") && !filename.includes("cover")
          ? { success: true }
          : { success: false, error: "handoff rejected" }
    )
    const opts = {
      ...createOptions("none"),
      includeComicInfo: true,
      coverImage: {
        data: new Uint8Array([4]).buffer,
        mimeType: "image/png",
      },
    }

    const outcome = await processNoneFormatChapter(runtime, noneInput(opts))

    expect(outcome).toEqual({
      status: "partial_success",
      errorMessage: "2/3 output files failed",
      imagesFailed: undefined,
      outputsRequested: 3,
      outputsFailedBeforeHandoff: 2,
      outputsCommitted: 0,
    })
    expect(
      vi
        .mocked(runtime.requestBrowserBlobDownload)
        .mock.calls.map(([request]) => request.filename)
    ).toEqual([
      "Series/Chapter Edge/000-cover.png",
      "Series/Chapter Edge/001.jpg",
      "Series/Chapter Edge/ComicInfo.xml",
    ])
  })

  it("propagates ComicInfo generation errors after handing off completed images", async () => {
    const runtime = createRuntime()
    buildComicInfoMock.mockImplementationOnce(() => {
      throw new Error("XML serialization failed")
    })

    await expect(
      processNoneFormatChapter(
        runtime,
        noneInput({ ...createOptions("none"), includeComicInfo: true })
      )
    ).rejects.toThrow("XML serialization failed")
    expect(runtime.requestBrowserBlobDownload).toHaveBeenCalledTimes(1)
  })

  it("returns a structured outcome when a custom page write fails after downloads have begun", async () => {
    const runtime = createRuntime()
    vi.mocked(runtime.resolveWritableDownloadRoot).mockResolvedValue(
      {} as FileSystemDirectoryHandle
    )
    vi.mocked(writeBlobToPath).mockRejectedValue(new Error("write failed"))
    const opts = {
      ...createOptions("none"),
      downloadMode: "custom" as const,
    }

    await expect(
      processNoneFormatChapter(runtime, noneInput(opts))
    ).resolves.toMatchObject({
      status: "failed",
      errorMessage: "Tako could not write to the selected folder.",
      errorCategory: "folder_write_failed",
      imagesFailed: 1,
      outputsRequested: 1,
      outputsCommitted: 0,
    })
    expect(runtime.requestBrowserBlobDownload).not.toHaveBeenCalled()
  })

  it("returns a structured custom cover write failure before downloading pages", async () => {
    const runtime = createRuntime()
    const downloadImage = successfulImage()
    vi.mocked(runtime.resolveWritableDownloadRoot).mockResolvedValue(
      {} as FileSystemDirectoryHandle
    )
    vi.mocked(writeBlobToPath).mockRejectedValue(
      new Error("cover write failed")
    )
    const opts = {
      ...createOptions("none"),
      downloadMode: "custom" as const,
      coverImage: {
        data: new Uint8Array([4]).buffer,
        mimeType: "image/png",
      },
    }

    await expect(
      processNoneFormatChapter(runtime, noneInput(opts, downloadImage))
    ).resolves.toEqual({
      status: "failed",
      errorMessage: "Tako could not write to the selected folder.",
      errorCategory: "folder_write_failed",
      imagesFailed: 1,
      outputsRequested: 2,
      outputsFailedBeforeHandoff: 0,
      outputsCommitted: 0,
    })
    expect(downloadImage).not.toHaveBeenCalled()
  })

  it("propagates a thrown browser cover handoff error", async () => {
    const runtime = createRuntime()
    const downloadImage = successfulImage()
    vi.mocked(runtime.requestBrowserBlobDownload).mockRejectedValue(
      new Error("runtime disconnected")
    )
    const opts = {
      ...createOptions("none"),
      coverImage: {
        data: new Uint8Array([4]).buffer,
        mimeType: "image/png",
      },
    }

    await expect(
      processNoneFormatChapter(runtime, noneInput(opts, downloadImage))
    ).rejects.toThrow("runtime disconnected")
    expect(downloadImage).not.toHaveBeenCalled()
  })

  it("reports partial success when one image download fails before handoff", async () => {
    const runtime = createRuntime()
    const downloadImage = vi.fn(async (url: string) => {
      if (url.endsWith("/1.jpg")) throw new Error("HTTP 404")
      return {
        filename: "second.jpg",
        data: new Uint8Array([2]).buffer,
        mimeType: "image/jpeg",
      }
    })
    const input = noneInput(createOptions("none"), downloadImage)
    input.urls = ["https://example.com/1.jpg", "https://example.com/2.jpg"]

    await expect(processNoneFormatChapter(runtime, input)).resolves.toEqual({
      status: "partial_success",
      errorMessage: "1/2 images failed",
      imagesFailed: 1,
      outputsRequested: 2,
      outputsFailedBeforeHandoff: 1,
      outputsCommitted: 0,
    })
    expect(runtime.requestBrowserBlobDownload).toHaveBeenCalledTimes(1)
  })

  it("preserves committed images when a custom ComicInfo write fails", async () => {
    const runtime = createRuntime()
    vi.mocked(runtime.resolveWritableDownloadRoot).mockResolvedValue(
      {} as FileSystemDirectoryHandle
    )
    vi.mocked(writeBlobToPath)
      .mockResolvedValueOnce({ status: "written" })
      .mockRejectedValueOnce(new Error("metadata write failed"))
    const opts = {
      ...createOptions("none"),
      includeComicInfo: true,
      downloadMode: "custom" as const,
    }

    await expect(
      processNoneFormatChapter(runtime, noneInput(opts))
    ).resolves.toEqual({
      status: "partial_success",
      errorMessage: "Tako could not write to the selected folder.",
      errorCategory: "folder_write_failed",
      imagesFailed: undefined,
      outputsRequested: 2,
      outputsFailedBeforeHandoff: 0,
      outputsCommitted: 1,
    })
    expect(writeBlobToPath).toHaveBeenCalledTimes(2)
    expect(runtime.requestBrowserBlobDownload).not.toHaveBeenCalled()
  })

  it("uses the uniquify policy for cover, image, and ComicInfo writes", async () => {
    const runtime = createRuntime()
    const root = {} as FileSystemDirectoryHandle
    vi.mocked(runtime.resolveWritableDownloadRoot).mockResolvedValue(root)
    vi.mocked(writeBlobToPath).mockResolvedValue({ status: "written" })
    const opts = {
      ...createOptions("none"),
      includeComicInfo: true,
      downloadMode: "custom" as const,
      coverImage: {
        data: new Uint8Array([4]).buffer,
        mimeType: "image/webp",
      },
      settingsSnapshot: {
        ...createOptions("none").settingsSnapshot,
        conflictPolicy: "uniquify" as const,
      },
    }

    await expect(
      processNoneFormatChapter(runtime, noneInput(opts))
    ).resolves.toEqual({
      status: "completed",
      outputsRequested: 3,
      outputsFailedBeforeHandoff: 0,
      outputsCommitted: 3,
    })
    expect(writeBlobToPath).toHaveBeenCalledTimes(3)
    expect(
      vi.mocked(writeBlobToPath).mock.calls.map((call) => [call[1], call[3]])
    ).toEqual([
      ["Series/Chapter Edge/000-cover.webp", "uniquify"],
      ["Series/Chapter Edge/001.jpg", "uniquify"],
      ["Series/Chapter Edge/ComicInfo.xml", "uniquify"],
    ])
  })

  it("reports all requested outputs failed when image, cover, and metadata handoffs fail", async () => {
    const runtime = createRuntime()
    vi.mocked(runtime.requestBrowserBlobDownload).mockResolvedValue({
      success: false,
      error: "handoff failed",
    })
    const opts = {
      ...createOptions("none"),
      includeComicInfo: true,
      coverImage: {
        data: new Uint8Array([4]).buffer,
        mimeType: "image/png",
      },
    }

    const outcome = await processNoneFormatChapter(runtime, noneInput(opts))

    expect(outcome).toEqual({
      status: "failed",
      errorMessage: "All output files failed (3/3)",
      imagesFailed: 1,
      outputsRequested: 3,
      outputsFailedBeforeHandoff: 3,
      outputsCommitted: 0,
    })
  })

  it("completes an empty no-archive request without creating output blobs", async () => {
    const runtime = createRuntime()
    const input = noneInput(createOptions("none"))
    input.urls = []

    await expect(processNoneFormatChapter(runtime, input)).resolves.toEqual({
      status: "completed",
      outputsRequested: 0,
      outputsFailedBeforeHandoff: 0,
      outputsCommitted: 0,
    })
    expect(runtime.requestBrowserBlobDownload).not.toHaveBeenCalled()
    expect(input.downloadImage).not.toHaveBeenCalled()
  })
})
