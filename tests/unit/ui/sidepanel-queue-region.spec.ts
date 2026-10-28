import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { TooltipProvider } from "@/components/ui/tooltip"
import { SidePanelQueueRegion } from "@/entrypoints/sidepanel/components/SidePanelQueueRegion"
import type { QueueTaskSummary } from "@/src/domain/queue/state"

vi.stubGlobal("chrome", {
  ...chrome,
  runtime: {
    getURL: (path: string) => path,
  },
})

function makeTask(
  id: string,
  status: QueueTaskSummary["status"]
): QueueTaskSummary {
  return {
    destination: { kind: "downloads-api" },
    id,
    seriesKey: `site#${id}`,
    seriesTitle: `Series ${id}`,
    siteIntegration: "mangadex",
    status,
    chapters: { total: 1, completed: 0, unsuccessful: 0 },
    timestamps: { created: 1, completed: 2 },
  }
}

const commonProps = {
  historyTasks: [] as QueueTaskSummary[],
  isLoading: false,
  readStatus: "ready" as const,
  onRefresh: vi.fn(),
  isInlineSelectionOpen: false,
  cancelingTaskIds: new Set<string>(),
  retryingTaskIds: new Set<string>(),
  restartingTaskIds: new Set<string>(),
  removingTaskIds: new Set<string>(),
  movingTaskIds: new Set<string>(),
  activeTaskProgress: null,
  showActiveProgress: false,
  onCancelTask: vi.fn(),
  onRetryFailed: vi.fn(),
  onRestartTask: vi.fn(),
  onMoveTaskToTop: vi.fn(),
  onRemoveTask: vi.fn(),
  onViewFullHistory: vi.fn(),
}

function renderQueueRegion(
  props: React.ComponentProps<typeof SidePanelQueueRegion>
): string {
  return renderToStaticMarkup(
    React.createElement(
      TooltipProvider,
      null,
      React.createElement(SidePanelQueueRegion, props)
    )
  )
}

describe("SidePanelQueueRegion unified queue layout", () => {
  it("preserves the producer error and offers manual recovery when handoff is uncertain", () => {
    const html = renderQueueRegion({
      ...commonProps,
      queueTasks: [],
      historyTasks: [
        {
          ...makeTask("uncertain", "failed"),
          failureCategory: "archive_creation_failed",
          outputUncertain: true,
          chapters: { total: 1, completed: 0, unsuccessful: 1 },
        },
      ],
    })
    expect(html).toContain(
      "Chrome file saving could not be confirmed. Retrying may create duplicate files."
    )
    expect(html).toContain(
      'aria-label="Retry all chapters (may create duplicates)"'
    )
    expect(html).toContain("Tako could not create the archive.")
  })

  it("shows an unavailable view with a retry action", () => {
    const html = renderQueueRegion({
      ...commonProps,
      queueTasks: [],
      readStatus: "error",
    })
    expect(html).toContain("Queue and task history could not be loaded.")
    expect(html).toContain("Retry")
    expect(html).not.toContain("No downloads yet")
  })

  it("shows an unconfirmed result without claiming a saved file", () => {
    const html = renderQueueRegion({
      ...commonProps,
      queueTasks: [],
      historyTasks: [
        {
          ...makeTask("native", "completed"),
          outputDestination: "downloads-api",
        },
      ],
    })
    expect(html).toContain("Previously processed")
    expect(html).toContain("Final saving was not confirmed.")
    expect(html).not.toContain(">Saved<")
  })

  it("labels retained tasks as stale after a failed refresh", () => {
    const html = renderQueueRegion({
      ...commonProps,
      queueTasks: [makeTask("known", "queued")],
      readStatus: "stale",
    })
    expect(html).toContain("Queue and task history may be out of date.")
    expect(html).toContain("Series known")
  })

  it("shows the empty view after a successful read", () => {
    const html = renderQueueRegion({ ...commonProps, queueTasks: [] })
    expect(html).toContain("No downloads yet")
    expect(html).not.toContain('role="alert"')
  })

  it("renders active first and queued tasks in one queue container", () => {
    const html = renderQueueRegion({
      ...commonProps,
      queueTasks: [
        makeTask("active", "downloading"),
        makeTask("queued", "queued"),
      ],
    })

    expect(html.match(/data-queue-scroll-container/g)).toHaveLength(1)
    expect(html.indexOf("Series active")).toBeLessThan(
      html.indexOf("Series queued")
    )
  })

  it("does not render queued or history rows while inline selection is open", () => {
    const html = renderQueueRegion({
      ...commonProps,
      queueTasks: [makeTask("queued", "queued")],
      historyTasks: [makeTask("history", "completed")],
      isInlineSelectionOpen: true,
    })

    expect(html).not.toContain("Series queued")
    expect(html).not.toContain("Series history")
    expect(html).not.toContain("Recent history")
  })

  it("keeps active progress at intrinsic height while inline selection is open", () => {
    const html = renderQueueRegion({
      ...commonProps,
      queueTasks: [
        makeTask("active", "downloading"),
        makeTask("queued", "queued"),
      ],
      isInlineSelectionOpen: true,
    })

    expect(html).toContain("basis-auto")
    expect(html).toContain("grow-0")
    expect(html).toContain("Series active")
    expect(html).not.toContain("Series queued")
  })
})
