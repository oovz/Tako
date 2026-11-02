import { describe, expect, it } from "vitest"
import { z } from "zod"
import type {
  NativeOutputRecord,
  NativeOutputState,
} from "@/src/domain/native-output/state"
import { InvalidDurableStateError } from "@/src/runtime/runtime-phase-errors"
import { parseCurrentNativeOutputState } from "@/src/storage/native-output-repository"

function preparedState(): NativeOutputState {
  const identity = {
    jobId: "job-1",
    attempt: 1,
    taskId: "task-1",
    chapterId: "chapter-1",
    fingerprint: "a".repeat(64),
    documentInstanceId: "document-1",
  }
  return {
    manifestsByJobId: {
      "job-1": {
        ...identity,
        phase: "open",
        outputsRequested: 1,
        outputsFailedBeforeHandoff: 0,
        slots: [{ disposition: "tracked", outputId: "output-1" }],
        createdAt: 10,
      },
    },
    outputsByOutputId: {
      "output-1": {
        ...identity,
        outputId: "output-1",
        outputIndex: 0,
        outputCount: 1,
        blobUrl: "blob:output-1",
        filename: "chapter.cbz",
        outputKind: "archive",
        phase: "prepared",
        createdAt: 10,
        accountingDisposition: "pending",
      },
    },
  }
}

function invalidPaths(state: NativeOutputState): PropertyKey[][] {
  try {
    parseCurrentNativeOutputState(state)
  } catch (error) {
    if (
      !(error instanceof InvalidDurableStateError) ||
      !(error.cause instanceof z.ZodError)
    )
      throw error
    return error.cause.issues.map((issue) => issue.path)
  }
  throw new Error("Expected invalid native-output state")
}

