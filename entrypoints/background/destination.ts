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
} from "@/src/domain/queue/state"
import type { DownloadDestination } from "@/src/shared/download-contract"
import { StorageMutationQueue } from "@/src/storage/storage-mutation-queue"
import { parseDestinationIssues } from "@/src/runtime/destination-issue-state"

type EffectiveDestination =
  | { kind: "custom"; handleId: string; handle: FileSystemDirectoryHandle }
  | { kind: "downloads" }

export interface DestinationContext {
  taskId: string
  chapterId?: string
  destination: DownloadDestination
  destinationOverride?: "downloads-api"
}

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

export interface DestinationIssueNotifier {
  notifyDestinationActionRequired(input: {
    issue: DestinationIssue
    notificationsEnabled: boolean
  }): void | Promise<void>
}

export interface DestinationSettingsReader {
  getSettings(): Promise<{ notifications: boolean }>
}

export type DestinationIssueRecordResult = {
  issue: DestinationIssue
  inserted: boolean
}

/** Owns the durable destination-issue document and its read-modify-write queue. */
export class DestinationIssueRepository {
  private readonly mutations = new StorageMutationQueue()

  async getAll(): Promise<DestinationIssue[]> {
    return await this.mutations.run(() => this.readDocument())
  }

  async record(issue: DestinationIssue): Promise<DestinationIssueRecordResult> {
    return await this.mutations.run(async () => {
      const current = await this.readDocument()
      const existing = current.find((candidate) => candidate.id === issue.id)
      if (existing) return { issue: existing, inserted: false }

      await chrome.storage.local.set({
        [LOCAL_STORAGE_KEYS.destinationIssues]: [...current, issue],
      })
      return { issue, inserted: true }
    })
  }

  async clearForTask(taskId: string): Promise<void> {
    await this.mutations.run(async () => {
      const current = await this.readDocument()
      const next = current.filter((issue) => issue.taskId !== taskId)
      if (next.length === current.length) return
      await chrome.storage.local.set({
        [LOCAL_STORAGE_KEYS.destinationIssues]: next,
      })
    })
  }

  private async readDocument(): Promise<DestinationIssue[]> {
    const stored = await chrome.storage.local.get(
      LOCAL_STORAGE_KEYS.destinationIssues
    )
    return parseDestinationIssues(stored[LOCAL_STORAGE_KEYS.destinationIssues])
  }
}

export interface DestinationServiceDependencies {
  issueRepository: DestinationIssueRepository
  settingsReader: DestinationSettingsReader
  notifier: DestinationIssueNotifier
}

export class DestinationService {
  constructor(private readonly deps: DestinationServiceDependencies) {}

  async getIssues(): Promise<DestinationIssue[]> {
    return await this.deps.issueRepository.getAll()
  }

  async recordDestinationIssue(
    context: DestinationContext,
    result: Exclude<DestinationPreflight, { ready: true }>
  ): Promise<DestinationIssue> {
    return await this.recordDestinationIssueKind(
      context,
      issueKindForPreflight(result)
    )
  }

  async recordDestinationRuntimeIssue(
    context: DestinationContext,
    kind: Extract<
      DestinationIssueKind,
      | "fsa_permission_required"
      | "fsa_folder_missing"
      | "fsa_write_failed"
      | "disk_full"
    >
  ): Promise<DestinationIssue> {
    return await this.recordDestinationIssueKind(context, kind)
  }

  async clearDestinationIssuesForTask(taskId: string): Promise<void> {
    await this.deps.issueRepository.clearForTask(taskId)
  }

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
      await this.recordDestinationIssue(context, preflight)
      throw new DestinationPreflightError(preflight.reason)
    }

    const handle = await loadDownloadRootHandle()
    if (!handle) {
      const unavailable = { ready: false, reason: "not_configured" } as const
      await this.recordDestinationIssue(context, unavailable)
      throw new DestinationPreflightError(unavailable.reason)
    }

    return {
      kind: "custom",
      handleId: DOWNLOAD_ROOT_HANDLE_ID,
      handle,
    }
  }

  private async recordDestinationIssueKind(
    context: DestinationContext,
    kind: DestinationIssueKind
  ): Promise<DestinationIssue> {
    const issue = createDestinationIssue(context, kind)
    const result = await this.deps.issueRepository.record(issue)
    if (result.inserted) {
      try {
        const settings = await this.deps.settingsReader.getSettings()
        await this.deps.notifier.notifyDestinationActionRequired({
          issue: result.issue,
          notificationsEnabled: settings.notifications,
        })
      } catch (error) {
        logger.debug(
          "[DestinationService] Failed to show destination notification",
          error
        )
      }
    }
    return result.issue
  }
}
