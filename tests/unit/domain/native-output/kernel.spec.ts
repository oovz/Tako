import { describe, expect, it } from "vitest"

import {
  attachNativeDownload,
  interruptNativeOutputBeforeAcceptance,
  markNativeDownloadTerminal,
  markNativeOutputAcceptanceUnknown,
  markNativeOutputAccountingDisposition,
  markNativeOutputBlobReleased,
  markNativeOutputDependencyReleased,
  markNativeOutputSurrendered,
  observeNativeDownloadErased,
  prepareNativeOutput,
  sealNativeOutputManifest,
} from "@/src/domain/native-output/kernel"
import { createEmptyNativeOutputState } from "@/src/domain/native-output/state"

const identity = {
  jobId: "job-1",
  attempt: 2,
  taskId: "task-1",
  chapterId: "chapter-1",
  fingerprint: "a".repeat(64),
  documentInstanceId: "document-instance-1",
  outputId: "output-1",
  outputIndex: 0,
  outputCount: 2,
  blobUrl: "blob:output-1",
  filename: "chapter/001.jpg",
  outputKind: "image" as const,
}

describe("native output kernel", () => {
  it("durably represents every requested index when a manifest seals", () => {
    const prepared = prepareNativeOutput(createEmptyNativeOutputState(), {
      ...identity,
      now: 10,
    })
    expect(prepared.result.outcome).toBe("applied")

    const sealed = sealNativeOutputManifest(prepared.next, {
      jobId: identity.jobId,
      attempt: identity.attempt,
      taskId: identity.taskId,
      chapterId: identity.chapterId,
      fingerprint: identity.fingerprint,
      documentInstanceId: identity.documentInstanceId,
      outputsRequested: 2,
      outputsFailedBeforeHandoff: 1,
      now: 20,
      error: "output never reached durable ownership",
    })

    expect(sealed.result).toMatchObject({ outcome: "applied" })
    expect(sealed.next.manifestsByJobId[identity.jobId]).toMatchObject({
      fingerprint: identity.fingerprint,
      documentInstanceId: identity.documentInstanceId,
    })
    expect(sealed.next.manifestsByJobId[identity.jobId]?.slots).toEqual([
      { disposition: "tracked", outputId: identity.outputId },
      {
        disposition: "untracked_failed",
        failedAt: 20,
        error: "output never reached durable ownership",
      },
    ])
  })

  it("accepts an exact replay and rejects output and slot collisions", () => {
    const prepared = prepareNativeOutput(createEmptyNativeOutputState(), {
      ...identity,
      now: 10,
    })
    expect(
      prepareNativeOutput(prepared.next, { ...identity, now: 99 }).result
        .outcome
    ).toBe("unchanged")
    expect(
      prepareNativeOutput(prepared.next, {
        ...identity,
        blobUrl: "blob:different",
        now: 11,
      }).result
    ).toEqual({ outcome: "rejected", reason: "output-identity-conflict" })
    expect(
      prepareNativeOutput(prepared.next, {
        ...identity,
        fingerprint: "b".repeat(64),
        now: 11,
      }).result
    ).toEqual({ outcome: "rejected", reason: "output-identity-conflict" })
    expect(
      prepareNativeOutput(prepared.next, {
        ...identity,
        documentInstanceId: "document-instance-2",
        now: 11,
      }).result
    ).toEqual({ outcome: "rejected", reason: "output-identity-conflict" })
    expect(
      prepareNativeOutput(prepared.next, {
        ...identity,
        outputId: "output-2",
        blobUrl: "blob:output-2",
        now: 11,
      }).result
    ).toEqual({ outcome: "rejected", reason: "output-index-conflict" })
  })

  it("keeps the write-ahead acceptance state monotonic through terminal cleanup", () => {
    let state = prepareNativeOutput(createEmptyNativeOutputState(), {
      ...identity,
      outputCount: 1,
      now: 10,
    }).next
    const unknown = markNativeOutputAcceptanceUnknown(state, {
      outputId: identity.outputId,
      now: 11,
    })
    expect(unknown.result).toMatchObject({
      outcome: "applied",
      record: { phase: "acceptance_unknown" },
    })
    state = unknown.next

    const waiting = attachNativeDownload(state, {
      outputId: identity.outputId,
      downloadId: 42,
    })
    expect(waiting.result).toMatchObject({
      outcome: "applied",
      record: { phase: "waiting", downloadId: 42 },
    })
    state = waiting.next

    const terminal = markNativeDownloadTerminal(state, {
      downloadId: 42,
      phase: "complete",
      now: 12,
    })
    expect(terminal.result).toMatchObject({
      outcome: "applied",
      record: { phase: "complete" },
    })
    state = terminal.next

    const accounted = markNativeOutputAccountingDisposition(state, {
      outputId: identity.outputId,
      disposition: "accounted",
      now: 13,
    })
    state = accounted.next
    const released = markNativeOutputBlobReleased(state, {
      outputId: identity.outputId,
      now: 14,
    })
    state = released.next
    expect(
      markNativeOutputDependencyReleased(state, {
        outputId: identity.outputId,
        now: 15,
      }).result
    ).toMatchObject({
      outcome: "applied",
      record: { dependencyReleasedAt: 15 },
    })
  })

  it("records erased as an observation without inventing a terminal result", () => {
    let state = prepareNativeOutput(createEmptyNativeOutputState(), {
      ...identity,
      outputCount: 1,
      now: 10,
    }).next
    state = markNativeOutputAcceptanceUnknown(state, {
      outputId: identity.outputId,
      now: 11,
    }).next
    state = attachNativeDownload(state, {
      outputId: identity.outputId,
      downloadId: 42,
    }).next

    const erased = observeNativeDownloadErased(state, {
      downloadId: 42,
      now: 12,
    })
    expect(erased.result).toMatchObject({
      outcome: "applied",
      record: { phase: "waiting", erasedAt: 12 },
    })
  })

  it("makes a proven API rejection terminal without a download ID", () => {
    let state = prepareNativeOutput(createEmptyNativeOutputState(), {
      ...identity,
      outputCount: 1,
      now: 10,
    }).next
    state = markNativeOutputAcceptanceUnknown(state, {
      outputId: identity.outputId,
      now: 11,
    }).next
    const rejected = interruptNativeOutputBeforeAcceptance(state, {
      outputId: identity.outputId,
      error: "Chrome rejected the request",
      now: 12,
    })
    expect(rejected.result).toMatchObject({
      outcome: "applied",
      record: {
        phase: "interrupted",
        terminalAt: 12,
      },
    })
    if (rejected.result.outcome !== "applied") {
      throw new Error("expected terminal interruption")
    }
    expect(rejected.result.record.downloadId).toBeUndefined()
  })

  it("only surrenders waiting outputs whose download was erased", () => {
    let state = prepareNativeOutput(createEmptyNativeOutputState(), {
      ...identity,
      outputCount: 1,
      now: 10,
    }).next
    state = markNativeOutputAcceptanceUnknown(state, {
      outputId: identity.outputId,
      now: 11,
    }).next
    state = attachNativeDownload(state, {
      outputId: identity.outputId,
      downloadId: 42,
    }).next

    // Without an erased observation the output is still observable.
    expect(
      markNativeOutputSurrendered(state, {
        outputId: identity.outputId,
        now: 12,
      }).result
    ).toEqual({ outcome: "rejected", reason: "invalid-transition" })

    state = observeNativeDownloadErased(state, {
      downloadId: 42,
      now: 13,
    }).next
    const surrendered = markNativeOutputSurrendered(state, {
      outputId: identity.outputId,
      now: 14,
    })
    expect(surrendered.result).toMatchObject({
      outcome: "applied",
      record: {
        phase: "surrendered",
        erasedAt: 13,
        surrenderedAt: 14,
        downloadId: 42,
      },
    })
    // Replay is idempotent.
    expect(
      markNativeOutputSurrendered(surrendered.next, {
        outputId: identity.outputId,
        now: 99,
      }).result.outcome
    ).toBe("unchanged")
  })

  it("releases Blob and dependency ownership for surrendered outputs", () => {
    let state = prepareNativeOutput(createEmptyNativeOutputState(), {
      ...identity,
      outputCount: 1,
      now: 10,
    }).next
    state = markNativeOutputAcceptanceUnknown(state, {
      outputId: identity.outputId,
      now: 11,
    }).next
    state = attachNativeDownload(state, {
      outputId: identity.outputId,
      downloadId: 42,
    }).next
    state = observeNativeDownloadErased(state, {
      downloadId: 42,
      now: 12,
    }).next
    state = markNativeOutputSurrendered(state, {
      outputId: identity.outputId,
      now: 13,
    }).next

    const blobReleased = markNativeOutputBlobReleased(state, {
      outputId: identity.outputId,
      now: 14,
    })
    expect(blobReleased.result.outcome).toBe("applied")
    if (blobReleased.result.outcome !== "applied") {
      throw new Error("expected Blob release")
    }

    // Accounting disposition is the terminal proof of queue settlement.
    const accounted = markNativeOutputAccountingDisposition(blobReleased.next, {
      outputId: identity.outputId,
      disposition: "accounted",
      now: 15,
    })
    expect(accounted.result.outcome).toBe("applied")

    const dependencyReleased = markNativeOutputDependencyReleased(
      accounted.next,
      { outputId: identity.outputId, now: 16 }
    )
    expect(dependencyReleased.result).toMatchObject({
      outcome: "applied",
      record: { dependencyReleasedAt: 16 },
    })
  })
})
