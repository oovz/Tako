import { describe, expect, it } from "vitest"

import {
  runtimeMessageRegistry,
  runtimePortRegistry,
} from "@/src/runtime/runtime-message-contracts"
import { OffscreenJobStateSchema } from "@/src/runtime/offscreen-job-contracts"
import { createTaskSettingsSnapshot } from "@/src/runtime/settings-snapshot"
import { DEFAULT_SETTINGS } from "@/src/domain/settings/defaults"
import type { SeriesMetadata } from "@/src/types/series-metadata"

const FINGERPRINT = "a".repeat(64)
const DOCUMENT_INSTANCE_ID = "document-instance-1"
const EXACT_JOB_IDENTITY = {
  jobId: "job-1",
  attempt: 1,
  taskId: "task-1",
  chapterId: "chapter-1",
  fingerprint: FINGERPRINT,
  documentInstanceId: DOCUMENT_INSTANCE_ID,
}

const EXPECTED_RUNTIME_MESSAGES = {
  REQUEST_TAB_CONTEXT_REFRESH:
    "background|command|sidepanel|integrations-ready",
  GET_SITE_INTEGRATION_ENABLEMENT: "background|query|offscreen|control-ready",
  GET_OPTIONS_DOWNLOAD_STATE: "background|query|options|runtime-ready",
  GET_OPTIONS_CONFIGURATION: "background|query|options|runtime-ready",
  GET_SIDEPANEL_DOWNLOAD_STATE: "background|query|sidepanel|runtime-ready",
  START_DOWNLOAD: "background|command|sidepanel|runtime-ready",
  RETRY_FAILED_CHAPTERS: "background|command|sidepanel,options|runtime-ready",
  RESTART_TASK: "background|command|sidepanel,options|runtime-ready",
  MOVE_TASK_TO_TOP: "background|command|sidepanel|runtime-ready",
  CLEAR_ALL_HISTORY: "background|command|options|runtime-ready",
  REMOVE_TASK: "background|command|sidepanel,options|runtime-ready",
  CANCEL_TASK: "background|command|sidepanel,options|runtime-ready",
  FORGET_UNOBSERVABLE_OUTPUTS:
    "background|command|sidepanel,options|runtime-ready",
  RETRY_DESTINATION: "background|command|options|runtime-ready",
  SAVE_OPTIONS_CONFIGURATION: "background|command|options|runtime-ready",
  GET_UI_PREFERENCES: "background|query|sidepanel,options|runtime-ready",
  GET_PERSISTENT_ERRORS: "background|query|sidepanel|control-ready",
  CONTINUE_DOWNLOAD: "background|command|sidepanel,options|runtime-ready",
  UNDO_QUEUE_ACTION: "background|command|sidepanel,options|runtime-ready",
  CLEAR_PERSISTED_DOWNLOAD_HISTORY: "background|command|options|runtime-ready",
  ACKNOWLEDGE_ERROR: "background|command|sidepanel|control-ready",
  OPEN_OPTIONS: "background|command|sidepanel|control-ready",
  OFFSCREEN_JOB_ACCEPTED: "background|event|offscreen|queue-hydrated",
  OFFSCREEN_JOB_HEARTBEAT: "background|event|offscreen|queue-hydrated",
  OFFSCREEN_JOB_TERMINAL: "background|event|offscreen|runtime-ready",
  OFFSCREEN_OUTPUT_READY: "background|event|offscreen|runtime-ready",
  OFFSCREEN_DOWNLOAD_PROGRESS: "background|event|offscreen|runtime-ready",
  OFFSCREEN_INITIALIZATION_FAILED: "background|event|offscreen|control-ready",
  OFFSCREEN_STATUS: "offscreen|query|background|control-ready",
  OFFSCREEN_QUERY_JOB: "offscreen|query|background|runtime-ready",
  OFFSCREEN_CANCEL_JOB: "offscreen|command|background|runtime-ready",
  REVOKE_BLOB_URL: "offscreen|command|background|runtime-ready",
  OFFSCREEN_DOWNLOAD_CHAPTER: "offscreen|command|background|runtime-ready",
  OFFSCREEN_PARSE_SERIES_HTML: "offscreen|command|background|runtime-ready",
  OFFSCREEN_CANCEL_SERIES_HTML: "offscreen|command|background|runtime-ready",
} as const

