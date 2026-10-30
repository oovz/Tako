// @vitest-environment happy-dom
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"

import { OptionsPage } from "@/entrypoints/options/main-options-page"
import { DEFAULT_SETTINGS } from "@/src/domain/settings/defaults"
import type {
  OptionsConfigurationSnapshot,
  RuntimeMessage,
} from "@/src/runtime/runtime-message-contracts"
import { t } from "@/src/runtime/i18n"

type StorageListener = Parameters<
  typeof chrome.storage.onChanged.addListener
>[0]
let root: Root
let container: HTMLDivElement
let configuration: OptionsConfigurationSnapshot
const listeners = new Set<StorageListener>()
const sendMessage = vi.fn()

function button(key: Parameters<typeof t>[0]) {
  const control = Array.from(document.querySelectorAll("button")).find(
    (item) => item.textContent === t(key)
  )
  expect(control).toBeDefined()
  return control!
}

async function mount() {
  await act(async () => root.render(createElement(OptionsPage)))
  await act(async () => vi.dynamicImportSettled())
}

async function toggleNotifications() {
  await act(async () =>
    container.querySelector<HTMLButtonElement>("#notifications")!.click()
  )
}

async function changeStorage(
  changes: Record<string, chrome.storage.StorageChange>
) {
  await act(async () => {
    listeners.forEach((listener) => listener(changes, "local"))
  })
}

function configurationResponse(snapshot: OptionsConfigurationSnapshot) {
  return {
    success: true,
    data: {
      configuration: snapshot,
      historyStats: { totalChapters: 0, totalSeries: 0 },
      historySeries: [],
    },
  }
}

