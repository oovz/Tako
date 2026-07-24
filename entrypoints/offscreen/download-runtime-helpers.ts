import logger from "@/src/runtime/logger"
import { siteIntegrationRegistry } from "@/src/runtime/site-integration-registry"
import { scheduleForIntegrationScope } from "@/src/runtime/rate-limit"
import type { RateLimitPolicySnapshot } from "@/src/runtime/rate-limit"
import {
  loadDownloadRootHandle,
  queryFsaPermission,
} from "@/src/storage/fs-access"
import { sendDownloadApiRequest } from "./helpers"
import type { ChapterDownloadImageResult } from "./chapter-processing"

export type CoverImageAsset = {
  data: ArrayBuffer
  mimeType: string
}

type ImageRetryHooks = {
  onAttemptStart?: (attempt: number) => void | Promise<void>
}

export async function prefetchCoverImage(input: {
  coverUrl?: string
  integrationId?: string
  integrationContext?: Record<string, unknown>
  rateLimitSettings?: RateLimitPolicySnapshot
  signal?: AbortSignal
  onActivity?: () => void | Promise<void>
  withImageRetries: <T>(
    fn: () => Promise<T>,
    hooks?: ImageRetryHooks
  ) => Promise<T>
}): Promise<CoverImageAsset | undefined> {
  const {
    coverUrl,
    integrationId,
    integrationContext,
    rateLimitSettings,
    signal,
    onActivity,
    withImageRetries,
  } = input
  if (!coverUrl || !integrationId) {
    return undefined
  }

  try {
    const integrationInfo = siteIntegrationRegistry.findById(integrationId)
    if (!integrationInfo?.integration) {
      return undefined
    }

    const OffscreenIntegration = integrationInfo.integration.offscreen
    if (!OffscreenIntegration) {
      return undefined
    }
    const reportActivity = async () => {
      await onActivity?.()
    }
    const result = await withImageRetries<ChapterDownloadImageResult>(
      () =>
        scheduleForIntegrationScope(
          integrationId,
          "image",
          () =>
            OffscreenIntegration.chapter.downloadImage(coverUrl, {
              signal,
              onBytesReceived: reportActivity,
              context: {
                ...(integrationContext ?? {}),
                ...(rateLimitSettings ? { rateLimitSettings } : {}),
              },
            }),
          rateLimitSettings?.image
        ),
      {
        onAttemptStart: reportActivity,
      }
    )
    return { data: result.data, mimeType: result.mimeType }
  } catch (error) {
    logger.debug("Single chapter cover image fetch failed (non-fatal):", error)
    return undefined
  }
}

export async function prefetchOptionalCoverImage(input: {
  includeCoverImage?: boolean
  coverUrl?: string
  integrationId?: string
  integrationContext?: Record<string, unknown>
  rateLimitSettings?: RateLimitPolicySnapshot
  signal?: AbortSignal
  onActivity?: () => void | Promise<void>
  withImageRetries: <T>(
    fn: () => Promise<T>,
    hooks?: ImageRetryHooks
  ) => Promise<T>
}): Promise<CoverImageAsset | undefined> {
  const {
    includeCoverImage = true,
    coverUrl,
    integrationId,
    integrationContext,
    rateLimitSettings,
    signal,
    onActivity,
    withImageRetries,
  } = input
  if (!includeCoverImage) {
    return undefined
  }

  return await prefetchCoverImage({
    coverUrl,
    integrationId,
    integrationContext,
    rateLimitSettings,
    signal,
    onActivity,
    withImageRetries,
  })
}

export async function resolveWritableDownloadRoot(_input?: {
  taskId?: string
  chapter?: unknown
  totalImages?: number
}): Promise<FileSystemDirectoryHandle> {
  void _input
  const dir = await loadDownloadRootHandle()
  if (!dir) {
    throw new Error("Custom folder is not configured")
  }

  const permission = await queryFsaPermission(dir, true)
  if (permission !== "granted") {
    throw new Error(
      permission === "prompt"
        ? "Custom folder permission is required"
        : "Custom folder is unavailable"
    )
  }

  return dir
}

export async function requestBrowserBlobDownload(input: {
  jobId: string
  attempt: number
  outputId: string
  taskId: string
  chapterId: string
  blob: Blob
  filename: string
  outputIndex: number
  outputCount: number
  outputKind: "archive" | "image"
  signal?: AbortSignal
}): Promise<Awaited<ReturnType<typeof sendDownloadApiRequest>>> {
  const {
    jobId,
    attempt,
    outputId,
    taskId,
    chapterId,
    blob,
    filename,
    outputIndex,
    outputCount,
    outputKind,
    signal,
  } = input
  if (signal?.aborted) {
    throw new Error("job-cancelled")
  }
  const fileUrl = URL.createObjectURL(blob)
  // A runtime transport failure is ambiguous: the Service Worker may have
  // already called downloads.download() and died before returning the
  // acceptance response. Rejections therefore leave the Blob alive for the
  // identity-bound replay or durable pending-output recovery to reconcile.
  const response = await sendDownloadApiRequest(
    {
      jobId,
      attempt,
      outputId,
      taskId,
      chapterId,
      fileUrl,
      filename,
      outputIndex,
      outputCount,
      outputKind,
    },
    signal
  )

  if (!response.success) {
    URL.revokeObjectURL(fileUrl)
  }

  return response
}
