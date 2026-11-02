import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { queueCommandClient } from "@/src/ui/shared/queue-command-client"

describe("retained queue action transport", () => {
  const sendMessage = vi.fn()
  const stored: Record<string, unknown> = {}
  const actions = [
    {
      type: "RETRY_FAILED_CHAPTERS",
      invoke: () => queueCommandClient.retryFailedChapters("task-1"),
      payload: { taskId: "task-1" },
      identity: "task-1",
    },
    {
      type: "RESTART_TASK",
      invoke: () => queueCommandClient.restartTask("task-1"),
      payload: { taskId: "task-1" },
      identity: "task-1",
    },
    {
      type: "UNDO_QUEUE_ACTION",
      invoke: () => queueCommandClient.undoQueueAction("undo-1"),
      payload: { token: "undo-1" },
      identity: "undo-1",
    },
  ]

  beforeEach(() => {
    vi.stubGlobal("chrome", {
      runtime: { sendMessage },
      storage: {
        session: {
          get: async (key: string) =>
            key in stored ? { [key]: structuredClone(stored[key]) } : {},
          set: async (values: Record<string, unknown>) => {
            Object.assign(stored, structuredClone(values))
          },
          remove: async (key: string) => {
            delete stored[key]
          },
        },
      },
    })
  })

  afterEach(() => {
    for (const key of Object.keys(stored)) delete stored[key]
    vi.resetAllMocks()
    vi.unstubAllGlobals()
  })

  it.each(actions)(
    "preserves $type identity across uncertain transport and clears it after acknowledgment",
    async ({ type, invoke, payload, identity }) => {
      sendMessage.mockRejectedValue(new Error("Transport unavailable"))
      await expect(invoke()).rejects.toThrow("Transport unavailable")
      expect(sendMessage).toHaveBeenCalledTimes(2)
      const first = sendMessage.mock.calls[0][0]
      expect(first).toMatchObject({ target: "background", type, payload })
      expect(sendMessage.mock.calls[1][0]).toEqual(first)
      expect(stored[`runtime-command:${type}:${identity}`]).toEqual(first)

      sendMessage.mockResolvedValue({ success: true })
      await expect(invoke()).resolves.toBeUndefined()
      expect(sendMessage.mock.calls[2][0]).toEqual(first)
      expect(Object.keys(stored)).toEqual([])
    }
  )

  it("rejects a logical refusal after one send and releases the acknowledged command", async () => {
    sendMessage.mockResolvedValue({
      success: false,
      error: "Task cannot be restarted",
    })
    await expect(queueCommandClient.restartTask("task-1")).rejects.toThrow(
      "Task cannot be restarted"
    )
    expect(sendMessage).toHaveBeenCalledOnce()
    expect(Object.keys(stored)).toEqual([])
  })
})
