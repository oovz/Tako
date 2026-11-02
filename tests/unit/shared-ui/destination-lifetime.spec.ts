// @vitest-environment happy-dom

import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { TaskDestinationCaption } from "@/src/ui/shared/TaskDestinationCaption"
import type { TaskDestination } from "@/src/types/state-snapshots"

const load = vi.hoisted(() => vi.fn())
vi.mock("@/src/storage/fs-access", () => ({ loadDownloadRootHandle: load }))

describe("task destination caption lifetime", () => {
  let root: Root
  let container: HTMLDivElement

  async function render(
    destination: TaskDestination,
    useChromeFallback?: true
  ) {
    await act(async () =>
      root.render(
        createElement(TaskDestinationCaption, {
          destination,
          requestedPath: "Series/Chapter.cbz",
          useChromeFallback,
        })
      )
    )
  }

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
    container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    load.mockReset()
    vi.unstubAllGlobals()
  })

  it.each(["success", "failure"])(
    "keeps a replacement folder when an older lookup finishes with %s",
    async (outcome) => {
      const older = Promise.withResolvers<{ name: string }>()
      load.mockReturnValueOnce(older.promise)
      await render({ kind: "file-system-access", handleId: "old" })
      load.mockResolvedValue({ name: "Current folder" })
      await render({ kind: "file-system-access", handleId: "current" })
      await act(async () => {
        if (outcome === "success") older.resolve({ name: "Old folder" })
        else older.reject(new Error("Old lookup"))
      })
      expect(container.textContent).toBe("Current folder/Series/Chapter.cbz")
      expect(container.querySelector("p")?.title).toBe(container.textContent)
    }
  )

  it.each(["missing", "failure"])(
    "uses the generic folder caption after a %s lookup",
    async (outcome) => {
      if (outcome === "missing") load.mockResolvedValue(undefined)
      else load.mockRejectedValue(new Error("Unavailable"))
      await render({ kind: "file-system-access", handleId: "captured" })
      expect(container.textContent).toBe("Selected folder/Series/Chapter.cbz")
    }
  )

  it("hides the previous folder name while a new destination is loading", async () => {
    load.mockResolvedValueOnce({ name: "Old folder" })
    await render({ kind: "file-system-access", handleId: "old" })
    const pending = Promise.withResolvers<{ name: string }>()
    load.mockReturnValueOnce(pending.promise)
    await render({ kind: "file-system-access", handleId: "current" })
    expect(container.textContent).toBe("Selected folder/Series/Chapter.cbz")
    await act(async () => pending.resolve({ name: "Current folder" }))
    expect(container.textContent).toBe("Current folder/Series/Chapter.cbz")
  })

  it("uses the Chrome target and fallback notice without a folder lookup", async () => {
    await render({ kind: "downloads-api" }, true)
    expect(load).not.toHaveBeenCalled()
    expect(container.textContent).toBe(
      "Chrome Downloads/Series/Chapter.cbz · Switched to Chrome Downloads"
    )
    expect(container.querySelector("p")?.title).toBe(
      "Chrome Downloads/Series/Chapter.cbz"
    )
  })
})
