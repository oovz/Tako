import { describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import React from "react"

import { ActiveTaskProgress } from "@/entrypoints/sidepanel/components/ActiveTaskProgress"
import type { QueueTaskSummary } from "@/src/domain/queue/state"

function makeTask(overrides: Partial<QueueTaskSummary> = {}): QueueTaskSummary {
  return {
    id: "task-1",
    seriesKey: "mangadex#manga-1",
    seriesTitle: "Series 1",
    siteIntegration: "mangadex",
    status: "downloading",
    chapters: { total: 4, completed: 1, unsuccessful: 0 },
    timestamps: { created: Date.now() },
    failureCategory: undefined,
    isRetried: false,
    isRetryTask: false,
    lastSuccessfulDownloadId: undefined,
    ...overrides,
  }
}

describe("ActiveTaskProgress", () => {
  it("renders chapter/image progress labels for active multi-chapter task", () => {
    const html = renderToStaticMarkup(
      React.createElement(ActiveTaskProgress, {
        task: makeTask(),
        progress: {
          generation: "generation-1",
          revision: 1,
          updatedAt: 1,
          taskId: "task-1",
          status: "downloading",
          stage: "downloading",
          phaseFraction: 0.3,
          outputCommitted: false,
          chapterTitle: "Chapter 2",
          imagesProcessed: 12,
          totalImages: 40,
          activeChapterCount: 2,
          activeChapters: [
            {
              chapterId: "ch-2",
              chapterTitle: "Chapter 2",
              imagesProcessed: 6,
              totalImages: 20,
              stage: "downloading",
              phaseFraction: 0.3,
              updatedAt: 1,
            },
            {
              chapterId: "ch-3",
              chapterTitle: "Chapter 3",
              imagesProcessed: 6,
              totalImages: 20,
              stage: "downloading",
              phaseFraction: 0.3,
              updatedAt: 1,
            },
          ],
        },
      })
    )

    expect(html).toContain("Progress")
    expect(html).toContain("2 chapters downloading")
    expect(html).toContain("12/40 images")
  })

  it("shows single chapter title suffix when totalChapters is one", () => {
    const html = renderToStaticMarkup(
      React.createElement(ActiveTaskProgress, {
        task: makeTask({
          chapters: { total: 1, completed: 0, unsuccessful: 0 },
        }),
        progress: {
          generation: "generation-1",
          revision: 1,
          updatedAt: 1,
          taskId: "task-1",
          status: "downloading",
          stage: "downloading",
          phaseFraction: 0.3,
          outputCommitted: false,
          chapterTitle: "Chapter One",
          imagesProcessed: 3,
          totalImages: 10,
          activeChapterCount: 1,
          activeChapters: [
            {
              chapterId: "ch-1",
              chapterTitle: "Chapter One",
              imagesProcessed: 3,
              totalImages: 10,
              stage: "downloading",
              phaseFraction: 0.3,
              updatedAt: 1,
            },
          ],
        },
      })
    )

    expect(html).toContain("Chapter 1/1 - Chapter One")
    expect(html).toContain("3/10 images")
  })

  it("describes the between-chapter state without inventing image progress", () => {
    const html = renderToStaticMarkup(
      React.createElement(ActiveTaskProgress, {
        task: makeTask(),
        progress: {
          generation: "generation-1",
          revision: 2,
          updatedAt: 2,
          taskId: "task-1",
          status: "downloading",
          stage: "accepted",
          phaseFraction: 0,
          overallFraction: 0.25,
          outputCommitted: false,
          imagesProcessed: 0,
          totalImages: 0,
          activeChapterCount: 0,
          activeChapters: [],
        },
      })
    )

    expect(html).toContain("Preparing next chapter")
    expect(html).not.toContain("1 chapter downloading")
    expect(html).not.toContain("0/0 images")
    expect(html).toContain('data-image-progress-visible="false"')
  })

  it("keeps the image-progress track mounted while an archive stage is shown", () => {
    const html = renderToStaticMarkup(
      React.createElement(ActiveTaskProgress, {
        task: makeTask(),
        progress: {
          generation: "generation-1",
          revision: 5,
          updatedAt: 5,
          taskId: "task-1",
          status: "downloading",
          stage: "archiving",
          phaseFraction: 0.5,
          outputCommitted: false,
          imagesProcessed: 10,
          totalImages: 20,
          activeChapterCount: 1,
          activeChapters: [],
        },
      })
    )

    expect(html).toContain('data-image-progress-visible="false"')
    expect(html).toContain('aria-hidden="true"')
  })

  it("does not display complete progress until output is committed", () => {
    const incompleteHtml = renderToStaticMarkup(
      React.createElement(ActiveTaskProgress, {
        task: makeTask({
          chapters: { total: 1, completed: 1, unsuccessful: 0 },
        }),
        progress: {
          generation: "generation-1",
          revision: 3,
          updatedAt: 3,
          taskId: "task-1",
          status: "downloading",
          stage: "saving",
          phaseFraction: 1,
          overallFraction: 1,
          outputCommitted: false,
          imagesProcessed: 10,
          totalImages: 10,
          activeChapterCount: 0,
          activeChapters: [],
        },
      })
    )
    const completedHtml = renderToStaticMarkup(
      React.createElement(ActiveTaskProgress, {
        task: makeTask({
          chapters: { total: 1, completed: 1, unsuccessful: 0 },
        }),
        progress: {
          generation: "generation-1",
          revision: 4,
          updatedAt: 4,
          taskId: "task-1",
          status: "downloading",
          stage: "saving",
          phaseFraction: 1,
          overallFraction: 1,
          outputCommitted: true,
          imagesProcessed: 10,
          totalImages: 10,
          activeChapterCount: 0,
          activeChapters: [],
        },
      })
    )

    expect(incompleteHtml).toContain("99%")
    expect(completedHtml).toContain("100%")
  })
})
