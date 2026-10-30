import { describe, expect, it } from "vitest"
import {
  classifyFsaWriteErrorCategory,
  classifyOffscreenErrorCategory,
  FsaWriteError,
} from "@/entrypoints/offscreen/error-categories"

describe("offscreen failure recovery categories", () => {
  it.each([
    ["429 rate limit while disk full", "provider_rate_limited"],
    ["Disk full during archive creation failed", "disk_full"],
    ["Zip worker: no images found", "archive_creation_failed"],
    ["HTTP 404: page structure changed", "chapter_unavailable"],
    ["Failed to extract folder information", "provider_changed"],
    ["Permission denied for folder", "folder_permission_required"],
    ["Folder is missing", "folder_unavailable"],
    ["Selected folder is not configured", "folder_unavailable"],
    ["Selected folder is unavailable", "folder_unavailable"],
    ["Failed to fetch", "network_unavailable"],
    ["Unspecified operation failure", "unknown"],
  ])(
    "classifies %s for the appropriate recovery action",
    (message, category) => {
      expect(classifyOffscreenErrorCategory(new Error(message))).toBe(category)
    }
  )

  it("preserves a structured category before diagnostic heuristics", () => {
    expect(
      classifyOffscreenErrorCategory({
        category: "network_unavailable",
        message: "disk full",
      })
    ).toBe("network_unavailable")
    expect(
      classifyOffscreenErrorCategory(
        new DOMException("folder unavailable", "NotAllowedError")
      )
    ).toBe("folder_permission_required")
    expect(
      classifyOffscreenErrorCategory(
        new DOMException("opaque", "NotFoundError")
      )
    ).toBe("folder_unavailable")
  })

  it.each([
    ["QuotaExceededError", "disk_full"],
    ["DiskFullError", "disk_full"],
    ["PermissionExpiredError", "folder_permission_required"],
    ["DirectoryNotFoundError", "folder_unavailable"],
  ] as const)(
    "classifies the filesystem %s capability failure",
    (name, category) => {
      expect(
        classifyFsaWriteErrorCategory(new DOMException("opaque", name))
      ).toBe(category)
      const error = new FsaWriteError(category, undefined)
      expect(error.category).toBe(category)
      expect(error.message.length).toBeGreaterThan(0)
    }
  )
})
