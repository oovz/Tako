// @vitest-environment happy-dom
import { act, createElement } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, expect, it, vi } from "vitest"

import { useOptionsFolderManagement } from "@/entrypoints/options/hooks/useOptionsFolderManagement"
import { OptionsFsaController } from "@/entrypoints/options/controllers/options-fsa-controller"
import { DEFAULT_SETTINGS } from "@/src/domain/settings/defaults"
import type { DirHandle } from "@/src/storage/fs-access"
import { t } from "@/src/runtime/i18n"

const handles = vi.hoisted(() => new Map<string, DirHandle>())
const currentDefault = vi.hoisted(() => ({ id: "displayed-folder" }))

vi.mock("@/src/storage/fs-access", () => ({
  loadDownloadRootHandle: vi.fn(async (id?: string | null) =>
    handles.get(id === undefined ? currentDefault.id : (id ?? ""))
  ),
  saveDownloadRootHandle: vi.fn(),
  queryFsaPermission: vi.fn(async () => "prompt"),
  verifyPermission: vi.fn(async () => true),
}))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

afterEach(() => {
  handles.clear()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

it("renews the displayed folder after another Options page changes the default", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  const displayed = { name: "Displayed folder" } as DirHandle
  const replacement = { name: "New default" } as DirHandle
  handles.set("displayed-folder", displayed)
  handles.set("replacement-folder", replacement)
  currentDefault.id = "displayed-folder"
  const settings = structuredClone(DEFAULT_SETTINGS)
  settings.downloads.destination = "file-system-access"
  settings.downloads.customDirectoryHandleId = "displayed-folder"
  const fsaController = new OptionsFsaController()
  const isSavingRef = { current: false }
  let folder!: ReturnType<typeof useOptionsFolderManagement>
  function Harness() {
    folder = useOptionsFolderManagement({
      fsaController,
      isSavingRef,
      savedHandleId: "displayed-folder",
      settingsBuffer: settings,
      onSettingsChange: vi.fn(),
    })
    return null
  }
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  try {
    await act(async () => root.render(createElement(Harness)))
    expect(folder.selectedFolderName).toBe("Displayed folder")
    expect(folder.folderAccessRequired).toBe(true)
    currentDefault.id = "replacement-folder"

    await act(async () => {
      expect(await folder.grantDownloadFolderAccess()).toBe(true)
    })

    const { verifyPermission } = await import("@/src/storage/fs-access")
    expect(verifyPermission).toHaveBeenCalledExactlyOnceWith(displayed, true)
    expect(folder.selectedFolderName).toBe("Displayed folder")
    expect(folder.folderAccessRequired).toBe(false)
  } finally {
    await act(async () => root.unmount())
    container.remove()
  }
})

it.each([false, true])(
  "keeps a synchronized folder when older permission completes (new folder read pending: %s)",
  async (readPending) => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
    const displayed = { name: "Displayed folder" } as DirHandle
    const replacement = { name: "New default" } as DirHandle
    handles.set("displayed-folder", displayed)
    handles.set("replacement-folder", replacement)
    const permission = Promise.withResolvers<boolean>()
    const replacementPermission = Promise.withResolvers<PermissionState>()
    const { queryFsaPermission, verifyPermission } =
      await import("@/src/storage/fs-access")
    vi.mocked(verifyPermission).mockImplementationOnce(() => permission.promise)
    vi.mocked(queryFsaPermission).mockImplementation(async (handle) =>
      handle === replacement && readPending
        ? replacementPermission.promise
        : "prompt"
    )
    const fsaController = new OptionsFsaController()
    const isSavingRef = { current: false }
    let folder!: ReturnType<typeof useOptionsFolderManagement>
    function Harness({ id }: { id: string }) {
      const settings = structuredClone(DEFAULT_SETTINGS)
      settings.downloads.destination = "file-system-access"
      settings.downloads.customDirectoryHandleId = id
      folder = useOptionsFolderManagement({
        fsaController,
        isSavingRef,
        savedHandleId: id,
        settingsBuffer: settings,
        onSettingsChange: vi.fn(),
      })
      return null
    }
    const container = document.createElement("div")
    document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () =>
        root.render(createElement(Harness, { id: "displayed-folder" }))
      )
      let result!: Promise<boolean>
      await act(async () => {
        result = folder.grantDownloadFolderAccess()
      })
      expect(verifyPermission).toHaveBeenCalledExactlyOnceWith(displayed, true)
      await act(async () =>
        root.render(createElement(Harness, { id: "replacement-folder" }))
      )
      if (!readPending) {
        expect(folder.selectedFolderName).toBe("New default")
        expect(folder.folderAccessRequired).toBe(true)
      }

      await act(async () => {
        permission.resolve(true)
        await result
      })
      await act(async () => replacementPermission.resolve("prompt"))

      expect(folder.selectedFolderName).toBe("New default")
      expect(folder.folderAccessRequired).toBe(true)
      expect(await result).toBe(false)
      expect(folder.isPickingFolder).toBe(false)
      const { toast } = await import("sonner")
      expect(toast.success).not.toHaveBeenCalled()
      expect(toast.error).not.toHaveBeenCalled()
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  }
)

function directory(name: string): DirHandle {
  const handle: DirHandle = {
    kind: "directory",
    name,
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
  return handle
}

it.each(["current", "replaced"])(
  "keeps the %s folder owner's state when an access-renewal lookup rejects",
  async (owner) => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
    const displayed = directory("Displayed folder")
    const replacement = directory("New default")
    handles.set("displayed-folder", displayed)
    handles.set("replacement-folder", replacement)
    const { loadDownloadRootHandle, queryFsaPermission } =
      await import("@/src/storage/fs-access")
    vi.mocked(queryFsaPermission).mockResolvedValue("prompt")
    const lookup = Promise.withResolvers<DirHandle | undefined>()
    const fsaController = new OptionsFsaController()
    const isSavingRef = { current: false }
    let folder!: ReturnType<typeof useOptionsFolderManagement>
    function Harness({ id }: { id: string }) {
      const settings = structuredClone(DEFAULT_SETTINGS)
      settings.downloads.destination = "file-system-access"
      settings.downloads.customDirectoryHandleId = id
      folder = useOptionsFolderManagement({
        fsaController,
        isSavingRef,
        savedHandleId: id,
        settingsBuffer: settings,
        onSettingsChange: vi.fn(),
      })
      return null
    }
    const container = document.createElement("div")
    document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () =>
        root.render(createElement(Harness, { id: "displayed-folder" }))
      )
      vi.mocked(loadDownloadRootHandle).mockImplementationOnce(
        () => lookup.promise
      )
      let result!: Promise<boolean>
      await act(async () => {
        result = folder.grantDownloadFolderAccess()
      })
      expect(folder.isPickingFolder).toBe(true)
      if (owner === "replaced")
        await act(async () =>
          root.render(createElement(Harness, { id: "replacement-folder" }))
        )

      await act(async () => {
        lookup.reject(new Error("Handle store unavailable"))
        expect(await result).toBe(false)
      })

      expect(folder.selectedFolderName).toBe(
        owner === "replaced" ? "New default" : "Displayed folder"
      )
      expect(folder.folderAccessRequired).toBe(true)
      expect(folder.isPickingFolder).toBe(false)
      const { toast } = await import("sonner")
      if (owner === "current")
        expect(toast.error).toHaveBeenCalledExactlyOnceWith(
          t("options_toastPermissionDenied")
        )
      else expect(toast.error).not.toHaveBeenCalled()
      expect(toast.success).not.toHaveBeenCalled()
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  }
)
