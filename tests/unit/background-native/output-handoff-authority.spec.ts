import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  NativeOutputCoordinator,
  type NativeOutputCoordinatorDependencies,
} from "@/entrypoints/background/native-output-coordinator"
import { DEFAULT_SETTINGS } from "@/src/domain/settings/defaults"
import { createTaskSettingsSnapshot } from "@/src/runtime/settings-snapshot"
import { NativeOutputRepository } from "@/src/storage/native-output-repository"
import { QueueRepository } from "@/src/storage/queue-repository"
import { QueueProjectionService } from "@/src/storage/queue-projection-service"
import { HistoryRepository } from "@/src/storage/history-repository"

const identity = {
  jobId: "authority-job",
  attempt: 1,
  taskId: "authority-task",
  chapterId: "authority-chapter",
  fingerprint: "a".repeat(64),
  documentInstanceId: "authority-document",
}
const payload = {
  ...identity,
  outputId: "authority-output",
  outputIndex: 0,
  outputCount: 1,
  fileUrl: "blob:authority-output",
  filename: "Series/Chapter.cbz",
  outputKind: "archive" as const,
}

describe("native output handoff authority", () => {
  beforeEach(() => {
    const local: Record<string, unknown> = {}
    vi.stubGlobal("chrome", {
      storage: {
        local: {
          get: vi.fn(async () => structuredClone(local)),
          set: vi.fn(async (values: Record<string, unknown>) => {
            Object.assign(local, structuredClone(values))
          }),
          remove: vi.fn(async (keys: string | string[]) => {
            for (const key of Array.isArray(keys) ? keys : [keys])
              delete local[key]
          }),
        },
        session: { set: vi.fn(async () => undefined) },
      },
      downloads: {
        download: vi.fn(async () => 42),
        search: vi.fn(async () => []),
      },
    })
  })

  async function fixture() {
    const queue = new QueueRepository(
      new QueueProjectionService(),
      new HistoryRepository()
    )
    const repository = new NativeOutputRepository()
    await queue.enqueueDownloadTask({
      id: identity.taskId,
      siteIntegrationId: "mangadex",
      mangaId: "series",
      seriesTitle: "Series",
      created: 1,
      started: 2,
      status: "downloading",
      chapters: [
        {
          id: identity.chapterId,
          url: "https://mangadex.org/chapter/authority-chapter",
          title: "Chapter",
          index: 0,
          status: "downloading",
          dispatchAttempt: identity.attempt,
          requestedPath: payload.filename,
          lastUpdated: 2,
        },
      ],
      settingsSnapshot: createTaskSettingsSnapshot(
        DEFAULT_SETTINGS,
        "mangadex"
      ),
    })
    const revoke = vi.fn(async () => undefined)
    const queryJob = vi.fn<
      NativeOutputCoordinatorDependencies["queryOffscreenJob"]
    >(async (job) => ({
      ...job,
      status: "active",
      stage: "saving",
      lastSequence: 1,
    }))
    const ensureLiveness = vi.fn(async () => undefined)
    const coordinator = new NativeOutputCoordinator({
      queueRepository: queue,
      repository,
      settingsRepository: { getSettings: async () => DEFAULT_SETTINGS },
      queryOffscreenJob: queryJob,
      requestBlobRevocation: revoke,
      ensureLivenessAlarm: ensureLiveness,
    })
    return { queue, repository, coordinator, revoke, queryJob, ensureLiveness }
  }

  it("keeps a new output unpersisted when its producer has no lease", async () => {
    const f = await fixture()
    expect(await f.coordinator.getJobPhase(identity.jobId)).toBeNull()
    expect(
      (await f.coordinator.handleOutputReady(payload)).response
    ).toMatchObject({
      disposition: "not_persisted",
      reason: "stale-job",
    })
    expect(await f.coordinator.getJobPhase(identity.jobId)).toBeNull()
    expect(await f.repository.getByOutputId(payload.outputId)).toBeUndefined()
    expect(chrome.downloads.download).not.toHaveBeenCalled()
  })

  it("interrupts a prepared output after producer ownership was lost", async () => {
    const f = await fixture()
    await f.repository.prepare({ ...payload, blobUrl: payload.fileUrl, now: 3 })
    expect(await f.coordinator.getJobPhase(identity.jobId)).toBe("open")
    expect(
      (await f.coordinator.handleOutputReady(payload)).response
    ).toMatchObject({
      disposition: "tracked",
      phase: "interrupted",
    })
    expect(chrome.downloads.download).not.toHaveBeenCalled()
    expect(f.revoke).toHaveBeenCalledOnce()
    expect(await f.repository.getByOutputId(payload.outputId)).toMatchObject({
      phase: "interrupted",
      accountingDisposition: "pending",
    })
  })

  it("preserves a prepared output when a same-ID message changes its identity", async () => {
    const f = await fixture()
    await f.repository.prepare({ ...payload, blobUrl: payload.fileUrl, now: 3 })
    const before = await f.repository.getByOutputId(payload.outputId)
    expect(
      (
        await f.coordinator.handleOutputReady({
          ...payload,
          filename: "other.cbz",
        })
      ).response
    ).toMatchObject({
      disposition: "not_persisted",
      reason: "output-identity-conflict",
    })
    expect(await f.repository.getByOutputId(payload.outputId)).toEqual(before)
    expect(chrome.downloads.download).not.toHaveBeenCalled()
    expect(f.revoke).not.toHaveBeenCalled()
  })

  it("seals the observer phase while retaining native completion ownership", async () => {
    const f = await fixture()
    await f.repository.prepare({ ...payload, blobUrl: payload.fileUrl, now: 4 })
    await f.coordinator.sealManifest({
      ...identity,
      outputsRequested: 1,
      outputsFailedBeforeHandoff: 0,
    })
    expect(await f.coordinator.getJobPhase(identity.jobId)).toBe("sealed")
    expect(await f.coordinator.hasLiveDependencies()).toBe(true)
    expect(chrome.downloads.download).not.toHaveBeenCalled()
  })
  async function attachWaitingOutput(repository: NativeOutputRepository) {
    await repository.prepare({ ...payload, blobUrl: payload.fileUrl, now: 3 })
    await repository.markAcceptanceUnknown({
      outputId: payload.outputId,
      now: 4,
    })
    await repository.attachDownload({
      outputId: payload.outputId,
      downloadId: 42,
    })
  }

  it("reconciles a repeated handoff through its recorded Chrome ID without initiating again", async () => {
    const f = await fixture()
    await attachWaitingOutput(f.repository)
    expect(
      (await f.coordinator.handleOutputReady(payload)).response
    ).toMatchObject({
      disposition: "tracked",
      phase: "outcome_unknown",
    })
    expect(chrome.downloads.search).toHaveBeenCalledWith({ id: 42 })
    expect(chrome.downloads.download).not.toHaveBeenCalled()
    expect(f.revoke).not.toHaveBeenCalled()
    expect(await f.coordinator.hasLiveDependencies()).toBe(true)
  })

  it("ignores nonterminal browser progress while an output is waiting", async () => {
    const f = await fixture()
    await attachWaitingOutput(f.repository)
    const before = await f.repository.snapshot()
    expect(
      await f.coordinator.handleDownloadChanged({
        id: 42,
        state: { current: "in_progress" },
      })
    ).toEqual({ handled: false, effects: [] })
    expect(await f.repository.snapshot()).toEqual(before)
    expect(f.revoke).not.toHaveBeenCalled()
  })

  it("preserves the first confirmed terminal result against a conflicting later browser event", async () => {
    const f = await fixture()
    await attachWaitingOutput(f.repository)
    expect(
      await f.coordinator.handleDownloadChanged({
        id: 42,
        state: { current: "complete" },
      })
    ).toMatchObject({ handled: true })
    const before = await f.repository.snapshot()
    expect(
      await f.coordinator.handleDownloadChanged({
        id: 42,
        state: { current: "interrupted" },
        error: { current: "USER_CANCELED" },
      })
    ).toEqual({ handled: false, effects: [] })
    expect(await f.repository.snapshot()).toEqual(before)
    expect(f.revoke).toHaveBeenCalledOnce()
  })

  it("retains an open stopped producer for retry when sealing its manifest cannot persist", async () => {
    const f = await fixture()
    await f.repository.prepare({ ...payload, blobUrl: payload.fileUrl, now: 3 })
    f.queryJob.mockResolvedValue({
      ...identity,
      status: "terminal",
      stage: "saving",
      lastSequence: 2,
      outcome: {
        status: "failed",
        outputsRequested: 1,
        outputsCommitted: 0,
        outputsFailedBeforeHandoff: 0,
        errorMessage: "Producer preparation failed",
        errorCategory: "archive_creation_failed",
      },
    })
    vi.spyOn(f.repository, "sealManifest").mockRejectedValueOnce(
      new Error("Storage unavailable")
    )
    expect(await f.coordinator.reconcile()).toEqual([])
    expect(await f.coordinator.getJobPhase(identity.jobId)).toBe("open")
    expect((await f.queue.getTask(identity.taskId))?.chapters[0].status).toBe(
      "downloading"
    )
    expect(f.ensureLiveness).toHaveBeenCalled()
    expect(await f.coordinator.hasLiveDependencies()).toBe(true)

    expect(await f.coordinator.reconcile()).toEqual([
      {
        jobId: identity.jobId,
        attempt: identity.attempt,
        taskId: identity.taskId,
        chapterId: identity.chapterId,
      },
    ])
    expect(await f.coordinator.getJobPhase(identity.jobId)).toBe("sealed")
    expect((await f.queue.getTask(identity.taskId))?.chapters[0]).toMatchObject(
      {
        status: "failed",
        errorMessage: "Producer preparation failed",
        errorCategory: "archive_creation_failed",
      }
    )
    expect(chrome.downloads.download).not.toHaveBeenCalled()
  })
})
