import { afterEach, describe, expect, it, vi } from "vitest"

import { DEFAULT_SETTINGS } from "@/src/domain/settings/defaults"
import { canReleaseNativeOutputBlob } from "@/src/domain/native-output/state"
import { markNativeOutputBlobReleased } from "@/src/domain/native-output/kernel"
import { createTaskSettingsSnapshot } from "@/src/runtime/settings-snapshot"
import { migrateDurableStateForCurrentSchema } from "@/src/runtime/state-schema-migration"
import { HistoryRepository } from "@/src/storage/history-repository"
import { NativeOutputRepository } from "@/src/storage/native-output-repository"
import { QueueProjectionService } from "@/src/storage/queue-projection-service"
import { QueueRepository } from "@/src/storage/queue-repository"
import { SettingsRepository } from "@/src/storage/settings-repository"

const identity = {
  jobId: "job",
  attempt: 1,
  taskId: "task",
  chapterId: "chapter",
  fingerprint: "a".repeat(64),
  documentInstanceId: "document",
}

function profile(blobReleased: boolean, dependencyReleased = false) {
  const task = {
    id: identity.taskId,
    siteIntegrationId: "mangadex",
    mangaId: "series",
    seriesTitle: "Series",
    status: "partial_success",
    activeBlock: "native_output_action_required",
    errorMessage: "The browser no longer exposes this transfer",
    errorCategory: "browser_download_unobservable",
    created: 1,
    completed: 9,
    settingsSnapshot: createTaskSettingsSnapshot(DEFAULT_SETTINGS, "mangadex"),
    chapters: [
      {
        id: identity.chapterId,
        url: "https://mangadex.org/chapter/chapter",
        title: "Chapter",
        index: 0,
        status: "partial_success",
        lastUpdated: 9,
        outputs: { requested: 1, committed: 0, failed: 1 },
        nativeOutputSettlement: {
          ...identity,
          fingerprint: undefined,
          documentInstanceId: undefined,
          requested: 1,
          completed: 0,
          interrupted: 0,
          surrendered: 1,
          appliedAt: 9,
        },
      },
    ],
  }
  delete task.chapters[0]!.nativeOutputSettlement.fingerprint
  delete task.chapters[0]!.nativeOutputSettlement.documentInstanceId
  return {
    stateSchemaEpoch: 3,
    "settings:global": structuredClone(DEFAULT_SETTINGS),
    downloadQueue: [task],
    pendingUndoActions: [
      {
        token: "undo",
        type: "remove_history",
        taskSnapshot: { ...task, id: "retained-task" },
        previousQueuePosition: 0,
        createdAt: 10,
        expiresAt: 9999999999999,
      },
    ],
    downloadedChapters: [],
    seriesDownloadHistory: {},
    downloadHistoryClearCutoffs: { allBefore: 5, bySeries: {}, byChapter: {} },
    "pendingOutputs:index": {
      jobIds: ["job"],
      outputIds: ["output"],
      downloadIdToOutputId: { "42": "output" },
    },
    "pendingOutputs:manifest:job": {
      ...identity,
      phase: "sealed",
      outputsRequested: 1,
      outputsFailedBeforeHandoff: 0,
      slots: [{ disposition: "tracked", outputId: "output" }],
      createdAt: 1,
      sealedAt: 3,
      ...(dependencyReleased ? { dependencyReleasedAt: 12 } : {}),
    },
    "pendingOutputs:output:output": {
      ...identity,
      outputId: "output",
      outputIndex: 0,
      outputCount: 1,
      blobUrl: "blob:output",
      filename: "Series/Chapter.cbz",
      outputKind: "archive",
      phase: "surrendered",
      createdAt: 1,
      acceptanceStartedAt: 2,
      downloadId: 42,
      erasedAt: 5,
      surrenderedAt: 6,
      accountingDisposition: "accounted",
      accountingDispositionAt: 9,
      ...(blobReleased ? { blobReleasedAt: 10 } : {}),
      ...(dependencyReleased ? { dependencyReleasedAt: 11 } : {}),
    },
  }
}

