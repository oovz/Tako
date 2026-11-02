import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ActiveTaskProgress } from "@/entrypoints/sidepanel/components/ActiveTaskProgress"
import { CommandCenterQueue } from "@/entrypoints/sidepanel/components/CommandCenterQueue"
import { TooltipProvider } from "@/components/ui/tooltip"
import type { ActiveTaskProgress as ProgressState } from "@/entrypoints/sidepanel/hooks/useActiveTaskProgress"
import type { QueueTaskSummary } from "@/src/domain/queue/state"

const task: QueueTaskSummary = {
  id: "task",
  seriesKey: "mangadex#series",
  seriesTitle: "Series",
  siteIntegration: "mangadex",
  destination: { kind: "downloads-api" },
  status: "downloading",
  chapters: { total: 4, completed: 1, unsuccessful: 0 },
  timestamps: { created: 1 },
}

function progress(overrides: Partial<ProgressState> = {}): ProgressState {
  return {
    generation: "generation",
    revision: 1,
    updatedAt: 1,
    taskId: task.id,
    status: "downloading",
    stage: "downloading",
    phaseFraction: 0,
    outputCommitted: false,
    imagesProcessed: 5,
    totalImages: 10,
    activeChapterCount: 1,
    activeChapters: [],
    ...overrides,
  }
}

function render(
  value: ProgressState | null,
  overrides: Partial<QueueTaskSummary> = {}
) {
  return renderToStaticMarkup(
    createElement(ActiveTaskProgress, {
      task: { ...task, ...overrides },
      progress: value,
    })
  )
}

describe("rendered progress boundaries", () => {
  beforeEach(() => {
    vi.stubGlobal("chrome", {
      ...chrome,
      runtime: { getURL: (path: string) => path },
    })
  })

  afterEach(() => vi.unstubAllGlobals())

  it("uses completed chapters while the live snapshot is absent", () => {
    const html = render(null)
    expect(html).toContain('aria-label="Progress 25%"')
    expect(html).toContain('data-image-progress-visible="false"')
    expect(html).not.toContain("0/0 images")
  })

  it.each([
    { processed: 1, total: 1, stage: "downloading" as const, percent: 100 },
    { processed: 2, total: 4, stage: "transforming" as const, percent: 50 },
  ])(
    "announces actual image completion for $processed/$total images during $stage",
    ({ processed, total, stage, percent }) => {
      const html = render(
        progress({
          imagesProcessed: processed,
          totalImages: total,
          stage,
          overallFraction: 0.5,
          activeChapters: [
            {
              chapterId: "chapter",
              imagesProcessed: processed,
              totalImages: total,
              stage,
              phaseFraction: 0.5,
              updatedAt: 1,
            },
          ],
        })
      )
      expect(html).toMatch(new RegExp(`aria-label="[^"]*: ${percent}%"`))
      expect(html).toContain(`${processed}/${total}`)
      expect(html).toContain('role="status"')
      expect(html).toContain('aria-live="polite"')
    }
  )

  it("keeps zero-total stage transitions finite and hides their image track", () => {
    const html = render(
      progress({
        stage: "resolving",
        imagesProcessed: 0,
        totalImages: 0,
        activeChapterCount: 1,
        activeChapters: [
          {
            chapterId: "chapter",
            imagesProcessed: 0,
            totalImages: 0,
            stage: "resolving",
            phaseFraction: 0,
            updatedAt: 1,
          },
        ],
        overallFraction: 0.25,
      })
    )
    expect(html).toContain('aria-hidden="true"')
    expect(html).toContain('aria-label="Progress 25%"')
    expect(html).not.toContain("NaN")
    expect(html).not.toContain("Infinity")
  })

  it("uses image progress alone when the chapter total is unavailable", () => {
    const html = render(progress(), {
      chapters: { total: 0, completed: 0, unsuccessful: 0 },
    })
    expect(html).toContain('aria-label="Progress 50%"')
  })

  it("bounds each concurrent chapter contribution and ignores chapters without images", () => {
    const activeChapters = [
      { imagesProcessed: 30, totalImages: 10 },
      { imagesProcessed: -5, totalImages: 10 },
      { imagesProcessed: 5, totalImages: 0 },
    ].map((images, index) => ({
      chapterId: String(index),
      stage: "downloading" as const,
      phaseFraction: 0,
      updatedAt: 1,
      ...images,
    }))
    const html = render(progress({ activeChapters, activeChapterCount: 3 }))
    expect(html).toContain('aria-label="Progress 50%"')
    expect(html).toContain("3 chapters downloading")
  })

  it("prefers weighted progress over image counts and bounds its range", () => {
    expect(render(progress({ overallFraction: 0.7 }))).toContain(
      'aria-label="Progress 70%"'
    )
    expect(render(progress({ overallFraction: -0.5 }))).toContain(
      'aria-label="Progress 0%"'
    )
    expect(
      render(progress({ overallFraction: 2, outputCommitted: true }))
    ).toContain('aria-label="Progress 100%"')
  })

  it("keeps the image track bounded while transforming and clamps negative counters", () => {
    const html = render(
      progress({ stage: "transforming", imagesProcessed: -5 })
    )
    expect(html).toContain('data-image-progress-visible="true"')
    expect(html).toContain("0/10 images")
    expect(html).toContain('aria-label="Processing image 0 of 10: 0%"')
  })

  it("stops describing preparation as a next chapter after all chapters finish", () => {
    const html = render(
      progress({ stage: "dispatching", activeChapterCount: 0 }),
      {
        chapters: { total: 4, completed: 4, unsuccessful: 0 },
      }
    )
    expect(html).toContain("Preparing")
    expect(html).not.toContain("Preparing next chapter")
    expect(html).toContain('aria-label="Progress 99%"')
  })

  it("describes resolution separately from image processing", () => {
    const html = render(progress({ stage: "resolving" }))
    expect(html).toContain("Resolving chapter information")
    expect(html).toContain('data-image-progress-visible="false"')
  })

  it("bounds the row chapter count to the task and ignores another task's progress", () => {
    const renderRow = (snapshot: ProgressState, showActiveProgress = true) =>
      renderToStaticMarkup(
        createElement(
          TooltipProvider,
          null,
          createElement(CommandCenterQueue, {
            tasks: [task],
            activeTaskProgress: snapshot,
            showActiveProgress,
          })
        )
      )
    expect(renderRow(progress({ activeChapterCount: 0 }))).toContain("2/4")
    expect(renderRow(progress({ activeChapterCount: 8 }))).toContain("4/4")
    expect(
      renderRow(progress({ taskId: "another-task", activeChapterCount: 2 }))
    ).toContain("1/4")
    expect(renderRow(progress({ activeChapterCount: 2 }), false)).toContain(
      "1/4"
    )
  })
})
