// @vitest-environment happy-dom
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { useOptionsPageState } from "@/entrypoints/options/hooks/useOptionsPageState"
import { DEFAULT_SETTINGS } from "@/src/domain/settings/defaults"
import type {
  OptionsConfigurationData,
  OptionsConfigurationSnapshot,
} from "@/src/runtime/runtime-message-contracts"
import type { DirHandle } from "@/src/storage/fs-access"

const boundary = vi.hoisted(() => ({
  send: vi.fn(),
  loadHandle: vi.fn(),
  stage: vi.fn(),
  verify: vi.fn(),
  request: vi.fn(),
  remove: vi.fn(),
}))
vi.mock("@/src/runtime/send-runtime-message", () => ({
  sendRuntimeMessage: boundary.send,
}))
vi.mock("@/src/storage/fs-access", () => ({
  loadDownloadRootHandle: boundary.loadHandle,
  saveDownloadRootHandle: boundary.stage,
  verifyPermission: boundary.verify,
  queryFsaPermission: vi.fn(async () => "granted"),
}))
vi.mock("@/src/site-integrations/host-permission-service", () => ({
  requestIntegrationHostPermission: boundary.request,
  removeUnusedHostPermissions: boundary.remove,
}))
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

type Listener = Parameters<typeof chrome.storage.onChanged.addListener>[0]
let state: ReturnType<typeof useOptionsPageState>
let root: Root
let container: HTMLDivElement
const listeners = new Set<Listener>()
function projection(): OptionsConfigurationData {
  return {
    configuration: {
      settings: structuredClone(DEFAULT_SETTINGS),
      overrides: {},
      enablement: {},
      integrationSettings: {},
    },
    historyStats: { totalChapters: 0, totalSeries: 0 },
    historySeries: [],
  }
}
function Harness() {
  state = useOptionsPageState()
  return null
}
async function mount() {
  await act(async () => root.render(createElement(Harness)))
}
async function change(changes: Record<string, chrome.storage.StorageChange>) {
  await act(async () =>
    listeners.forEach((listener) => listener(changes, "local"))
  )
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  vi.stubGlobal("chrome", {
    ...chrome,
    storage: {
      onChanged: {
        addListener: (listener: Listener) => listeners.add(listener),
        removeListener: (listener: Listener) => listeners.delete(listener),
      },
    },
  })
  boundary.send.mockImplementation(async (message) =>
    message.type === "SAVE_OPTIONS_CONFIGURATION"
      ? { success: true, data: message.payload.configuration }
      : { success: true, data: projection() }
  )
  boundary.verify.mockResolvedValue(true)
  boundary.remove.mockResolvedValue(undefined)
  boundary.request.mockResolvedValue(true)
  boundary.loadHandle.mockResolvedValue(null)
  boundary.stage.mockResolvedValue(undefined)
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  listeners.clear()
  vi.resetAllMocks()
  vi.unstubAllGlobals()
})

it("commits the submitted snapshot while retaining newer edits and concurrent storage conflicts", async () => {
  await mount()
  await act(async () => state.handleSettingsChange({ notifications: false }))
  const saved = Promise.withResolvers<{
    success: true
    data: OptionsConfigurationSnapshot
  }>()
  let submitted!: OptionsConfigurationSnapshot
  boundary.send.mockImplementationOnce((message) => {
    submitted = message.payload.configuration
    return saved.promise
  })
  let saving!: Promise<void>
  await act(async () => {
    saving = state.saveConfiguration()
  })
  expect(state.isSaving).toBe(true)
  await act(async () =>
    state.handleSettingsChange({ motionPreference: "reduce" })
  )
  await change({
    "settings:global": {
      newValue: { ...submitted.settings, notifications: true },
    },
  })
  await act(async () => {
    saved.resolve({ success: true, data: submitted })
    await saving
  })
  expect(state.settings?.notifications).toBe(false)
  expect(state.settings?.motionPreference).toBe(
    DEFAULT_SETTINGS.motionPreference
  )
  expect(state.settingsBuffer?.motionPreference).toBe("reduce")
  expect(state.hasUnsavedChanges).toBe(true)
  expect(state.hasExternalChanges).toBe(true)
  const calls = boundary.send.mock.calls.length
  await act(async () => state.saveConfiguration())
  expect(boundary.send).toHaveBeenCalledTimes(calls)
})

