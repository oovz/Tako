// @vitest-environment happy-dom
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { StorageTab } from "@/entrypoints/options/tabs/StorageTab"
import { NetworkTab } from "@/entrypoints/options/tabs/NetworkTab"
import { DEFAULT_SETTINGS } from "@/src/domain/settings/defaults"
import { RATE_POLICY_LIMITS } from "@/src/shared/rate-policy-limits"
import { OptionsPage } from "@/entrypoints/options/main-options-page"
import { t } from "@/src/runtime/i18n"
import type {
  OptionsConfigurationSnapshot,
  RuntimeMessage,
} from "@/src/runtime/runtime-message-contracts"

const handleStorage = vi.hoisted(() => ({ load: vi.fn(), stage: vi.fn() }))
vi.mock("@/src/storage/fs-access", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/src/storage/fs-access")>()),
  loadDownloadRootHandle: handleStorage.load,
  saveDownloadRootHandle: handleStorage.stage,
}))

let root: Root
let container: HTMLDivElement
const onChange = vi.fn()

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
  document.documentElement.removeAttribute("data-tako-motion")
})

async function mountStorage(
  downloads: Partial<typeof DEFAULT_SETTINGS.downloads> = {}
) {
  const settings = {
    ...DEFAULT_SETTINGS,
    downloads: { ...DEFAULT_SETTINGS.downloads, ...downloads },
  }
  await act(async () =>
    root.render(
      createElement(StorageTab, {
        settings,
        onChange,
        selectedFolderName: null,
        folderAccessRequired: false,
        onGrantFolderAccess: async () => true,
        onPickFolder: async () => {},
        isPickingFolder: false,
        isSaving: false,
      })
    )
  )
  return settings
}

async function enter(selector: string, value: string) {
  const input = container.querySelector<HTMLInputElement>(selector)!
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value"
    )!.set!.call(input, value)
    input.dispatchEvent(new Event("input", { bubbles: true }))
  })
}

it.each([
  ["", "<SERIES_TITLE>"],
  ["Library", "Library/<SERIES_TITLE>"],
  ["Library/", "Library/<SERIES_TITLE>"],
])(
  "appends directory macros with one separator to %j",
  async (pathTemplate, expected) => {
    const settings = await mountStorage({ pathTemplate })
    const macro = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "+ <SERIES_TITLE>"
    )!
    await act(async () => macro.click())
    expect(onChange).toHaveBeenCalledExactlyOnceWith({
      downloads: { ...settings.downloads, pathTemplate: expected },
    })
  }
)

it.each([
  ["", "<CHAPTER_TITLE>"],
  ["Chapter", "Chapter - <CHAPTER_TITLE>"],
])(
  "appends filename macros with the filename separator to %j",
  async (fileNameTemplate, expected) => {
    const settings = await mountStorage({ fileNameTemplate })
    const macro = Array.from(container.querySelectorAll("button")).filter(
      (button) => button.textContent === "+ <CHAPTER_TITLE>"
    )[1]!
    await act(async () => macro.click())
    expect(onChange).toHaveBeenCalledExactlyOnceWith({
      downloads: { ...settings.downloads, fileNameTemplate: expected },
    })
  }
)

it("marks invalid templates and forwards text edits while preserving other download defaults", async () => {
  const settings = await mountStorage({
    pathTemplate: "<UNKNOWN>",
    fileNameTemplate: "<CHAPTER_TITLE",
  })
  expect(
    container.querySelector("#download-path")?.getAttribute("aria-invalid")
  ).toBe("true")
  expect(
    container.querySelector("#filename-template")?.getAttribute("aria-invalid")
  ).toBe("true")
  await enter("#download-path", "Library/<SERIES_TITLE>")
  expect(onChange).toHaveBeenLastCalledWith({
    downloads: {
      ...settings.downloads,
      pathTemplate: "Library/<SERIES_TITLE>",
    },
  })
  await enter("#filename-template", "<CHAPTER_NUMBER>")
  expect(onChange).toHaveBeenLastCalledWith({
    downloads: { ...settings.downloads, fileNameTemplate: "<CHAPTER_NUMBER>" },
  })
  await enter("#filename-template", "")
  expect(onChange).toHaveBeenLastCalledWith({
    downloads: { ...settings.downloads, fileNameTemplate: "" },
  })
})

