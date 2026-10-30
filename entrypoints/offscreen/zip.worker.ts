// Web Worker: create ZIP/CBZ archives from images and metadata using fflate streaming
// Runs CPU-heavy zipping off the main offscreen thread with streaming compression.
import { Zip, ZipDeflate, ZipPassThrough, strToU8 } from "fflate"
import { normalizeImageFilename } from "@/src/shared/filename-sanitizer"
import { assertNonemptyImagePayload } from "@/src/shared/site-integration-utils"
import { MAX_ARCHIVE_BYTES } from "@/src/constants/timeouts"

// Message-based streaming protocol used by the offscreen archive pipeline.
type InitMsg = {
  type: "init"
  chapterTitle: string
  extension: "cbz" | "zip"
  // Image filename normalization settings
  normalizeImageFilenames?: boolean
  imagePaddingDigits?: "auto" | 2 | 3 | 4 | 5
  totalImages?: number // Required if normalization enabled
  maxArchiveBytes?: number
}
type AddComicInfoMsg = { type: "addComicInfo"; xml: string }
type AddImageMsg = {
  type: "addImage"
  inputId?: string
  filename: string
  buffer: ArrayBuffer
  // Additional data for normalization
  index?: number // Image index (0-based)
  mimeType?: string // Image MIME type for extension detection
}
type FinalizeMsg = { type: "finalize" }
type ResetMsg = { type: "reset" }

type InboundMsg =
  InitMsg | AddComicInfoMsg | AddImageMsg | FinalizeMsg | ResetMsg

export type ZipWorkerResponse =
  | { type: "input-consumed"; inputId: string }
  | {
      type: "progress"
      bytes: number
      chunks: number
      final: boolean
    }
  | {
      success: true
      filename: string
      size: number
      buffer: ArrayBuffer // transferable
      imageCount: number
      format: "cbz" | "zip"
    }
  | { success: false; error: string }

interface StreamingState {
  zip?: Zip
  chunks: Uint8Array[]
  chapterTitle?: string
  extension?: "cbz" | "zip"
  imageCount: number
  compressedBytes: number
  maxArchiveBytes: number
  failed: boolean
  chunkCount: number
  // Normalization state
  normalizeImageFilenames: boolean
  imagePaddingDigits: "auto" | 2 | 3 | 4 | 5
  totalImages: number
}

export interface ZipWorkerRuntimeScope {
  postMessage(message: ZipWorkerResponse, transfer?: Transferable[]): void
  addEventListener(type: "error", listener: (event: ErrorEvent) => void): void
  addEventListener(
    type: "unhandledrejection",
    listener: (event: PromiseRejectionEvent) => void
  ): void
  onmessage: ((event: MessageEvent<InboundMsg>) => void) | null
}

function formatWorkerError(error: unknown, context: string): string {
  if (error instanceof Error) {
    return `${context}: ${error.name}: ${error.message}${error.stack ? `\n${error.stack}` : ""}`
  }

  if (typeof error === "string" && error.length > 0) {
    return `${context}: ${error}`
  }

  return `${context}: ${String(error)}`
}

function createStreamingState(): StreamingState {
  return {
    chunks: [],
    imageCount: 0,
    compressedBytes: 0,
    maxArchiveBytes: MAX_ARCHIVE_BYTES,
    failed: false,
    chunkCount: 0,
    normalizeImageFilenames: false,
    imagePaddingDigits: "auto",
    totalImages: 0,
  }
}

class ZipArchiveRuntime {
  private state = createStreamingState()

  constructor(private readonly scope: ZipWorkerRuntimeScope) {
    scope.addEventListener("error", (event) => this.handleGlobalError(event))
    scope.addEventListener("unhandledrejection", (event) => {
      this.post({
        success: false,
        error: formatWorkerError(
          event.reason,
          "Zip worker unhandled rejection"
        ),
      })
      event.preventDefault()
    })
    scope.onmessage = (event) => this.handleMessage(event.data)
  }

  private post(message: ZipWorkerResponse, transfer?: Transferable[]): void {
    this.scope.postMessage(message, transfer)
  }

  private ensureZip(): Zip {
    if (!this.state.zip) {
      this.state.zip = new Zip()
      this.state.zip.ondata = (error, chunk, final) =>
        this.acceptChunk(error, chunk, final)
    }
    return this.state.zip
  }