it("stages the picked capability before saving and clears a settled pending folder", async () => {
  const handle = { name: "Picked", kind: "directory" } as DirHandle
  vi.stubGlobal(
    "showDirectoryPicker",
    vi.fn(async () => handle)
  )
  await mount()
  await act(async () => state.pickDownloadFolder())
  expect(state.selectedFolderName).toBe("Picked")
  expect(state.hasUnsavedChanges).toBe(true)
  const order: string[] = []
  boundary.stage.mockImplementation(async () => {
    order.push("stage")
    boundary.loadHandle.mockResolvedValue(handle)
  })
  boundary.send.mockImplementationOnce(async (message) => {
    order.push("save")
    return { success: true, data: message.payload.configuration }
  })
  await act(async () => state.saveConfiguration())
  expect(order).toEqual(["stage", "save"])
  expect(boundary.stage).toHaveBeenCalledWith(
    handle,
    state.settings?.downloads.customDirectoryHandleId
  )
  expect(state.settings?.downloads.customDirectoryHandleId).toEqual(
    expect.any(String)
  )
  expect(state.hasUnsavedChanges).toBe(false)
  expect(state.selectedFolderName).toBe("Picked")
})

it("does not replace edits made while resolving an external conflict", async () => {
  await mount()
  await act(async () => state.handleSettingsChange({ notifications: false }))
  await change({
    siteOverrides: { newValue: { mangadex: { retries: { image: 1 } } } },
  })
  const loaded = Promise.withResolvers<{
    success: true
    data: OptionsConfigurationData
  }>()
  boundary.send.mockReturnValueOnce(loaded.promise)
  let resolving!: Promise<boolean>
  await act(async () => {
    resolving = state.resolveExternalChanges("reload")
  })
  await act(async () =>
    state.handleSettingsChange({ motionPreference: "reduce" })
  )
  await act(async () => {
    loaded.resolve({ success: true, data: projection() })
    await resolving
  })
  expect(await resolving).toBe(false)
  expect(state.settingsBuffer?.motionPreference).toBe("reduce")
  expect(state.hasExternalChanges).toBe(true)
})

it("rebases local edits then reloads to discard local configuration and a picked folder", async () => {
  await mount()
  await act(async () => state.handleSettingsChange({ notifications: false }))
  await change({ siteOverrides: {} })
  const latest = projection()
  latest.configuration.settings.motionPreference = "reduce"
  latest.configuration.enablement.mangadex = false
  boundary.send.mockResolvedValue({ success: true, data: latest })
  await act(async () => {
    expect(await state.resolveExternalChanges("keep-mine")).toBe(true)
  })
  expect(state.settingsBuffer?.notifications).toBe(false)
  expect(state.settingsBuffer?.motionPreference).toBe("reduce")
  expect(state.hasExternalChanges).toBe(false)
  const handle = { name: "Discarded", kind: "directory" } as DirHandle
  vi.stubGlobal(
    "showDirectoryPicker",
    vi.fn(async () => handle)
  )
  await act(async () => state.pickDownloadFolder())
  await change({ siteOverrides: {} })
  await act(async () => {
    expect(await state.discardChanges()).toBe(true)
  })
  expect(state.settingsBuffer).toEqual(latest.configuration.settings)
  expect(state.selectedFolderName).toBeNull()
  expect(state.hasUnsavedChanges).toBe(false)
  expect(boundary.remove).toHaveBeenCalledWith({ mangadex: false })
})

it("requests host permission synchronously from enablement and keeps denied enablement unchanged", async () => {
  await mount()
  const permission = Promise.withResolvers<boolean>()
  boundary.request.mockReturnValueOnce(permission.promise)
  let enabling!: Promise<void>
  await act(async () => {
    enabling = state.handleSiteIntegrationEnablementChange("mangadex", true)
    expect(boundary.request).toHaveBeenCalledExactlyOnceWith("mangadex")
  })
  expect(state.siteIntegrationEnablement.mangadex).toBeUndefined()
  await act(async () => {
    permission.resolve(false)
    await enabling
  })
  expect(state.siteIntegrationEnablement.mangadex).toBeUndefined()
  await act(async () =>
    state.handleSiteIntegrationEnablementChange("mangadex", true)
  )
  expect(state.siteIntegrationEnablement.mangadex).toBe(true)
})

it("retries failed hydration and removes its subscription on unmount", async () => {
  boundary.send.mockRejectedValueOnce(new Error("Unavailable"))
  await mount()
  expect(state.loadFailed).toBe(true)
  await act(async () => state.retryLoad())
  expect(state.loadFailed).toBe(false)
  expect(state.settings).not.toBeNull()
  expect(listeners.size).toBe(1)
  await act(async () => root.unmount())
  expect(listeners.size).toBe(0)
})

