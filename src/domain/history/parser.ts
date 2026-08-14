import { z } from "zod"
import type { DownloadedChapterRecord } from "./types"

const DownloadedChapterRecordSchema = z.strictObject({
  siteIntegrationId: z.string().min(1),
  chapterId: z.string().min(1),
  url: z.string(),
  title: z.string(),
  seriesId: z.string().min(1),
  seriesTitle: z.string(),
  chapterNumber: z.number().finite().optional(),
  volumeNumber: z.number().finite().optional(),
  downloadedAt: z.number().finite().nonnegative(),
  filePath: z.string().optional(),
  fileSize: z.number().finite().nonnegative().optional(),
  format: z.enum(["zip", "cbz", "cbr", "pdf", "none"]),
})

export function parseDownloadedChapters(
  raw: unknown
): DownloadedChapterRecord[] {
  const parsed = z.array(DownloadedChapterRecordSchema).safeParse(raw)
  if (!parsed.success)
    throw new Error("Stored downloaded chapter list is invalid")
  return structuredClone(parsed.data)
}
