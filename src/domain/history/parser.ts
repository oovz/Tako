import { z } from "zod"
import type { DownloadedChapterRecord } from "./types"

import { DownloadedChapterRecordSchema } from "./schema"

export function parseDownloadedChapters(
  raw: unknown
): DownloadedChapterRecord[] {
  const parsed = z.array(DownloadedChapterRecordSchema).safeParse(raw)
  if (!parsed.success)
    throw new Error("Stored downloaded chapter list is invalid")
  return structuredClone(parsed.data)
}
