import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

vi.mock("@/src/ui/shared/hooks/useChromeStorageValue", () => ({
  useChromeStorageValue: () => ({
    value: [
      {
        id: "issue-1",
        taskId: "task-1",
        kind: "fsa_folder_missing",
        occurredAt: 1,
      },
    ],
    hydrated: true,
  }),
}))

import { FsaBanner } from "@/entrypoints/sidepanel/components/FsaBanner"

describe("FsaBanner reflow", () => {
  it("wraps the message and action group within a narrow side panel", () => {
    const html = renderToStaticMarkup(React.createElement(FsaBanner))

    expect(html).toContain("flex-wrap")
    expect(html).toContain("break-words")
    expect(html).toContain("max-w-full")
  })
})