describe("runtime message registry", () => {
  it("is the exact current production registry with settled policy metadata", () => {
    const actual = Object.fromEntries(
      Object.entries(runtimeMessageRegistry).map(([type, entry]) => [
        type,
        [
          entry.target,
          entry.kind,
          entry.allowedSenders.join(","),
          entry.readiness,
        ].join("|"),
      ])
    )

    expect(actual).toEqual(EXPECTED_RUNTIME_MESSAGES)
    expect(Object.keys(actual)).toHaveLength(35)
  })

  it("keeps offscreen initialization failure payloads and acknowledgements strict", () => {
    const contract = runtimeMessageRegistry.OFFSCREEN_INITIALIZATION_FAILED

    expect(
      contract.request.safeParse({
        target: "background",
        type: "OFFSCREEN_INITIALIZATION_FAILED",
        payload: {
          errorMessage: "registry init failed",
          documentInstanceId: DOCUMENT_INSTANCE_ID,
        },
      }).success
    ).toBe(true)
    expect(
      contract.request.safeParse({
        target: "background",
        type: "OFFSCREEN_INITIALIZATION_FAILED",
        payload: {
          errorMessage: "registry init failed",
          documentInstanceId: DOCUMENT_INSTANCE_ID,
          generation: 1,
        },
      }).success
    ).toBe(false)
    expect(
      contract.request.safeParse({
        target: "background",
        type: "OFFSCREEN_INITIALIZATION_FAILED",
        payload: { errorMessage: "registry init failed" },
      }).success
    ).toBe(false)
    expect(contract.response.safeParse({ success: true }).success).toBe(true)
    expect(
      contract.response.safeParse({ success: true, closed: true }).success
    ).toBe(false)
  })

  it("requires a literal target and rejects unknown envelope fields", () => {
    const schema = runtimeMessageRegistry.OPEN_OPTIONS.request

    expect(
      schema.safeParse({ target: "background", type: "OPEN_OPTIONS" }).success
    ).toBe(false)
    expect(
      schema.safeParse({
        target: "background",
        type: "OPEN_OPTIONS",
        payload: {},
      }).success
    ).toBe(true)
    expect(schema.safeParse({ type: "OPEN_OPTIONS" }).success).toBe(false)
    expect(
      schema.safeParse({
        target: "offscreen",
        type: "OPEN_OPTIONS",
      }).success
    ).toBe(false)
    expect(
      schema.safeParse({
        target: "background",
        type: "OPEN_OPTIONS",
        protocolVersion: 1,
      }).success
    ).toBe(false)
  })

  it("requires explicit payload objects for current empty-payload commands", () => {
    expect(
      runtimeMessageRegistry.REQUEST_TAB_CONTEXT_REFRESH.request.safeParse({
        target: "background",
        type: "REQUEST_TAB_CONTEXT_REFRESH",
      }).success
    ).toBe(false)
    expect(
      runtimeMessageRegistry.REQUEST_TAB_CONTEXT_REFRESH.request.safeParse({
        target: "background",
        type: "REQUEST_TAB_CONTEXT_REFRESH",
        payload: {},
      }).success
    ).toBe(true)
    expect(
      runtimeMessageRegistry.CLEAR_ALL_HISTORY.request.safeParse({
        target: "background",
        type: "CLEAR_ALL_HISTORY",
        commandId: "00000000-0000-4000-8000-000000000001",
        issuedAt: 1,
      }).success
    ).toBe(false)
    expect(
      runtimeMessageRegistry.CLEAR_ALL_HISTORY.request.safeParse({
        target: "background",
        type: "CLEAR_ALL_HISTORY",
        commandId: "00000000-0000-4000-8000-000000000001",
        issuedAt: 1,
        payload: {},
      }).success
    ).toBe(true)
  })

  it("exposes exact principal-scoped download-state queries with strict responses", () => {
    expect(runtimeMessageRegistry.GET_OPTIONS_DOWNLOAD_STATE).toMatchObject({
      target: "background",
      kind: "query",
      allowedSenders: ["options"],
      readiness: "runtime-ready",
    })
    expect(runtimeMessageRegistry.GET_SIDEPANEL_DOWNLOAD_STATE).toMatchObject({
      target: "background",
      kind: "query",
      allowedSenders: ["sidepanel"],
      readiness: "runtime-ready",
    })
    expect(
      runtimeMessageRegistry.GET_OPTIONS_DOWNLOAD_STATE.response.safeParse({
        success: true,
        data: { tasks: [], destinationIssue: null, queueStorageBytes: 0 },
      }).success
    ).toBe(true)
    expect(
      runtimeMessageRegistry.GET_OPTIONS_DOWNLOAD_STATE.response.safeParse({
        success: true,
        data: { tasks: [], destinationIssue: null, queueStorageBytes: 0 },
        legacy: true,
      }).success
    ).toBe(false)
  })

  it("exposes strict Options configuration query and durable save contracts", () => {
    expect(runtimeMessageRegistry.GET_OPTIONS_CONFIGURATION).toMatchObject({
      target: "background",
      kind: "query",
      allowedSenders: ["options"],
      readiness: "runtime-ready",
    })
    expect(runtimeMessageRegistry.SAVE_OPTIONS_CONFIGURATION).toMatchObject({
      target: "background",
      kind: "command",
      allowedSenders: ["options"],
      readiness: "runtime-ready",
    })
    expect(
      runtimeMessageRegistry.GET_OPTIONS_CONFIGURATION.response.safeParse({
        success: true,
        data: {
          configuration: {
            settings: DEFAULT_SETTINGS,
            overrides: {},
            enablement: {},
            integrationSettings: {},
          },
          historyStats: { totalChapters: 0, totalSeries: 0 },
          historySeries: [],
        },
      }).success
    ).toBe(true)
    expect(
      runtimeMessageRegistry.GET_OPTIONS_CONFIGURATION.response.safeParse({
        success: true,
        data: {
          configuration: {
            settings: DEFAULT_SETTINGS,
            overrides: {},
            enablement: {},
            integrationSettings: {},
          },
          historyStats: { totalChapters: 0, totalSeries: 0 },
          historySeries: [],
          legacy: true,
        },
      }).success
    ).toBe(false)
  })

  it("exposes strict UI preferences without the durable settings document", () => {
    expect(runtimeMessageRegistry.GET_UI_PREFERENCES).toMatchObject({
      target: "background",
      kind: "query",
      allowedSenders: ["sidepanel", "options"],
      readiness: "runtime-ready",
    })
    expect(
      runtimeMessageRegistry.GET_UI_PREFERENCES.response.safeParse({
        success: true,
        data: { motionPreference: "system", uiLanguage: "auto" },
      }).success
    ).toBe(true)
    expect(
      runtimeMessageRegistry.GET_UI_PREFERENCES.response.safeParse({
        success: true,
        data: {
          motionPreference: "system",
          uiLanguage: "auto",
          notifications: true,
        },
      }).success
    ).toBe(false)
  })

  it("exposes strict persistent errors for the Side Panel query", () => {
    expect(runtimeMessageRegistry.GET_PERSISTENT_ERRORS).toMatchObject({
      target: "background",
      kind: "query",
      allowedSenders: ["sidepanel"],
      readiness: "control-ready",
    })
    expect(
      runtimeMessageRegistry.GET_PERSISTENT_ERRORS.response.safeParse({
        success: true,
        data: [
          {
            code: "QUEUE_RECOVERY_FAILED",
            message: "Queue recovery failed",
            severity: "error",
            ts: 1,
          },
        ],
      }).success
    ).toBe(true)
    expect(
      runtimeMessageRegistry.GET_PERSISTENT_ERRORS.response.safeParse({
        success: true,
        data: [{ code: "QUEUE_RECOVERY_FAILED" }],
      }).success
    ).toBe(false)
    expect(
      runtimeMessageRegistry.GET_PERSISTENT_ERRORS.response.safeParse({
        success: true,
        data: [
          {
            code: "QUEUE_RECOVERY_FAILED",
            message: "Queue recovery failed",
            severity: "error",
            ts: 1,
            unknown: true,
          },
        ],
      }).success
    ).toBe(false)
  })

  it("enforces the current-only response wire shapes", () => {
    for (const initializationState of [
      "initializing",
      "ready",
      "failed",
    ] as const) {
      expect(
        runtimeMessageRegistry.OFFSCREEN_STATUS.response.safeParse({
          success: true,
          initializationState,
          documentInstanceId: DOCUMENT_INSTANCE_ID,
          activeJobCount: 0,
          activeSeriesResolutionCount: 0,
          activeTaskIds: [],
        }).success
      ).toBe(true)
    }
    expect(
      runtimeMessageRegistry.OFFSCREEN_STATUS.response.safeParse({
        success: true,
        initializationState: "ready",
        documentInstanceId: DOCUMENT_INSTANCE_ID,
        activeJobCount: 0,
        activeSeriesResolutionCount: 0,
        activeTaskIds: [],
        isInitialized: true,
      }).success
    ).toBe(false)
    expect(
      runtimeMessageRegistry.OFFSCREEN_STATUS.response.safeParse({
        success: true,
        initializationState: "ready",
        documentInstanceId: DOCUMENT_INSTANCE_ID,
        activeJobCount: 0,
        activeSeriesResolutionCount: 0,
        activeTaskIds: [],
        ready: true,
      }).success
    ).toBe(false)
    expect(
      runtimeMessageRegistry.OFFSCREEN_STATUS.response.safeParse({
        success: true,
        initializationState: "ready",
        activeJobCount: 0,
        activeSeriesResolutionCount: 0,
        activeTaskIds: [],
      }).success
    ).toBe(false)
    expect(
      runtimeMessageRegistry.RETRY_FAILED_CHAPTERS.response.safeParse({
        success: true,
        newTaskId: "task-2",
      }).success
    ).toBe(false)
    expect(
      runtimeMessageRegistry.CLEAR_ALL_HISTORY.response.safeParse({
        success: true,
        removedCount: 2,
      }).success
    ).toBe(false)
    expect(
      runtimeMessageRegistry.OFFSCREEN_OUTPUT_READY.response.safeParse({
        success: true,
        accepted: true,
        id: 4,
      }).success
    ).toBe(false)
  })

  it("requires a complete exact incarnation for runtime-ready job queries", () => {
    const schema = runtimeMessageRegistry.OFFSCREEN_QUERY_JOB.request
    const request = {
      target: "offscreen",
      type: "OFFSCREEN_QUERY_JOB",
      payload: {
        requestId: "request-1",
        identity: EXACT_JOB_IDENTITY,
      },
    }

    expect(schema.safeParse(request).success).toBe(true)
    expect(
      schema.safeParse({
        ...request,
        payload: { requestId: request.payload.requestId },
      }).success
    ).toBe(false)
    expect(
      schema.safeParse({
        ...request,
        payload: {
          ...request.payload,
          identity: { jobId: "job-1", attempt: 1 },
        },
      }).success
    ).toBe(false)
  })

  it("requires a strict terminal event with the full job incarnation", () => {
    const terminalEvent = {
      target: "background",
      type: "OFFSCREEN_JOB_TERMINAL",
      payload: {
        ...EXACT_JOB_IDENTITY,
        sequence: 4,
        stage: "saving",
        terminalAt: 1_000,
        outcome: {
          status: "completed",
          outputsRequested: 1,
          outputsCommitted: 1,
          outputsFailedBeforeHandoff: 0,
        },
      },
    }
    const schema = runtimeMessageRegistry.OFFSCREEN_JOB_TERMINAL.request

    expect(schema.safeParse(terminalEvent).success).toBe(true)
    expect(
      schema.safeParse({
        ...terminalEvent,
        payload: {
          ...terminalEvent.payload,
          documentInstanceId: undefined,
        },
      }).success
    ).toBe(false)
  })

  it("rejects impossible native-output indices and output counts", () => {
    const outputReady = {
      target: "background",
      type: "OFFSCREEN_OUTPUT_READY",
      payload: {
        ...EXACT_JOB_IDENTITY,
        outputId: "output-1",
        fileUrl: "blob:output-1",
        filename: "Series/Chapter 1.cbz",
        outputIndex: 1,
        outputCount: 1,
        outputKind: "archive",
      },
    }
    expect(
      runtimeMessageRegistry.OFFSCREEN_OUTPUT_READY.request.safeParse(
        outputReady
      ).success
    ).toBe(false)

    const progress = {
      target: "background",
      type: "OFFSCREEN_DOWNLOAD_PROGRESS",
      payload: {
        ...EXACT_JOB_IDENTITY,
        sequence: 1,
        stage: "saving",
        status: "completed",
        outputsRequested: 1,
        outputsFailedBeforeHandoff: 2,
      },
    }
    expect(
      runtimeMessageRegistry.OFFSCREEN_DOWNLOAD_PROGRESS.request.safeParse(
        progress
      ).success
    ).toBe(false)

    const impossibleOutcome = {
      ...EXACT_JOB_IDENTITY,
      status: "terminal",
      stage: "saving",
      sequence: 1,
      outcome: {
        status: "completed",
        outputsRequested: 1,
        outputsFailedBeforeHandoff: 0,
        outputsCommitted: 2,
      },
    }
    expect(OffscreenJobStateSchema.safeParse(impossibleOutcome).success).toBe(
      false
    )
  })

  it("accepts a normalized metadata snapshot and rejects an extra title", () => {
    const comicInfo = {
      title: "Canonical Series",
      author: "Test Author",
      artist: "Test Artist",
      description: "Test description",
      genres: ["Action", "Adventure"],
      communityRating: 4.5,
      year: 2026,
      coverUrl: "https://example.test/cover.jpg",
      alternativeTitles: ["Canonical Alternative"],
      status: "ongoing",
      language: "en",
      contentRating: "safe",
      readingDirection: "ltr",
      publisher: "Test Publisher",
      tags: ["featured"],
    } satisfies SeriesMetadata
    const { title: seriesTitle, ...expectedComicInfo } = comicInfo
    const settingsSnapshot = createTaskSettingsSnapshot(
      DEFAULT_SETTINGS,
      "mangadex",
      { comicInfo }
    )
    expect(settingsSnapshot.comicInfo).toEqual(expectedComicInfo)
    expect(settingsSnapshot.comicInfo).not.toHaveProperty("title")

    const request = {
      target: "offscreen",
      type: "OFFSCREEN_DOWNLOAD_CHAPTER",
      payload: {
        jobId: "job-1",
        attempt: 1,
        taskId: "task-1",
        fingerprint: FINGERPRINT,
        seriesKey: "mangadex:series-1",
        book: {
          siteIntegrationId: "mangadex",
          seriesTitle,
          metadata: expectedComicInfo,
        },
        chapter: {
          id: "chapter-1",
          title: "Chapter 1",
          url: "https://example.test/chapter-1",
          index: 1,
          resolvedPath: "Canonical Series/Chapter 1.cbz",
        },
        settingsSnapshot,
        saveMode: "downloads-api",
      },
    }
    const schema = runtimeMessageRegistry.OFFSCREEN_DOWNLOAD_CHAPTER.request

    expect(schema.safeParse(request).success).toBe(true)
    expect(
      schema.safeParse({
        ...request,
        payload: {
          ...request.payload,
          settingsSnapshot: {
            ...settingsSnapshot,
            comicInfo: { ...settingsSnapshot.comicInfo, title: seriesTitle },
          },
        },
      }).success
    ).toBe(false)
    expect(
      schema.safeParse({
        ...request,
        payload: {
          ...request.payload,
          book: {
            ...request.payload.book,
            metadata: { ...expectedComicInfo, title: seriesTitle },
          },
        },
      }).success
    ).toBe(false)
    expect(
      schema.safeParse({
        ...request,
        payload: {
          ...request.payload,
          book: {
            ...request.payload.book,
            metadata: { ...expectedComicInfo, unsupported: true },
          },
        },
      }).success
    ).toBe(false)
    expect(
      schema.safeParse({
        ...request,
        payload: {
          ...request.payload,
          integrationContext: {
            schemaVersion: 1,
            data: { valid: true, nested: { count: 1 } },
          },
        },
      }).success
    ).toBe(true)
    expect(
      schema.safeParse({
        ...request,
        payload: {
          ...request.payload,
          integrationContext: {
            schemaVersion: 1,
            data: { invalid: undefined },
          },
        },
      }).success
    ).toBe(false)
  })

  it("validates parsed series metadata and chapter-list output recursively", () => {
    const response = {
      success: true,
      seriesMetadata: {
        title: "Canonical Series",
        author: "Test Author",
      },
      chapterList: {
        chapters: [
          {
            id: "chapter-1",
            url: "https://example.test/chapter-1",
            title: "Chapter 1",
            comicInfo: { Title: "Chapter 1" },
          },
        ],
        volumes: [{ id: "volume-1", title: "Volume 1" }],
      },
    }
    const schema = runtimeMessageRegistry.OFFSCREEN_PARSE_SERIES_HTML.response

    expect(schema.safeParse(response).success).toBe(true)
    expect(
      schema.safeParse({
        ...response,
        seriesMetadata: {
          ...response.seriesMetadata,
          unsupported: true,
        },
      }).success
    ).toBe(false)
    expect(
      schema.safeParse({
        ...response,
        chapterList: {
          ...response.chapterList,
          chapters: [
            {
              ...response.chapterList.chapters[0],
              comicInfo: { Title: "Chapter 1", unsupported: true },
            },
          ],
        },
      }).success
    ).toBe(false)
    expect(
      schema.safeParse({
        ...response,
        chapterList: {
          ...response.chapterList,
          chapters: [
            {
              ...response.chapterList.chapters[0],
              unsupported: true,
            },
          ],
        },
      }).success
    ).toBe(false)
  })

  it("preserves the accepted start and undo result data", () => {
    expect(
      runtimeMessageRegistry.START_DOWNLOAD.response.safeParse({
        success: true,
        taskId: "task-1",
      }).success
    ).toBe(true)
    expect(
      runtimeMessageRegistry.REMOVE_TASK.response.safeParse({
        success: true,
        data: {
          undo: {
            token: "undo-1",
            type: "remove_history",
            expiresAt: 1,
          },
        },
      }).success
    ).toBe(true)
  })

  it("owns the strict sidepanel progress Port contract", () => {
    expect(runtimePortRegistry).toEqual({
      ACTIVE_TASK_PROGRESS: expect.objectContaining({
        name: "tako-active-task-progress",
        allowedSenders: ["sidepanel"],
        readiness: "queue-hydrated",
      }),
    })
    expect(
      runtimePortRegistry.ACTIVE_TASK_PROGRESS.serverEvent.safeParse({
        type: "ACTIVE_TASK_PROGRESS",
        generation: "generation-1",
        revision: 1,
        progress: null,
      }).success
    ).toBe(true)
    expect(
      runtimePortRegistry.ACTIVE_TASK_PROGRESS.serverEvent.safeParse({
        type: "ACTIVE_TASK_PROGRESS",
        generation: "generation-1",
        revision: 1,
        progress: null,
        legacy: true,
      }).success
    ).toBe(false)
  })
})
