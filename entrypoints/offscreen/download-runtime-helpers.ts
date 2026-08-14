import logger from "@/src/runtime/logger"
import { offscreenSiteAdaptersById } from "@/src/runtime/generated/site-integration-offscreen-registry"
import type {
  RateLimitPolicySnapshot,
  RateLimitService,
} from "@/src/runtime/rate-limit"
import {
  loadDownloadRootHandle,
  queryFsaPermission,
} from "@/src/storage/fs-access"
import { sendDownloadApiRequest } from "./helpers"
import type { ChapterDownloadImageResult } from "./chapter-processing"
import type {
  OffscreenLiveResourceLedger,
  OffscreenLiveResourceLease,
} from "@/src/runtime/offscreen-live-resource-ledger"
import { OffscreenLiveResourceLimitError } from "@/src/runtime/offscreen-live-resource-ledger"
import type { JsonObject } from "@/src/types/site-integrations"

export type CoverImageAsset = {
  data: ArrayBuffer
  mimeType: string
  liveResourceLease?: OffscreenLiveResourceLease
}

type ImageRetryHooks = {
  onAttemptStart?: (attempt: number) => void | Promise<void>
}

export async function prefetchCoverImage(input: {
  coverUrl?: string
  integrationId?: string
  integrationContext?: JsonObject
  rateLimitSettings: RateLimitPolicySnapshot
  rateLimitService: RateLimitService
  signal?: AbortSignal
  onActivity?: () => void | Promise<void>
  withImageRetries: <T>(
    fn: () => Promise<T>,
    hooks?: ImageRetryHooks
  ) => Promise<T>
  liveResourceLedger: OffscreenLiveResourceLedger
}): Promise<CoverImageAsset | undefined> {
  const {
    coverUrl,
    integrationId,
    integrationContext,
    rateLimitSettings,
    rateLimitService,
    signal,
    onActivity,
    withImageRetries,
    liveResourceLedger,
  } = input
  if (!coverUrl || !integrationId) {
    return undefined
  }

  try {
    const OffscreenIntegration =
      offscreenSiteAdaptersById[integrationId]?.offscreen
    if (!OffscreenIntegration) {
      return undefined
    }
    const reportActivity = async () => {
      await onActivity?.()
    }
    const downloadCoverImage =
      OffscreenIntegration.cover?.downloadImage ??
      OffscreenIntegration.chapter.downloadImage
    const result = await withImageRetries<ChapterDownloadImageResult>(
      () =>
        rateLimitService.scheduleForIntegrationScope(
          integrationId,
          "image",
          () =>
            downloadCoverImage(coverUrl, {
              signal,
              skipRateLimit: true,
              onBytesReceived: reportActivity,
              liveResourceLedger,
              dispatchContext: integrationContext,
              runtime: { rateLimitSettings, rateLimitService },
            }),
          rateLimitSettings.image
        ),
      {
        onAttemptStart: reportActivity,
      }
    )
    return {
      data: result.data,
      mimeType: result.mimeType,
      liveResourceLease: result.liveResourceLease,
    }
  } catch (error) {
    if (error instanceof OffscreenLiveResourceLimitError) throw error
    logger.debug("Single chapter cover image fetch failed (non-fatal):", error)
    return undefined
  }
}

export async function prefetchOptionalCoverImage(input: {
  includeCoverImage?: boolean
  coverUrl?: string
  integrationId?: string
  integrationContext?: JsonObject
  rateLimitSettings: RateLimitPolicySnapshot
  rateLimitService: RateLimitService
  signal?: AbortSignal
  onActivity?: () => void | Promise<void>
  withImageRetries: <T>(
    fn: () => Promise<T>,
    hooks?: ImageRetryHooks
  ) => Promise<T>
  liveResourceLedger: OffscreenLiveResourceLedger
}): Promise<CoverImageAsset | undefined> {
  const {
    includeCoverImage = true,
    coverUrl,
    integrationId,
    integrationContext,
    rateLimitSettings,
    rateLimitService,
    signal,
    onActivity,
    withImageRetries,
    liveResourceLedger,
  } = input
  if (!includeCoverImage) {
    return undefined
  }

  return await prefetchCoverImage({
    coverUrl,
    integrationId,
    integrationContext,
    rateLimitSettings,
    rateLimitService,
    signal,
    onActivity,
    withImageRetries,
    liveResourceLedger,
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
  fingerprint: string
  documentInstanceId: string
  fileUrl: string
  filename: string
  outputIndex: number
  outputCount: number
  outputKind: "archive" | "image"
  signal: AbortSignal
}): Promise<Awaited<ReturnType<typeof sendDownloadApiRequest>>> {
  const {
    jobId,
    attempt,
    outputId,
    taskId,
    chapterId,
    fingerprint,
    documentInstanceId,
    fileUrl,
    filename,
    outputIndex,
    outputCount,
    outputKind,
    signal,
  } = input
  if (signal.aborted) {
    throw new Error("job-cancelled")
  }
  const payload = {
    jobId,
    attempt,
    outputId,
    taskId,
    chapterId,
    fingerprint,
    documentInstanceId,
    fileUrl,
    filename,
    outputIndex,
    outputCount,
    outputKind,
  } as const
  return await sendDownloadApiRequest(payload, signal)
}
