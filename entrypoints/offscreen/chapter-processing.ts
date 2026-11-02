import {
  NoneFormatChapterOutput,
  type NoneFormatChapterInput,
} from "./chapter-processing-none"
import {
  ArchiveFormatChapterOutput,
  type ArchiveFormatChapterInput,
} from "./chapter-processing-archive"
import type {
  ChapterOutcome,
  ChapterProcessingRuntime,
} from "./chapter-processing-types"

export type {
  ArchiveNormalizationSettings,
  BrowserBlobDownloadResponse,
  ChapterDownloadImageFn,
  ChapterDownloadImageResult,
  ChapterOutcome,
  ChapterOutcomeStatus,
  ChapterProcessingRuntime,
  ErrorCategory,
  ProcessChapterStreamingOptions,
  ProcessDownloadChapterSettingsSnapshot,
  WorkerZipProgress,
  WorkerZipResult,
} from "./chapter-processing-types"

export async function processNoneFormatChapter(
  runtime: ChapterProcessingRuntime,
  input: NoneFormatChapterInput
): Promise<ChapterOutcome> {
  return await new NoneFormatChapterOutput(runtime, input).run()
}

export async function processArchiveFormatChapter(
  runtime: ChapterProcessingRuntime,
  input: ArchiveFormatChapterInput
): Promise<ChapterOutcome> {
  return await new ArchiveFormatChapterOutput(runtime, input).run()
}
