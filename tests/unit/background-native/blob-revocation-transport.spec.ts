import { beforeEach, describe, expect, it, vi } from "vitest"

import { requestBlobRevocation } from "@/entrypoints/background/native-output-blob-revocation"
import type { NativeOutputRecord } from "@/src/domain/native-output/state"

const record: NativeOutputRecord = {
  jobId: "blob-release-job",
  attempt: 1,
  taskId: "blob-release-task",
  chapterId: "blob-release-chapter",
  fingerprint: "a".repeat(64),
  documentInstanceId: "offscreen-incarnation",
  outputId: "blob-release-output",
  blobUrl: "blob:confirmed-native-output",
  outputIndex: 0,
  outputCount: 1,
  filename: "Series/Chapter.cbz",
  outputKind: "archive",
  phase: "complete",
  createdAt: 1,
  downloadId: 42,
  terminalAt: 2,
  accountingDisposition: "accounted",
}

describe("native output Blob revocation transport", () => {
  const sendMessage = vi.fn()

  beforeEach(() => {
    sendMessage.mockReset()
    vi.stubGlobal("chrome", { runtime: { sendMessage } })
  })

  it("resolves after offscreen confirms revocation for the exact output incarnation", async () => {
    sendMessage.mockResolvedValue({ success: true })

    await expect(requestBlobRevocation(record)).resolves.toBeUndefined()

    expect(sendMessage).toHaveBeenCalledExactlyOnceWith({
      target: "offscreen",
      type: "REVOKE_BLOB_URL",
      payload: {
        jobId: record.jobId,
        attempt: record.attempt,
        taskId: record.taskId,
        chapterId: record.chapterId,
        fingerprint: record.fingerprint,
        documentInstanceId: record.documentInstanceId,
        outputId: record.outputId,
        blobUrl: record.blobUrl,
      },
    })
  })

  it("rejects with the offscreen failure cause when revocation is refused", async () => {
    sendMessage.mockResolvedValue({
      success: false,
      error: "Blob still belongs to an active output consumer",
    })

    await expect(requestBlobRevocation(record)).rejects.toThrow(
      "Blob still belongs to an active output consumer"
    )
    expect(sendMessage).toHaveBeenCalledOnce()
  })

  it("preserves a runtime transport rejection without retrying", async () => {
    const error = new Error("Offscreen receiving end is unavailable")
    sendMessage.mockRejectedValue(error)

    await expect(requestBlobRevocation(record)).rejects.toBe(error)
    expect(sendMessage).toHaveBeenCalledOnce()
  })
})
