import { describe, expect, it } from "vitest"
import { z } from "zod"
import { parseEpoch5NativeOutputState } from "@/src/runtime/state-schema-migration-native-schema"

const identity = {
  jobId: "job",
  attempt: 1,
  taskId: "task",
  chapterId: "chapter",
  fingerprint: "a".repeat(64),
  documentInstanceId: "document",
}

function manifest(patch: Record<string, unknown> = {}) {
  return {
    ...identity,
    phase: "sealed",
    outputsRequested: 1,
    outputsFailedBeforeHandoff: 0,
    slots: [{ disposition: "tracked", outputId: "output" }],
    createdAt: 1,
    sealedAt: 3,
    ...patch,
  }
}
function output(patch: Record<string, unknown> = {}) {
  return {
    ...identity,
    outputId: "output",
    outputIndex: 0,
    outputCount: 1,
    blobUrl: "blob:output",
    filename: "Series/Chapter.cbz",
    outputKind: "archive",
    phase: "waiting",
    createdAt: 1,
    acceptanceStartedAt: 2,
    downloadId: 42,
    accountingDisposition: "pending",
    ...patch,
  }
}
function state(
  record: Record<string, unknown> = {},
  job: Record<string, unknown> = {}
) {
  return {
    manifestsByJobId: { job: manifest(job) },
    outputsByOutputId: { output: output(record) },
  }
}
function issues(value: unknown) {
  try {
    parseEpoch5NativeOutputState(value)
  } catch (error) {
    if (error instanceof Error && error.cause instanceof z.ZodError)
      return error.cause.issues.map((issue) => issue.path)
    throw error
  }
  return []
}

describe("historical native-output evidence", () => {
  it.each([
    { outputIndex: 1 },
    { acceptanceStartedAt: undefined },
    { acceptanceStartedAt: 0 },
    { phase: "prepared" },
    { phase: "acceptance_unknown" },
    { phase: "handoff_interrupted", downloadId: undefined, terminalAt: 3 },
    { downloadId: undefined },
    { terminalAt: 3 },
    { phase: "complete" },
    { phase: "interrupted", terminalAt: 0 },
    { phase: "handoff_interrupted", downloadId: undefined, erasedAt: 3 },
    { erasedAt: 5, erasedByBrowserAt: 4 },
    { erasedByBrowserAt: 4 },
    { accountingDispositionAt: 4 },
    { accountingDisposition: "accounted" },
    {
      phase: "prepared",
      downloadId: undefined,
      accountingDisposition: "accounted",
      accountingDispositionAt: 3,
    },
    { blobReleasedAt: 3 },
    { phase: "complete", terminalAt: 3, blobReleasedAt: 0 },
    { erasedAt: 5, blobReleasedAt: 6, dependencyReleasedAt: 7 },
    {
      phase: "complete",
      terminalAt: 3,
      accountingDisposition: "accounted",
      accountingDispositionAt: 3,
      dependencyReleasedAt: 4,
    },
    {
      phase: "complete",
      terminalAt: 3,
      accountingDisposition: "accounted",
      accountingDispositionAt: 3,
      blobReleasedAt: 5,
      dependencyReleasedAt: 4,
    },
  ])("rejects inconsistent lifecycle or release evidence %#", (patch) => {
    expect(issues(state(patch)).length).toBeGreaterThan(0)
  })

  it("accepts recorded completion and acknowledged resource release", () => {
    expect(
      issues(
        state(
          {
            phase: "complete",
            terminalAt: 3,
            accountingDisposition: "accounted",
            accountingDispositionAt: 4,
            blobReleasedAt: 5,
            dependencyReleasedAt: 6,
          },
          { settlementAcknowledgedAt: 4, dependencyReleasedAt: 6 }
        )
      )
    ).toEqual([])
    expect(
      issues(
        state(
          {
            erasedAt: 5,
            accountingDisposition: "accounted",
            accountingDispositionAt: 6,
            blobReleasedAt: 7,
            dependencyReleasedAt: 8,
          },
          { settlementAcknowledgedAt: 6, dependencyReleasedAt: 8 }
        )
      )
    ).toEqual([])
  })

  it("reports output evidence violations in their established order", () => {
    expect(
      issues(
        state({
          outputIndex: 1,
          phase: "waiting",
          acceptanceStartedAt: 0,
          downloadId: undefined,
          terminalAt: 0,
          erasedAt: 2,
          erasedByBrowserAt: 1,
          accountingDispositionAt: 4,
          blobReleasedAt: 0,
          dependencyReleasedAt: 0,
        })
      )
    ).toEqual([
      ["outputsByOutputId", "output", "outputIndex"],
      ["outputsByOutputId", "output", "acceptanceStartedAt"],
      ["outputsByOutputId", "output", "downloadId"],
      ["outputsByOutputId", "output", "terminalAt"],
      ["outputsByOutputId", "output", "terminalAt"],
      ["outputsByOutputId", "output", "erasedAt"],
      ["outputsByOutputId", "output", "erasedByBrowserAt"],
      ["outputsByOutputId", "output", "accountingDispositionAt"],
      ["outputsByOutputId", "output", "blobReleasedAt"],
      ["outputsByOutputId", "output", "dependencyReleasedAt"],
      ["manifestsByJobId", "job", "slots", 0],
    ])
  })
})

