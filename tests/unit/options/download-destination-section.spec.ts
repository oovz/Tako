import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { DownloadDestinationSection } from "@/entrypoints/options/components/DownloadDestinationSection"
import { DEFAULT_SETTINGS } from "@/src/domain/settings/defaults"

vi.mock("@/src/storage/fs-access", () => ({
  detectFsaCapabilities: () => ({
    directoryPicker: true,
    indexedDb: true,
    handlePermissionQuery: true,
    handlePermissionRequest: true,
    writableFile: true,
  }),
}))

describe("DownloadDestinationSection", () => {
  it("renders default browser download message when destination is downloads-api and no folder selected", () => {
    const markup = renderToStaticMarkup(
      createElement(DownloadDestinationSection, {
        downloads: {
          ...DEFAULT_SETTINGS.downloads,
          destination: "downloads-api",
        },
        selectedFolderName: null,
        isPickingFolder: false,
        isSaving: false,
        onDownloadsChange: vi.fn(),
        onPickFolder: vi.fn(),
      })
    )

    expect(markup).toContain(
      "No custom folder selected. Uses default browser downloads."
    )
    expect(markup).not.toContain("No download folder selected")
  })

  it("renders current folder name when folder is selected", () => {
    const markup = renderToStaticMarkup(
      createElement(DownloadDestinationSection, {
        downloads: {
          ...DEFAULT_SETTINGS.downloads,
          destination: "file-system-access",
        },
        selectedFolderName: "MangaFolder",
        isPickingFolder: false,
        isSaving: false,
        onDownloadsChange: vi.fn(),
        onPickFolder: vi.fn(),
      })
    )

    expect(markup).toContain("Current folder: MangaFolder")
    expect(markup).not.toContain("No download folder selected")
  })

  it("renders note and 'No folder selected.' when FSA is selected without a folder", () => {
    const markup = renderToStaticMarkup(
      createElement(DownloadDestinationSection, {
        downloads: {
          ...DEFAULT_SETTINGS.downloads,
          destination: "file-system-access",
        },
        selectedFolderName: null,
        isPickingFolder: false,
        isSaving: false,
        onDownloadsChange: vi.fn(),
        onPickFolder: vi.fn(),
      })
    )

    expect(markup).toContain("No folder selected.")
    expect(markup).not.toContain(
      "No custom folder selected. Uses default browser downloads."
    )
    expect(markup).toContain("No download folder selected")
    expect(markup).toContain(
      "Select a folder to use File System Access download mode. Changes cannot be saved until a folder is chosen."
    )
  })
})
