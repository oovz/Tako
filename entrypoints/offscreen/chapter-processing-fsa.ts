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
  beginFsaWrite: () => Promise<void>
  dir: FileSystemDirectoryHandle
  path: string
  blob: Blob
  collisionPolicy: ConflictPolicy
  signal?: AbortSignal
  onBytesWritten?: (bytesWritten: number) => void | Promise<void>
}): Promise<WriteBlobToPathResult> {
  try {
    await input.beginFsaWrite()
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
    directoryHandleId?: string
    abortSignal?: AbortSignal
  }
): Promise<FileSystemDirectoryHandle> {
  try {
    if (!input.directoryHandleId) {
      throw new Error("Custom folder is not configured")
    }
    return await runtime.resolveWritableDownloadRoot(input.directoryHandleId)
  } catch (error) {
    if (input.abortSignal?.aborted) {
      throw new Error("job-cancelled", { cause: error })
    }
    throw error
  }
}
