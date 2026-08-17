import logger from "@/src/runtime/logger"
import type {
  BrowserBlobDownloadResponse,
  ChapterOutcome,
} from "./chapter-processing-types"
import type { FsaWriteError } from "./error-categories"

export function requireNativeOutputDisposition(
  response: BrowserBlobDownloadResponse
): Extract<NonNullable<BrowserBlobDownloadResponse>, { success: true }> {
  if (!response) {
    throw new Error("Native output ownership response was not delivered")
  }
  if (response.success !== true) {
    throw new Error(response.error)
  }
  return response
}

export function createNoneFormatChapterOutcome(input: {
  downloadMode: "browser" | "custom"
  totalImages: number
  failedImages: number
  totalAdditionalOutputs?: number
  failedAdditionalOutputs?: number
}): ChapterOutcome {
  const {
    downloadMode,
    totalImages,
    failedImages,
    totalAdditionalOutputs = 0,
    failedAdditionalOutputs = 0,
  } = input
  const totalOutputs = totalImages + totalAdditionalOutputs
  const failedOutputs = failedImages + failedAdditionalOutputs

  if (failedOutputs > 0) {
    const succeededOutputs = totalOutputs - failedOutputs
    if (succeededOutputs > 0) {
      logger.warn(
        `Partial success (${downloadMode}): ${succeededOutputs} succeeded, ${failedOutputs} failed`
      )
      return {
        status: "partial_success",
        errorMessage:
          totalAdditionalOutputs > 0
            ? `${failedOutputs}/${totalOutputs} output files failed`
            : `${failedImages}/${totalImages} images failed`,
        imagesFailed: failedImages || undefined,
        outputsRequested: totalOutputs,
        outputsFailedBeforeHandoff:
          downloadMode === "browser" ? failedOutputs : 0,
        outputsCommitted: downloadMode === "custom" ? succeededOutputs : 0,
      }
    }

    return {
      status: "failed",
      errorMessage:
        totalAdditionalOutputs > 0
          ? `All output files failed (${failedOutputs}/${totalOutputs})`
          : `All images failed (${failedImages}/${totalImages})`,
      imagesFailed: failedImages || undefined,
      outputsRequested: totalOutputs,
      outputsFailedBeforeHandoff:
        downloadMode === "browser" ? failedOutputs : 0,
      outputsCommitted: 0,
    }
  }

  return {
    status: "completed",
    outputsRequested: totalOutputs,
    outputsFailedBeforeHandoff: 0,
    outputsCommitted: downloadMode === "custom" ? totalOutputs : 0,
  }
}

export function createFsaDestinationFailureOutcome(input: {
  error: FsaWriteError
  outputsRequested: number
  outputsCommitted: number
  totalImages: number
  committedImages: number
}): ChapterOutcome {
  const imagesFailed = Math.max(0, input.totalImages - input.committedImages)
  return {
    status: input.outputsCommitted > 0 ? "partial_success" : "failed",
    errorMessage: input.error.message,
    errorCategory: input.error.category,
    imagesFailed: imagesFailed || undefined,
    outputsRequested: input.outputsRequested,
    outputsFailedBeforeHandoff: 0,
    outputsCommitted: input.outputsCommitted,
  }
}
