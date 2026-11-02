import { composeSeriesKey } from "@/src/runtime/queue-task-summary"
import { createOffscreenDispatchFingerprint } from "@/src/runtime/offscreen-job-fingerprint"
import { resolveSiteIntegrationDispatchContext } from "@/src/runtime/site-integration-dispatch-context"
import type {
  ActiveDispatchLease,
  DispatchLeaseAuthority,
  DownloadTaskState,
} from "@/src/domain/queue/state"
import type {
  RuntimeMessageRequest,
  RuntimeMessageResponse,
} from "@/src/runtime/runtime-message-contracts"
import type { SiteIntegrationSettingsService } from "@/src/storage/site-integration-settings-service"
import type { TaskDestination } from "@/src/types/state-snapshots"
import type { Chapter } from "@/src/types/chapter"
import type { DownloadPlan } from "./queue-helpers"

export type ChapterDispatchMessage =
  RuntimeMessageRequest<"OFFSCREEN_DOWNLOAD_CHAPTER">
export interface ChapterDispatchContext {
  plan: DownloadPlan
  chapter: Chapter
  taskChapter: DownloadTaskState["chapters"][number]
  latestTask: DownloadTaskState
  destination: TaskDestination
  saveMode: ChapterDispatchMessage["payload"]["saveMode"]
}
export interface ChapterDispatchIdentity {
  jobId: string
  attempt: number
  taskId: string
  chapterId: string
}
export interface ChapterDispatchCandidate {
  identity: ChapterDispatchIdentity
  reusableLease?: ActiveDispatchLease
}

export function sameDispatchJob(
  lease: DispatchLeaseAuthority | null,
  identity: ChapterDispatchIdentity
): lease is DispatchLeaseAuthority {
  return (
    lease !== null &&
    lease.jobId === identity.jobId &&
    lease.attempt === identity.attempt &&
    lease.taskId === identity.taskId &&
    lease.chapterId === identity.chapterId
  )
}

export function sameDispatchAuthority(
  lease: DispatchLeaseAuthority | null,
  authority: DispatchLeaseAuthority
): boolean {
  return (
    sameDispatchJob(lease, authority) &&
    lease.fingerprint === authority.fingerprint
  )
}

export function reusableChapterLease(
  task: DownloadTaskState,
  taskId: string,
  chapterId: string,
  lease: ActiveDispatchLease | null
): ActiveDispatchLease | undefined {
  const chapter = task.chapters.find((chapter) => chapter.id === chapterId)
  return chapter?.status === "downloading" &&
    lease?.taskId === taskId &&
    lease.chapterId === chapterId
    ? lease
    : undefined
}

export function canAdmitChapterDispatch(
  task: DownloadTaskState | undefined,
  lease: ActiveDispatchLease | null,
  candidate: ChapterDispatchCandidate
): boolean {
  if (task?.status !== "downloading") return false
  const chapter = task.chapters.find(
    (chapter) => chapter.id === candidate.identity.chapterId
  )
  if (candidate.reusableLease)
    return (
      chapter?.status === "downloading" &&
      sameDispatchAuthority(lease, candidate.reusableLease)
    )
  return chapter?.status === "queued" && lease === null
}

export function canSendChapterDispatch(
  task: DownloadTaskState | undefined,
  lease: ActiveDispatchLease | null,
  message: ChapterDispatchMessage
): boolean {
  const chapter = task?.chapters.find(
    (chapter) => chapter.id === message.payload.chapter.id
  )
  return (
    task?.status === "downloading" &&
    chapter?.status === "downloading" &&
    sameDispatchAuthority(lease, {
      ...message.payload,
      chapterId: message.payload.chapter.id,
    })
  )
}

function chapterDispatchPayload(context: ChapterDispatchContext) {
  const { chapter, latestTask, taskChapter } = context
  return {
    id: chapter.id,
    title: chapter.title,
    url: chapter.url,
    index: taskChapter.index,
    chapterLabel: chapter.chapterLabel,
    chapterNumber: chapter.chapterNumber,
    volumeId: chapter.volumeId,
    volumeNumber: chapter.volumeNumber,
    volumeLabel: chapter.volumeLabel,
    language:
      latestTask.chapters.find((taskChapter) => taskChapter.id === chapter.id)
        ?.language ?? chapter.comicInfo?.LanguageISO,
    resolvedPath: chapter.resolvedPath || chapter.title,
  }
}

export async function createChapterDispatchMessage(
  context: ChapterDispatchContext,
  candidate: ChapterDispatchCandidate,
  settingsSnapshot: DownloadTaskState["settingsSnapshot"],
  settingsReader: Pick<SiteIntegrationSettingsService, "getAll" | "getForSite">
): Promise<ChapterDispatchMessage> {
  const { plan, chapter, latestTask, destination, saveMode } = context
  const { identity } = candidate
  const seriesKey = composeSeriesKey(plan.book.siteId, plan.book.seriesId)
  const integrationContext = await resolveSiteIntegrationDispatchContext({
    siteIntegrationId: plan.book.siteId,
    taskId: identity.taskId,
    seriesKey,
    chapter,
    settingsSnapshot,
    siteIntegrationSettingsReader: settingsReader,
  })
  const unsignedPayload = {
    jobId: identity.jobId,
    attempt: identity.attempt,
    taskId: identity.taskId,
    seriesKey,
    book: {
      siteIntegrationId: plan.book.siteId,
      seriesTitle: plan.book.seriesTitle,
      coverUrl: latestTask.seriesCoverUrl ?? plan.book.coverUrl,
      metadata: latestTask.settingsSnapshot.comicInfo,
    },
    chapter: chapterDispatchPayload(context),
    settingsSnapshot: { ...settingsSnapshot, destination },
    saveMode,
    directoryHandleId:
      destination.kind === "file-system-access"
        ? destination.handleId!
        : undefined,
    notBefore: latestTask.nextChapterDispatchAt,
    integrationContext,
  }
  const fingerprint = await createOffscreenDispatchFingerprint(unsignedPayload)
  if (
    candidate.reusableLease &&
    candidate.reusableLease.fingerprint !== fingerprint
  )
    throw new Error(
      "Recovered dispatch fingerprint does not match durable lease"
    )
  return {
    target: "offscreen",
    type: "OFFSCREEN_DOWNLOAD_CHAPTER",
    payload: { ...unsignedPayload, fingerprint },
  }
}

export function assertChapterDispatchAcknowledged(
  response: RuntimeMessageResponse<"OFFSCREEN_DOWNLOAD_CHAPTER">,
  message: ChapterDispatchMessage
) {
  if (!response.success) throw new Error(response.error)
  const { payload } = message
  if (
    response.accepted !== true ||
    response.jobId !== payload.jobId ||
    response.attempt !== payload.attempt ||
    response.taskId !== payload.taskId ||
    response.chapterId !== payload.chapter.id ||
    response.fingerprint !== payload.fingerprint
  )
    throw new Error("Offscreen dispatch acknowledgement mismatch")
  return response
}
