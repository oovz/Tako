// @vitest-environment happy-dom
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { ActivityTab } from "@/entrypoints/options/tabs/ActivityTab"
import { createNoneFormatChapterOutcome } from "@/entrypoints/offscreen/chapter-processing-outcomes"
import {
  beginChapterDispatch,
  cancelDownloadTask,
  clearDispatchLease,
  enqueueDownloadTask,
  finalizeDownloadTask,
  settleTaskChapter,
  startDownloadTask,
} from "@/src/domain/queue/kernel"
import type {
  DownloadTaskState,
  QueueAggregateState,
} from "@/src/domain/queue/state"
import { DEFAULT_SETTINGS } from "@/src/domain/settings/defaults"
import { createDispatchLease } from "@/src/runtime/dispatch-lease"
import { DownloadTaskStateSchema } from "@/src/runtime/queue-state-schemas"
import { createTaskSettingsSnapshot } from "@/src/runtime/settings-snapshot"
import { t } from "@/src/runtime/i18n"
import type { RuntimeMessage } from "@/src/runtime/runtime-message-contracts"

vi.mock("@/src/storage/fs-access", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/src/storage/fs-access")>()),
  loadDownloadRootHandle: async () => ({ name: "Recorded folder" }),
}))

let root: Root
let container: HTMLDivElement
const sendMessage = vi.fn()

