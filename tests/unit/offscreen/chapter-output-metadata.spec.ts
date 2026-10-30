import { afterEach, describe, expect, it, vi } from "vitest"
import { strFromU8, unzipSync } from "fflate"
import { Window } from "happy-dom"

import {
  processArchiveFormatChapter,
  processNoneFormatChapter,
  type ChapterDownloadImageFn,
  type ChapterProcessingRuntime,
  type ProcessChapterStreamingOptions,
} from "@/entrypoints/offscreen/chapter-processing"
import {
  installZipWorkerRuntime,
  type ZipWorkerRuntimeScope,
} from "@/entrypoints/offscreen/zip.worker"
import { DEFAULT_SETTINGS } from "@/src/domain/settings/defaults"
import { OffscreenLiveResourceLedger } from "@/src/runtime/offscreen-live-resource-ledger"
import { RateLimitService } from "@/src/runtime/rate-limit"
import { createTaskSettingsSnapshot } from "@/src/runtime/settings-snapshot"

vi.mock("@/entrypoints/offscreen/archive-worker-factory", () => ({
  default: () => new InProcessArchiveWorker(),
}))

class InProcessArchiveWorker {
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  private readonly scope: ZipWorkerRuntimeScope = {
    onmessage: null,
    addEventListener: () => {},
    postMessage: (message, transfer = []) => {
      const data = structuredClone(message, { transfer })
      this.onmessage?.(new MessageEvent("message", { data }))
    },
  }

  constructor() {
    installZipWorkerRuntime(this.scope)
  }

  postMessage(
    message: Parameters<
      NonNullable<ZipWorkerRuntimeScope["onmessage"]>
    >[0]["data"],
    transfer: Transferable[] = []
  ): void {
    const data = structuredClone(message, { transfer })
    this.scope.onmessage?.(new MessageEvent("message", { data }))
  }

  terminate(): void {
    this.scope.onmessage = null
  }
}

const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII="
const imageBytes = () =>
  Uint8Array.from(atob(PNG_BASE64), (character) => character.charCodeAt(0))
    .buffer
const URLS = ["https://images.example/1.png", "https://images.example/2.png"]
const POLICY = {
  image: { concurrency: 1, delayMs: 0 },
  chapter: { concurrency: 1, delayMs: 0 },
}

