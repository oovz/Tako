import { describe, expect, it } from "vitest"

import {
  acknowledgeNativeOutputSettlement,
  attachNativeDownload,
  markNativeDownloadTerminal,
  markNativeOutputAcceptanceUnknown,
  markNativeOutputAccountingDisposition,
  markNativeOutputBlobReleased,
  markNativeOutputDependencyReleased,
  markNativeOutputJobDependencyReleased,
  markNativeOutputOutcomeUnknown,
  prepareNativeOutput,
  sealNativeOutputManifest,
} from "@/src/domain/native-output/kernel"
import {
  createEmptyNativeOutputState,
  isNativeOutputLive,
  type NativeOutputIdentity,
  type NativeOutputState,
} from "@/src/domain/native-output/state"

const identity: NativeOutputIdentity = {
  jobId: "job",
  attempt: 1,
  taskId: "task",
  chapterId: "chapter",
  fingerprint: "a".repeat(64),
  documentInstanceId: "document",
  outputId: "output",
  outputIndex: 0,
  outputCount: 1,
  blobUrl: "blob:output",
  filename: "Chapter.cbz",
  outputKind: "archive",
}

function prepared(): NativeOutputState {
  return prepareNativeOutput(createEmptyNativeOutputState(), {
    ...identity,
    now: 1,
  }).next
}

function accepted(): NativeOutputState {
  return markNativeOutputAcceptanceUnknown(prepared(), {
    outputId: identity.outputId,
    now: 2,
  }).next
}

function waiting(): NativeOutputState {
  return attachNativeDownload(accepted(), {
    outputId: identity.outputId,
    downloadId: 42,
  }).next
}

