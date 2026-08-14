import { describe, expect, it, vi } from "vitest"

import {
  processArchiveFormatChapter,
  processNoneFormatChapter,
  type ChapterDownloadImageFn,
  type ChapterProcessingRuntime,
  type ProcessChapterStreamingOptions,
} from "@/entrypoints/offscreen/chapter-processing"
import { createTaskSettingsSnapshot } from "@/src/runtime/settings-snapshot"
import * as comicInfoGenerator from "@/src/runtime/comicinfo-generator"
import { DEFAULT_SETTINGS } from "@/src/domain/settings/defaults"
import { writeBlobToPath } from "@/src/storage/fs-access"
import { OffscreenLiveResourceLedger } from "@/src/runtime/offscreen-live-resource-ledger"
import type { RateLimitService } from "@/src/runtime/rate-limit"

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

vi.mock("@/entrypoints/offscreen/archive-worker-factory", () => ({
  default: () =>
    new (class MockZipWorker {
      onmessage: ((event: MessageEvent<unknown>) => void) | null = null
      onerror: ((event: ErrorEvent) => void) | null = null
      private extension: "cbz" | "zip" = "cbz"

      postMessage(message: { type?: string; extension?: "cbz" | "zip" }) {
        if (message.type === "init" && message.extension) {
          this.extension = message.extension
        }

        if (message.type === "finalize") {
          this.onmessage?.({
            data: {
              success: true,
              filename: `Chapter 1.${this.extension}`,
              size: 4,
              buffer: new Uint8Array([0x50, 0x4b, 0x03, 0x04]).buffer,
              imageCount: 2,
              format: this.extension,
            },
          } as MessageEvent<unknown>)
        }
      }

      terminate() {
        // no-op
      }
    })(),
}))

const rateLimitService = {
  resolveEffectivePolicy: vi.fn(async () => ({ concurrency: 1, delayMs: 0 })),
  scheduleForIntegrationScope: vi.fn(
    async <T>(_integrationId: string, _scope: string, task: () => Promise<T>) =>
      task()
  ),
  cleanupRateLimiters: vi.fn(),
} as unknown as RateLimitService

function createRuntime(): ChapterProcessingRuntime {
  return {
    liveResourceLedger: new OffscreenLiveResourceLedger(),
    rateLimitService,
    withImageRetries: async (fn) => fn(),
    resolveWritableDownloadRoot: vi.fn(),
    requestBrowserBlobDownload: vi.fn(
      async () =>
        ({
          success: true,
          disposition: "tracked",
          phase: "waiting",
        }) as const
    ),
    getMemoryStats: vi.fn(() => null),
  }
}

function createDownloadImage(): ChapterDownloadImageFn {
  return vi.fn(async (url: string) => ({
    filename: url.endsWith("2.jpg") ? "page-2.jpg" : "page-1.jpg",
    data: new Uint8Array([1, 2, 3]).buffer,
    mimeType: "image/jpeg",
  }))
}

function createBaseOptions<TFormat extends "cbz" | "zip" | "none">(
  format: TFormat
): ProcessChapterStreamingOptions & { format: TFormat } {
  return {
    taskId: "task-1",
    jobId: "job-1",
    attempt: 1,
    chapter: {
      id: "chapter-1",
      title: "Chapter 1",
      url: "https://example.com/chapter-1",
      resolvedPath: `Series/Chapter 1${format === "none" ? "" : `.${format}`}`,
      comicInfo: {},
    },
    seriesTitle: "Series",
    format,
    includeComicInfo: false,
    downloadMode: "browser" as const,
    comicInfoVersion: "2.0" as const,
    onProgress: vi.fn(async () => undefined),
    onArchiveProgress: vi.fn(async () => undefined),
    abortSignal: new AbortController().signal,
    normalizeImageFilenames: true,
    imagePaddingDigits: 3 as const,
    settingsSnapshot: {
      ...createTaskSettingsSnapshot(DEFAULT_SETTINGS, "test-site"),
      archiveFormat: format,
      rateLimitSettings: {
        image: { concurrency: 2, delayMs: 0 },
        chapter: { concurrency: 1, delayMs: 0 },
      },
    },
  }
}

