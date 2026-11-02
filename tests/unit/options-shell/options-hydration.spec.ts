// @vitest-environment happy-dom
import { act, createElement } from "react"
import { flushSync } from "react-dom"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { toast } from "sonner"
import { OptionsPage } from "@/entrypoints/options/main-options-page"
import { DEFAULT_SETTINGS } from "@/src/domain/settings/defaults"
import { t } from "@/src/runtime/i18n"
import type { RuntimeMessage } from "@/src/runtime/runtime-message-contracts"

let root: Root
let container: HTMLDivElement
const listeners = new Set<
  Parameters<typeof chrome.storage.onChanged.addListener>[0]
>()
const sendMessage = vi.fn()

function loaded() {
  return {
    success: true,
    data: {
      configuration: {
        settings: structuredClone(DEFAULT_SETTINGS),
        overrides: {},
        enablement: {},
        integrationSettings: {},
      },
      historyStats: { totalChapters: 0, totalSeries: 0 },
      historySeries: [],
    },
  }
}

async function mount() {
  await act(async () => root.render(createElement(OptionsPage)))
  await act(async () => vi.dynamicImportSettled())
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  sendMessage.mockImplementation(async (message: RuntimeMessage) => {
    if (message.type === "GET_UI_PREFERENCES")
      return {
        success: true,
        data: { uiLanguage: "auto", motionPreference: "system" },
      }
    if (message.type === "GET_OPTIONS_CONFIGURATION") return loaded()
    throw new Error(`Unexpected message ${message.type}`)
  })
  vi.stubGlobal("chrome", {
    ...chrome,
    runtime: {
      sendMessage,
      getManifest: () => ({
        version: "2.0.9",
        host_permissions: [],
        optional_host_permissions: [],
      }),
    },
    storage: {
      local: { get: async () => ({}) },
      onChanged: {
        addListener: (
          listener: Parameters<typeof chrome.storage.onChanged.addListener>[0]
        ) => listeners.add(listener),
        removeListener: (
          listener: Parameters<typeof chrome.storage.onChanged.addListener>[0]
        ) => listeners.delete(listener),
      },
    },
  })
  window.history.replaceState(null, "", "?tab=general")
  container = document.createElement("div")
  container.id = "root"
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  expect(listeners.size).toBe(0)
  vi.restoreAllMocks()
  vi.resetAllMocks()
  vi.unstubAllGlobals()
})

it("recovers an initial configuration failure while preferences hydrate independently", async () => {
  const preferences = Promise.withResolvers<unknown>()
  const configuration = Promise.withResolvers<unknown>()
  sendMessage.mockImplementation((message: RuntimeMessage) =>
    message.type === "GET_UI_PREFERENCES"
      ? preferences.promise
      : configuration.promise
  )
  await mount()
  expect(container.querySelector('[role="status"]')).not.toBeNull()
  expect(container.querySelector("h1")).toBeNull()
  await act(async () =>
    configuration.resolve({ success: false, error: "Unavailable" })
  )
  expect(container.querySelector('[role="alert"]')).not.toBeNull()
  const retry = Array.from(container.querySelectorAll("button")).find(
    (button) => button.textContent === t("common_restart")
  )!
  expect(retry).toBeDefined()
  const retryLoad = Promise.withResolvers<unknown>()
  sendMessage.mockImplementation((message: RuntimeMessage) =>
    message.type === "GET_UI_PREFERENCES"
      ? preferences.promise
      : retryLoad.promise
  )
  await act(async () => retry.click())
  expect(container.querySelector('[role="alert"]')).toBeNull()
  expect(container.querySelector('[role="status"]')).not.toBeNull()
  await act(async () => retryLoad.resolve(loaded()))
  await act(async () => vi.dynamicImportSettled())
  expect(container.querySelector("h1")).not.toBeNull()
  expect(container.querySelector("#notifications")).not.toBeNull()
  await act(async () =>
    preferences.resolve({
      success: true,
      data: { uiLanguage: "auto", motionPreference: "reduce" },
    })
  )
  expect(container.querySelector("#notifications")).not.toBeNull()
})

it("cancels startup hydration before a disposed page can issue a read or failure notification", async () => {
  const error = vi.spyOn(toast, "error")
  const normal = sendMessage.getMockImplementation()!
  sendMessage.mockImplementation((message: RuntimeMessage) =>
    message.type === "GET_OPTIONS_CONFIGURATION"
      ? Promise.reject(new Error("Old page unavailable"))
      : normal(message)
  )
  act(() => {
    flushSync(() => root.render(createElement(OptionsPage)))
    root.unmount()
  })
  await act(async () => {})
  expect(
    sendMessage.mock.calls.filter(
      ([message]) => message.type === "GET_OPTIONS_CONFIGURATION"
    )
  ).toHaveLength(0)
  expect(error).not.toHaveBeenCalled()
  root = createRoot(container)
  sendMessage.mockImplementation(normal)
  await mount()
  expect(container.querySelector("#notifications")).not.toBeNull()
  expect(error).not.toHaveBeenCalled()
})
