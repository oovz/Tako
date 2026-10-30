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

type NoneFormatCounts = {
  downloadMode: "browser" | "custom"
  totalImages: number
  failedImages: number
  totalAdditionalOutputs?: number
  failedAdditionalOutputs?: number
}

type NoneFormatFailures = NoneFormatCounts & {
  totalOutputs: number
  failedOutputs: number
}

function describeNoneFormatFailures(
  input: NoneFormatFailures,
  partial: boolean
): string {
  if ((input.totalAdditionalOutputs ?? 0) > 0) {
    return partial
      ? `${input.failedOutputs}/${input.totalOutputs} output files failed`
      : `All output files failed (${input.failedOutputs}/${input.totalOutputs})`
  }
  return partial
    ? `${input.failedImages}/${input.totalImages} images failed`
    : `All images failed (${input.failedImages}/${input.totalImages})`
}

function createNoneFormatFailureOutcome(
  input: NoneFormatFailures
): ChapterOutcome {
  const succeededOutputs = input.totalOutputs - input.failedOutputs
  const partial = succeededOutputs > 0
  if (partial) {
    logger.warn(
      `Partial success (${input.downloadMode}): ${succeededOutputs} succeeded, ${input.failedOutputs} failed`
    )
  }
  return {
    status: partial ? "partial_success" : "failed",
    errorMessage: describeNoneFormatFailures(input, partial),
    imagesFailed: input.failedImages || undefined,
    outputsRequested: input.totalOutputs,
    outputsFailedBeforeHandoff:
      input.downloadMode === "browser" ? input.failedOutputs : 0,
    outputsCommitted:
      input.downloadMode === "custom" && partial ? succeededOutputs : 0,
  }
}

export function createNoneFormatChapterOutcome(
  input: NoneFormatCounts
): ChapterOutcome {
  const totalOutputs = input.totalImages + (input.totalAdditionalOutputs ?? 0)
  const failedOutputs =
    input.failedImages + (input.failedAdditionalOutputs ?? 0)
  if (failedOutputs > 0) {
    return createNoneFormatFailureOutcome({
      ...input,
      totalOutputs,
      failedOutputs,
    })
  }
  return {
    status: "completed",
    outputsRequested: totalOutputs,
    outputsFailedBeforeHandoff: 0,
    outputsCommitted: input.downloadMode === "custom" ? totalOutputs : 0,
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
