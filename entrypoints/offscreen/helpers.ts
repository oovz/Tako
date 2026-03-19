import type { Chapter } from '@/src/types/chapter'
import type { ComicInfoV2 } from '@/src/types/comic-info'
import { buildSeriesComicInfoBase } from '@/src/shared/chapter-metadata'
import type {
  OffscreenDownloadApiRequestMessage,
  OffscreenDownloadApiRequestResponse,
  OffscreenDownloadChapterMessage,
} from '@/src/types/offscreen-messages'

const OFFSCREEN_DOWNLOAD_API_THROTTLE_MS = 250
let lastDownloadApiRequestAt = 0

export type SeriesMetadataInput = OffscreenDownloadChapterMessage['payload']['book']['metadata']

export function buildComicInfoMetadata(input: {
  chapter: Chapter
  seriesTitle: string
  seriesMetadata?: SeriesMetadataInput
  pageCount: number
  hasCoverImage: boolean
}): ComicInfoV2 {
  const { chapter, seriesTitle, seriesMetadata, pageCount, hasCoverImage } = input
  const metadata: ComicInfoV2 = {
    ...buildSeriesComicInfoBase(seriesTitle, seriesMetadata),
    Title: chapter.title,
    Series: seriesTitle,
    Number: chapter.chapterLabel ?? chapter.chapterNumber?.toString(),
    Volume: chapter.volumeNumber,
    LanguageISO: chapter.language ?? seriesMetadata?.language,
    Web: chapter.url,
    PageCount: pageCount,
  }

  if (hasCoverImage && pageCount > 0) {
    metadata.Pages = Array.from({ length: pageCount }, (_, index) => ({
      Image: index,
      Type: index === 0 ? 'FrontCover' : undefined,
    }))
  }

  return metadata
}

export async function sendThrottledDownloadApiRequest(
  payload: OffscreenDownloadApiRequestMessage['payload'],
): Promise<OffscreenDownloadApiRequestResponse> {
  const now = Date.now()
  const elapsed = now - lastDownloadApiRequestAt

  if (elapsed < OFFSCREEN_DOWNLOAD_API_THROTTLE_MS) {
    await new Promise((resolve) => setTimeout(resolve, OFFSCREEN_DOWNLOAD_API_THROTTLE_MS - elapsed))
  }

  lastDownloadApiRequestAt = Date.now()
  return chrome.runtime.sendMessage<OffscreenDownloadApiRequestMessage, OffscreenDownloadApiRequestResponse>({
    type: 'OFFSCREEN_DOWNLOAD_API_REQUEST',
    payload,
  })
}

