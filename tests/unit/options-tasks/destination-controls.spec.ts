// @vitest-environment happy-dom
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { DownloadDestinationSection } from "@/entrypoints/options/components/DownloadDestinationSection"
import { DEFAULT_SETTINGS } from "@/src/domain/settings/defaults"
import { t } from "@/src/runtime/i18n"

const capabilities = vi.hoisted(() => ({
  directoryPicker: true,
  indexedDb: true,
  handlePermissionQuery: true,
  handlePermissionRequest: true,
  writableFile: true,
}))
vi.mock("@/src/storage/fs-access", () => ({
  detectFsaCapabilities: () => capabilities,
}))
let root: Root
let container: HTMLDivElement
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  Object.assign(capabilities, {
    directoryPicker: true,
    indexedDb: true,
    handlePermissionQuery: true,
    handlePermissionRequest: true,
    writableFile: true,
  })
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

function props(destination: "downloads-api" | "file-system-access") {
  return {
    downloads: {
      ...DEFAULT_SETTINGS.downloads,
      destination,
      customDirectoryHandleId: "captured",
    },
    selectedFolderName: "Captured folder",
    folderAccessRequired: true,
    onGrantFolderAccess: vi.fn(async () => true),
    isPickingFolder: false,
    isSaving: false,
    onDownloadsChange: vi.fn(),
    onPickFolder: vi.fn(async () => undefined),
  }
}
async function render(properties: ReturnType<typeof props>) {
  await act(async () =>
    root.render(createElement(DownloadDestinationSection, properties))
  )
}
function button(label: string) {
  return [...container.querySelectorAll("button")].find(
    (item) => item.textContent === label
  )!
}

it("keeps captured folder identity on enable and clears it when browser downloads are chosen", async () => {
  const properties = props("downloads-api")
  await render(properties)
  await act(async () =>
    container.querySelector<HTMLButtonElement>("#custom-folder-switch")!.click()
  )
  expect(properties.onDownloadsChange).toHaveBeenLastCalledWith({
    destination: "file-system-access",
    customDirectoryHandleId: "captured",
  })
  properties.downloads.destination = "file-system-access"
  await render(properties)
  await act(async () => button(t("options_useBrowserDownloads")).click())
  expect(properties.onDownloadsChange).toHaveBeenLastCalledWith({
    destination: "downloads-api",
    customDirectoryHandleId: null,
  })
  await act(async () =>
    container.querySelector<HTMLButtonElement>("#custom-folder-switch")!.click()
  )
  expect(properties.onDownloadsChange).toHaveBeenLastCalledWith({
    destination: "downloads-api",
    customDirectoryHandleId: null,
  })
})

it("starts folder selection and permission renewal directly from their user controls", async () => {
  const properties = props("file-system-access")
  await render(properties)
  act(() => button(t("options_changeFolder")).click())
  expect(properties.onPickFolder).toHaveBeenCalledOnce()
  act(() => button(t("folderAccess_grant")).click())
  expect(properties.onGrantFolderAccess).toHaveBeenCalledOnce()
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>("#allow-chrome-fallback")!
      .click()
  )
  expect(properties.onDownloadsChange).toHaveBeenLastCalledWith({
    allowChromeFallback: !DEFAULT_SETTINGS.downloads.allowChromeFallback,
  })
})

it.each(Object.keys(capabilities) as (keyof typeof capabilities)[])(
  "allows disabling a saved folder when %s is unavailable",
  async (missingCapability) => {
    capabilities[missingCapability] = false
    const properties = props("downloads-api")
    await render(properties)
    expect(
      container.querySelector<HTMLButtonElement>("#custom-folder-switch")!
        .disabled
    ).toBe(true)
    expect(button(t("options_changeFolder")).disabled).toBe(true)
    properties.downloads.destination = "file-system-access"
    await render(properties)
    expect(
      container.querySelector<HTMLButtonElement>("#custom-folder-switch")!
        .disabled
    ).toBe(false)
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>("#custom-folder-switch")!
        .click()
    )
    expect(properties.onDownloadsChange).toHaveBeenCalledWith({
      destination: "downloads-api",
      customDirectoryHandleId: null,
    })
  }
)
