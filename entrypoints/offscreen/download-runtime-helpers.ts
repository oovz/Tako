import logger from '@/src/runtime/logger'
import { siteIntegrationRegistry } from '@/src/runtime/site-integration-registry'
import { scheduleForIntegrationScope } from '@/src/runtime/rate-limit'
import type { RateLimitPolicySnapshot } from '@/src/runtime/rate-limit'
import { loadDownloadRootHandle, verifyPermission } from '@/src/storage/fs-access'
import { sendThrottledDownloadApiRequest } from './helpers'
import type { ChapterDownloadImageResult } from './chapter-processing'

export type CoverImageAsset = {
  data: ArrayBuffer
  mimeType: string
}

type ImageRetryHooks = { onAttemptStart?: (attempt: number) => void | Promise<void> }

export async function prefetchCoverImage(input: {
  coverUrl?: string
  integrationId?: string
  integrationContext?: Record<string, unknown>
  rateLimitSettings?: RateLimitPolicySnapshot
  signal?: AbortSignal
  onActivity?: () => void | Promise<void>
  withImageRetries: <T>(fn: () => Promise<T>, hooks?: ImageRetryHooks) => Promise<T>
}): Promise<CoverImageAsset | undefined> {
  const { coverUrl, integrationId, integrationContext, rateLimitSettings, signal, onActivity, withImageRetries } = input
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
        scheduleForIntegrationScope(integrationId, 'image', () =>
          OffscreenIntegration.chapter.downloadImage(coverUrl, {
            signal,
            onBytesReceived: reportActivity,
            context: {
              ...(integrationContext ?? {}),
              ...(rateLimitSettings ? { rateLimitSettings } : {}),
            },
          }),
          rateLimitSettings?.image,
        ),
      {
        onAttemptStart: reportActivity,
      },
    )
    return { data: result.data, mimeType: result.mimeType }
  } catch (error) {
    logger.debug('Single chapter cover image fetch failed (non-fatal):', error)
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
  withImageRetries: <T>(fn: () => Promise<T>, hooks?: ImageRetryHooks) => Promise<T>
}): Promise<CoverImageAsset | undefined> {
  const { includeCoverImage = true, coverUrl, integrationId, integrationContext, rateLimitSettings, signal, onActivity, withImageRetries } = input
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

export async function resolveWritableDownloadRoot(input: {
  onFallback: () => Promise<void>
}): Promise<FileSystemDirectoryHandle | null> {
  const { onFallback } = input
  const dir = await loadDownloadRootHandle()
  if (!dir) {
    await onFallback()
    return null
  }

  if (!(await verifyPermission(dir, true))) {
    await onFallback()
    return null
  }

  return dir
}

export function requestBrowserBlobDownload(input: {
  taskId: string
  chapterId: string
  blob: Blob
  filename: string
}): Promise<Awaited<ReturnType<typeof sendThrottledDownloadApiRequest>>> {
  const { taskId, chapterId, blob, filename } = input
  const fileUrl = URL.createObjectURL(blob)
  return sendThrottledDownloadApiRequest({
    taskId,
    chapterId,
    fileUrl,
    filename,
  })
}
