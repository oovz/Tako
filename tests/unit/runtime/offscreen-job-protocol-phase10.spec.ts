import { describe, expect, it } from "vitest"

import {
  createOffscreenDispatchFingerprint,
  type FingerprintedOffscreenDispatchPayload,
} from "@/src/runtime/offscreen-job-fingerprint"
import { runtimeMessageRegistry } from "@/src/runtime/runtime-message-contracts"
import { createTaskSettingsSnapshot } from "@/src/runtime/settings-snapshot"
import { DEFAULT_SETTINGS } from "@/src/domain/settings/defaults"

function dispatchPayload(): Omit<
  FingerprintedOffscreenDispatchPayload,
  "fingerprint"
> {
  return {
    jobId: "job-1",
    attempt: 1,
    taskId: "task-1",
    seriesKey: "mangadex:series-1",
    book: {
      siteIntegrationId: "mangadex",
      seriesTitle: "Series",
    },
    chapter: {
      id: "chapter-1",
      title: "Chapter 1",
      url: "https://example.test/chapter-1",
      index: 1,
      resolvedPath: "Series/Chapter 1.cbz",
    },
    settingsSnapshot: createTaskSettingsSnapshot(DEFAULT_SETTINGS, "mangadex"),
    saveMode: "downloads-api",
    integrationContext: {
      schemaVersion: 1,
      data: { nested: { beta: 2, alpha: 1 } },
    },
  }
}

describe("Phase 10 offscreen job protocol", () => {
  it("fingerprints the complete validated dispatch payload canonically", async () => {
    const payload = dispatchPayload()
    const reordered = {
      ...payload,
      integrationContext: {
        schemaVersion: 1,
        data: { nested: { alpha: 1, beta: 2 } },
      },
    }

    const fingerprint = await createOffscreenDispatchFingerprint(payload)
    expect(await createOffscreenDispatchFingerprint(reordered)).toBe(
      fingerprint
    )
    expect(
      await createOffscreenDispatchFingerprint({
        ...payload,
        chapter: { ...payload.chapter, title: "Changed" },
      })
    ).not.toBe(fingerprint)
    expect(fingerprint).toMatch(/^[0-9a-f]{64}$/)
  })

  it("requires exact full query identity and returns only the matching incarnation", () => {
    const identity = {
      jobId: "job-1",
      attempt: 1,
      taskId: "task-1",
      chapterId: "chapter-1",
      fingerprint: "a".repeat(64),
      documentInstanceId: "document-instance-1",
    }
    const request = {
      target: "offscreen",
      type: "OFFSCREEN_QUERY_JOB",
      payload: { requestId: "query-1", identity },
    }

    expect(
      runtimeMessageRegistry.OFFSCREEN_QUERY_JOB.request.safeParse(request)
        .success
    ).toBe(true)
    expect(
      runtimeMessageRegistry.OFFSCREEN_QUERY_JOB.request.safeParse({
        ...request,
        payload: { requestId: "query-1" },
      }).success
    ).toBe(false)
    expect(runtimeMessageRegistry.OFFSCREEN_QUERY_JOB.readiness).toBe(
      "runtime-ready"
    )
  })

  it("uses immediate dispatch ACKs and a dedicated full terminal event", () => {
    const ack = {
      success: true,
      accepted: true,
      jobId: "job-1",
      attempt: 1,
      taskId: "task-1",
      chapterId: "chapter-1",
      fingerprint: "a".repeat(64),
      documentInstanceId: "document-instance-1",
    }
    expect(
      runtimeMessageRegistry.OFFSCREEN_DOWNLOAD_CHAPTER.response.safeParse(ack)
        .success
    ).toBe(true)
    expect(
      runtimeMessageRegistry.OFFSCREEN_DOWNLOAD_CHAPTER.response.safeParse({
        success: true,
        status: "completed",
        outputsRequested: 1,
        outputsFailedBeforeHandoff: 0,
      }).success
    ).toBe(false)

    expect(runtimeMessageRegistry).toHaveProperty("OFFSCREEN_JOB_TERMINAL")
    expect(runtimeMessageRegistry).not.toHaveProperty(
      "QUERY_BLOB_URL_OWNERSHIP"
    )
  })
})
