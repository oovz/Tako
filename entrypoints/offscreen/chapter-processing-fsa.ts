import type { Chapter } from "@/src/types/chapter"
import {
  writeBlobToPath,
  type WriteBlobToPathResult,
} from "@/src/storage/fs-access"
import type {
  ChapterProcessingRuntime,
  ProcessChapterStreamingOptions,
} from "./chapter-processing-types"
import { toFsaWriteError } from "./error-categories"

export type ConflictPolicy = "uniquify" | "overwrite"

export function getConflictPolicy(
  opts: ProcessChapterStreamingOptions
): ConflictPolicy {
  return opts.settingsSnapshot.conflictPolicy
}

export async function writeFsaOutput(input: {
  dir: FileSystemDirectoryHandle
  path: string
  blob: Blob
  collisionPolicy: ConflictPolicy
  signal?: AbortSignal
  onBytesWritten?: (bytesWritten: number) => void | Promise<void>
}): Promise<WriteBlobToPathResult> {
  try {
    return await writeBlobToPath(
      input.dir,
      input.path,
      input.blob,
      input.collisionPolicy,
      {
        signal: input.signal,
        onBytesWritten: input.onBytesWritten,
      }
    )
  } catch (error) {
    if (input.signal?.aborted) throw error
    throw toFsaWriteError(error)
  }
}

export async function resolveChapterWritableRoot(
  runtime: ChapterProcessingRuntime,
  input: {
    taskId: string
    chapter: Chapter
    totalImages: number
    abortSignal?: AbortSignal
  }
): Promise<FileSystemDirectoryHandle> {
  try {
    return await runtime.resolveWritableDownloadRoot({
      taskId: input.taskId,
      chapter: input.chapter,
      totalImages: input.totalImages,
    })
  } catch (error) {
    if (input.abortSignal?.aborted) {
      throw new Error("job-cancelled", { cause: error })
    }
    throw error
  }
}