describe("chapter artifact metadata and browser output identities", () => {
  const schedulers: RateLimitService[] = []

  afterEach(() => {
    for (const scheduler of schedulers.splice(0)) {
      scheduler.cleanupRateLimiters()
    }
  })

  function createHarness<TFormat extends "cbz" | "none">(
    format: TFormat,
    includeCover: boolean
  ) {
    const ledger = new OffscreenLiveResourceLedger()
    const rateLimitService = new RateLimitService({
      resolveEffectivePolicy: async () => POLICY.image,
    })
    schedulers.push(rateLimitService)
    const requestBrowserBlobDownload = vi.fn<
      ChapterProcessingRuntime["requestBrowserBlobDownload"]
    >(async () => ({
      success: true,
      disposition: "tracked",
      phase: "waiting",
    }))
    const runtime: ChapterProcessingRuntime = {
      liveResourceLedger: ledger,
      rateLimitService,
      withImageRetries: async (fn) => fn(),
      beginFsaWrite: async () => {},
      resolveWritableDownloadRoot: vi.fn(),
      requestBrowserBlobDownload,
      getMemoryStats: () => null,
    }
    const coverData = includeCover ? imageBytes() : undefined
    const opts: ProcessChapterStreamingOptions & { format: TFormat } = {
      taskId: "task-1",
      jobId: "job-1",
      attempt: 1,
      chapter: {
        id: "chapter-1",
        title: "Chapter 1",
        url: "https://example.com/chapter-1",
        resolvedPath: `Series/Chapter 1${format === "none" ? "" : ".cbz"}`,
        comicInfo: {},
      },
      seriesTitle: "Series",
      format,
      includeComicInfo: true,
      downloadMode: "browser",
      comicInfoVersion: "2.0",
      onProgress: async () => {},
      onArchiveProgress: async () => {},
      abortSignal: new AbortController().signal,
      coverImage: coverData
        ? {
            data: coverData,
            mimeType: "image/png",
            liveResourceLease: ledger.reserve(coverData.byteLength, "cover"),
          }
        : undefined,
      settingsSnapshot: {
        ...createTaskSettingsSnapshot(DEFAULT_SETTINGS, "mycomic"),
        archiveFormat: format,
        normalizeImageFilenames: true,
        imagePaddingDigits: 3,
        rateLimitSettings: POLICY,
      },
    }
    const downloadImage: ChapterDownloadImageFn = async (url, options) => {
      const data = imageBytes()
      return {
        filename: url.slice(url.lastIndexOf("/") + 1),
        data,
        mimeType: "image/png",
        liveResourceLease: options.liveResourceLedger.reserve(
          data.byteLength,
          "page"
        ),
      }
    }
    return { opts, runtime, requestBrowserBlobDownload, downloadImage, ledger }
  }

  it.each([
    ["cbz", false],
    ["cbz", true],
    ["none", false],
    ["none", true],
  ] as const)(
    "emits %s metadata and output identities with cover=%s",
    async (format, includeCover) => {
      const harness = createHarness(format, includeCover)
      const { opts, runtime, requestBrowserBlobDownload, downloadImage } =
        harness
      const common = {
        urls: URLS,
        integrationId: "mycomic",
        downloadImage,
        normalizeSettings: {
          normalizeImageFilenames: true,
          imagePaddingDigits: 3 as const,
        },
      }
      try {
        const outcome =
          opts.format === "cbz"
            ? await processArchiveFormatChapter(runtime, {
                ...common,
                opts: { ...opts, format: "cbz" },
              })
            : await processNoneFormatChapter(runtime, {
                ...common,
                opts: { ...opts, format: "none" },
              })
        const outputs = requestBrowserBlobDownload.mock.calls.map(
          ([output]) => output
        )
        expect(outcome.status).toBe("completed")
        for (const output of outputs) {
          expect(output).toMatchObject({
            jobId: opts.jobId,
            attempt: opts.attempt,
            taskId: opts.taskId,
            chapterId: opts.chapter.id,
          })
        }
        let xml: string
        if (format === "cbz") {
          expect(outputs).toHaveLength(1)
          expect(outputs[0]).toMatchObject({
            outputId: "job-1:archive:0",
            outputIndex: 0,
            outputCount: 1,
            outputKind: "archive",
          })
          const entries = unzipSync(
            new Uint8Array(await outputs[0].blob.arrayBuffer())
          )
          expect(
            Object.keys(entries).filter((name) => name !== "ComicInfo.xml")
          ).toHaveLength(URLS.length + Number(includeCover))
          xml = strFromU8(entries["ComicInfo.xml"])
        } else {
          const count = URLS.length + Number(includeCover) + 1
          expect(outputs).toHaveLength(count)
          expect(new Set(outputs.map((output) => output.outputId)).size).toBe(
            count
          )
          expect(outputs.map((output) => output.outputIndex)).toEqual(
            Array.from({ length: count }, (_, index) => index)
          )
          expect(outputs.every((output) => output.outputCount === count)).toBe(
            true
          )
          const metadata = outputs.find((output) =>
            output.filename.endsWith("/ComicInfo.xml")
          )
          expect(metadata).toBeDefined()
          expect(metadata!.blob.type).toBe("application/xml")
          for (const image of outputs.filter((output) => output !== metadata)) {
            expect(image.blob.type).toBe("image/png")
          }
          xml = await metadata!.blob.text()
        }
        const window = new Window()
        try {
          const document = new window.DOMParser().parseFromString(
            xml,
            "application/xml"
          )
          expect(document.documentElement.tagName).toBe("ComicInfo")
          expect(
            document.getElementsByTagName("PageCount")[0]?.textContent
          ).toBe(String(URLS.length + Number(includeCover)))
          const pages = Array.from(document.getElementsByTagName("Page"))
          expect(pages.map((page) => page.getAttribute("Image"))).toEqual(
            includeCover ? ["0", "1", "2"] : []
          )
          expect(pages.map((page) => page.getAttribute("Type"))).toEqual(
            includeCover ? ["FrontCover", null, null] : []
          )
        } finally {
          await window.happyDOM.close()
        }
      } finally {
        opts.coverImage?.liveResourceLease.release()
      }
      expect(harness.ledger.getUsedBytes()).toBe(0)
    }
  )

  it("preserves Japanese right-to-left reading order in archived ComicInfo", async () => {
    const harness = createHarness("cbz", false)
    harness.opts.seriesMetadata = { language: "ja", readingDirection: "rtl" }

    const outcome = await processArchiveFormatChapter(harness.runtime, {
      opts: harness.opts,
      urls: URLS,
      integrationId: "mycomic",
      downloadImage: harness.downloadImage,
      normalizeSettings: {
        normalizeImageFilenames: true,
        imagePaddingDigits: 3,
      },
    })

    expect(outcome.status).toBe("completed")
    expect(harness.requestBrowserBlobDownload).toHaveBeenCalledTimes(1)
    const [[output]] = harness.requestBrowserBlobDownload.mock.calls
    const entries = unzipSync(new Uint8Array(await output.blob.arrayBuffer()))
    const window = new Window()
    try {
      const document = new window.DOMParser().parseFromString(
        strFromU8(entries["ComicInfo.xml"]),
        "application/xml"
      )
      expect(document.getElementsByTagName("Manga")[0]?.textContent).toBe(
        "YesAndRightToLeft"
      )
    } finally {
      await window.happyDOM.close()
    }
    expect(harness.ledger.getUsedBytes()).toBe(0)
  })
})
