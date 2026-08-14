import { describe, expect, it } from "vitest"

import {
  normalizeActiveTaskProgress,
  shouldAcceptProgressRevision,
} from "@/entrypoints/sidepanel/hooks/useActiveTaskProgress"

describe("useActiveTaskProgress normalizeActiveTaskProgress", () => {
  const currentProgress = {
    generation: "generation-1",
    revision: 3,
    updatedAt: 100,
    taskId: "task-1",
    chapterId: "ch-1",
    chapterTitle: "Chapter 1",
    imagesProcessed: 4,
    totalImages: 20,
    activeChapterCount: 1,
    activeChapters: [
      {
        chapterId: "ch-1",
        chapterTitle: "Chapter 1",
        imagesProcessed: 4,
        totalImages: 20,
        stage: "downloading",
        phaseFraction: 0.2,
        updatedAt: 100,
      },
    ],
    stage: "downloading",
    phaseFraction: 0.2,
    overallFraction: 0.1,
    outputCommitted: false,
    status: "downloading",
  } as const

  it("returns null for invalid payload", () => {
    expect(normalizeActiveTaskProgress(undefined)).toBeNull()
    expect(normalizeActiveTaskProgress({ taskId: "x" })).toBeNull()
  })

  it("returns null for unsupported status values", () => {
    expect(
      normalizeActiveTaskProgress({
        ...currentProgress,
        status: "queued",
      })
    ).toBeNull()
  })

  it("accepts the exact current stored projection without synthesis", () => {
    expect(normalizeActiveTaskProgress(currentProgress)).toEqual(
      currentProgress
    )
  })

  it.each([
    {
      taskId: "task-1",
      imagesProcessed: 1,
      totalImages: 5,
      status: "downloading",
    },
    { ...currentProgress, generation: undefined },
    { ...currentProgress, activeChapters: undefined },
    { ...currentProgress, outputCommitted: undefined },
  ])("rejects an old optional-field projection %#", (value) => {
    expect(normalizeActiveTaskProgress(value)).toBeNull()
  })

  it("rejects unknown projection and nested chapter fields", () => {
    expect(
      normalizeActiveTaskProgress({
        ...currentProgress,
        unsupported: true,
      })
    ).toBeNull()
    expect(
      normalizeActiveTaskProgress({
        ...currentProgress,
        activeChapters: [
          { ...currentProgress.activeChapters[0], unsupported: true },
        ],
      })
    ).toBeNull()
  })

  it("accepts a lower revision from a new worker generation", () => {
    expect(
      shouldAcceptProgressRevision({
        currentGeneration: "worker-old",
        currentRevision: 42,
        nextGeneration: "worker-new",
        nextRevision: 1,
      })
    ).toBe(true)
    expect(
      shouldAcceptProgressRevision({
        currentGeneration: "worker-new",
        currentRevision: 2,
        nextGeneration: "worker-new",
        nextRevision: 1,
      })
    ).toBe(false)
  })
})