describe("chapter processing format contracts", () => {
  it.each([
    ["cbz", "application/x-cbz"],
    ["zip", "application/zip"],
  ] as const)(
    "creates one %s archive blob download with the correct filename and MIME type",
    async (format, mimeType) => {
      const runtime = createRuntime()
      const opts = createBaseOptions(format)

      const outcome = await processArchiveFormatChapter(runtime, {
        opts,
        urls: ["https://example.com/1.jpg", "https://example.com/2.jpg"],
        integrationId: "test-site",
        downloadImage: createDownloadImage(),
        normalizeSettings: {
          normalizeImageFilenames: true,
          imagePaddingDigits: 3,
        },
      })

      expect(outcome).toEqual({
        status: "completed",
        outputsRequested: 1,
        outputsFailedBeforeHandoff: 0,
        outputsCommitted: 0,
      })
      expect(runtime.requestBrowserBlobDownload).toHaveBeenCalledTimes(1)
      expect(runtime.requestBrowserBlobDownload).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: "task-1",
          chapterId: "chapter-1",
          filename: `Series/Chapter 1.${format}`,
          blob: expect.any(Blob),
        })
      )
      const blob = vi.mocked(runtime.requestBrowserBlobDownload).mock
        .calls[0]?.[0].blob
      expect(blob?.type).toBe(mimeType)
      expect(opts.onArchiveProgress).not.toHaveBeenCalledWith(
        5,
        "starting archive"
      )
      expect(opts.onArchiveProgress).toHaveBeenCalledWith(90, "finalizing")
    }
  )

  it("honors the collision policy when writing an archive to a custom folder", async () => {
    const runtime = createRuntime()
    const writableRoot = {} as FileSystemDirectoryHandle
    vi.mocked(runtime.resolveWritableDownloadRoot).mockResolvedValue(
      writableRoot
    )
    vi.mocked(writeBlobToPath).mockClear()
    const opts = {
      ...createBaseOptions("cbz"),
      downloadMode: "custom" as const,
      settingsSnapshot: {
        ...createBaseOptions("cbz").settingsSnapshot,
        conflictPolicy: "overwrite" as const,
      },
    }

    const outcome = await processArchiveFormatChapter(runtime, {
      opts,
      urls: ["https://example.com/1.jpg", "https://example.com/2.jpg"],
      integrationId: "test-site",
      downloadImage: createDownloadImage(),
      normalizeSettings: {
        normalizeImageFilenames: true,
        imagePaddingDigits: 3,
      },
    })

    expect(outcome).toEqual({
      status: "completed",
      outputsRequested: 1,
      outputsFailedBeforeHandoff: 0,
      outputsCommitted: 1,
    })
    expect(writeBlobToPath).toHaveBeenCalledWith(
      writableRoot,
      "Series/Chapter 1.cbz",
      expect.any(Blob),
      "overwrite",
      expect.objectContaining({ signal: opts.abortSignal })
    )
    expect(runtime.requestBrowserBlobDownload).not.toHaveBeenCalled()
  })

  it("streams no-archive browser downloads as separate image files under the chapter folder", async () => {
    const runtime = createRuntime()

    const outcome = await processNoneFormatChapter(runtime, {
      opts: createBaseOptions("none"),
      urls: ["https://example.com/1.jpg", "https://example.com/2.jpg"],
      integrationId: "test-site",
      downloadImage: createDownloadImage(),
      normalizeSettings: {
        normalizeImageFilenames: true,
        imagePaddingDigits: 3,
      },
    })

    expect(outcome).toEqual({
      status: "completed",
      outputsRequested: 2,
      outputsFailedBeforeHandoff: 0,
      outputsCommitted: 0,
    })
    expect(runtime.requestBrowserBlobDownload).toHaveBeenCalledTimes(2)
    expect(
      vi
        .mocked(runtime.requestBrowserBlobDownload)
        .mock.calls.map((call) => call[0].filename)
    ).toEqual(["Series/Chapter 1/001.jpg", "Series/Chapter 1/002.jpg"])
  })

  it("uses the exact emitted output count when optional ComicInfo generation returns null", async () => {
    vi.spyOn(comicInfoGenerator, "generateComicInfo").mockReturnValueOnce(null)
    const runtime = createRuntime()

    const outcome = await processNoneFormatChapter(runtime, {
      opts: {
        ...createBaseOptions("none"),
        includeComicInfo: true,
      },
      urls: ["https://example.com/1.jpg", "https://example.com/2.jpg"],
      integrationId: "test-site",
      downloadImage: createDownloadImage(),
      normalizeSettings: {
        normalizeImageFilenames: true,
        imagePaddingDigits: 3,
      },
    })

    expect(outcome).toEqual({
      status: "completed",
      outputsRequested: 2,
      outputsFailedBeforeHandoff: 0,
      outputsCommitted: 0,
    })
    expect(runtime.requestBrowserBlobDownload).toHaveBeenCalledTimes(2)
    expect(
      vi
        .mocked(runtime.requestBrowserBlobDownload)
        .mock.calls.map((call) => call[0].outputCount)
    ).toEqual([2, 2])
    expect(
      vi
        .mocked(runtime.requestBrowserBlobDownload)
        .mock.calls.some((call) => call[0].filename.endsWith("/ComicInfo.xml"))
    ).toBe(false)
  })

  it("hands off each no-archive browser image without waiting for later images", async () => {
    const runtime = createRuntime()
    let resolveSecond!: (
      value: Awaited<ReturnType<ChapterDownloadImageFn>>
    ) => void
    const secondImage = new Promise<
      Awaited<ReturnType<ChapterDownloadImageFn>>
    >((resolve) => {
      resolveSecond = resolve
    })
    const downloadImage = vi.fn(async (url: string) => {
      if (url.endsWith("2.jpg")) return secondImage
      return {
        filename: "page-1.jpg",
        data: new Uint8Array([1]).buffer,
        mimeType: "image/jpeg",
      }
    })

    const processing = processNoneFormatChapter(runtime, {
      opts: createBaseOptions("none"),
      urls: ["https://example.com/1.jpg", "https://example.com/2.jpg"],
      integrationId: "test-site",
      downloadImage,
      normalizeSettings: {
        normalizeImageFilenames: true,
        imagePaddingDigits: 3,
      },
    })

    await vi.waitFor(() => expect(downloadImage).toHaveBeenCalledTimes(2))
    await vi.waitFor(() =>
      expect(runtime.requestBrowserBlobDownload).toHaveBeenCalledTimes(1)
    )

    resolveSecond({
      filename: "page-2.jpg",
      data: new Uint8Array([2]).buffer,
      mimeType: "image/jpeg",
    })
    await expect(processing).resolves.toEqual({
      status: "completed",
      outputsRequested: 2,
      outputsFailedBeforeHandoff: 0,
      outputsCommitted: 0,
    })
  })

  it("blocks a custom-folder chapter before downloading no-archive images", async () => {
    const runtime = createRuntime()
    vi.mocked(runtime.resolveWritableDownloadRoot).mockRejectedValue(
      new Error("Custom folder permission is required")
    )
    const downloadImage = createDownloadImage()

    await expect(
      processNoneFormatChapter(runtime, {
        opts: {
          ...createBaseOptions("none"),
          downloadMode: "custom",
        },
        urls: ["https://example.com/1.jpg"],
        integrationId: "test-site",
        downloadImage,
        normalizeSettings: {
          normalizeImageFilenames: true,
          imagePaddingDigits: 3,
        },
      })
    ).rejects.toThrow("Custom folder permission is required")

    expect(downloadImage).not.toHaveBeenCalled()
  })

  it("uses the FSA uniquify policy for a no-archive output", async () => {
    const runtime = createRuntime()
    vi.mocked(runtime.resolveWritableDownloadRoot).mockResolvedValue(
      {} as FileSystemDirectoryHandle
    )
    vi.mocked(writeBlobToPath).mockResolvedValue({ status: "written" })

    const outcome = await processNoneFormatChapter(runtime, {
      opts: {
        ...createBaseOptions("none"),
        downloadMode: "custom",
        settingsSnapshot: {
          ...createBaseOptions("none").settingsSnapshot,
          conflictPolicy: "uniquify",
        },
      },
      urls: ["https://example.com/1.jpg"],
      integrationId: "test-site",
      downloadImage: createDownloadImage(),
      normalizeSettings: {
        normalizeImageFilenames: true,
        imagePaddingDigits: 3,
      },
    })

    expect(outcome).toEqual({
      status: "completed",
      outputsRequested: 1,
      outputsFailedBeforeHandoff: 0,
      outputsCommitted: 1,
    })
    expect(writeBlobToPath).toHaveBeenCalledWith(
      expect.anything(),
      "Series/Chapter 1/001.jpg",
      expect.any(Blob),
      "uniquify",
      expect.any(Object)
    )
    expect(runtime.requestBrowserBlobDownload).not.toHaveBeenCalled()
  })

  it("does not emit an FSA fallback when cancellation interrupts a write", async () => {
    const runtime = createRuntime()
    const controller = new AbortController()
    vi.mocked(runtime.resolveWritableDownloadRoot).mockResolvedValue(
      {} as FileSystemDirectoryHandle
    )
    vi.mocked(writeBlobToPath).mockImplementationOnce(async () => {
      controller.abort()
      throw new Error("job-cancelled")
    })

    await expect(
      processNoneFormatChapter(runtime, {
        opts: {
          ...createBaseOptions("none"),
          downloadMode: "custom",
          abortSignal: controller.signal,
        },
        urls: ["https://example.com/1.jpg"],
        integrationId: "test-site",
        downloadImage: createDownloadImage(),
        normalizeSettings: {
          normalizeImageFilenames: true,
          imagePaddingDigits: 3,
        },
      })
    ).rejects.toThrow("job-cancelled")
  })

  it("preserves committed image accounting when FSA permission is lost mid-chapter", async () => {
    const runtime = createRuntime()
    const permissionError = Object.assign(new Error("write rejected"), {
      name: "NotAllowedError",
    })
    vi.mocked(runtime.resolveWritableDownloadRoot).mockResolvedValue(
      {} as FileSystemDirectoryHandle
    )
    vi.mocked(writeBlobToPath)
      .mockReset()
      .mockResolvedValueOnce({ status: "written" })
      .mockRejectedValueOnce(permissionError)
    const downloadImage = createDownloadImage()

    const outcome = await processNoneFormatChapter(runtime, {
      opts: {
        ...createBaseOptions("none"),
        downloadMode: "custom",
        settingsSnapshot: {
          ...createBaseOptions("none").settingsSnapshot,
          rateLimitSettings: {
            image: { concurrency: 1, delayMs: 0 },
            chapter: { concurrency: 1, delayMs: 0 },
          },
        },
      },
      urls: [
        "https://example.com/1.jpg",
        "https://example.com/2.jpg",
        "https://example.com/3.jpg",
      ],
      integrationId: "test-site",
      downloadImage,
      normalizeSettings: {
        normalizeImageFilenames: true,
        imagePaddingDigits: 3,
      },
    })

    expect(outcome).toEqual({
      status: "partial_success",
      errorMessage: "Access to the selected folder is required.",
      errorCategory: "folder_permission_required",
      imagesFailed: 2,
      outputsRequested: 3,
      outputsFailedBeforeHandoff: 0,
      outputsCommitted: 1,
    })
    expect(downloadImage).toHaveBeenCalledTimes(2)
    expect(writeBlobToPath).toHaveBeenCalledTimes(2)
  })

  it("returns a structured generic FSA write failure instead of losing output counts", async () => {
    const runtime = createRuntime()
    vi.mocked(runtime.resolveWritableDownloadRoot).mockResolvedValue(
      {} as FileSystemDirectoryHandle
    )
    vi.mocked(writeBlobToPath)
      .mockReset()
      .mockRejectedValueOnce(new Error("opaque operating system error"))

    const outcome = await processNoneFormatChapter(runtime, {
      opts: {
        ...createBaseOptions("none"),
        downloadMode: "custom",
        settingsSnapshot: {
          ...createBaseOptions("none").settingsSnapshot,
          rateLimitSettings: {
            image: { concurrency: 1, delayMs: 0 },
            chapter: { concurrency: 1, delayMs: 0 },
          },
        },
      },
      urls: ["https://example.com/1.jpg", "https://example.com/2.jpg"],
      integrationId: "test-site",
      downloadImage: createDownloadImage(),
      normalizeSettings: {
        normalizeImageFilenames: true,
        imagePaddingDigits: 3,
      },
    })

    expect(outcome).toEqual({
      status: "failed",
      errorMessage: "Tako could not write to the selected folder.",
      errorCategory: "folder_write_failed",
      imagesFailed: 2,
      outputsRequested: 2,
      outputsFailedBeforeHandoff: 0,
      outputsCommitted: 0,
    })
  })

  it("reports disk-full metadata failure without discarding committed images", async () => {
    const runtime = createRuntime()
    const diskFullError = Object.assign(new Error("write rejected"), {
      name: "QuotaExceededError",
    })
    vi.mocked(runtime.resolveWritableDownloadRoot).mockResolvedValue(
      {} as FileSystemDirectoryHandle
    )
    vi.mocked(writeBlobToPath)
      .mockReset()
      .mockResolvedValueOnce({ status: "written" })
      .mockResolvedValueOnce({ status: "written" })
      .mockRejectedValueOnce(diskFullError)

    const outcome = await processNoneFormatChapter(runtime, {
      opts: {
        ...createBaseOptions("none"),
        downloadMode: "custom",
        includeComicInfo: true,
        settingsSnapshot: {
          ...createBaseOptions("none").settingsSnapshot,
          rateLimitSettings: {
            image: { concurrency: 1, delayMs: 0 },
            chapter: { concurrency: 1, delayMs: 0 },
          },
        },
      },
      urls: ["https://example.com/1.jpg", "https://example.com/2.jpg"],
      integrationId: "test-site",
      downloadImage: createDownloadImage(),
      normalizeSettings: {
        normalizeImageFilenames: true,
        imagePaddingDigits: 3,
      },
    })

    expect(outcome).toEqual({
      status: "partial_success",
      errorMessage: "There is not enough disk space in the selected folder.",
      errorCategory: "disk_full",
      imagesFailed: undefined,
      outputsRequested: 3,
      outputsFailedBeforeHandoff: 0,
      outputsCommitted: 2,
    })
  })

  it("reports partial success when one no-archive page handoff fails", async () => {
    const runtime = createRuntime()
    vi.mocked(runtime.requestBrowserBlobDownload)
      .mockResolvedValueOnce({
        success: true,
        disposition: "tracked",
        phase: "waiting",
      })
      .mockResolvedValueOnce({
        success: true,
        disposition: "not_persisted",
        reason: "download rejected",
      })

    const outcome = await processNoneFormatChapter(runtime, {
      opts: createBaseOptions("none"),
      urls: ["https://example.com/1.jpg", "https://example.com/2.jpg"],
      integrationId: "test-site",
      downloadImage: createDownloadImage(),
      normalizeSettings: {
        normalizeImageFilenames: true,
        imagePaddingDigits: 3,
      },
    })

    expect(outcome).toEqual({
      status: "partial_success",
      errorMessage: "1/2 images failed",
      imagesFailed: 1,
      outputsRequested: 2,
      outputsFailedBeforeHandoff: 1,
      outputsCommitted: 0,
    })
  })

  it("stops no-archive handoffs when cancellation arrives between files", async () => {
    const runtime = createRuntime()
    const controller = new AbortController()
    vi.mocked(runtime.requestBrowserBlobDownload).mockImplementationOnce(
      async () => {
        controller.abort()
        return {
          success: true,
          disposition: "tracked",
          phase: "waiting",
        }
      }
    )

    await expect(
      processNoneFormatChapter(runtime, {
        opts: {
          ...createBaseOptions("none"),
          abortSignal: controller.signal,
          settingsSnapshot: {
            ...createBaseOptions("none").settingsSnapshot,
            rateLimitSettings: {
              image: { concurrency: 1, delayMs: 0 },
              chapter: { concurrency: 1, delayMs: 0 },
            },
          },
        },
        urls: ["https://example.com/1.jpg", "https://example.com/2.jpg"],
        integrationId: "test-site",
        downloadImage: createDownloadImage(),
        normalizeSettings: {
          normalizeImageFilenames: true,
          imagePaddingDigits: 3,
        },
      })
    ).rejects.toThrow("job-cancelled")

    expect(runtime.requestBrowserBlobDownload).toHaveBeenCalledTimes(1)
    expect(runtime.requestBrowserBlobDownload).toHaveBeenCalledWith(
      expect.objectContaining({ signal: controller.signal })
    )
  })

  it("reports failure when every no-archive page handoff fails", async () => {
    const runtime = createRuntime()
    vi.mocked(runtime.requestBrowserBlobDownload).mockResolvedValue({
      success: true,
      disposition: "not_persisted",
      reason: "download rejected",
    })

    const outcome = await processNoneFormatChapter(runtime, {
      opts: createBaseOptions("none"),
      urls: ["https://example.com/1.jpg", "https://example.com/2.jpg"],
      integrationId: "test-site",
      downloadImage: createDownloadImage(),
      normalizeSettings: {
        normalizeImageFilenames: true,
        imagePaddingDigits: 3,
      },
    })

    expect(outcome).toEqual({
      status: "failed",
      errorMessage: "All images failed (2/2)",
      imagesFailed: 2,
      outputsRequested: 2,
      outputsFailedBeforeHandoff: 2,
      outputsCommitted: 0,
    })
  })

  it("reports partial success when an explicitly requested metadata handoff fails", async () => {
    const runtime = createRuntime()
    vi.mocked(runtime.requestBrowserBlobDownload).mockImplementation(
      async ({ filename }) =>
        filename.endsWith("/ComicInfo.xml")
          ? {
              success: true,
              disposition: "not_persisted",
              reason: "download rejected",
            }
          : {
              success: true,
              disposition: "tracked",
              phase: "waiting",
            }
    )

    const outcome = await processNoneFormatChapter(runtime, {
      opts: {
        ...createBaseOptions("none"),
        includeComicInfo: true,
      },
      urls: ["https://example.com/1.jpg", "https://example.com/2.jpg"],
      integrationId: "test-site",
      downloadImage: createDownloadImage(),
      normalizeSettings: {
        normalizeImageFilenames: true,
        imagePaddingDigits: 3,
      },
    })

    expect(outcome).toEqual({
      status: "partial_success",
      errorMessage: "1/3 output files failed",
      imagesFailed: undefined,
      outputsRequested: 3,
      outputsFailedBeforeHandoff: 1,
      outputsCommitted: 0,
    })
  })
})