it.each(["unsupported", "aborted", "denied", "failure"])(
  "keeps the draft folder unchanged when the picker is %s",
  async (outcome) => {
    const handle = { name: "Candidate", kind: "directory" } as DirHandle
    if (outcome !== "unsupported")
      vi.stubGlobal(
        "showDirectoryPicker",
        vi.fn(async () => {
          if (outcome === "aborted")
            throw new DOMException("Canceled", "AbortError")
          if (outcome === "failure") throw new Error("Picker unavailable")
          return handle
        })
      )
    boundary.verify.mockResolvedValue(false)
    await mount()
    await act(async () => state.pickDownloadFolder())
    expect(state.selectedFolderName).toBeNull()
    expect(state.hasUnsavedChanges).toBe(false)
    expect(state.isPickingFolder).toBe(false)
    const { toast } = await import("sonner")
    if (outcome === "aborted") expect(toast.error).not.toHaveBeenCalled()
    else expect(toast.error).toHaveBeenCalledOnce()
  }
)

it("retains a picked folder after staging fails and permits retry", async () => {
  const handle = { name: "Retry folder", kind: "directory" } as DirHandle
  vi.stubGlobal(
    "showDirectoryPicker",
    vi.fn(async () => handle)
  )
  await mount()
  await act(async () => state.pickDownloadFolder())
  boundary.stage.mockRejectedValueOnce(new Error("Handle database unavailable"))
  const before = boundary.send.mock.calls.length
  await act(async () => state.saveConfiguration())
  expect(boundary.send).toHaveBeenCalledTimes(before)
  expect(state.settings?.downloads.destination).toBe("downloads-api")
  expect(state.selectedFolderName).toBe("Retry folder")
  expect(state.hasUnsavedChanges).toBe(true)
  expect(state.isSaving).toBe(false)
  boundary.stage.mockImplementation(async () => {
    boundary.loadHandle.mockResolvedValue(handle)
  })
  await act(async () => state.saveConfiguration())
  expect(state.hasUnsavedChanges).toBe(false)
  expect(state.settings?.downloads.destination).toBe("file-system-access")
})

it.each(["template", "settings", "folder"])(
  "blocks an invalid %s before submitting configuration",
  async (invalid) => {
    await mount()
    await act(async () => {
      if (invalid === "settings")
        state.handleSettingsChange({ globalRetries: { image: -1, chapter: 3 } })
      else
        state.handleSettingsChange({
          downloads: {
            ...state.settingsBuffer!.downloads,
            ...(invalid === "folder"
              ? { destination: "file-system-access" as const }
              : { pathTemplate: "<UNKNOWN>" }),
          },
        })
    })
    const before = boundary.send.mock.calls.length
    await act(async () => state.saveConfiguration())
    expect(boundary.send).toHaveBeenCalledTimes(before)
    expect(state.isSaving).toBe(false)
    expect(state.hasUnsavedChanges).toBe(true)
    const { toast } = await import("sonner")
    expect(toast.error).toHaveBeenCalledOnce()
  }
)

it("discards a local draft and clears its pending folder without reloading", async () => {
  const handle = { name: "Discarded", kind: "directory" } as DirHandle
  vi.stubGlobal(
    "showDirectoryPicker",
    vi.fn(async () => handle)
  )
  await mount()
  await act(async () => state.pickDownloadFolder())
  const before = boundary.send.mock.calls.length
  await act(async () => {
    expect(await state.discardChanges()).toBe(true)
  })
  expect(boundary.send).toHaveBeenCalledTimes(before)
  expect(state.settingsBuffer).toEqual(state.settings)
  expect(state.selectedFolderName).toBeNull()
  expect(state.hasUnsavedChanges).toBe(false)
})

it.each(["missing", "denied", "failure"])(
  "retains the current configuration when folder access is %s",
  async (outcome) => {
    const handle = { name: "Saved folder", kind: "directory" } as DirHandle
    const loaded = projection()
    loaded.configuration.settings.downloads.destination = "file-system-access"
    loaded.configuration.settings.downloads.customDirectoryHandleId =
      "saved-folder"
    boundary.send.mockResolvedValue({ success: true, data: loaded })
    boundary.loadHandle.mockResolvedValue(handle)
    await mount()
    if (outcome === "missing") boundary.loadHandle.mockResolvedValue(null)
    else if (outcome === "failure")
      boundary.loadHandle.mockRejectedValue(new Error("Unavailable"))
    else boundary.verify.mockResolvedValue(false)
    await act(async () => {
      expect(await state.grantDownloadFolderAccess()).toBe(false)
    })
    expect(state.selectedFolderName).toBe("Saved folder")
    expect(state.settings?.downloads.customDirectoryHandleId).toBe(
      "saved-folder"
    )
    expect(state.isPickingFolder).toBe(false)
  }
)

