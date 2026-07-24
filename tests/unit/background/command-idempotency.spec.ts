import { beforeEach, describe, expect, it, vi } from "vitest"
import { LOCAL_STORAGE_KEYS } from "@/src/runtime/storage-keys"

let storage: Record<string, unknown>

function fingerprint(value: unknown): string {
  const input = JSON.stringify(value)
  let left = 0x811c9dc5
  let right = 0x9e3779b9
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index)
    left = Math.imul(left ^ code, 0x01000193)
    right = Math.imul(right ^ code, 0x85ebca6b)
  }
  return `${(left >>> 0).toString(16).padStart(8, "0")}${(right >>> 0)
    .toString(16)
    .padStart(8, "0")}`
}

function installStorage(
  setOverride?: (values: Record<string, unknown>) => Promise<void>
) {
  vi.stubGlobal("chrome", {
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: storage[key] })),
        set: vi.fn(
          setOverride ??
            (async (values: Record<string, unknown>) => {
              Object.assign(storage, structuredClone(values))
            })
        ),
      },
    },
  } as unknown as typeof chrome)
}

describe("durable command idempotency", () => {
  beforeEach(() => {
    storage = {}
    vi.resetModules()
    installStorage()
  })

  it("coalesces concurrent replays and persists the original result", async () => {
    const { executeIdempotentCommand } =
      await import("@/entrypoints/background/command-idempotency")
    let resolveOperation!: (value: { success: true; taskId: string }) => void
    const operation = vi.fn(
      () =>
        new Promise<{ success: true; taskId: string }>((resolve) => {
          resolveOperation = resolve
        })
    )
    const input = {
      commandId: "command-1",
      type: "START_DOWNLOAD",
      message: { type: "START_DOWNLOAD", commandId: "command-1", issuedAt: 1 },
      operation,
    }

    const first = executeIdempotentCommand(input)
    const duplicate = executeIdempotentCommand(input)
    await vi.waitFor(() => expect(operation).toHaveBeenCalledTimes(1))
    resolveOperation({ success: true, taskId: "task-1" })

    await expect(first).resolves.toEqual({ success: true, taskId: "task-1" })
    await expect(duplicate).resolves.toEqual({
      success: true,
      taskId: "task-1",
    })
    expect(operation).toHaveBeenCalledTimes(1)
  })

  it("rejects a concurrent command-id collision before coalescing results", async () => {
    const { executeIdempotentCommand } =
      await import("@/entrypoints/background/command-idempotency")
    let resolveFirst!: (value: { success: true }) => void
    const firstOperation = vi.fn(
      () =>
        new Promise<{ success: true }>((resolve) => {
          resolveFirst = resolve
        })
    )
    const first = executeIdempotentCommand({
      commandId: "command-collision",
      type: "START_DOWNLOAD",
      message: { type: "START_DOWNLOAD", payload: { mangaId: "series-1" } },
      operation: firstOperation,
    })
    await vi.waitFor(() => expect(firstOperation).toHaveBeenCalledTimes(1))

    const collidingOperation = vi.fn(async () => ({ success: true as const }))
    await expect(
      executeIdempotentCommand({
        commandId: "command-collision",
        type: "CLEAR_ALL_HISTORY",
        message: { type: "CLEAR_ALL_HISTORY" },
        operation: collidingOperation,
      })
    ).resolves.toEqual({
      success: false,
      error: "Command ID was reused with different input",
    })
    expect(collidingOperation).not.toHaveBeenCalled()

    resolveFirst({ success: true })
    await expect(first).resolves.toEqual({ success: true })
  })

  it("returns a persisted result after a simulated service-worker restart", async () => {
    const firstModule =
      await import("@/entrypoints/background/command-idempotency")
    const message = {
      type: "MOVE_TASK_TO_TOP",
      commandId: "command-2",
      issuedAt: 2,
    }
    await firstModule.executeIdempotentCommand({
      commandId: "command-2",
      type: "MOVE_TASK_TO_TOP",
      message,
      operation: vi.fn(async () => ({ success: true as const })),
    })

    vi.resetModules()
    const restartedModule =
      await import("@/entrypoints/background/command-idempotency")
    const replayOperation = vi.fn(async () => ({ success: false as const }))
    await expect(
      restartedModule.executeIdempotentCommand({
        commandId: "command-2",
        type: "MOVE_TASK_TO_TOP",
        message,
        operation: replayOperation,
      })
    ).resolves.toEqual({ success: true })
    expect(replayOperation).not.toHaveBeenCalled()
  })

  it("does not repeat a mutation when result persistence fails ambiguously", async () => {
    let setCount = 0
    installStorage(async (values) => {
      setCount += 1
      if (setCount === 2) throw new Error("result write failed")
      Object.assign(storage, structuredClone(values))
    })
    const firstModule =
      await import("@/entrypoints/background/command-idempotency")
    const operation = vi.fn(async () => ({ success: true as const }))
    const input = {
      commandId: "command-3",
      type: "CLEAR_ALL_HISTORY",
      message: {
        type: "CLEAR_ALL_HISTORY",
        commandId: "command-3",
        issuedAt: 3,
      },
      operation,
    }
    await expect(firstModule.executeIdempotentCommand(input)).rejects.toThrow(
      "result write failed"
    )
    expect(operation).toHaveBeenCalledTimes(1)

    vi.resetModules()
    installStorage()
    const restartedModule =
      await import("@/entrypoints/background/command-idempotency")
    const replayOperation = vi.fn(async () => ({ success: true as const }))
    await expect(
      restartedModule.executeIdempotentCommand({
        ...input,
        operation: replayOperation,
      })
    ).resolves.toEqual({
      success: false,
      error: "Command outcome is pending reconciliation",
    })
    expect(replayOperation).not.toHaveBeenCalled()
  })

  it("never evicts a pending intent because of age or cache pressure", async () => {
    const targetMessage = {
      type: "START_DOWNLOAD",
      commandId: "pending-target",
      issuedAt: 1,
    }
    const now = Date.now()
    storage[LOCAL_STORAGE_KEYS.commandResults] = Object.fromEntries(
      Array.from({ length: 129 }, (_, index) => {
        const commandId = index === 128 ? "pending-target" : `pending-${index}`
        const message = index === 128 ? targetMessage : { commandId }
        return [
          commandId,
          {
            commandId,
            type: index === 128 ? "START_DOWNLOAD" : "MOVE_TASK_TO_TOP",
            fingerprint: fingerprint(message),
            state: "pending",
            startedAt: index === 128 ? 0 : now - index,
          },
        ]
      })
    )
    const firstModule =
      await import("@/entrypoints/background/command-idempotency")
    await firstModule.executeIdempotentCommand({
      commandId: "fresh-command",
      type: "CLEAR_ALL_HISTORY",
      message: { type: "CLEAR_ALL_HISTORY" },
      operation: vi.fn(async () => ({ success: true as const })),
    })

    vi.resetModules()
    const restartedModule =
      await import("@/entrypoints/background/command-idempotency")
    const replayOperation = vi.fn(async () => ({ success: true as const }))
    await expect(
      restartedModule.executeIdempotentCommand({
        commandId: "pending-target",
        type: "START_DOWNLOAD",
        message: targetMessage,
        operation: replayOperation,
      })
    ).resolves.toEqual({
      success: false,
      error: "Command outcome is pending reconciliation",
    })
    expect(replayOperation).not.toHaveBeenCalled()
  })
})