function configurationReadCount() {
  return sendMessage.mock.calls.filter(
    ([message]) => message.type === "GET_OPTIONS_CONFIGURATION"
  ).length
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  configuration = {
    settings: structuredClone(DEFAULT_SETTINGS),
    overrides: {},
    enablement: {},
    integrationSettings: {},
  }
  configuration.settings.motionPreference = "reduce"
  sendMessage.mockImplementation(async (message: RuntimeMessage) => {
    switch (message.type) {
      case "GET_OPTIONS_CONFIGURATION":
        return {
          success: true,
          data: {
            configuration,
            historyStats: { totalChapters: 0, totalSeries: 0 },
            historySeries: [],
          },
        }
      case "GET_UI_PREFERENCES":
        return {
          success: true,
          data: { uiLanguage: "auto", motionPreference: "system" },
        }
      case "SAVE_OPTIONS_CONFIGURATION":
        configuration = message.payload.configuration
        return { success: true, data: configuration }
      case "GET_OPTIONS_DOWNLOAD_STATE":
        return { success: true, data: { tasks: [], queueStorageBytes: 0 } }
      default:
        throw new Error(`Unexpected message ${message.type}`)
    }
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
      onChanged: {
        addListener: (listener: StorageListener) => listeners.add(listener),
        removeListener: (listener: StorageListener) =>
          listeners.delete(listener),
      },
      local: { get: async () => ({}) },
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
  listeners.clear()
  document.documentElement.removeAttribute("data-tako-motion")
  vi.resetAllMocks()
  vi.unstubAllGlobals()
})

it("loads through runtime validation, applies document preferences and saves edits from the footer", async () => {
  await mount()
  expect(container.querySelector("h1")?.textContent).toBe(t("options_general"))
  expect(document.title).toBe(t("options_takoSettings"))
  expect(document.documentElement.lang).toBe("en")
  expect(document.documentElement.getAttribute("data-tako-motion")).toBe(
    "reduce"
  )
  expect(container.classList.contains("tako-scroll-locked")).toBe(true)
  await act(async () =>
    container.querySelector<HTMLButtonElement>("#notifications")!.click()
  )
  expect(button("options_saveChanges").disabled).toBe(false)
  await act(async () => button("options_saveChanges").click())
  expect(configuration.settings.notifications).toBe(
    !DEFAULT_SETTINGS.notifications
  )
  expect(container.textContent).not.toContain(t("options_unsavedChanges"))
  await act(async () => root.unmount())
  expect(
    document.documentElement.classList.contains("tako-scroll-locked")
  ).toBe(false)
  expect(document.body.classList.contains("tako-scroll-locked")).toBe(false)
  expect(container.classList.contains("tako-scroll-locked")).toBe(false)
})

it("retains unsaved edits across tab navigation and blocks saving until an external conflict is resolved", async () => {
  await mount()
  await act(async () =>
    container.querySelector<HTMLButtonElement>("#notifications")!.click()
  )
  await act(async () => button("options_network").click())
  await act(async () => vi.dynamicImportSettled())
  expect(container.querySelector("h1")?.textContent).toBe(t("options_network"))
  expect(button("options_saveChanges").disabled).toBe(false)
  await act(async () =>
    listeners.forEach((listener) =>
      listener(
        { siteOverrides: { newValue: { mangadex: { outputFormat: "zip" } } } },
        "local"
      )
    )
  )
  expect(container.textContent).toContain(t("options_externalChangesTitle"))
  expect(button("options_saveChanges").disabled).toBe(true)
  await act(async () => button("options_externalChangesKeepMine").click())
  expect(container.textContent).not.toContain(t("options_externalChangesTitle"))
  expect(button("options_saveChanges").disabled).toBe(false)
  await act(async () => button("options_discard").click())
  await act(async () => button("options_discardChanges").click())
  expect(container.textContent).not.toContain(t("options_unsavedChanges"))
})

it("shows a retryable initial loading failure and then hydrates the page", async () => {
  const normal = sendMessage.getMockImplementation()!
  const pending = Promise.withResolvers<unknown>()
  sendMessage.mockImplementation((message) =>
    message.type === "GET_OPTIONS_CONFIGURATION"
      ? pending.promise
      : normal(message)
  )
  await mount()
  expect(container.querySelector('[role="status"]')?.textContent).toBe(
    t("options_loadingSettings")
  )
  await act(async () => pending.reject(new Error("Offline")))
  expect(container.querySelector('[role="alert"]')?.textContent).toBe(
    t("options_toastLoadFailed")
  )
  sendMessage.mockImplementation(normal)
  await act(async () => button("common_restart").click())
  await act(async () => vi.dynamicImportSettled())
  expect(container.querySelector("h1")?.textContent).toBe(t("options_general"))
})

it("routes the storage, integration and activity sections to their live controls", async () => {
  await mount()
  await act(async () => button("options_storage").click())
  await act(async () => vi.dynamicImportSettled())
  expect(container.querySelector("h1")?.textContent).toBe(t("options_storage"))
  await act(async () =>
    container.querySelector<HTMLButtonElement>("#comicinfo")!.click()
  )
  expect(button("options_saveChanges").disabled).toBe(false)
  await act(async () => button("options_siteIntegrations").click())
  await act(async () => vi.dynamicImportSettled())
  expect(container.querySelector("h1")?.textContent).toBe(
    t("options_siteIntegrations")
  )
  expect(
    container.querySelector('[data-testid="site-integration-card-mangadex"]')
  ).not.toBeNull()
  await act(async () => button("options_activity").click())
  await act(async () => vi.dynamicImportSettled())
  expect(container.querySelector("h1")?.textContent).toBe(t("options_activity"))
  expect(container.textContent).toContain(t("options_noDownloadsYet"))
  await act(async () => button("options_saveChanges").click())
  expect(configuration.settings.downloads.includeComicInfo).toBe(
    !DEFAULT_SETTINGS.downloads.includeComicInfo
  )
})

it("keeps an emptied filename editable, blocks its save and saves a repaired template", async () => {
  await mount()
  await act(async () => button("options_storage").click())
  await act(async () => vi.dynamicImportSettled())
  const input = container.querySelector<HTMLInputElement>("#filename-template")!
  const editFilename = async (value: string) => {
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value"
      )!.set!.call(input, value)
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })
  }
  await editFilename("")
  expect(input.value).toBe("")
  expect(input.getAttribute("aria-invalid")).toBe("true")
  await act(async () => button("options_saveChanges").click())
  expect(
    sendMessage.mock.calls.some(
      ([message]) => message.type === "SAVE_OPTIONS_CONFIGURATION"
    )
  ).toBe(false)
  await editFilename("<CHAPTER_NUMBER>")
  expect(input.getAttribute("aria-invalid")).toBe("false")
  await act(async () => button("options_saveChanges").click())
  expect(configuration.settings.downloads.fileNameTemplate).toBe(
    "<CHAPTER_NUMBER>"
  )
  expect(container.textContent).not.toContain(t("options_unsavedChanges"))
})

