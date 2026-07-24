import { describe, expect, it } from "vitest"

import {
  OffscreenMessageSchema,
  RuntimeMessageSchema,
} from "@/src/runtime/message-schemas"

describe("offscreen messaging contracts (behavior-based)", () => {
  it("accepts OFFSCREEN_DOWNLOAD_PROGRESS payloads with chapter-scoped progress fields", () => {
    const parsed = OffscreenMessageSchema.parse({
      type: "OFFSCREEN_DOWNLOAD_PROGRESS",
      payload: {
        jobId: "job-1",
        attempt: 1,
        taskId: "task-1",
        chapterId: "chapter-1",
        sequence: 3,
        stage: "downloading",
        chapterTitle: "Chapter 1",
        status: "downloading",
        imagesProcessed: 5,
        totalImages: 20,
      },
    })

    expect(parsed.type).toBe("OFFSCREEN_DOWNLOAD_PROGRESS")
  })

  it("accepts OFFSCREEN_OUTPUT_READY payload shape for browser downloads", () => {
    const parsed = RuntimeMessageSchema.parse({
      type: "OFFSCREEN_OUTPUT_READY",
      payload: {
        jobId: "job-1",
        attempt: 1,
        outputId: "job-1:archive:0",
        taskId: "task-1",
        chapterId: "chapter-1",
        fileUrl: "blob:test-url",
        filename: "Series/Chapter 1.cbz",
        outputIndex: 0,
        outputCount: 1,
        outputKind: "archive",
      },
    })

    expect(parsed.type).toBe("OFFSCREEN_OUTPUT_READY")
  })

  it("rejects non-blob URLs for browser download handoffs", () => {
    const parsed = RuntimeMessageSchema.safeParse({
      type: "OFFSCREEN_OUTPUT_READY",
      payload: {
        jobId: "job-1",
        attempt: 1,
        outputId: "job-1:archive:0",
        taskId: "task-1",
        chapterId: "chapter-1",
        fileUrl: "https://example.com/file.cbz",
        filename: "Series/Chapter 1.cbz",
        outputIndex: 0,
        outputCount: 1,
        outputKind: "archive",
      },
    })

    expect(parsed.success).toBe(false)
  })

  it("rejects non-blob URLs for revoke requests", () => {
    const parsed = RuntimeMessageSchema.safeParse({
      type: "REVOKE_BLOB_URL",
      payload: {
        jobId: "job-1",
        attempt: 1,
        outputId: "job-1:archive:0",
        blobUrl: "https://example.com/file.cbz",
      },
    })

    expect(parsed.success).toBe(false)
  })

  it("rejects non-canonical waiting status in OFFSCREEN_DOWNLOAD_PROGRESS payloads", () => {
    const parsed = OffscreenMessageSchema.safeParse({
      type: "OFFSCREEN_DOWNLOAD_PROGRESS",
      payload: {
        jobId: "job-1",
        attempt: 1,
        taskId: "task-1",
        chapterId: "chapter-1",
        sequence: 1,
        stage: "downloading",
        status: "waiting",
      },
    })

    expect(parsed.success).toBe(false)
  })

  it("does not accept legacy OFFSCREEN_ARCHIVE_DOWNLOADED in runtime message schema", () => {
    const parsed = RuntimeMessageSchema.safeParse({
      type: "OFFSCREEN_ARCHIVE_DOWNLOADED",
      payload: {
        taskId: "task-1",
        jobId: "job-1",
      },
    })

    expect(parsed.success).toBe(false)
  })
})