it("changes metadata switches without replacing unrelated download settings", async () => {
  const settings = await mountStorage()
  for (const [id, key] of [
    ["comicinfo", "includeComicInfo"],
    ["cover-image", "includeCoverImage"],
    ["normalize", "normalizeImageFilenames"],
  ] as const) {
    await act(async () =>
      container.querySelector<HTMLButtonElement>(`#${id}`)!.click()
    )
    expect(onChange).toHaveBeenLastCalledWith({
      downloads: { ...settings.downloads, [key]: !settings.downloads[key] },
    })
  }
})

it("bounds image and chapter delays independently and retains the other policy fields", async () => {
  await act(async () =>
    root.render(
      createElement(NetworkTab, { settings: DEFAULT_SETTINGS, onChange })
    )
  )
  await enter("#image-request-delay", "-100")
  expect(onChange).toHaveBeenLastCalledWith({
    globalPolicy: {
      ...DEFAULT_SETTINGS.globalPolicy,
      image: {
        ...DEFAULT_SETTINGS.globalPolicy.image,
        delayMs: RATE_POLICY_LIMITS.MIN_DELAY_MS,
      },
    },
  })
  await enter("#chapter-delay", "99999999")
  expect(onChange).toHaveBeenLastCalledWith({
    globalPolicy: {
      ...DEFAULT_SETTINGS.globalPolicy,
      chapter: {
        ...DEFAULT_SETTINGS.globalPolicy.chapter,
        delayMs: RATE_POLICY_LIMITS.MAX_DELAY_MS,
      },
    },
  })
  const zeroPresets = Array.from(container.querySelectorAll("button")).filter(
    (button) => button.textContent === "0ms"
  )
  await act(async () => zeroPresets[1].click())
  expect(onChange).toHaveBeenLastCalledWith({
    globalPolicy: {
      ...DEFAULT_SETTINGS.globalPolicy,
      chapter: { ...DEFAULT_SETTINGS.globalPolicy.chapter, delayMs: 0 },
    },
  })
  await enter("#image-retries", "")
  expect(onChange).toHaveBeenLastCalledWith({
    globalRetries: { ...DEFAULT_SETTINGS.globalRetries, image: 0 },
  })
  await enter("#chapter-retries", "7")
  expect(onChange).toHaveBeenLastCalledWith({
    globalRetries: { ...DEFAULT_SETTINGS.globalRetries, chapter: 7 },
  })
})

type PermissionDescriptor = { mode: "read" | "readwrite" }

function directory(
  name: string,
  permission: { read: PermissionState; readwrite: PermissionState }
) {
  const queryPermission = vi.fn(
    async ({ mode }: PermissionDescriptor) => permission[mode]
  )
  const requestPermission = vi.fn(
    async ({ mode }: PermissionDescriptor) => permission[mode]
  )
  const handle: FileSystemDirectoryHandle & {
    queryPermission: typeof queryPermission
    requestPermission: typeof requestPermission
  } = {
    kind: "directory",
    name,
    queryPermission,
    requestPermission,
    isSameEntry: async (other) => other === handle,
    getDirectoryHandle: async () => {
      throw new Error("Unexpected subdirectory access")
    },
    getFileHandle: async () => {
      throw new Error("Unexpected file access")
    },
    removeEntry: async () => {
      throw new Error("Unexpected directory mutation")
    },
    resolve: async () => null,
    async *entries() {
      yield* []
      return undefined
    },
    async *keys() {
      yield* []
      return undefined
    },
    async *values() {
      yield* []
      return undefined
    },
    [Symbol.asyncIterator]() {
      return this.entries()
    },
  }
  return { handle, queryPermission, requestPermission }
}