it("retains a newer local edit when its earlier successful save event arrives late", async () => {
  await mount()
  await toggleNotifications()
  await act(async () => button("options_saveChanges").click())
  const saved = structuredClone(configuration)
  await toggleNotifications()

  await changeStorage({ "settings:global": { newValue: saved.settings } })

  expect(container.textContent).not.toContain(t("options_externalChangesTitle"))
  expect(container.textContent).toContain(t("options_unsavedChanges"))
  expect(button("options_saveChanges").disabled).toBe(false)
  expect(
    container.querySelector("#notifications")?.getAttribute("aria-checked")
  ).toBe(String(DEFAULT_SETTINGS.notifications))
  await act(async () => button("options_saveChanges").click())
  expect(configuration.settings.notifications).toBe(
    DEFAULT_SETTINGS.notifications
  )
  expect(container.textContent).not.toContain(t("options_unsavedChanges"))
})

it("recognizes a later external write matching a failed save instead of suppressing its conflict", async () => {
  await mount()
  const normal = sendMessage.getMockImplementation()!
  let submitted: OptionsConfigurationSnapshot | undefined
  sendMessage.mockImplementation((message: RuntimeMessage) => {
    if (message.type === "SAVE_OPTIONS_CONFIGURATION") {
      submitted = structuredClone(message.payload.configuration)
      return { success: false, error: "Storage unavailable" }
    }
    return normal(message)
  })
  await toggleNotifications()
  await act(async () => button("options_saveChanges").click())
  expect(configuration.settings.notifications).toBe(
    DEFAULT_SETTINGS.notifications
  )
  expect(container.textContent).toContain(t("options_unsavedChanges"))

  configuration = submitted!
  await changeStorage({
    "settings:global": { newValue: configuration.settings },
  })

  expect(container.textContent).toContain(t("options_externalChangesTitle"))
  expect(button("options_saveChanges").disabled).toBe(true)
  sendMessage.mockImplementation(normal)
  await act(async () => button("options_externalChangesKeepMine").click())
  expect(container.textContent).not.toContain(t("options_externalChangesTitle"))
  expect(
    container.querySelector("#notifications")?.getAttribute("aria-checked")
  ).toBe(String(!DEFAULT_SETTINGS.notifications))
})

it("retires an older external read after a clean page resolves its conflict", async () => {
  await mount()
  const stale = structuredClone(configuration)
  const normal = sendMessage.getMockImplementation()!
  const olderRead = Promise.withResolvers<unknown>()
  let externalReads = 0
  sendMessage.mockImplementation((message: RuntimeMessage) => {
    if (message.type !== "GET_OPTIONS_CONFIGURATION") return normal(message)
    externalReads += 1
    if (externalReads === 1)
      return { success: false, error: "Storage unavailable" }
    if (externalReads === 2) return olderRead.promise
    return configurationResponse(configuration)
  })
  await changeStorage({ "settings:global": { newValue: stale.settings } })
  expect(container.textContent).toContain(t("options_externalChangesTitle"))
  await changeStorage({ siteOverrides: { newValue: {} } })
  expect(externalReads).toBe(2)
  configuration = structuredClone(stale)
  configuration.settings.notifications = !DEFAULT_SETTINGS.notifications
  await act(async () => button("options_externalChangesReload").click())
  expect(container.textContent).not.toContain(t("options_externalChangesTitle"))
  expect(externalReads).toBe(3)

  await act(async () => olderRead.resolve(configurationResponse(stale)))

  expect(container.textContent).not.toContain(t("options_externalChangesTitle"))
  expect(container.textContent).not.toContain(t("options_unsavedChanges"))
  expect(
    container.querySelector("#notifications")?.getAttribute("aria-checked")
  ).toBe(String(!DEFAULT_SETTINGS.notifications))
})