function installStorage(initial: Record<string, unknown>) {
  const stored = structuredClone(initial)
  vi.stubGlobal("chrome", {
    i18n: { getMessage: (key: string) => key },
    storage: {
      local: {
        get: vi.fn(async (keys: string | string[]) =>
          Object.fromEntries(
            [keys]
              .flat()
              .flatMap((key) =>
                key in stored ? [[key, structuredClone(stored[key])]] : []
              )
          )
        ),
        set: vi.fn(async (values: Record<string, unknown>) => {
          Object.assign(stored, structuredClone(values))
        }),
        remove: vi.fn(async (keys: string | string[]) => {
          for (const key of [keys].flat()) delete stored[key]
        }),
      },
      session: { set: vi.fn(async () => undefined) },
    },
  })
  return stored
}

afterEach(() => vi.unstubAllGlobals())

describe("retained profile migration and hydration", () => {
  it.each([false, true])(
    "hydrates removed native representations while preserving actual Blob release=%s",
    async (blobReleased) => {
      const stored = installStorage(profile(blobReleased))
      await migrateDurableStateForCurrentSchema()
      const history = new HistoryRepository()
      const queue = new QueueRepository(new QueueProjectionService(), history)
      const native = new NativeOutputRepository()
      const settings = new SettingsRepository("warn")
      await queue.initialize()
      await native.initialize()
      expect((await settings.getSettings()).downloads).toEqual(
        DEFAULT_SETTINGS.downloads
      )
      expect(
        (await queue.getTask("task"))?.chapters[0]?.nativeOutputSettlement
      ).toMatchObject({
        requested: 1,
        completed: 0,
        interrupted: 1,
        acceptanceUncertain: true,
      })
      expect(await history.getDownloadedChapters()).toEqual([])
      expect((await history.getAggregate()).clearCutoffs.allBefore).toBe(5)
      expect(stored.pendingUndoActions).toMatchObject([
        {
          taskSnapshot: {
            id: "retained-task",
            chapters: [
              { nativeOutputSettlement: { acceptanceUncertain: true } },
            ],
          },
        },
      ])
      const state = await native.snapshot()
      const output = state.outputsByOutputId.output!
      expect(output).toMatchObject({
        phase: "waiting",
        downloadId: 42,
        erasedAt: 5,
        accountingDisposition: "accounted",
      })
      expect(output).not.toHaveProperty("terminalAt")
      expect(output).not.toHaveProperty("erasedByBrowserAt")
      expect(output.blobReleasedAt).toBe(blobReleased ? 10 : undefined)
      expect(canReleaseNativeOutputBlob(output)).toBe(false)
      if (!blobReleased) {
        expect(
          markNativeOutputBlobReleased(state, { outputId: "output", now: 20 })
            .result
        ).toMatchObject({ outcome: "rejected", reason: "invalid-transition" })
      }
      const before = structuredClone(stored)
      await migrateDurableStateForCurrentSchema()
      expect(stored).toEqual(before)
    }
  )
  it("preserves completed dependency release receipts without inventing a transfer result", async () => {
    installStorage(profile(true, true))
    await migrateDurableStateForCurrentSchema()
    const repository = new NativeOutputRepository()
    const state = await repository.snapshot()
    expect(state.outputsByOutputId.output).toMatchObject({
      phase: "waiting",
      blobReleasedAt: 10,
      dependencyReleasedAt: 11,
    })
    expect(state.manifestsByJobId.job).toMatchObject({
      dependencyReleasedAt: 12,
      settlementAcknowledgedAt: 12,
    })
    expect(state.outputsByOutputId.output).not.toHaveProperty("terminalAt")
    expect(state.outputsByOutputId.output).not.toHaveProperty(
      "erasedByBrowserAt"
    )
  })
})