  private fail(error: string): void {
    this.state.failed = true
    this.state.chunks = []
    this.post({ success: false, error })
  }

  private acceptChunk(
    error: Error | null,
    chunk: Uint8Array,
    final: boolean
  ): void {
    if (this.state.failed) return
    if (error) {
      this.fail(error.message || "ZIP compression error")
      return
    }
    const nextBytes = this.state.compressedBytes + chunk.byteLength
    if (nextBytes > this.state.maxArchiveBytes) {
      this.fail(
        `Archive size exceeds ${this.state.maxArchiveBytes} byte limit (got at least ${nextBytes})`
      )
      return
    }
    this.state.compressedBytes = nextBytes
    this.state.chunks.push(chunk)
    this.state.chunkCount += 1
    this.post({
      type: "progress",
      bytes: nextBytes,
      chunks: this.state.chunkCount,
      final,
    })
    if (final) this.finishArchive()
  }

  private finishArchive(): void {
    const totalLength = this.state.chunks.reduce(
      (sum, chunk) => sum + chunk.length,
      0
    )
    const finalBuffer = new Uint8Array(totalLength)
    let offset = 0
    for (const chunk of this.state.chunks) {
      finalBuffer.set(chunk, offset)
      offset += chunk.length
    }
    const format = this.state.extension || "cbz"
    const filename = `${this.state.chapterTitle || "chapter"}.${format}`
    const buffer = finalBuffer.buffer
    this.state.chunks = []
    this.post(
      {
        success: true,
        filename,
        size: buffer.byteLength,
        buffer,
        imageCount: this.state.imageCount,
        format,
      },
      [buffer]
    )
  }

  private initialize(message: InitMsg): void {
    this.state = createStreamingState()
    this.state.chapterTitle = message.chapterTitle
    this.state.extension = message.extension
    this.state.normalizeImageFilenames =
      message.normalizeImageFilenames ?? false
    this.state.imagePaddingDigits = message.imagePaddingDigits ?? "auto"
    this.state.totalImages = message.totalImages ?? 0
    this.state.maxArchiveBytes = message.maxArchiveBytes ?? MAX_ARCHIVE_BYTES
    this.ensureZip()
  }

  private addComicInfo(message: AddComicInfoMsg): void {
    if (this.state.failed) return
    const zip = this.ensureZip()
    const stream = new ZipDeflate("ComicInfo.xml", { level: 6 })
    zip.add(stream)
    stream.push(strToU8(message.xml), true)
  }

  private addImage(message: AddImageMsg): void {
    if (this.state.failed) return
    const zip = this.ensureZip()
    const bytes = new Uint8Array(message.buffer)
    assertNonemptyImagePayload(message.buffer)
    let filename = message.filename
    if (
      this.state.normalizeImageFilenames &&
      message.index !== undefined &&
      message.mimeType
    ) {
      filename = normalizeImageFilename(
        message.index,
        this.state.totalImages,
        message.mimeType,
        this.state.imagePaddingDigits
      )
    }
    const image = new ZipPassThrough(filename)
    zip.add(image)
    image.push(bytes, true)
    this.state.imageCount += 1
    if (message.inputId)
      this.post({ type: "input-consumed", inputId: message.inputId })
  }

  private handleGlobalError(event: ErrorEvent): void {
    const location = event.filename
      ? ` (${event.filename}:${event.lineno}:${event.colno})`
      : ""
    const error =
      event.error instanceof Error
        ? event.error
        : new Error(`${event.message || "Unhandled worker error"}${location}`)
    this.post({
      success: false,
      error: formatWorkerError(error, "Zip worker global error"),
    })
    event.preventDefault()
  }

  private handleMessage(message: InboundMsg): void {
    try {
      switch (message.type) {
        case "reset":
          this.state = createStreamingState()
          return
        case "init":
          this.initialize(message)
          return
        case "addComicInfo":
          this.addComicInfo(message)
          return
        case "addImage":
          this.addImage(message)
          return
        case "finalize":
          if (!this.state.failed) this.ensureZip().end()
          return
      }
    } catch (error) {
      this.fail(formatWorkerError(error, `Zip worker ${message.type}`))
    }
  }
}

export function installZipWorkerRuntime(scope: ZipWorkerRuntimeScope): void {
  new ZipArchiveRuntime(scope)
}
