import type { Chapter } from "@/src/types/chapter"
import type { ComicInfoV2 } from "@/src/types/comic-info"
import { buildSeriesComicInfoBase } from "@/src/shared/chapter-metadata"
import type {
  OffscreenOutputReadyMessage,
  OffscreenOutputReadyResponse,
} from "@/src/types/offscreen-messages"
import type { SeriesMetadataSnapshot } from "@/src/types/state-snapshots"

function throwIfDownloadRequestAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new Error("job-cancelled")
  }
}

/**
 * Consumer-side type for series metadata passed to ComicInfo generation.
 *
 * The wire format (Zod-validated) is `Record<string, unknown> | undefined`;
 * callers narrow to this type before passing it in. See
 * `createProcessChapterStreamingOptions` in `download-request-mappers.ts`.
 */
export type SeriesMetadataInput = SeriesMetadataSnapshot | undefined

export function buildComicInfoMetadata(input: {
  chapter: Chapter
  seriesTitle: string
  seriesMetadata?: SeriesMetadataInput
  pageCount: number
  hasCoverImage: boolean
}): ComicInfoV2 {
  const { chapter, seriesTitle, seriesMetadata, pageCount, hasCoverImage } =
    input
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
      Type: index === 0 ? "FrontCover" : undefined,
    }))
  }

  return metadata
}

export async function sendDownloadApiRequest(
  payload: OffscreenOutputReadyMessage["payload"],
  signal?: AbortSignal
): Promise<OffscreenOutputReadyResponse> {
  throwIfDownloadRequestAborted(signal)
  return chrome.runtime.sendMessage<
    OffscreenOutputReadyMessage,
    OffscreenOutputReadyResponse
  >({
    type: "OFFSCREEN_OUTPUT_READY",
    payload,
  })
}
