import { beforeEach, describe, expect, it, vi } from "vitest"

import { InvalidDurableStateError } from "@/src/runtime/runtime-phase-errors"
import {
  NativeOutputRepository,
  parseCurrentNativeOutputState,
} from "@/src/storage/native-output-repository"

const identity = {
  jobId: "job-1",
  attempt: 1,
  taskId: "task-1",
  chapterId: "chapter-1",
  fingerprint: "a".repeat(64),
  documentInstanceId: "document-instance-1",
  outputId: "output-1",
  outputIndex: 0,
  outputCount: 1,
  blobUrl: "blob:output-1",
  filename: "chapter.cbz",
  outputKind: "archive" as const,
}

describe("NativeOutputRepository", () => {
  let local: Record<string, unknown>
  let set: ReturnType<typeof vi.fn>

  beforeEach(() => {
    local = {}
    set = vi.fn(async (values: Record<string, unknown>) => {
      Object.assign(local, structuredClone(values))
    })
    vi.stubGlobal("chrome", {
      storage: {
        local: {
          get: vi.fn(async () => structuredClone(local)),
          set,
          remove: vi.fn(async (keys: string | string[]) => {
            const removed = Array.isArray(keys) ? keys : [keys]
            for (const key of removed) delete local[key]
          }),
        },
      },
    } as unknown as typeof chrome)
  })

  it("persists a prepared record before publishing it through the cache", async () => {
    const repository = new NativeOutputRepository()
    const result = await repository.prepare({ ...identity, now: 10 })

    expect(result).toMatchObject({ outcome: "applied" })
    expect(set).toHaveBeenCalledOnce()
    expect(local["pendingOutputs:output:output-1"]).toMatchObject({
      outputId: identity.outputId,
      phase: "prepared",
    })
    expect(local["pendingOutputs:manifest:job-1"]).toMatchObject({
      jobId: identity.jobId,
      phase: "open",
    })
    expect(local["pendingOutputs:index"]).toEqual({
      jobIds: ["job-1"],
      outputIds: ["output-1"],
      downloadIdToOutputId: {},
    })
    expect(await repository.getByOutputId(identity.outputId)).toMatchObject({
      phase: "prepared",
      blobUrl: identity.blobUrl,
      fingerprint: identity.fingerprint,
      documentInstanceId: identity.documentInstanceId,
    })
    expect(await repository.getManifest(identity.jobId)).toMatchObject({
      jobId: identity.jobId,
      phase: "open",
    })
  })

  it("publishes no candidate after a failed durable write and reloads storage", async () => {
    const repository = new NativeOutputRepository()
    set.mockRejectedValueOnce(new Error("quota exceeded"))

    await expect(repository.prepare({ ...identity, now: 10 })).rejects.toThrow(
      "quota exceeded"
    )
    expect(await repository.getByOutputId(identity.outputId)).toBeUndefined()
  })

  it("returns detached snapshots and results", async () => {
    const repository = new NativeOutputRepository()
    const result = await repository.prepare({ ...identity, now: 10 })
    if (result.outcome !== "applied") throw new Error("expected apply")
    result.record.filename = "mutated"
    const snapshot = await repository.snapshot()
    snapshot.outputsByOutputId[identity.outputId]!.filename = "also-mutated"

    expect((await repository.getByOutputId(identity.outputId))?.filename).toBe(
      identity.filename
    )
  })

  it("keeps an unresolved zero-output manifest live until its dependency is released", async () => {
    const repository = new NativeOutputRepository()
    await repository.ensureManifest({
      jobId: identity.jobId,
      attempt: identity.attempt,
      taskId: identity.taskId,
      chapterId: identity.chapterId,
      fingerprint: identity.fingerprint,
      documentInstanceId: identity.documentInstanceId,
      outputsRequested: 0,
      now: 10,
    })

    await expect(repository.hasLiveDependencies()).resolves.toBe(true)

    await repository.sealManifest({
      jobId: identity.jobId,
      attempt: identity.attempt,
      taskId: identity.taskId,
      chapterId: identity.chapterId,
      fingerprint: identity.fingerprint,
      documentInstanceId: identity.documentInstanceId,
      outputsRequested: 0,
      outputsFailedBeforeHandoff: 0,
      now: 11,
      error: "no outputs",
    })
    await expect(repository.hasLiveDependencies()).resolves.toBe(true)

    await repository.markJobDependencyReleased({
      jobId: identity.jobId,
      now: 12,
    })
    await expect(repository.hasLiveDependencies()).resolves.toBe(false)
  })

  it("rewrites the index when removal-only pruning deletes the last records", async () => {
    const repository = new NativeOutputRepository()
    await repository.prepare({ ...identity, now: 10 })
    await repository.markAcceptanceUnknown({
      outputId: identity.outputId,
      now: 11,
    })
    await repository.attachDownload({
      outputId: identity.outputId,
      downloadId: 42,
    })
    await repository.markTerminal({
      downloadId: 42,
      phase: "complete",
      now: 12,
    })
    await repository.sealManifest({
      jobId: identity.jobId,
      attempt: identity.attempt,
      taskId: identity.taskId,
      chapterId: identity.chapterId,
      fingerprint: identity.fingerprint,
      documentInstanceId: identity.documentInstanceId,
      outputsRequested: 1,
      outputsFailedBeforeHandoff: 0,
      now: 13,
      error: "no output failed",
    })
    await repository.markAccountingDisposition({
      outputId: identity.outputId,
      disposition: "accounted",
      now: 14,
    })
    await repository.markBlobReleased({ outputId: identity.outputId, now: 15 })
    await repository.markDependencyReleased({
      outputId: identity.outputId,
      now: 16,
    })

    // The output was pruned by its release; the manifest remains, so the
    // index must drop only the output mapping.
    expect(local["pendingOutputs:index"]).toEqual({
      jobIds: ["job-1"],
      outputIds: [],
      downloadIdToOutputId: {},
    })
    expect(local["pendingOutputs:output:output-1"]).toBeUndefined()

    await repository.markJobDependencyReleased({
      jobId: identity.jobId,
      now: 17,
    })

    // The final transition removes only the manifest; the index must be
    // rewritten to empty, never left referencing absent keys.
    expect(local["pendingOutputs:index"]).toEqual({
      jobIds: [],
      outputIds: [],
      downloadIdToOutputId: {},
    })
    expect(local["pendingOutputs:manifest:job-1"]).toBeUndefined()
    await expect(repository.hasLiveDependencies()).resolves.toBe(false)
  })

  it("repairs a stale durable index during hydration", async () => {
    local["pendingOutputs:index"] = {
      jobIds: ["ghost"],
      outputIds: ["missing-output"],
      downloadIdToOutputId: { "42": "missing-output" },
    }
    const repository = new NativeOutputRepository()

    await repository.initialize()

    expect(local["pendingOutputs:index"]).toEqual({
      jobIds: [],
      outputIds: [],
      downloadIdToOutputId: {},
    })
  })

  it("rejects an invalid current schema instead of hydrating an empty state", async () => {
    local["pendingOutputs:index"] = {
      jobIds: [],
      outputIds: ["orphan"],
      downloadIdToOutputId: {},
    }
    local["pendingOutputs:output:orphan"] = { outputId: "orphan" }
    const repository = new NativeOutputRepository()

    await expect(repository.initialize()).rejects.toBeInstanceOf(
      InvalidDurableStateError
    )
  })

  it("validates exact group and unique identity invariants", () => {
    expect(() =>
      parseCurrentNativeOutputState({
        manifestsByJobId: {
          "job-1": {
            jobId: "job-1",
            attempt: 1,
            taskId: "task-1",
            chapterId: "chapter-1",
            fingerprint: identity.fingerprint,
            documentInstanceId: identity.documentInstanceId,
            phase: "open",
            outputsRequested: 1,
            outputsFailedBeforeHandoff: 0,
            slots: [{ disposition: "tracked", outputId: "output-1" }],
            createdAt: 1,
          },
        },
        outputsByOutputId: {
          "output-1": {
            ...identity,
            chapterId: "different-chapter",
            phase: "prepared",
            createdAt: 1,
            accountingDisposition: "pending",
          },
        },
      })
    ).toThrow(InvalidDurableStateError)
  })
})