it("blocks conflict resolution during save and reloads the single changed key when discarding afterward", async () => {
  await mount()
  const normal = sendMessage.getMockImplementation()!
  const save = Promise.withResolvers<unknown>()
  let submitted: OptionsConfigurationSnapshot | undefined
  sendMessage.mockImplementation((message: RuntimeMessage) => {
    if (message.type !== "SAVE_OPTIONS_CONFIGURATION") return normal(message)
    submitted = structuredClone(message.payload.configuration)
    return save.promise
  })
  await toggleNotifications()
  await act(async () => button("options_saveChanges").click())
  await toggleNotifications()
  configuration.settings.motionPreference = "system"
  await changeStorage({
    "settings:global": { newValue: configuration.settings },
  })
  const readsBeforeResolution = configurationReadCount()
  await act(async () => button("options_externalChangesReload").click())
  await act(async () => button("options_externalChangesKeepMine").click())

  expect(configurationReadCount()).toBe(readsBeforeResolution)
  expect(container.textContent).toContain(t("options_externalChangesTitle"))
  expect(button("options_discard").disabled).toBe(true)
  expect(button("options_saveChanges").disabled).toBe(true)

  await act(async () => save.resolve({ success: true, data: submitted }))
  expect(container.textContent).toContain(t("options_externalChangesTitle"))
  await act(async () => button("options_discard").click())
  await act(async () => button("options_discardChanges").click())

  expect(configurationReadCount()).toBe(readsBeforeResolution + 1)
  expect(container.textContent).not.toContain(t("options_externalChangesTitle"))
  expect(container.textContent).not.toContain(t("options_unsavedChanges"))
  expect(
    container.querySelector("#notifications")?.getAttribute("aria-checked")
  ).toBe(String(DEFAULT_SETTINGS.notifications))
})

it("keeps discard confirmation open while a separate conflict resolution is pending", async () => {
  await mount()
  await toggleNotifications()
  configuration.settings.motionPreference = "system"
  await changeStorage({
    "settings:global": { newValue: configuration.settings },
  })
  const normal = sendMessage.getMockImplementation()!
  const resolution = Promise.withResolvers<unknown>()
  sendMessage.mockImplementation((message: RuntimeMessage) =>
    message.type === "GET_OPTIONS_CONFIGURATION"
      ? resolution.promise
      : normal(message)
  )
  await act(async () => button("options_externalChangesKeepMine").click())
  const readsDuringResolution = configurationReadCount()
  expect(button("options_externalChangesReload").disabled).toBe(true)
  expect(button("options_externalChangesKeepMine").disabled).toBe(true)
  expect(button("options_saveChanges").disabled).toBe(true)
  await act(async () => button("options_discard").click())
  await act(async () => button("options_discardChanges").click())

  expect(document.querySelector('[role="alertdialog"]')).not.toBeNull()
  expect(configurationReadCount()).toBe(readsDuringResolution)
  expect(container.textContent).toContain(t("options_externalChangesTitle"))
  await act(async () =>
    resolution.resolve(configurationResponse(configuration))
  )
  expect(container.textContent).not.toContain(t("options_externalChangesTitle"))
  expect(document.querySelector('[role="alertdialog"]')).not.toBeNull()
  await act(async () => button("options_discardChanges").click())
  expect(document.querySelector('[role="alertdialog"]')).toBeNull()
  expect(container.textContent).not.toContain(t("options_unsavedChanges"))
})
