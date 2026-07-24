import { describe, expect, it } from "vitest"

import {
  classifyFsaWriteErrorCategory,
  classifyOffscreenErrorCategory,
} from "@/entrypoints/offscreen/error-categories"

describe("offscreen error categories", () => {
  it("classifies an explicit folder permission rejection as action-required", () => {
    const error = new DOMException("Permission denied", "NotAllowedError")

    expect(classifyFsaWriteErrorCategory(error)).toBe(
      "folder_permission_required"
    )
  })

  it("does not guess that every SecurityError is a folder permission failure", () => {
    const error = new DOMException("Operation is not allowed", "SecurityError")

    expect(classifyFsaWriteErrorCategory(error)).toBe("folder_write_failed")
    expect(classifyOffscreenErrorCategory(error)).toBe("unknown")
  })
})
