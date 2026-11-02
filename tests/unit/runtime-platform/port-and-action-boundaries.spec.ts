import { describe, expect, it } from "vitest"
import { normalizeActiveTaskProgressPortMessage } from "@/src/runtime/active-task-progress"
import { parseOptionsActionItems } from "@/src/runtime/options-action-items"

const progress = {
  generation: "worker-1",
  revision: 2,
  updatedAt: 10,
  taskId: "task-1",
  imagesProcessed: 1,
  totalImages: 3,
  activeChapterCount: 1,
  activeChapters: [
    {
      chapterId: "chapter-1",
      imagesProcessed: 1,
      totalImages: 3,
      stage: "downloading",
      phaseFraction: 1 / 3,
      updatedAt: 10,
    },
  ],
  stage: "downloading",
  phaseFraction: 1 / 3,
  outputCommitted: false,
  status: "downloading",
}

describe("active progress port boundary", () => {
  it("accepts a validated update and an explicit cleared projection", () => {
    const event = {
      type: "ACTIVE_TASK_PROGRESS",
      generation: "worker-1",
      revision: 2,
      progress,
    }
    expect(normalizeActiveTaskProgressPortMessage(event)).toEqual(event)
    expect(
      normalizeActiveTaskProgressPortMessage({ ...event, progress: null })
    ).toEqual({ ...event, progress: null })
  })

  it("rejects malformed events and projections from another generation or revision", () => {
    const event = {
      type: "ACTIVE_TASK_PROGRESS",
      generation: "worker-1",
      revision: 2,
      progress,
    }
    expect(normalizeActiveTaskProgressPortMessage({})).toBeNull()
    expect(
      normalizeActiveTaskProgressPortMessage({
        ...event,
        generation: "worker-2",
      })
    ).toBeNull()
    expect(
      normalizeActiveTaskProgressPortMessage({ ...event, revision: 3 })
    ).toBeNull()
  })
})

describe("stored extension update action boundary", () => {
  it("restores available updates with and without an optional version", () => {
    const extensionUpdate = {
      status: "available",
      detectedAt: 100,
      version: "2.1.0",
    }
    expect(parseOptionsActionItems({ extensionUpdate })).toEqual({
      extensionUpdate,
    })
    for (const version of [undefined, "", 42]) {
      expect(
        parseOptionsActionItems({
          extensionUpdate: { ...extensionUpdate, version },
        })
      ).toEqual({ extensionUpdate: { status: "available", detectedAt: 100 } })
    }
  })
})
