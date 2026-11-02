import { afterEach, describe, expect, it, vi } from "vitest"
import { updateActionBadge } from "@/src/runtime/projection"
import {
  clearExtensionUpdateActionItem,
  markExtensionUpdateActionItemAvailable,
} from "@/src/runtime/options-action-items"
import { SESSION_STORAGE_KEYS } from "@/src/runtime/storage-keys"

afterEach(() => vi.unstubAllGlobals())

describe("browser action effects", () => {
  it("updates the active queue badge and clears it when the queue empties", async () => {
    const calls: unknown[] = []
    vi.stubGlobal("chrome", {
      action: {
        setBadgeText: vi.fn(async (value: unknown) => {
          calls.push(value)
        }),
        setBadgeBackgroundColor: vi.fn(async (value: unknown) => {
          calls.push(value)
        }),
      },
    })
    await updateActionBadge(4)
    expect(calls).toEqual([{ text: "4" }, { color: "#2563eb" }])
    calls.length = 0
    await updateActionBadge(0)
    expect(calls).toEqual([{ text: "" }])
  })

  it("persists and clears update notices in the browser's session storage", async () => {
    const sessionData: Record<string, unknown> = {}
    vi.stubGlobal("chrome", {
      storage: {
        session: {
          get: vi.fn(async () => ({ ...sessionData })),
          set: vi.fn(async (value: Record<string, unknown>) => {
            Object.assign(sessionData, value)
          }),
        },
      },
    })
    await markExtensionUpdateActionItemAvailable({
      version: "2.1.0",
      now: () => 100,
    })
    expect(sessionData[SESSION_STORAGE_KEYS.optionsActionItems]).toEqual({
      extensionUpdate: {
        status: "available",
        version: "2.1.0",
        detectedAt: 100,
      },
    })
    await clearExtensionUpdateActionItem()
    expect(sessionData[SESSION_STORAGE_KEYS.optionsActionItems]).toEqual({})
  })
})
