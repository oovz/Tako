import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { TooltipProvider } from "@/components/ui/tooltip"
import { SidePanelQueueRegion } from "@/entrypoints/sidepanel/components/SidePanelQueueRegion"
import type { QueueTaskSummary } from "@/src/types/queue-state"

vi.stubGlobal("chrome", {
  runtime: {
    getURL: (path: string) => path,
  },
})

function makeTask(
  id: string,
  status: QueueTaskSummary["status"]
): QueueTaskSummary {
  return {
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
})
