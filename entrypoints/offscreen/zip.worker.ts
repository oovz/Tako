// Web Worker: create ZIP/CBZ archives from images and metadata using fflate streaming
// Runs CPU-heavy zipping off the main offscreen thread with streaming compression.
import { Zip, ZipDeflate, ZipPassThrough, strToU8 } from "fflate"
import { normalizeImageFilename } from "@/src/shared/filename-sanitizer"
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
  isFinalized: boolean
  chapterTitle?: string
  extension?: "cbz" | "zip"
  imageCount: number
  compressedBytes: number
  maxArchiveBytes: number
  resourceLimitFailed: boolean
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

export function installZipWorkerRuntime(scope: ZipWorkerRuntimeScope): void {
  const streamState: StreamingState = {
    chunks: [],
    isFinalized: false,
    imageCount: 0,
    compressedBytes: 0,
    maxArchiveBytes: MAX_ARCHIVE_BYTES,
    resourceLimitFailed: false,
    chunkCount: 0,
    normalizeImageFilenames: false,
    imagePaddingDigits: "auto",
    totalImages: 0,
  }

  const post = (message: ZipWorkerResponse, transfer?: Transferable[]) => {
    scope.postMessage(message, transfer)
  }

  const ensureZip = (): Zip => {
    if (!streamState.zip) {
      streamState.zip = new Zip()
      streamState.zip.ondata = (err, chunk, final) => {
        if (streamState.resourceLimitFailed) return
        if (err) {
          post({
            success: false,
            error: err.message || "ZIP compression error",
          })
          return
        }
        const nextCompressedBytes =
          streamState.compressedBytes + chunk.byteLength
        if (nextCompressedBytes > streamState.maxArchiveBytes) {
          streamState.resourceLimitFailed = true
          streamState.chunks = []
          post({
            success: false,
            error: `Archive size exceeds ${streamState.maxArchiveBytes} byte limit (got at least ${nextCompressedBytes})`,
          })
          return
        }
        streamState.compressedBytes = nextCompressedBytes
        streamState.chunks.push(chunk)
        streamState.chunkCount += 1
        post({
          type: "progress",
          bytes: streamState.compressedBytes,
          chunks: streamState.chunkCount,
          final,
        })
        if (final) {
          const totalLength = streamState.chunks.reduce(
            (sum, chunk) => sum + chunk.length,
            0
          )
          const finalBuffer = new Uint8Array(totalLength)
          let offset = 0
          for (const chunk of streamState.chunks) {
            finalBuffer.set(chunk, offset)
            offset += chunk.length
          }
          const filename = `${streamState.chapterTitle || "chapter"}.${streamState.extension || "cbz"}`
          const buffer = finalBuffer.buffer
          streamState.chunks = []
          const response: ZipWorkerResponse = {
            success: true,
            filename,
            size: buffer.byteLength,
            buffer,
            imageCount: streamState.imageCount,
            format: streamState.extension || "cbz",
          }
          post(response, [buffer])
          streamState.isFinalized = true
        }
      }
    }
    return streamState.zip
  }

  const resetState = () => {
    streamState.zip = undefined
    streamState.chunks = []
    streamState.isFinalized = false
    streamState.chapterTitle = undefined
    streamState.extension = undefined
    streamState.imageCount = 0
    streamState.compressedBytes = 0
    streamState.maxArchiveBytes = MAX_ARCHIVE_BYTES
    streamState.resourceLimitFailed = false
    streamState.chunkCount = 0
    streamState.normalizeImageFilenames = false
    streamState.imagePaddingDigits = "auto"
    streamState.totalImages = 0
  }

  scope.addEventListener("error", (event) => {
    const location = event.filename
      ? ` (${event.filename}:${event.lineno}:${event.colno})`
      : ""
    const error =
      event.error instanceof Error
        ? event.error
        : new Error(`${event.message || "Unhandled worker error"}${location}`)
    post({
      success: false,
      error: formatWorkerError(error, "Zip worker global error"),
    })
    event.preventDefault()
  })

  scope.addEventListener("unhandledrejection", (event) => {
    post({
      success: false,
      error: formatWorkerError(event.reason, "Zip worker unhandled rejection"),
    })
    event.preventDefault()
  })

  scope.onmessage = (event) => {
    const message = event.data
    try {
      switch (message.type) {
        case "reset":
          resetState()
          return
        case "init": {
          resetState()
          streamState.chapterTitle = message.chapterTitle
          streamState.extension = message.extension
          streamState.normalizeImageFilenames =
            message.normalizeImageFilenames ?? false
          streamState.imagePaddingDigits = message.imagePaddingDigits ?? "auto"
          streamState.totalImages = message.totalImages ?? 0
          streamState.maxArchiveBytes =
            message.maxArchiveBytes ?? MAX_ARCHIVE_BYTES
          ensureZip()
          return
        }
        case "addComicInfo": {
          if (streamState.resourceLimitFailed) return
          const zip = ensureZip()
          const stream = new ZipDeflate("ComicInfo.xml", { level: 6 })
          zip.add(stream)
          stream.push(strToU8(message.xml), true)
          return
        }
        case "addImage": {
          if (streamState.resourceLimitFailed) return
          const zip = ensureZip()
          const bytes = new Uint8Array(message.buffer)
          if (bytes.byteLength === 0) {
            if (message.inputId) {
              post({ type: "input-consumed", inputId: message.inputId })
            }
            return
          }

          let filename = message.filename
          if (
            streamState.normalizeImageFilenames &&
            message.index !== undefined &&
            message.mimeType
          ) {
            filename = normalizeImageFilename(
              message.index,
              streamState.totalImages,
              message.mimeType,
              streamState.imagePaddingDigits
            )
          }

          const image = new ZipPassThrough(filename)
          zip.add(image)
          image.push(bytes, true)
          streamState.imageCount += 1
          if (message.inputId) {
            post({ type: "input-consumed", inputId: message.inputId })
          }
          return
        }
        case "finalize":
          if (streamState.resourceLimitFailed) return
          ensureZip().end()
          return
      }
    } catch (error) {
      post({
        success: false,
        error: formatWorkerError(error, `Zip worker ${message.type}`),
      })
    }
  }
}
