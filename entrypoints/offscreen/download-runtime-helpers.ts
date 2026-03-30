import logger from '@/src/runtime/logger'
import { siteIntegrationRegistry } from '@/src/runtime/site-integration-registry'
import { scheduleForIntegrationScope } from '@/src/runtime/rate-limit'
import { loadDownloadRootHandle, verifyPermission } from '@/src/storage/fs-access'
import { sendThrottledDownloadApiRequest } from './helpers'
import type { ChapterDownloadImageResult } from './chapter-processing'

export type CoverImageAsset = {
  data: ArrayBuffer
  mimeType: string
}

export async function prefetchCoverImage(input: {
  coverUrl?: string
  integrationId?: string
  integrationContext?: Record<string, unknown>
  withImageRetries: <T>(fn: () => Promise<T>) => Promise<T>
}): Promise<CoverImageAsset | undefined> {
  const { coverUrl, integrationId, integrationContext, withImageRetries } = input
  if (!coverUrl || !integrationId) {
    return undefined
  }

  try {
    const integrationInfo = siteIntegrationRegistry.findById(integrationId)
    if (!integrationInfo?.integration) {
      return undefined
    }

    const backgroundIntegration = integrationInfo.integration.background
    const result = await withImageRetries<ChapterDownloadImageResult>(() =>
      scheduleForIntegrationScope(integrationId, 'image', () =>
        backgroundIntegration.chapter.downloadImage(coverUrl, {
          context: integrationContext,
        }),
      ),
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
  withImageRetries: <T>(fn: () => Promise<T>) => Promise<T>
}): Promise<CoverImageAsset | undefined> {
  const { includeCoverImage = true, coverUrl, integrationId, integrationContext, withImageRetries } = input
  if (!includeCoverImage) {
    return undefined
  }

  return await prefetchCoverImage({
    coverUrl,
    integrationId,
    integrationContext,
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