beforeEach(() => {
  const retained = new Map<string, unknown>()
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  vi.stubGlobal("chrome", {
    ...chrome,
    runtime: { ...chrome.runtime, sendMessage, getURL: (path: string) => path },
    storage: {
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
      session: {
        get: async (key: string) =>
          retained.has(key) ? { [key]: retained.get(key) } : {},
        set: async (values: Record<string, unknown>) => {
          for (const [key, value] of Object.entries(values))
            retained.set(key, value)
        },
        remove: async (key: string) => {
          retained.delete(key)
        },
      },
    },
  })
  sendMessage.mockReset()
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function capturedTask(
  status: DownloadTaskState["status"],
  now: number
): DownloadTaskState {
  const settings = structuredClone(DEFAULT_SETTINGS)
  Object.assign(settings.downloads, {
    defaultFormat: "none",
    destination: "file-system-access",
    customDirectoryHandleId: "recorded-folder",
    includeComicInfo: false,
    includeCoverImage: false,
  })
  const queued = DownloadTaskStateSchema.parse({
    id: `task-${status}`,
    siteIntegrationId: "mangadex",
    mangaId: `series-${status}`,
    seriesTitle: `Recorded ${status}`,
    status: "queued",
    created: now,
    settingsSnapshot: createTaskSettingsSnapshot(settings, "mangadex"),
    chapters: [
      {
        id: `chapter-${status}`,
        title: "Only chapter",
        index: 0,
        url: "https://mangadex.org/chapter/11111111-1111-4111-8111-111111111111",
        requestedPath: `Recorded/${status}/Chapter`,
        status: "queued",
        lastUpdated: now,
      },
    ],
  })
  let state: QueueAggregateState = {
    queue: [],
    lease: null,
    pendingUndoActions: [],
  }
  state = enqueueDownloadTask(state, { task: queued }).next
  if (status === "queued") return DownloadTaskStateSchema.parse(state.queue[0])
  const started = startDownloadTask(state, { taskId: queued.id, now })
  expect(started.result.outcome).toBe("applied")
  const lease = createDispatchLease({
    jobId: `job-${status}`,
    taskId: queued.id,
    chapterId: queued.chapters[0].id,
    attempt: 1,
    fingerprint: "a".repeat(64),
    saveMode: "fsa",
    destinationHandleId: "recorded-folder",
    now,
  })
  const dispatched = beginChapterDispatch(started.next, {
    taskId: queued.id,
    chapterId: queued.chapters[0].id,
    expectedPreviousLease: null,
    lease,
    now,
  })
  expect(dispatched.result.outcome).toBe("applied")
  state = dispatched.next
  if (status === "downloading")
    return DownloadTaskStateSchema.parse(state.queue[0])
  if (status === "canceled") {
    const canceled = cancelDownloadTask(state, {
      taskId: queued.id,
      commandId: "cancel-active",
      now,
    })
    expect(canceled.result.outcome).toBe("applied")
    const released = clearDispatchLease(canceled.next, { identity: lease })
    expect(released.result.outcome).toBe("applied")
    return DownloadTaskStateSchema.parse(released.next.queue[0])
  }
  const totalImages = status === "completed" ? 1 : 3
  const outcome = createNoneFormatChapterOutcome({
    downloadMode: "custom",
    totalImages,
    failedImages:
      status === "failed" ? 3 : status === "partial_success" ? 1 : 0,
  })
  expect(outcome.status).toBe(status)
  const settled = settleTaskChapter(state, {
    taskId: queued.id,
    chapterId: queued.chapters[0].id,
    status: outcome.status,
    lease,
    now,
    updates: {
      totalImages,
      imagesFailed: outcome.imagesFailed,
      errorMessage: outcome.errorMessage,
      outputs: {
        requested: outcome.outputsRequested,
        committed: outcome.outputsCommitted,
        failed: outcome.outputsRequested - outcome.outputsCommitted,
      },
      outputDestination: "fsa",
      saveConfirmedAt: outcome.status === "completed" ? now : undefined,
    },
  })
  expect(settled.result.outcome).toBe("applied")
  const finalized = finalizeDownloadTask(settled.next, {
    taskId: queued.id,
    chapterOutcomesByIndex: [{ chapterId: queued.chapters[0].id, ...outcome }],
    completedAt: now,
    clearLease: lease,
  })
  expect(finalized.result.outcome).toBe("applied")
  return DownloadTaskStateSchema.parse(finalized.next.queue[0])
}

function taskCard(task: DownloadTaskState): HTMLElement {
  const headings = [
    ...container.querySelectorAll<HTMLElement>(
      '[role="heading"][aria-level="3"]'
    ),
  ].filter((heading) => heading.textContent === task.seriesTitle)
  expect(headings, task.id).toHaveLength(1)
  const card = headings[0].closest<HTMLElement>("[aria-busy]")
  expect(card, task.id).not.toBeNull()
  return card!
}

function groupHeading(card: HTMLElement): HTMLHeadingElement {
  let group = card.parentElement
  while (group && !group.querySelector(":scope > h2"))
    group = group.parentElement
  const heading = group?.querySelector<HTMLHeadingElement>(":scope > h2")
  expect(heading).toBeDefined()
  return heading!
}

function action(label: string, parent: ParentNode): HTMLButtonElement {
  const button = [...parent.querySelectorAll("button")].find(
    (item) => item.textContent === label
  )
  expect(button, label).toBeDefined()
  return button!
}

it("keeps queue and terminal results in their own groups and routes each permitted operation", async () => {
  const cases = [
    {
      status: "downloading",
      group: "options_activeDownloads",
      action: "common_cancel",
      command: "CANCEL_TASK",
    },
    {
      status: "queued",
      group: "options_queued",
      action: "common_cancel",
      command: "CANCEL_TASK",
    },
    {
      status: "completed",
      group: "options_completed",
      action: "common_remove",
      command: "REMOVE_TASK",
    },
    {
      status: "failed",
      group: "options_failedPartial",
      action: "sidepanel_restartTask",
      command: "RESTART_TASK",
    },
    {
      status: "partial_success",
      group: "options_failedPartial",
      action: "sidepanel_retryFailedChapters",
      command: "RETRY_FAILED_CHAPTERS",
    },
    {
      status: "canceled",
      group: "options_canceled",
      action: "sidepanel_restartTask",
      command: "RESTART_TASK",
    },
  ] as const
  const snapshotAt = Date.now()
  const tasks = cases.map(({ status }) =>
    capturedTask(
      status,
      status === "queued" || status === "downloading"
        ? snapshotAt
        : snapshotAt - 1000
    )
  )
  expect(
    tasks
      .flatMap((task) => task.chapters)
      .filter((chapter) => chapter.status === "downloading")
  ).toHaveLength(1)
  sendMessage.mockImplementation(async (message: RuntimeMessage) =>
    message.type === "GET_OPTIONS_DOWNLOAD_STATE"
      ? { success: true, data: { tasks, queueStorageBytes: 0 } }
      : { success: false, error: "Command transport unavailable" }
  )
  await act(async () =>
    root.render(
      createElement(ActivityTab, {
        onClearChapterHistory: async () => true,
      })
    )
  )
  for (const [index, spec] of cases.entries()) {
    const task = tasks[index]
    const card = taskCard(task)
    expect(groupHeading(card).textContent).toContain(t(spec.group))
    const priorCommands = sendMessage.mock.calls.filter(
      ([message]) => message.type !== "GET_OPTIONS_DOWNLOAD_STATE"
    ).length
    await act(async () => action(t(spec.action), card).click())
    if (spec.status === "downloading") {
      expect(
        sendMessage.mock.calls.filter(
          ([message]) => message.type !== "GET_OPTIONS_DOWNLOAD_STATE"
        )
      ).toHaveLength(priorCommands)
      const confirmation = card.querySelector('[role="group"]')!
      expect(confirmation).not.toBeNull()
      await act(async () => action("Yes", confirmation).click())
      await act(async () => action("No", confirmation).click())
    }
    const commands = sendMessage.mock.calls.filter(
      ([message]) => message.type !== "GET_OPTIONS_DOWNLOAD_STATE"
    )
    expect(commands).toHaveLength(priorCommands + 1)
    expect(commands.at(-1)?.[0]).toMatchObject({
      target: "background",
      type: spec.command,
      payload: { taskId: task.id },
    })
  }
})
