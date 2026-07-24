import { describe, expect, it } from "vitest"

import {
  ARCHIVE_FORMATS,
  ArchiveFormatSchema,
  DownloadErrorCategorySchema,
  DownloadProgressStatusSchema,
  DownloadTaskChapterStatusSchema,
  DownloadTaskStatusSchema,
  ImagePaddingDigitsSchema,
} from "@/src/shared/download-contract"

describe("download-contract", () => {
  it("exposes the canonical archive formats in one place", () => {
    expect(ARCHIVE_FORMATS).toEqual(["cbz", "zip", "none"])
    expect(ArchiveFormatSchema.safeParse("cbz").success).toBe(true)
    expect(ArchiveFormatSchema.safeParse("CBZ").success).toBe(false)
  })

  it("distinguishes chapter, task, and progress statuses", () => {
    expect(DownloadTaskChapterStatusSchema.safeParse("queued").success).toBe(
      true
    )
    expect(DownloadTaskChapterStatusSchema.safeParse("canceled").success).toBe(
      true
    )
    expect(DownloadTaskChapterStatusSchema.safeParse("skipped").success).toBe(
      true
    )

    expect(DownloadTaskStatusSchema.safeParse("canceled").success).toBe(true)

    expect(DownloadProgressStatusSchema.safeParse("completed").success).toBe(
      true
    )
    expect(DownloadProgressStatusSchema.safeParse("queued").success).toBe(false)
  })

  it("keeps the shared auxiliary vocabularies strict", () => {
    expect(
      DownloadErrorCategorySchema.safeParse("network_unavailable").success
    ).toBe(true)
    expect(
      DownloadErrorCategorySchema.safeParse("folder_permission_required")
        .success
    ).toBe(true)
    expect(DownloadErrorCategorySchema.safeParse("network").success).toBe(false)

    expect(ImagePaddingDigitsSchema.safeParse("auto").success).toBe(true)
    expect(ImagePaddingDigitsSchema.safeParse(4).success).toBe(true)
    expect(ImagePaddingDigitsSchema.safeParse(6).success).toBe(false)
  })
})
