import {
  DOWNLOAD_ROOT_HANDLE_ID,
  loadDownloadRootHandle,
  queryFsaPermission,
} from "@/src/storage/fs-access"
import logger from "@/src/runtime/logger"
import type {
  DispatchLeaseAuthority,
  DestinationIssue,
  DestinationIssueKind,
  DownloadTaskState,
  OutputAccounting,
} from "@/src/domain/queue/state"
import type { DownloadDestination } from "@/src/shared/download-contract"
import type { QueueRepository } from "@/src/storage/queue-repository"

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
  readonly context: DestinationContext
  readonly result: Exclude<DestinationPreflight, { ready: true }>

  constructor(
    context: DestinationContext,
    result: Exclude<DestinationPreflight, { ready: true }>
  ) {
    super(`Destination preflight failed: ${result.reason}`)
    this.name = "DestinationPreflightError"
    this.context = context
    this.result = result
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

export type DestinationBlockResult = Awaited<
  ReturnType<QueueRepository["blockTaskForDestination"]>
>

type DestinationQueueOwner = Pick<QueueRepository, "blockTaskForDestination">

export type DestinationBlockInput = {
  context: DestinationContext
  kind: DestinationIssueKind
  now?: number
  errorMessage?: string
  errorCategory?: DownloadTaskState["errorCategory"]
  chapter?: {
    chapterId: string
    lease: DispatchLeaseAuthority
    imagesFailed?: number
    outputs?: OutputAccounting
  }
}

export interface DestinationServiceDependencies {
  queueRepository: DestinationQueueOwner
  settingsReader: DestinationSettingsReader
  notifier: DestinationIssueNotifier
}

export class DestinationService {
  constructor(private readonly deps: DestinationServiceDependencies) {}

  async blockForPreflight(
    context: DestinationContext,
    result: Exclude<DestinationPreflight, { ready: true }>
  ): Promise<DestinationBlockResult> {
    return await this.block({
      context,
      kind: issueKindForPreflight(result),
    })
  }

  async blockForRuntimeIssue(
    input: Omit<DestinationBlockInput, "kind"> & {
      kind: Extract<
        DestinationIssueKind,
        | "fsa_permission_required"
        | "fsa_folder_missing"
        | "fsa_write_failed"
        | "disk_full"
      >
    }
  ): Promise<DestinationBlockResult> {
    return await this.block(input)
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
      throw new DestinationPreflightError(context, preflight)
    }

    const handle = await loadDownloadRootHandle()
    if (!handle) {
      const unavailable = { ready: false, reason: "not_configured" } as const
      throw new DestinationPreflightError(context, unavailable)
    }

    return {
      kind: "custom",
      handleId: DOWNLOAD_ROOT_HANDLE_ID,
      handle,
    }
  }

  private async block(
    input: DestinationBlockInput
  ): Promise<DestinationBlockResult> {
    const issue = createDestinationIssue(input.context, input.kind)
    const transition = await this.deps.queueRepository.blockTaskForDestination({
      taskId: input.context.taskId,
      now: input.now ?? Date.now(),
      destinationIssue: issue,
      errorMessage: input.errorMessage,
      errorCategory: input.errorCategory,
      chapter: input.chapter,
    })
    if (transition.outcome === "applied") {
      try {
        const settings = await this.deps.settingsReader.getSettings()
        await this.deps.notifier.notifyDestinationActionRequired({
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
    return transition
  }
}