describe("Options folder workflows", () => {
  type StorageListener = Parameters<
    typeof chrome.storage.onChanged.addListener
  >[0]
  let configuration: OptionsConfigurationSnapshot
  const storedHandles = new Map<string, FileSystemDirectoryHandle>()
  const listeners = new Set<StorageListener>()
  const grantedOrigins = new Set<string>()
  const picker = vi.fn<() => Promise<FileSystemDirectoryHandle>>()
  const sendMessage = vi.fn()
  const request = vi.fn()
  const remove = vi.fn()

  function button(key: Parameters<typeof t>[0]) {
    const control = Array.from(document.querySelectorAll("button")).find(
      (item) => item.textContent === t(key)
    )
    expect(control).toBeDefined()
    return control!
  }

  async function mountPage() {
    await act(async () => root.render(createElement(OptionsPage)))
    await act(async () => vi.dynamicImportSettled())
  }

  function commandCount(type: RuntimeMessage["type"]) {
    return sendMessage.mock.calls.filter(([message]) => message.type === type)
      .length
  }

  beforeEach(() => {
    configuration = {
      settings: structuredClone(DEFAULT_SETTINGS),
      overrides: {},
      enablement: {},
      integrationSettings: {},
    }
    storedHandles.clear()
    listeners.clear()
    grantedOrigins.clear()
    handleStorage.load
      .mockReset()
      .mockImplementation(async (id: string) => storedHandles.get(id))
    handleStorage.stage
      .mockReset()
      .mockImplementation(
        async (handle: FileSystemDirectoryHandle, id: string) => {
          storedHandles.set(id, handle)
        }
      )
    picker
      .mockReset()
      .mockRejectedValue(new DOMException("Canceled", "AbortError"))
    sendMessage
      .mockReset()
      .mockImplementation(async (message: RuntimeMessage) => {
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
          default:
            throw new Error(`Unexpected message ${message.type}`)
        }
      })
    request
      .mockReset()
      .mockImplementation(
        async ({ origins }: chrome.permissions.Permissions) => {
          origins?.forEach((origin) => grantedOrigins.add(origin))
          return true
        }
      )
    remove
      .mockReset()
      .mockImplementation(
        async ({ origins }: chrome.permissions.Permissions) => {
          origins?.forEach((origin) => grantedOrigins.delete(origin))
          return true
        }
      )
    vi.stubGlobal("chrome", {
      ...chrome,
      runtime: {
        sendMessage,
        getManifest: () => ({
          version: "2.0.9",
          host_permissions: [],
          optional_host_permissions: ["https://*/*"],
        }),
      },
      storage: {
        local: { get: async () => ({}) },
        onChanged: {
          addListener: (listener: StorageListener) => listeners.add(listener),
          removeListener: (listener: StorageListener) =>
            listeners.delete(listener),
        },
      },
      permissions: {
        request,
        remove,
        getAll: async () => ({ origins: [...grantedOrigins] }),
      },
    })
    vi.stubGlobal("showDirectoryPicker", picker)
    vi.stubGlobal(
      "FileSystemHandle",
      class {
        async queryPermission(): Promise<PermissionState> {
          return "granted"
        }
        async requestPermission(): Promise<PermissionState> {
          return "granted"
        }
      }
    )
    vi.stubGlobal(
      "FileSystemFileHandle",
      class {
        async createWritable() {
          throw new Error("Unexpected native file write")
        }
      }
    )
    vi.stubGlobal("indexedDB", {
      open: () => {
        throw new Error("Unexpected native handle storage")
      },
    })
    container.id = "root"
    window.history.replaceState(null, "", "?tab=storage")
  })

  it("rejects a picked folder that grants read access but denies writable access", async () => {
    const selected = directory("Read-only folder", {
      read: "granted",
      readwrite: "denied",
    })
    picker.mockResolvedValue(selected.handle)
    await mountPage()
    expect(button("options_selectFolder").disabled).toBe(false)
    await act(async () => button("options_selectFolder").click())

    expect(selected.queryPermission).toHaveBeenCalledExactlyOnceWith({
      mode: "readwrite",
    })
    expect(selected.requestPermission).toHaveBeenCalledExactlyOnceWith({
      mode: "readwrite",
    })
    expect(
      container
        .querySelector("#custom-folder-switch")
        ?.getAttribute("aria-checked")
    ).toBe("false")
    expect(container.textContent).not.toContain(selected.handle.name)
    expect(commandCount("SAVE_OPTIONS_CONFIGURATION")).toBe(0)
  })

  it("requires writable renewal for a saved folder even when read access is granted", async () => {
    const permission: { read: PermissionState; readwrite: PermissionState } = {
      read: "granted",
      readwrite: "prompt",
    }
    const saved = directory("Saved folder", permission)
    storedHandles.set("saved-folder", saved.handle)
    configuration.settings.downloads.destination = "file-system-access"
    configuration.settings.downloads.customDirectoryHandleId = "saved-folder"
    await mountPage()
    expect(button("folderAccess_grant").disabled).toBe(false)
    expect(saved.queryPermission).toHaveBeenCalledWith({ mode: "readwrite" })

    saved.requestPermission.mockImplementationOnce(async ({ mode }) => {
      permission.readwrite = "granted"
      return permission[mode]
    })
    await act(async () => button("folderAccess_grant").click())

    expect(container.textContent).not.toContain(
      t("options_savedFolderRepairRequired")
    )
    expect(container.textContent).toContain(saved.handle.name)
    expect(
      saved.queryPermission.mock.calls.every(
        ([descriptor]) => descriptor.mode === "readwrite"
      )
    ).toBe(true)
    expect(saved.requestPermission).toHaveBeenCalledExactlyOnceWith({
      mode: "readwrite",
    })
    expect(picker).not.toHaveBeenCalled()
  })

  it("saves edits using a writable saved folder without selecting a new folder", async () => {
    const saved = directory("Writable saved folder", {
      read: "granted",
      readwrite: "granted",
    })
    storedHandles.set("saved-folder", saved.handle)
    configuration.settings.downloads.destination = "file-system-access"
    configuration.settings.downloads.customDirectoryHandleId = "saved-folder"
    await mountPage()
    expect(container.textContent).not.toContain(
      t("options_savedFolderRepairRequired")
    )
    await act(async () =>
      container.querySelector<HTMLButtonElement>("#comicinfo")!.click()
    )
    await act(async () => button("options_saveChanges").click())

    expect(commandCount("SAVE_OPTIONS_CONFIGURATION")).toBe(1)
    expect(configuration.settings.downloads).toMatchObject({
      destination: "file-system-access",
      customDirectoryHandleId: "saved-folder",
      includeComicInfo: !DEFAULT_SETTINGS.downloads.includeComicInfo,
    })
    expect(container.textContent).not.toContain(t("options_unsavedChanges"))
    expect(picker).not.toHaveBeenCalled()
    expect(handleStorage.stage).not.toHaveBeenCalled()
  })

  it("blocks Save, its shortcut and conflict resolution while a picked folder's permission query is pending", async () => {
    const selected = directory("Pending folder", {
      read: "granted",
      readwrite: "granted",
    })
    const permission = Promise.withResolvers<PermissionState>()
    selected.queryPermission.mockReturnValueOnce(permission.promise)
    picker.mockResolvedValue(selected.handle)
    await mountPage()
    await act(async () =>
      container.querySelector<HTMLButtonElement>("#comicinfo")!.click()
    )
    await act(async () => button("options_selectFolder").click())
    expect(picker).toHaveBeenCalledOnce()
    expect(selected.queryPermission).toHaveBeenCalledExactlyOnceWith({
      mode: "readwrite",
    })
    expect(button("options_selectFolder").disabled).toBe(true)
    expect(button("options_saveChanges").disabled).toBe(false)
    await act(async () => button("options_saveChanges").click())
    await act(async () =>
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "s",
          ctrlKey: true,
          cancelable: true,
        })
      )
    )
    expect(commandCount("SAVE_OPTIONS_CONFIGURATION")).toBe(0)

    configuration.overrides = { mangadex: { outputFormat: "zip" } }
    await act(async () =>
      listeners.forEach((listener) =>
        listener(
          { siteOverrides: { newValue: configuration.overrides } },
          "local"
        )
      )
    )
    const reads = commandCount("GET_OPTIONS_CONFIGURATION")
    await act(async () => button("options_externalChangesReload").click())
    await act(async () => button("options_externalChangesKeepMine").click())
    expect(commandCount("GET_OPTIONS_CONFIGURATION")).toBe(reads)
    expect(container.textContent).toContain(t("options_externalChangesTitle"))

    await act(async () => permission.resolve("granted"))
    await act(async () => button("options_externalChangesKeepMine").click())
    await act(async () => button("options_saveChanges").click())
    expect(commandCount("SAVE_OPTIONS_CONFIGURATION")).toBe(1)
    expect(configuration.settings.downloads).toMatchObject({
      destination: "file-system-access",
      includeComicInfo: !DEFAULT_SETTINGS.downloads.includeComicInfo,
    })
    expect(configuration.overrides).toEqual({
      mangadex: { outputFormat: "zip" },
    })
    expect(handleStorage.stage).toHaveBeenCalledWith(
      selected.handle,
      configuration.settings.downloads.customDirectoryHandleId
    )
    expect(container.textContent).not.toContain(t("options_unsavedChanges"))
  })

  it("removes an unsaved integration's temporary host grant when Options closes", async () => {
    await mountPage()
    await act(async () => button("options_siteIntegrations").click())
    await act(async () => vi.dynamicImportSettled())
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>("#mangadex-integration-enabled")!
        .click()
    )
    expect(grantedOrigins).toEqual(new Set(["https://*/*"]))
    expect(request).toHaveBeenCalledExactlyOnceWith({
      origins: ["https://*/*"],
    })
    expect(commandCount("SAVE_OPTIONS_CONFIGURATION")).toBe(0)
    expect(configuration.enablement).toEqual({})

    await act(async () => root.unmount())

    expect(remove).toHaveBeenCalledExactlyOnceWith({ origins: ["https://*/*"] })
    expect(grantedOrigins.size).toBe(0)
    expect(listeners.size).toBe(0)
  })
})
