import {
  DOWNLOAD_ROOT_HANDLE_ID,
  loadDownloadRootHandle,
  queryFsaPermission,
} from "@/src/storage/fs-access"
import logger from "@/src/runtime/logger"
import { LOCAL_STORAGE_KEYS } from "@/src/runtime/storage-keys"
import type {
  DestinationIssue,
  DestinationIssueKind,
} from "@/src/types/queue-state"
import type { DownloadDestination } from "@/src/shared/download-contract"
import { StorageMutationQueue } from "@/src/storage/storage-mutation-queue"
import { settingsService } from "@/src/storage/settings-service"
import { getNotificationService } from "./notification-service"
import { normalizeDestinationIssues } from "@/src/runtime/destination-issue-state"

type EffectiveDestination =
  | { kind: "custom"; handleId: string; handle: FileSystemDirectoryHandle }
  | { kind: "downloads" }

export interface DestinationContext {
  taskId: string
  chapterId?: string
  destination: DownloadDestination
  destinationOverride?: "downloads-api"
}

const destinationIssueMutations = new StorageMutationQueue()

export type DestinationPreflight =
  | { ready: true }
  | {
      ready: false
      reason:
        | "unsupported"
        | "not_configured"
        | "permission_prompt"
        | "permission_denied"
        | "folder_unavailable"
    }

export class DestinationPreflightError extends Error {
  readonly reason: Exclude<DestinationPreflight, { ready: true }>["reason"]

  constructor(reason: DestinationPreflightError["reason"]) {
    super(`Destination preflight failed: ${reason}`)
    this.name = "DestinationPreflightError"
    this.reason = reason
  }
}

export function issueKindForPreflight(
  result: Exclude<DestinationPreflight, { ready: true }>
): DestinationIssueKind {
  switch (result.reason) {
    case "permission_prompt":
    case "permission_denied":
      return "fsa_permission_required"
    case "not_configured":
    case "folder_unavailable":
      return "fsa_folder_missing"
    case "unsupported":
      return "fsa_unsupported"
  }
}

export async function getDestinationIssues(): Promise<DestinationIssue[]> {
  const stored = await chrome.storage.local.get(
    LOCAL_STORAGE_KEYS.destinationIssues
  )
  const value = stored[LOCAL_STORAGE_KEYS.destinationIssues]
  return normalizeDestinationIssues(value)
}

export function createDestinationIssue(
  context: DestinationContext,
  kind: DestinationIssueKind
): DestinationIssue {
  return {
    id: `${context.taskId}:${context.chapterId ?? ""}:${kind}`,
    taskId: context.taskId,
    chapterId: context.chapterId,
    kind,
    occurredAt: Date.now(),
  }
}

export async function notifyDestinationIssue(
  issue: DestinationIssue
): Promise<void> {
  try {
    const settings = await settingsService.getSettings()
    getNotificationService().notifyDestinationActionRequired({
      issue,
      notificationsEnabled: settings.notifications,
    })
  } catch (error) {
    logger.debug(
      "[DestinationService] Failed to show destination notification",
      error
    )
  }
}

async function recordDestinationIssueKind(
  context: DestinationContext,
  kind: DestinationIssueKind
): Promise<DestinationIssue> {
  return await destinationIssueMutations.run(async () => {
    const issueId = `${context.taskId}:${context.chapterId ?? ""}:${kind}`
    const current = await getDestinationIssues()
    const existing = current.find((candidate) => candidate.id === issueId)
    if (existing) return existing

    const issue = createDestinationIssue(context, kind)
    await chrome.storage.local.set({
      [LOCAL_STORAGE_KEYS.destinationIssues]: [...current, issue],
    })
    await notifyDestinationIssue(issue)
    return issue
  })
}

export async function recordDestinationIssue(
  context: DestinationContext,
  result: Exclude<DestinationPreflight, { ready: true }>
): Promise<DestinationIssue> {
  return await recordDestinationIssueKind(
    context,
    issueKindForPreflight(result)
  )
}

export async function recordDestinationRuntimeIssue(
  context: DestinationContext,
  kind: Extract<
    DestinationIssueKind,
    | "fsa_permission_required"
    | "fsa_folder_missing"
    | "fsa_write_failed"
    | "disk_full"
  >
): Promise<DestinationIssue> {
  return await recordDestinationIssueKind(context, kind)
}

export async function clearDestinationIssuesForTask(
  taskId: string
): Promise<void> {
  await destinationIssueMutations.run(async () => {
    const current = await getDestinationIssues()
    const next = current.filter((issue) => issue.taskId !== taskId)
    if (next.length === current.length) return
    await chrome.storage.local.set({
      [LOCAL_STORAGE_KEYS.destinationIssues]: next,
    })
  })
}

export class DestinationService {
  async preflight(context: DestinationContext): Promise<DestinationPreflight> {
    const destination = context.destinationOverride ?? context.destination
    if (destination === "downloads-api") {
      return { ready: true }
    }

    let handle: FileSystemDirectoryHandle | undefined
    try {
      handle = await loadDownloadRootHandle()
    } catch (error) {
      logger.debug(
        "[DestinationService] FSA handle storage is unavailable",
        error
      )
      return { ready: false, reason: "unsupported" }
    }
    if (!handle) {
      return { ready: false, reason: "not_configured" }
    }

    const permission = await queryFsaPermission(handle, true)
    if (permission === "granted") {
      return { ready: true }
    }
    if (permission === "prompt") {
      return { ready: false, reason: "permission_prompt" }
    }
    if (permission === "denied") {
      return { ready: false, reason: "permission_denied" }
    }
    if (permission === "unsupported") {
      return { ready: false, reason: "unsupported" }
    }

    return { ready: false, reason: "folder_unavailable" }
  }

  async getEffectiveDestination(
    context: DestinationContext
  ): Promise<EffectiveDestination> {
    const destination = context.destinationOverride ?? context.destination
    if (destination === "downloads-api") {
      return { kind: "downloads" }
    }

    const preflight = await this.preflight(context)
    if (!preflight.ready) {
      await recordDestinationIssue(context, preflight)
      throw new DestinationPreflightError(preflight.reason)
    }

    const handle = await loadDownloadRootHandle()
    if (!handle) {
      const unavailable = { ready: false, reason: "not_configured" } as const
      await recordDestinationIssue(context, unavailable)
      throw new DestinationPreflightError(unavailable.reason)
    }

    return {
      kind: "custom",
      handleId: DOWNLOAD_ROOT_HANDLE_ID,
      handle,
    }
  }
}

export const destinationService = new DestinationService()
