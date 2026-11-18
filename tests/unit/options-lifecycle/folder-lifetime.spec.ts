// @vitest-environment happy-dom
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { OptionsFsaController } from "@/entrypoints/options/controllers/options-fsa-controller"
import { useOptionsFolderManagement } from "@/entrypoints/options/hooks/useOptionsFolderManagement"
import { DEFAULT_SETTINGS } from "@/src/domain/settings/defaults"
import type { DirHandle } from "@/src/storage/fs-access"
const boundary = vi.hoisted(() => ({
  load: vi.fn(),
  query: vi.fn(),
  verify: vi.fn(),
  setupRequired: vi.fn(),
  send: vi.fn(),
}))
vi.mock("@/src/storage/fs-access", () => ({
  loadDownloadRootHandle: boundary.load,
  queryFsaPermission: boundary.query,
  verifyPermission: boundary.verify,
  readFolderSetupRequired: boundary.setupRequired,
}))
vi.mock("@/src/runtime/send-runtime-message", () => ({
  sendRuntimeMessage: boundary.send,
}))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
let folder: ReturnType<typeof useOptionsFolderManagement>
let root: Root
let container: HTMLDivElement
const controller = new OptionsFsaController()
const handle = { name: "Saved folder", kind: "directory" } as DirHandle
let canVerifyFolderSetup: boolean
function Harness() {
  folder = useOptionsFolderManagement({
    fsaController: controller,
    savedHandleId: "saved-folder",
    isSavingRef: { current: false },
    settingsBuffer: DEFAULT_SETTINGS,
    onSettingsChange: vi.fn(),
    canVerifyFolderSetup: () => canVerifyFolderSetup,
  })
  return null
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  boundary.load.mockResolvedValue(handle)
  boundary.query.mockResolvedValue("prompt")
  boundary.verify.mockResolvedValue(true)
  boundary.setupRequired.mockResolvedValue(false)
  boundary.send.mockResolvedValue({ success: true })
  canVerifyFolderSetup = true
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.resetAllMocks()
  vi.unstubAllGlobals()
})

it("retains a user access grant when an older saved-folder permission query completes", async () => {
  const queried = Promise.withResolvers<PermissionState>()
  boundary.query.mockReturnValueOnce(queried.promise)
  await act(async () => root.render(createElement(Harness)))
  await act(async () => {
    expect(await folder.grantDownloadFolderAccess()).toBe(true)
  })
  expect(folder.selectedFolderName).toBe("Saved folder")
  expect(folder.folderAccessRequired).toBe(false)
  await act(async () => queried.resolve("denied"))
  expect(folder.selectedFolderName).toBe("Saved folder")
  expect(folder.folderAccessRequired).toBe(false)
})

it("ignores a saved-folder grant completing after unmount", async () => {
  const permission = Promise.withResolvers<boolean>()
  boundary.verify.mockReturnValueOnce(permission.promise)
  await act(async () => root.render(createElement(Harness)))
  let granting!: Promise<boolean>
  await act(async () => {
    granting = folder.grantDownloadFolderAccess()
  })
  await act(async () => root.unmount())
  await act(async () => {
    permission.resolve(true)
    expect(await granting).toBe(false)
  })
  const { toast } = await import("sonner")
  expect(toast.success).not.toHaveBeenCalled()
  expect(toast.error).not.toHaveBeenCalled()
})

it("reports a failed saved-folder lookup without a fabricated selected folder", async () => {
  boundary.load.mockRejectedValueOnce(new Error("Handle store unavailable"))
  await act(async () => root.render(createElement(Harness)))
  expect(folder.selectedFolderName).toBeNull()
  expect(folder.folderAccessRequired).toBe(true)
})

it("asks the background to verify access without opening a second prompt on the initial visit", async () => {
  boundary.setupRequired.mockResolvedValue(true)
  boundary.query.mockResolvedValue("granted")
  await act(async () => root.render(createElement(Harness)))
  await act(async () => folder.folderSetup!.finish())

  expect(boundary.verify).not.toHaveBeenCalled()
  expect(boundary.send).toHaveBeenCalledExactlyOnceWith({
    target: "background",
    type: "VERIFY_FOLDER_SETUP",
    payload: { handleId: "saved-folder" },
  })
})

it("waits for Chrome approval before verifying persistent access to the saved folder", async () => {
  boundary.setupRequired.mockResolvedValue(true)
  const permission = Promise.withResolvers<boolean>()
  boundary.verify.mockReturnValueOnce(permission.promise)
  await act(async () => root.render(createElement(Harness)))
  boundary.load.mockClear()
  boundary.load.mockImplementationOnce(() => new Promise(() => {}))

  let finishing!: Promise<void>
  act(() => {
    finishing = folder.folderSetup!.finish()
    expect(boundary.verify).toHaveBeenCalledExactlyOnceWith(handle, true, {
      requestImmediately: true,
    })
  })
  expect(boundary.load).not.toHaveBeenCalled()
  expect(boundary.send).not.toHaveBeenCalled()

  await act(async () => {
    permission.resolve(true)
    await finishing
  })
  expect(boundary.send).toHaveBeenCalledWith({
    target: "background",
    type: "VERIFY_FOLDER_SETUP",
    payload: { handleId: "saved-folder", afterApproval: true },
  })
  expect(folder.folderSetup).toBeDefined()
})

it("leaves Options in place when the draft changes during the permission prompt", async () => {
  boundary.setupRequired.mockResolvedValue(true)
  const permission = Promise.withResolvers<boolean>()
  boundary.verify.mockReturnValueOnce(permission.promise)
  await act(async () => root.render(createElement(Harness)))

  let finishing!: Promise<void>
  await act(async () => {
    finishing = folder.folderSetup!.finish()
  })
  canVerifyFolderSetup = false
  await act(async () => {
    permission.resolve(true)
    await finishing
  })

  expect(boundary.send).not.toHaveBeenCalledWith(
    expect.objectContaining({ type: "VERIFY_FOLDER_SETUP" })
  )
})
