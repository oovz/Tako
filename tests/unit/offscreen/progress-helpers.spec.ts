import { describe, expect, it } from "vitest"

import {
  createStreamingProgressHandlers,
  createTerminalProgressPayload,
} from "@/entrypoints/offscreen/progress-helpers"

describe("terminal offscreen progress", () => {
  it("reports the terminal error and category to the background", () => {
    expect(
      createTerminalProgressPayload({
        taskId: "task-1",
        chapterId: "chapter-1",
        chapterTitle: "Chapter 1",
        outcome: {
          status: "failed",
          errorMessage: "HTTP 503: unavailable",
          errorCategory: "network_unavailable",
          imagesFailed: 2,
          outputsRequested: 0,
          outputsFailedBeforeHandoff: 0,
          outputsCommitted: 0,
        },
        imagesProcessed: 3,
        totalImages: 5,
      })
    ).toEqual(
      expect.objectContaining({
        status: "failed",
        error: "HTTP 503: unavailable",
        errorCategory: "network_unavailable",
        imagesFailed: 2,
      })
    )
  })

  it("caps a pending browser handoff below completion", () => {
    expect(
      createTerminalProgressPayload({
        taskId: "task-1",
        chapterId: "chapter-1",
        chapterTitle: "Chapter 1",
        outcome: {
          status: "completed",
          outputsRequested: 1,
          outputsFailedBeforeHandoff: 0,
          outputsCommitted: 0,
        },
        imagesProcessed: 5,
        totalImages: 5,
      })
    ).toMatchObject({ stage: "saving", phaseFraction: 0.99 })
  })

  it("reports a committed File System Access output as complete", () => {
    expect(
      createTerminalProgressPayload({
        taskId: "task-1",
        chapterId: "chapter-1",
        chapterTitle: "Chapter 1",
        outcome: {
          status: "completed",
          outputsRequested: 1,
          outputsFailedBeforeHandoff: 0,
          outputsCommitted: 1,
        },
        imagesProcessed: 5,
        totalImages: 5,
      })
    ).toMatchObject({ stage: "saving", phaseFraction: 1 })
  })
})

describe("streaming offscreen progress", () => {
  it("reports cover retrieval as resolving rather than archiving", async () => {
    const emitted: unknown[] = []
    const handlers = createStreamingProgressHandlers({
      taskId: "task-1",
      chapterId: "chapter-1",
      chapterTitle: "Chapter 1",
      latestImageProgress: { current: 0, total: 0 },
      emitProgressMessage: async (payload) => {
        emitted.push(payload)
      },
    })

    await handlers.onArchiveProgress(0, "cover")

    expect(emitted).toEqual([
      expect.objectContaining({ stage: "resolving", phaseFraction: 0.5 }),
    ])
  })

  it("reports archiving only when archive finalization begins", async () => {
    const emitted: unknown[] = []
    const handlers = createStreamingProgressHandlers({
      taskId: "task-1",
      chapterId: "chapter-1",
      chapterTitle: "Chapter 1",
      latestImageProgress: { current: 5, total: 5 },
      emitProgressMessage: async (payload) => {
        emitted.push(payload)
      },
    })

    await handlers.onProgress(100, "downloading", { current: 5, total: 5 })
    await handlers.onArchiveProgress(90, "finalizing")

    expect(emitted).toEqual([
      expect.objectContaining({ stage: "downloading" }),
      expect.objectContaining({ stage: "archiving" }),
    ])
  })
})
