import assert from "node:assert/strict"
import { setImmediate } from "node:timers/promises"
import { describe, it } from "vitest"
import { ArchiveWorkerSession } from "@/entrypoints/offscreen/archive-worker-session"
import type {
  WorkerZipProgress,
  WorkerZipResult,
} from "@/entrypoints/offscreen/chapter-processing-types"

class WorkerStub {
  onmessage: Worker["onmessage"] = null
  onerror: Worker["onerror"] = null
  readonly messages: unknown[] = []
  terminations = 0

  postMessage(message: unknown): void {
    this.messages.push(message)
  }

  terminate(): void {
    this.terminations += 1
  }

  send(data: WorkerZipResult | WorkerZipProgress): void {
    this.onmessage?.call(
      this as unknown as Worker,
      new MessageEvent("message", { data })
    )
  }
}

const progress: WorkerZipProgress = {
  type: "progress",
  bytes: 10,
  chunks: 1,
  final: false,
}

async function observeSettlement(result: Promise<WorkerZipResult>) {
  const outcome = result.then(
    (value) => ({ kind: "success" as const, value }),
    (error: unknown) => ({ kind: "failure" as const, error })
  )
  return Promise.race([
    outcome,
    setImmediate().then(() => ({ kind: "pending" as const })),
  ])
}

describe("archive worker settlement", () => {
  it("rejects pending finalization when the session is disposed", async () => {
    const worker = new WorkerStub()
    const session = new ArchiveWorkerSession(worker as unknown as Worker)
    const outcome = observeSettlement(session.finalize())
    session.dispose()
    const settled = await outcome
    assert.ok(settled.kind === "failure")
    assert.ok(settled.error instanceof Error)
    assert.match(settled.error.message, /disposed/)
    assert.equal(session.failureSignal.reason, settled.error)
    assert.equal(worker.terminations, 1)
  })

  it("disposes once when an abort observer also disposes the session", () => {
    const worker = new WorkerStub()
    const session = new ArchiveWorkerSession(worker as unknown as Worker)
    session.failureSignal.addEventListener("abort", () => session.dispose())
    session.dispose()
    session.dispose()
    assert.equal(session.failureSignal.aborted, true)
    assert.equal(worker.terminations, 1)
    assert.equal(worker.onmessage, null)
    assert.equal(worker.onerror, null)
  })

  it("settles finalization when a progress callback throws", async () => {
    const worker = new WorkerStub()
    const failure = new Error("Progress delivery failed")
    const session = new ArchiveWorkerSession(
      worker as unknown as Worker,
      () => {
        throw failure
      }
    )
    const outcome = observeSettlement(session.finalize())
    try {
      assert.doesNotThrow(() => worker.send(progress))
      assert.deepEqual(await outcome, { kind: "failure", error: failure })
      assert.equal(session.failureSignal.reason, failure)
    } finally {
      session.dispose()
    }
  })

  it("settles finalization when a progress callback rejects", async () => {
    const worker = new WorkerStub()
    const failure = new Error("Progress delivery rejected")
    const session = new ArchiveWorkerSession(
      worker as unknown as Worker,
      async () => {
        throw failure
      }
    )
    const outcome = observeSettlement(session.finalize())
    try {
      worker.send(progress)
      assert.deepEqual(await outcome, { kind: "failure", error: failure })
      assert.equal(session.failureSignal.reason, failure)
    } finally {
      session.dispose()
    }
  })

  it("preserves successful finalization when the session is later disposed", async () => {
    const worker = new WorkerStub()
    const session = new ArchiveWorkerSession(worker as unknown as Worker)
    const result = session.finalize()
    const saved: WorkerZipResult = {
      success: true,
      buffer: new ArrayBuffer(3),
      filename: "Chapter.cbz",
    }
    worker.send(saved)
    assert.equal(await result, saved)
    assert.deepEqual(worker.messages, [{ type: "finalize" }])
    session.dispose()
    assert.equal(session.failureSignal.aborted, false)
    assert.equal(worker.terminations, 1)
  })

  it("does not replace a worker failure during disposal", async () => {
    const worker = new WorkerStub()
    const session = new ArchiveWorkerSession(worker as unknown as Worker)
    const failure = new Error("Archive creation failed")
    const result = session.finalize()
    session.reject(failure)
    session.dispose()
    await assert.rejects(result, (error) => error === failure)
    assert.equal(session.failureSignal.reason, failure)
  })
})