describe("historical native manifests", () => {
  const open = { phase: "open", slots: [null], sealedAt: undefined }
  it.each([
    { errorMessage: "failure" },
    { errorCategory: "unknown" },
    { sealedAt: 3 },
    { settlementAcknowledgedAt: 3 },
    { dependencyReleasedAt: 3 },
    { outputsFailedBeforeHandoff: 1 },
    {
      slots: [
        { disposition: "untracked_failed", failedAt: 3, error: "failure" },
      ],
    },
  ])("rejects finalized evidence in an open manifest %#", (patch) => {
    expect(
      issues({
        manifestsByJobId: { job: manifest({ ...open, ...patch }) },
        outputsByOutputId: {},
      })
    ).toContainEqual(["manifestsByJobId", "job", "phase"])
  })
  it.each([
    { slots: [] },
    { outputsFailedBeforeHandoff: 2 },
    { sealedAt: undefined },
    { sealedAt: 0 },
    { slots: [null] },
    { outputsFailedBeforeHandoff: 1 },
    { settlementAcknowledgedAt: 2 },
    { dependencyReleasedAt: 4 },
    { settlementAcknowledgedAt: 4, dependencyReleasedAt: 3 },
  ])("rejects incomplete or out-of-order manifest receipts %#", (patch) => {
    expect(
      issues({
        manifestsByJobId: { job: manifest(patch) },
        outputsByOutputId: {},
      }).length
    ).toBeGreaterThan(0)
  })
  it("accepts an open reservation and a sealed manifest whose released output was pruned", () => {
    expect(
      issues({
        manifestsByJobId: { job: manifest(open) },
        outputsByOutputId: {},
      })
    ).toEqual([])
    expect(
      issues({ manifestsByJobId: { job: manifest() }, outputsByOutputId: {} })
    ).toEqual([])
    expect(
      issues({
        manifestsByJobId: {
          job: manifest({
            ...open,
            slots: [{ disposition: "tracked", outputId: "output" }],
          }),
        },
        outputsByOutputId: {},
      })
    ).toEqual([["manifestsByJobId", "job", "slots", 0]])
  })
})

describe("historical native record ownership", () => {
  it.each([
    { jobId: "other" },
    { attempt: 2 },
    { taskId: "other" },
    { chapterId: "other" },
    { fingerprint: "b".repeat(64) },
    { documentInstanceId: "other" },
    { outputCount: 2 },
    { outputIndex: 1, outputCount: 2 },
  ])("rejects an output outside its exact manifest incarnation %#", (patch) => {
    expect(issues(state(patch))).toContainEqual([
      "manifestsByJobId",
      "job",
      "slots",
      0,
    ])
  })
  it("rejects repeated output slots before reporting their incarnation mismatch", () => {
    expect(
      issues({
        manifestsByJobId: {
          job: manifest({
            outputsRequested: 2,
            slots: [
              { disposition: "tracked", outputId: "output" },
              { disposition: "tracked", outputId: "output" },
            ],
          }),
        },
        outputsByOutputId: { output: output({ outputCount: 2 }) },
      })
    ).toEqual([
      ["manifestsByJobId", "job", "slots", 1],
      ["manifestsByJobId", "job", "slots", 1],
    ])
  })
  it("rejects reused Blob and browser identities in output order", () => {
    expect(
      issues({
        manifestsByJobId: {
          job: manifest(),
          second: manifest({
            jobId: "second",
            slots: [{ disposition: "tracked", outputId: "second" }],
          }),
        },
        outputsByOutputId: {
          output: output(),
          second: output({ jobId: "second", outputId: "second" }),
        },
      })
    ).toEqual([
      ["outputsByOutputId", "second", "blobUrl"],
      ["outputsByOutputId", "second", "downloadId"],
    ])
  })
  it("rejects acknowledgement and dependency release while tracked ownership remains unresolved", () => {
    expect(
      issues(
        state({}, { settlementAcknowledgedAt: 4, dependencyReleasedAt: 5 })
      )
    ).toEqual([
      ["manifestsByJobId", "job", "settlementAcknowledgedAt"],
      ["manifestsByJobId", "job", "dependencyReleasedAt"],
    ])
  })
  it("requires storage keys to match the indexed manifest and output identities", () => {
    expect(
      issues({
        manifestsByJobId: { wrong: manifest() },
        outputsByOutputId: { output: output() },
      })
    ).toEqual([["manifestsByJobId", "wrong", "jobId"]])
    expect(
      issues({
        manifestsByJobId: { job: manifest() },
        outputsByOutputId: { wrong: output() },
      })
    ).toEqual([["outputsByOutputId", "wrong"]])
  })
})