describe("native output durable refinements", () => {
  it("reports manifest shape, phase and lifecycle violations in validation order", () => {
    const state = preparedState()
    Object.assign(state.manifestsByJobId["job-1"]!, {
      outputsRequested: 2,
      outputsFailedBeforeHandoff: 3,
      settlementAcknowledgedAt: 8,
      dependencyReleasedAt: 7,
    })
    expect(invalidPaths(state).slice(0, 5)).toEqual([
      ["manifestsByJobId", "job-1", "slots"],
      ["manifestsByJobId", "job-1", "outputsFailedBeforeHandoff"],
      ["manifestsByJobId", "job-1", "phase"],
      ["manifestsByJobId", "job-1", "settlementAcknowledgedAt"],
      ["manifestsByJobId", "job-1", "dependencyReleasedAt"],
    ])
  })

  it("requires sealed timestamps, filled slots and exact failed-output accounting", () => {
    const state = preparedState()
    const manifest = state.manifestsByJobId["job-1"]!
    manifest.phase = "sealed"
    manifest.slots = [null]
    expect(invalidPaths(state)).toContainEqual([
      "manifestsByJobId",
      "job-1",
      "phase",
    ])
    manifest.sealedAt = 11
    manifest.slots = [
      {
        disposition: "untracked_failed",
        failedAt: 11,
        error: "handoff failed",
      },
    ]
    expect(invalidPaths(state)).toContainEqual([
      "manifestsByJobId",
      "job-1",
      "phase",
    ])
    manifest.outputsFailedBeforeHandoff = 1
    state.outputsByOutputId = {}
    expect(parseCurrentNativeOutputState(state)).toEqual(state)
  })

  it.each([
    ["errorMessage", "failed"],
    ["sealedAt", 11],
    ["settlementAcknowledgedAt", 12],
    ["dependencyReleasedAt", 13],
  ] as const)("rejects %s on an open manifest", (field, value) => {
    const state = preparedState()
    Object.assign(state.manifestsByJobId["job-1"]!, { [field]: value })
    expect(invalidPaths(state)).toContainEqual([
      "manifestsByJobId",
      "job-1",
      "phase",
    ])
  })

  const recordCases: Array<[string, Partial<NativeOutputRecord>, string[]]> = [
    [
      "missing acceptance and native ID",
      { phase: "waiting" },
      ["acceptanceStartedAt", "downloadId"],
    ],
    [
      "native results before acceptance",
      { downloadId: 7, terminalAt: 12 },
      ["phase"],
    ],
    [
      "acceptance before preparation",
      { phase: "acceptance_unknown", acceptanceStartedAt: 9 },
      ["acceptanceStartedAt"],
    ],
    [
      "waiting terminal timestamp",
      {
        phase: "waiting",
        acceptanceStartedAt: 11,
        downloadId: 7,
        terminalAt: 12,
      },
      ["terminalAt"],
    ],
    [
      "unknown outcome terminal timestamp",
      { phase: "outcome_unknown", acceptanceStartedAt: 11, terminalAt: 12 },
      ["terminalAt"],
    ],
    [
      "terminal result before acceptance",
      {
        phase: "complete",
        acceptanceStartedAt: 11,
        downloadId: 7,
        terminalAt: 10,
      },
      ["terminalAt"],
    ],
    ["missing terminal timestamp", { phase: "interrupted" }, ["terminalAt"]],
    ["erasure without native ID", { erasedAt: 12 }, ["erasedAt"]],
    [
      "browser erasure without observation",
      { erasedByBrowserAt: 12 },
      ["erasedByBrowserAt"],
    ],
    [
      "browser erasure before observation",
      {
        phase: "waiting",
        acceptanceStartedAt: 11,
        downloadId: 7,
        erasedAt: 12,
        erasedByBrowserAt: 11,
      },
      ["erasedByBrowserAt"],
    ],
    [
      "timestamp for pending accounting",
      { accountingDispositionAt: 12 },
      ["accountingDispositionAt"],
    ],
    [
      "accounting an unresolved output",
      {
        phase: "waiting",
        acceptanceStartedAt: 11,
        downloadId: 7,
        accountingDisposition: "accounted",
        accountingDispositionAt: 12,
      },
      ["accountingDisposition"],
    ],
    [
      "missing disposition timestamp",
      {
        phase: "interrupted",
        terminalAt: 12,
        accountingDisposition: "not_owner",
      },
      ["accountingDisposition"],
    ],
    [
      "Blob release without consumption",
      { blobReleasedAt: 12 },
      ["blobReleasedAt"],
    ],
    [
      "dependency release without accounting or Blob release",
      { dependencyReleasedAt: 12 },
      ["dependencyReleasedAt"],
    ],
    [
      "release before preparation",
      { phase: "interrupted", terminalAt: 12, blobReleasedAt: 9 },
      ["blobReleasedAt"],
    ],
    [
      "dependency release before Blob release",
      {
        phase: "interrupted",
        terminalAt: 12,
        accountingDisposition: "accounted",
        accountingDispositionAt: 12,
        blobReleasedAt: 14,
        dependencyReleasedAt: 13,
      },
      ["dependencyReleasedAt"],
    ],
  ]
  it.each(recordCases)("rejects %s", (_name, patch, fields) => {
    const state = preparedState()
    Object.assign(state.outputsByOutputId["output-1"]!, patch)
    expect(invalidPaths(state)).toEqual(
      fields.map((field) => ["outputsByOutputId", "output-1", field])
    )
  })

  it("retains erased waiting Blob evidence independently of accounting readiness", () => {
    const state = preparedState()
    Object.assign(state.outputsByOutputId["output-1"]!, {
      phase: "waiting",
      acceptanceStartedAt: 11,
      downloadId: 7,
      erasedAt: 12,
      blobReleasedAt: 13,
    })
    expect(parseCurrentNativeOutputState(state)).toEqual(state)
  })

  it("rejects an output index equal to its declared count before reporting slot ownership", () => {
    const state = preparedState()
    state.outputsByOutputId["output-1"]!.outputIndex = 1
    expect(invalidPaths(state)).toEqual([
      ["outputsByOutputId", "output-1", "outputIndex"],
      ["manifestsByJobId", "job-1", "slots", 0],
    ])
  })

  it("requires a manifest storage key to match the validated job identity", () => {
    const state = preparedState()
    state.manifestsByJobId = { other: state.manifestsByJobId["job-1"]! }
    expect(invalidPaths(state)).toEqual([
      ["manifestsByJobId", "other", "jobId"],
    ])
  })

  it("rejects an output stored under another identity as both missing and orphaned", () => {
    const state = preparedState()
    state.outputsByOutputId = { other: state.outputsByOutputId["output-1"]! }
    expect(invalidPaths(state)).toEqual([
      ["manifestsByJobId", "job-1", "slots", 0],
      ["outputsByOutputId", "other"],
    ])
  })

  it("requires exact slot ownership and unique Blob/native download identities", () => {
    const state = preparedState()
    const manifest = state.manifestsByJobId["job-1"]!
    manifest.outputsRequested = 2
    manifest.slots.push({ disposition: "tracked", outputId: "output-2" })
    const first = state.outputsByOutputId["output-1"]!
    Object.assign(first, {
      phase: "waiting",
      acceptanceStartedAt: 11,
      downloadId: 7,
      outputCount: 2,
    })
    state.outputsByOutputId["output-2"] = {
      ...first,
      outputId: "output-2",
      outputIndex: 1,
    }
    expect(invalidPaths(state)).toEqual([
      ["outputsByOutputId", "output-2", "blobUrl"],
      ["outputsByOutputId", "output-2", "downloadId"],
    ])
    state.outputsByOutputId["output-2"]!.blobUrl = "blob:output-2"
    state.outputsByOutputId["output-2"]!.downloadId = 8
    expect(parseCurrentNativeOutputState(state)).toEqual(state)
    manifest.slots[1] = { disposition: "tracked", outputId: "output-1" }
    expect(invalidPaths(state)).toEqual([
      ["manifestsByJobId", "job-1", "slots", 1],
      ["manifestsByJobId", "job-1", "slots", 1],
      ["outputsByOutputId", "output-2"],
    ])
  })

  it("allows pruned sealed outputs and rejects pruned open outputs", () => {
    const state = preparedState()
    state.outputsByOutputId = {}
    expect(invalidPaths(state)).toEqual([
      ["manifestsByJobId", "job-1", "slots", 0],
    ])
    Object.assign(state.manifestsByJobId["job-1"]!, {
      phase: "sealed",
      sealedAt: 11,
      settlementAcknowledgedAt: 12,
      dependencyReleasedAt: 13,
    })
    expect(parseCurrentNativeOutputState(state)).toEqual(state)
  })

  it("checks settled/released manifests against every retained tracked output", () => {
    const state = preparedState()
    Object.assign(state.manifestsByJobId["job-1"]!, {
      phase: "sealed",
      sealedAt: 11,
      settlementAcknowledgedAt: 12,
      dependencyReleasedAt: 13,
    })
    expect(invalidPaths(state)).toEqual([
      ["manifestsByJobId", "job-1", "settlementAcknowledgedAt"],
      ["manifestsByJobId", "job-1", "dependencyReleasedAt"],
    ])
  })
})
