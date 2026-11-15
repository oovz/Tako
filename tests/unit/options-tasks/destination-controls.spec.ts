// @vitest-environment happy-dom
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import {
  DownloadDestinationSection,
  type DownloadDestinationSectionProps,
} from "@/entrypoints/options/components/DownloadDestinationSection"
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
async function render(properties: DownloadDestinationSectionProps) {
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

it("returns the user to the Chrome prompt after a temporary folder grant", async () => {
  const previousUrl = window.location.href
  window.history.replaceState(null, "", "?tab=storage&folder-setup=temporary")
  const properties = props("file-system-access")
  const finish = vi.fn(async () => {})
  try {
    await render({
      ...properties,
      folderSetup: { handleId: "captured", disabled: true, finish },
    })
    const label = t("options_folderSetupRequestAccess")
    expect(button(label).disabled).toBe(true)
    expect(container.textContent).toContain(t("options_folderSetupAlwaysAllow"))
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      t("options_folderSetupTemporary")
    )
    expect(window.location.search).toBe("?tab=storage")

    await render({
      ...properties,
      folderSetup: { handleId: "captured", disabled: false, finish },
    })
    await act(async () => button(label).click())
    expect(finish).toHaveBeenCalledOnce()
    expect(properties.onGrantFolderAccess).not.toHaveBeenCalled()
  } finally {
    window.history.replaceState(null, "", previousUrl)
  }
})

it("shows setup success for the verified folder until a different folder is selected", async () => {
  const previousUrl = window.location.href
  window.history.replaceState(
    null,
    "",
    "?tab=storage&folder-setup=ready&folder-setup-handle=captured"
  )
  const properties = props("file-system-access")
  try {
    await render({ ...properties, selectedFolderName: null })
    expect(container.querySelector('[role="status"]')).toBeNull()

    await render({ ...properties, folderAccessRequired: false })
    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      t("options_folderSetupReady")
    )
    expect(window.location.search).toBe("?tab=storage")

    await render({
      ...properties,
      folderAccessRequired: false,
      selectedFolderName: "Other folder",
      downloads: { ...properties.downloads, customDirectoryHandleId: null },
    })
    expect(container.querySelector('[role="status"]')).toBeNull()
  } finally {
    window.history.replaceState(null, "", previousUrl)
  }
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