describe("native output ownership boundaries", () => {
  it("fences preparation against invalid slots, reused Blobs and sealed manifests", () => {
    const initial = prepared()
    expect(
      prepareNativeOutput(initial, {
        ...identity,
        outputId: "other",
        outputIndex: -1,
        now: 3,
      }).result
    ).toEqual({ outcome: "rejected", reason: "output-index-out-of-range" })
    expect(
      prepareNativeOutput(initial, {
        ...identity,
        outputId: "other",
        outputIndex: 1,
        now: 3,
      }).result
    ).toEqual({ outcome: "rejected", reason: "output-index-out-of-range" })
    expect(
      prepareNativeOutput(initial, {
        ...identity,
        jobId: "other-job",
        outputId: "other",
        now: 3,
      }).result
    ).toEqual({ outcome: "rejected", reason: "blob-url-conflict" })
    const sealed = sealNativeOutputManifest(initial, {
      ...identity,
      outputsRequested: 1,
      outputsFailedBeforeHandoff: 0,
      error: "unused",
      now: 4,
    }).next
    const refused = prepareNativeOutput(sealed, {
      ...identity,
      outputId: "other",
      blobUrl: "blob:other",
      now: 5,
    })
    expect(refused.result).toEqual({
      outcome: "rejected",
      reason: "manifest-sealed",
    })
    expect(refused.next).toBe(sealed)
  })

  it("rejects replay when its manifest has lost or changed durable ownership", () => {
    const initial = prepared()
    const manifests: NativeOutputState["manifestsByJobId"][] = [
      {},
      { job: { ...initial.manifestsByJobId.job!, attempt: 2 } },
    ]
    for (const manifestsByJobId of manifests) {
      const state = { ...initial, manifestsByJobId }
      const refused = prepareNativeOutput(state, { ...identity, now: 5 })
      expect(refused.result).toEqual({
        outcome: "rejected",
        reason: "manifest-conflict",
      })
      expect(refused.next).toBe(state)
    }
  })

  it("attaches one browser identity while preserving unknown-outcome evidence", () => {
    const initial = waiting()
    expect(
      attachNativeDownload(initial, { outputId: "missing", downloadId: 42 })
        .result
    ).toEqual({ outcome: "rejected", reason: "output-not-found" })
    expect(
      attachNativeDownload(prepared(), { outputId: "output", downloadId: 42 })
        .result
    ).toEqual({ outcome: "rejected", reason: "invalid-transition" })
    expect(
      attachNativeDownload(initial, { outputId: "output", downloadId: 43 })
        .result
    ).toEqual({ outcome: "rejected", reason: "download-id-conflict" })
    const replay = attachNativeDownload(initial, {
      outputId: "output",
      downloadId: 42,
    })
    expect(replay.result.outcome).toBe("unchanged")
    expect(replay.next).toBe(initial)

    const other = prepareNativeOutput(initial, {
      ...identity,
      jobId: "other-job",
      outputId: "other",
      blobUrl: "blob:other",
      now: 3,
    }).next
    const acceptingOther = markNativeOutputAcceptanceUnknown(other, {
      outputId: "other",
      now: 4,
    }).next
    expect(
      attachNativeDownload(acceptingOther, {
        outputId: "other",
        downloadId: 42,
      }).result
    ).toEqual({ outcome: "rejected", reason: "download-id-conflict" })

    const unknown = markNativeOutputOutcomeUnknown(accepted(), {
      outputId: "output",
    }).next
    expect(
      attachNativeDownload(unknown, { outputId: "output", downloadId: 43 })
        .result
    ).toMatchObject({
      outcome: "applied",
      record: { phase: "outcome_unknown", downloadId: 43 },
    })
  })

  it("keeps terminal results and accounting disposition immutable under replay", () => {
    expect(
      markNativeDownloadTerminal(prepared(), {
        downloadId: 42,
        phase: "complete",
        now: 3,
      }).result
    ).toEqual({ outcome: "rejected", reason: "download-not-found" })
    const initial = waiting()
    const terminal = markNativeDownloadTerminal(initial, {
      downloadId: 42,
      phase: "complete",
      now: 3,
    }).next
    expect(
      markNativeDownloadTerminal(terminal, {
        downloadId: 42,
        phase: "complete",
        now: 99,
      }).result.outcome
    ).toBe("unchanged")
    expect(
      markNativeDownloadTerminal(terminal, {
        downloadId: 42,
        phase: "interrupted",
        now: 4,
      }).result
    ).toEqual({ outcome: "rejected", reason: "terminal-conflict" })
    expect(
      markNativeOutputAccountingDisposition(initial, {
        outputId: "output",
        disposition: "accounted",
        now: 4,
      }).result
    ).toEqual({ outcome: "rejected", reason: "invalid-transition" })
    expect(
      markNativeOutputAccountingDisposition(initial, {
        outputId: "missing",
        disposition: "accounted",
        now: 4,
      }).result
    ).toEqual({ outcome: "rejected", reason: "output-not-found" })
    const accounted = markNativeOutputAccountingDisposition(terminal, {
      outputId: "output",
      disposition: "accounted",
      now: 4,
    }).next
    const replay = markNativeOutputAccountingDisposition(accounted, {
      outputId: "output",
      disposition: "accounted",
      now: 99,
    })
    expect(replay.result.outcome).toBe("unchanged")
    expect(replay.next).toBe(accounted)
    expect(
      markNativeOutputAccountingDisposition(accounted, {
        outputId: "output",
        disposition: "not_owner",
        now: 5,
      }).result
    ).toEqual({ outcome: "rejected", reason: "accounting-conflict" })
  })

  it("holds job liveness through terminal accounting and every resource release", () => {
    let state = prepared()
    const record = () => state.outputsByOutputId.output!
    const releaseJob = () =>
      markNativeOutputJobDependencyReleased(state, { jobId: "job", now: 20 })
    expect(isNativeOutputLive(record())).toBe(true)
    expect(releaseJob().result).toEqual({
      outcome: "rejected",
      reason: "invalid-transition",
    })
    expect(
      markNativeOutputJobDependencyReleased(state, {
        jobId: "missing",
        now: 20,
      }).result
    ).toEqual({ outcome: "rejected", reason: "manifest-not-found" })
    state = waiting()
    state = sealNativeOutputManifest(state, {
      ...identity,
      outputsRequested: 1,
      outputsFailedBeforeHandoff: 0,
      error: "unused",
      now: 3,
    }).next
    expect(releaseJob().result.outcome).toBe("rejected")
    state = markNativeDownloadTerminal(state, {
      downloadId: 42,
      phase: "complete",
      now: 4,
    }).next
    expect(isNativeOutputLive(record())).toBe(true)
    state = markNativeOutputAccountingDisposition(state, {
      outputId: "output",
      disposition: "accounted",
      now: 5,
    }).next
    state = acknowledgeNativeOutputSettlement(state, {
      jobId: "job",
      now: 6,
    }).next
    expect(isNativeOutputLive(record())).toBe(true)
    expect(releaseJob().result.outcome).toBe("rejected")
    state = markNativeOutputBlobReleased(state, {
      outputId: "output",
      now: 7,
    }).next
    expect(isNativeOutputLive(record())).toBe(true)
    state = markNativeOutputDependencyReleased(state, {
      outputId: "output",
      now: 8,
    }).next
    expect(isNativeOutputLive(record())).toBe(false)
    state = releaseJob().next
    const replay = releaseJob()
    expect(replay.result.outcome).toBe("unchanged")
    expect(replay.next).toBe(state)
  })
})
