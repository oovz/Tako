import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  getDownloadCancelPresentation,
  getDownloadErrorMessage,
} from "@/src/runtime/download-error-presentation"
import { DOWNLOAD_ERROR_CATEGORIES } from "@/src/shared/download-contract"

describe("download error presentation", () => {
  beforeEach(() => {
    vi.stubGlobal("chrome", {
      i18n: {
        getMessage: vi.fn((key: string) => key),
      },
    })
  })

  it.each([
    ["network_unavailable", "downloadError_networkUnavailable"],
    ["provider_rate_limited", "downloadError_providerRateLimited"],
    ["provider_changed", "downloadError_providerChanged"],
    ["chapter_unavailable", "downloadError_chapterUnavailable"],
    ["folder_permission_required", "downloadError_folderPermissionRequired"],
    ["folder_unavailable", "downloadError_folderUnavailable"],
    ["folder_write_failed", "downloadError_folderWriteFailed"],
    ["disk_full", "downloadError_diskFull"],
    [
      "browser_download_interrupted",
      "downloadError_browserDownloadInterrupted",
    ],
    [
      "browser_download_unobservable",
      "downloadError_browserDownloadUnobservable",
    ],
    ["archive_creation_failed", "downloadError_archiveCreationFailed"],
    ["unknown", "downloadError_unknown"],
  ] as const)("maps %s to packaged copy", (category, expectedKey) => {
    expect(getDownloadErrorMessage(category)).toBe(expectedKey)
  })

  it("has an explicit mapping for every canonical category", () => {
    expect(
      DOWNLOAD_ERROR_CATEGORIES.map((category) =>
        getDownloadErrorMessage(category)
      )
    ).not.toContain("")
  })

  it("never returns an untrusted technical string", () => {
    const raw =
      "ERR_FILE_ACCESS_DENIED https://signed.example/image?token=secret"

    expect(getDownloadErrorMessage(raw)).toBe("downloadError_unknown")
    expect(getDownloadErrorMessage(raw)).not.toContain(raw)
    expect(getDownloadErrorMessage(raw)).not.toContain("token=secret")
  })

  it("uses explicit task-wide forget copy for unobservable downloads", () => {
    expect(
      getDownloadCancelPresentation("browser_download_unobservable")
    ).toEqual({
      title: "sidepanel_forgetUnobservableDownload",
      description: "sidepanel_forgetUnobservableWarning",
      confirmLabel: "sidepanel_forgetDownload",
    })
  })

  it("uses task-wide forget copy when another chapter owns the unobservable output", () => {
    expect(getDownloadCancelPresentation("network_unavailable", true)).toEqual({
      title: "sidepanel_forgetUnobservableDownload",
      description: "sidepanel_forgetUnobservableWarning",
      confirmLabel: "sidepanel_forgetDownload",
    })
  })

  it("keeps ordinary cancellation copy for other failures", () => {
    expect(getDownloadCancelPresentation("network_unavailable")).toEqual({
      title: "sidepanel_cancelThisDownload",
      description: "sidepanel_cancelProgressWarning",
      confirmLabel: "common_yes",
    })
  })
})
