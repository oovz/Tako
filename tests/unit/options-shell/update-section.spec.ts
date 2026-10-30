// @vitest-environment happy-dom
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"

import { ExtensionUpdateSection } from "@/entrypoints/options/components/ExtensionUpdateSection"
import { SESSION_STORAGE_KEYS } from "@/src/runtime/storage-keys"
import { t } from "@/src/runtime/i18n"

let root: Root
let container: HTMLDivElement
const listeners = new Set<
  (details: chrome.runtime.UpdateAvailableDetails) => void
>()
const requestUpdateCheck = vi.fn()
const reload = vi.fn()
const stored: Record<string, unknown> = {}
const set = vi.fn(async (values: Record<string, unknown>) =>
  Object.assign(stored, values)
)

function button(key: Parameters<typeof t>[0]) {
  const found = Array.from(container.querySelectorAll("button")).find(
    (item) => item.textContent === t(key)
  )
  expect(found).toBeDefined()
  return found!
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  vi.stubGlobal("chrome", {
    ...chrome,
    runtime: {
      getManifest: () => ({ version: "2.0.9" }),
      requestUpdateCheck,
      reload,
      onUpdateAvailable: {
        addListener: (
          listener: (details: chrome.runtime.UpdateAvailableDetails) => void
        ) => listeners.add(listener),
        removeListener: (
          listener: (details: chrome.runtime.UpdateAvailableDetails) => void
        ) => listeners.delete(listener),
      },
    },
    storage: { session: { get: async () => ({ ...stored }), set } },
  })
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  listeners.clear()
  for (const key of Object.keys(stored)) delete stored[key]
  vi.resetAllMocks()
  vi.unstubAllGlobals()
})

it("disables a pending check, presents the update, and clears its action before reload", async () => {
  const pending =
    Promise.withResolvers<chrome.runtime.RequestUpdateCheckResult>()
  requestUpdateCheck.mockReturnValue(pending.promise)
  await act(async () => root.render(createElement(ExtensionUpdateSection)))
  expect(container.textContent).toContain(t("options_autoUpdateNote"))
  await act(async () => button("options_checkForUpdates").click())
  expect(button("options_checking").disabled).toBe(true)
  await act(async () =>
    pending.resolve({ status: "update_available", version: "2.1.0" })
  )
  expect(container.textContent).toContain(t("options_updateReady"))
  expect(stored[SESSION_STORAGE_KEYS.optionsActionItems]).toMatchObject({
    extensionUpdate: { status: "available", version: "2.1.0" },
  })
  set.mockImplementationOnce(async (values) => {
    expect(reload).not.toHaveBeenCalled()
    return Object.assign(stored, values)
  })
  await act(async () => button("options_applyUpdate").click())
  expect(stored[SESSION_STORAGE_KEYS.optionsActionItems]).toEqual({})
  expect(reload).toHaveBeenCalledOnce()
})

it("handles runtime update events and removes its subscription on unmount", async () => {
  await act(async () => root.render(createElement(ExtensionUpdateSection)))
  expect(listeners.size).toBe(1)
  await act(async () =>
    listeners.forEach((listener) => listener({ version: "2.2.0" }))
  )
  expect(button("options_applyUpdate").disabled).toBe(false)
  expect(stored[SESSION_STORAGE_KEYS.optionsActionItems]).toMatchObject({
    extensionUpdate: { version: "2.2.0" },
  })
  await act(async () => root.unmount())
  expect(listeners.size).toBe(0)
})

it.each([
  ["no_update", "options_noUpdateAvailable"],
  ["throttled", "options_checkThrottled"],
] as const)(
  "presents %s and only clears stale updates after a completed check",
  async (status, key) => {
    stored[SESSION_STORAGE_KEYS.optionsActionItems] = {
      extensionUpdate: { status: "available", detectedAt: 1 },
    }
    requestUpdateCheck.mockResolvedValue({ status })
    await act(async () => root.render(createElement(ExtensionUpdateSection)))
    await act(async () => button("options_checkForUpdates").click())
    expect(container.textContent).toContain(t(key))
    expect(container.textContent).not.toContain(t("options_applyUpdate"))
    expect(stored[SESSION_STORAGE_KEYS.optionsActionItems]).toEqual(
      status === "no_update"
        ? {}
        : { extensionUpdate: { status: "available", detectedAt: 1 } }
    )
  }
)

it("reports check failures and permits a subsequent check", async () => {
  requestUpdateCheck.mockRejectedValueOnce(new Error("Check unavailable"))
  await act(async () => root.render(createElement(ExtensionUpdateSection)))
  await act(async () => button("options_checkForUpdates").click())
  expect(container.textContent).toContain(t("options_updateCheckFailed"))
  expect(button("options_checkForUpdates").disabled).toBe(false)
  requestUpdateCheck.mockResolvedValue({ status: "no_update" })
  await act(async () => button("options_checkForUpdates").click())
  expect(container.textContent).toContain(t("options_noUpdateAvailable"))
})
