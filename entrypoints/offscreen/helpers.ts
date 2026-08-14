import type { Chapter } from "@/src/types/chapter"
import type { ComicInfoV2 } from "@/src/types/comic-info"
import { buildSeriesComicInfoBase } from "@/src/shared/chapter-metadata"
import type {
  RuntimeMessageRequest,
  RuntimeMessageResponse,
} from "@/src/runtime/runtime-message-contracts"
import { sendRuntimeMessage } from "@/src/runtime/send-runtime-message"
import type { SeriesMetadataSnapshot } from "@/src/types/state-snapshots"

function throwIfDownloadRequestAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new Error("job-cancelled")
  }
}

/**
 * Consumer-side type for series metadata passed to ComicInfo generation.
 *
 * The wire format is validated as a JSON object before it reaches offscreen
 * processing. See `createProcessChapterStreamingOptions` in
 * `download-request-mappers.ts`.
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
  payload: RuntimeMessageRequest<"OFFSCREEN_OUTPUT_READY">["payload"],
  signal?: AbortSignal
): Promise<RuntimeMessageResponse<"OFFSCREEN_OUTPUT_READY">> {
  throwIfDownloadRequestAborted(signal)
  return sendRuntimeMessage({
    target: "background",
    type: "OFFSCREEN_OUTPUT_READY",
    payload,
  })
}