it("refreshes chapter history only after successful clears and retains it after failures", async () => {
  await mount()
  const refreshed = projection()
  refreshed.historyStats = { totalChapters: 3, totalSeries: 1 }
  boundary.send.mockImplementation(async (message) =>
    message.type === "CLEAR_PERSISTED_DOWNLOAD_HISTORY"
      ? { success: true }
      : { success: true, data: refreshed }
  )
  await act(async () => {
    expect(await state.clearChapterHistory()).toBe(true)
  })
  expect(state.historyStats).toEqual(refreshed.historyStats)
  boundary.send.mockRejectedValueOnce(new Error("History unavailable"))
  await act(async () => {
    expect(await state.clearSeriesHistory("mangadex", "series")).toBe(false)
  })
  expect(state.historyStats).toEqual(refreshed.historyStats)
  expect(state.isClearing).toBe(false)
  await act(async () => {
    expect(await state.clearSeriesHistory("mangadex", "series")).toBe(true)
  })
  await act(async () => {
    expect(await state.handleRefreshHistory()).toEqual([])
  })
})

it.each(["success", "failure"])(
  "keeps a newer external hydration when the original read settles with %s",
  async (outcome) => {
    const initial = Promise.withResolvers<unknown>()
    boundary.send.mockReturnValueOnce(initial.promise)
    await mount()
    expect(state.isLoading).toBe(true)
    const latest = projection()
    latest.configuration.settings.notifications = false
    latest.historyStats.totalSeries = 4
    boundary.send.mockResolvedValue({ success: true, data: latest })
    await change({ "settings:global": {} })
    expect(state.settings?.notifications).toBe(false)
    expect(state.historyStats?.totalSeries).toBe(4)
    await act(async () => {
      if (outcome === "success")
        initial.resolve({ success: true, data: projection() })
      else initial.reject(new Error("Obsolete hydration failed"))
    })
    expect(state.settings?.notifications).toBe(false)
    expect(state.loadFailed).toBe(false)
    const { toast } = await import("sonner")
    expect(toast.error).not.toHaveBeenCalled()
  }
)

it("preserves a conflict when an external refresh fails and retries resolution", async () => {
  await mount()
  boundary.send.mockRejectedValueOnce(new Error("Read unavailable"))
  await change({ siteOverrides: {} })
  expect(state.hasExternalChanges).toBe(true)
  boundary.send.mockRejectedValueOnce(new Error("Resolution unavailable"))
  await act(async () => {
    expect(await state.resolveExternalChanges("reload")).toBe(false)
  })
  expect(state.hasExternalChanges).toBe(true)
  expect(state.isResolvingExternalChanges).toBe(false)
  await act(async () => {
    expect(await state.resolveExternalChanges("reload")).toBe(true)
  })
  expect(state.hasExternalChanges).toBe(false)
})

it("blocks duplicate saves and folder changes until the current save settles", async () => {
  await mount()
  await act(async () => state.handleSettingsChange({ notifications: false }))
  const response = Promise.withResolvers<{
    success: true
    data: OptionsConfigurationSnapshot
  }>()
  let submitted!: OptionsConfigurationSnapshot
  boundary.send.mockImplementationOnce((message) => {
    submitted = message.payload.configuration
    return response.promise
  })
  const picker = vi.fn(
    async () => ({ name: "Other", kind: "directory" }) as DirHandle
  )
  vi.stubGlobal("showDirectoryPicker", picker)
  const calls = boundary.send.mock.calls.length
  let saving!: Promise<void>
  await act(async () => {
    saving = state.saveConfiguration()
    await state.saveConfiguration()
    await state.pickDownloadFolder()
    expect(await state.discardChanges()).toBe(false)
  })
  expect(boundary.send).toHaveBeenCalledTimes(calls + 1)
  expect(picker).not.toHaveBeenCalled()
  expect(state.isSaving).toBe(true)
  await act(async () => {
    response.resolve({ success: true, data: submitted })
    await saving
  })
  expect(state.isSaving).toBe(false)
  expect(state.hasUnsavedChanges).toBe(false)
})
