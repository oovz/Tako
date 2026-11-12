import { describe, expect, it } from "vitest"

import {
  clearFsaDestinationActionItem,
  clearHostPermissionActionItem,
  createExtensionUpdateActionItem,
  getOptionsActionItemSeverity,
  markFsaDestinationActionItem,
  markExtensionUpdateActionItemAvailable,
  markHostPermissionActionItem,
  parseOptionsActionItems,
  parseStoredOptionsActionItems,
} from "@/src/runtime/options-action-items"

function createSessionStorageStub() {
  const data: Record<string, unknown> = {}
  return {
    data,
    area: {
      get: async (key: string) => ({ [key]: data[key] }),
      set: async (values: Record<string, unknown>) => {
        Object.assign(data, values)
      },
    } as Pick<chrome.storage.StorageArea, "get" | "set">,
  }
}

describe("options action items", () => {
  it("preserves update and destination alerts published concurrently", async () => {
    const { data, area } = createSessionStorageStub()

    await Promise.all([
      markExtensionUpdateActionItemAvailable({
        version: "1.2.8",
        storageArea: area,
      }),
      markFsaDestinationActionItem({ issue: "unavailable", storageArea: area }),
    ])

    expect(parseStoredOptionsActionItems(data)).toMatchObject({
      extensionUpdate: { version: "1.2.8" },
      fsaDestination: { issue: "unavailable" },
    })
  })

  it("creates an extension-update action item for Options to render", () => {
    expect(
      createExtensionUpdateActionItem({ version: "1.2.8", detectedAt: 1234 })
    ).toEqual({
      extensionUpdate: {
        status: "available",
        version: "1.2.8",
        detectedAt: 1234,
      },
    })
  })

  it("parses malformed stored values as no action items", () => {
    expect(parseOptionsActionItems(null)).toEqual({})
    expect(
      parseOptionsActionItems({ extensionUpdate: { status: "done" } })
    ).toEqual({})
    expect(
      parseOptionsActionItems({
        extensionUpdate: { status: "available", detectedAt: "now" },
      })
    ).toEqual({})
  })

  it("keeps valid action items when a sibling entry is malformed", () => {
    expect(
      parseOptionsActionItems({
        extensionUpdate: { status: "available", detectedAt: 5 },
        fsaDestination: { issue: "typo", detectedAt: 6 },
        hostPermission: { integrationIds: "mangadex", detectedAt: 7 },
      })
    ).toEqual({
      extensionUpdate: { status: "available", detectedAt: 5 },
    })
  })

  it("derives the header severity from action items, error outranking warning", () => {
    expect(getOptionsActionItemSeverity({})).toBeNull()
    expect(
      getOptionsActionItemSeverity(
        createExtensionUpdateActionItem({ detectedAt: 1234 })
      )
    ).toBe("warning")
    expect(
      getOptionsActionItemSeverity({
        hostPermission: { integrationIds: ["mangadex"], detectedAt: 1 },
      })
    ).toBe("warning")
    expect(
      getOptionsActionItemSeverity({
        fsaDestination: { issue: "permission_required", detectedAt: 1 },
      })
    ).toBe("warning")
    expect(
      getOptionsActionItemSeverity({
        extensionUpdate: { status: "available", detectedAt: 1 },
        fsaDestination: { issue: "unavailable", detectedAt: 2 },
      })
    ).toBe("error")
  })

  it("marks and clears the folder destination item over session storage", async () => {
    const { data, area } = createSessionStorageStub()

    await markFsaDestinationActionItem({
      issue: "permission_required",
      storageArea: area,
      now: () => 10,
    })
    expect(parseStoredOptionsActionItems(data)).toMatchObject({
      fsaDestination: { issue: "permission_required", detectedAt: 10 },
    })

    await markFsaDestinationActionItem({
      issue: "unavailable",
      storageArea: area,
      now: () => 20,
    })
    expect(
      getOptionsActionItemSeverity(parseStoredOptionsActionItems(data))
    ).toBe("error")

    await clearFsaDestinationActionItem({ storageArea: area })
    expect(parseStoredOptionsActionItems(data)).toEqual({})
  })

  it("marks, refines, and clears the host permission item", async () => {
    const { data, area } = createSessionStorageStub()

    await markHostPermissionActionItem({
      integrationIds: ["comicnettai", "mangadex", "mangadex"],
      storageArea: area,
      now: () => 30,
    })
    expect(parseStoredOptionsActionItems(data)).toMatchObject({
      hostPermission: {
        integrationIds: ["comicnettai", "mangadex"],
        detectedAt: 30,
      },
    })

    await clearHostPermissionActionItem({ storageArea: area })
    expect(parseStoredOptionsActionItems(data)).toEqual({})
  })
})
