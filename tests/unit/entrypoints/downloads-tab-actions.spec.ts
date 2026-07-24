import { beforeEach, describe, expect, it, vi } from "vitest"

import { requestDownloadTaskCancellation } from "@/entrypoints/options/download-task-actions"

vi.mock("@/src/runtime/logger", () => ({
  default: {
    error: vi.fn(),
  },
}))

describe("Options download task actions", () => {
  const sendMessage = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal("chrome", {
      runtime: { sendMessage },
      i18n: {
        getMessage: vi.fn((key: string) =>
          key === "options_toastCancelFailed" ? "Failed to cancel task" : key
        ),
      },
    })
  })

  it("returns success only when the background accepts cancellation", async () => {
    sendMessage.mockResolvedValueOnce({ success: true })

    await expect(requestDownloadTaskCancellation("task-1")).resolves.toEqual({
      success: true,
    })
  })

  it("keeps background diagnostics out of inline display", async () => {
    sendMessage.mockResolvedValueOnce({
      success: false,
      error: "ERR_FILE_ACCESS_DENIED https://signed.example/?token=secret",
    })

    await expect(requestDownloadTaskCancellation("task-1")).resolves.toEqual({
      success: false,
      error: "Failed to cancel task",
    })
  })

  it("returns a calm fallback message when runtime messaging fails", async () => {
    sendMessage.mockRejectedValueOnce(new Error("service worker unavailable"))

    await expect(requestDownloadTaskCancellation("task-1")).resolves.toEqual({
      success: false,
      error: "Failed to cancel task",
    })
  })
})
