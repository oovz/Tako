import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  getDownloadCancelPresentation,
  getDownloadErrorMessage,
  getDownloadFailureMessage,
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
    ["provider_access_denied", "downloadError_providerAccessDenied"],
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

  it.each([
    {
      label: "a confirmed interruption",
      category: "browser_download_interrupted",
      outputUncertain: false,
      expectedKeys: ["downloadError_browserDownloadInterrupted"],
    },
    {
      label: "an interruption with other unconfirmed output",
      category: "browser_download_interrupted",
      outputUncertain: true,
      expectedKeys: [
        "downloadError_browserDownloadInterrupted",
        "downloadError_browserOutputUnconfirmed",
      ],
    },
    {
      label: "an already unconfirmed failure",
      category: "browser_output_unconfirmed",
      outputUncertain: true,
      expectedKeys: ["downloadError_browserOutputUnconfirmed"],
    },
  ] as const)(
    "shows uncertainty recovery guidance once for $label",
    ({ category, outputUncertain, expectedKeys }) => {
      expect(getDownloadFailureMessage(category, outputUncertain)).toBe(
        expectedKeys.join(" ")
      )
    }
  )

  it("describes the scope of task cancellation", () => {
    expect(getDownloadCancelPresentation()).toEqual({
      title: "sidepanel_cancelThisDownload",
      description: "sidepanel_cancelProgressWarning",
      confirmLabel: "common_yes",
    })
  })
})
