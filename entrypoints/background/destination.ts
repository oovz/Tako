import {
  loadDownloadRootHandle,
  queryFsaPermission,
} from "@/src/storage/fs-access"
import type { DownloadErrorCategory } from "@/src/shared/download-contract"
import type { TaskDestination } from "@/src/types/state-snapshots"

export interface DestinationContext {
  taskId: string
  chapterId?: string
  destination: TaskDestination
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
      message?: string
    }

export class DestinationPreflightError extends Error {
  readonly errorCategory: DownloadErrorCategory
  constructor(
    readonly context: DestinationContext,
    readonly result: Exclude<DestinationPreflight, { ready: true }>
  ) {
    const permissionRequired =
      result.reason === "permission_prompt" ||
      result.reason === "permission_denied"
    super(
      result.message ??
        (permissionRequired
          ? "Access to the task's selected folder is required."
          : "The task's selected folder is unavailable.")
    )
    this.name = "DestinationPreflightError"
    this.errorCategory = permissionRequired
      ? "folder_permission_required"
      : "folder_unavailable"
  }
}

export class DestinationService {
  async preflight(context: DestinationContext): Promise<DestinationPreflight> {
    return checkDestinationHealth(context.destination)
  }
}

export async function checkDestinationHealth(
  destination: TaskDestination
): Promise<DestinationPreflight> {
  if (destination.kind === "downloads-api") return { ready: true }
  if (destination.handleId === null)
    return { ready: false, reason: "not_configured" }
  try {
    const handle = await loadDownloadRootHandle(destination.handleId)
    if (!handle) return { ready: false, reason: "not_configured" }
    const permission = await queryFsaPermission(handle, true)
    return destinationPermissionResult(permission)
  } catch (error) {
    return {
      ready: false,
      reason: "folder_unavailable",
      message: error instanceof Error ? error.message : String(error),
    }
  }
}

function destinationPermissionResult(
  permission: Awaited<ReturnType<typeof queryFsaPermission>>
): DestinationPreflight {
  if (permission === "granted") return { ready: true }
  if (permission === "prompt")
    return { ready: false, reason: "permission_prompt" }
  if (permission === "denied")
    return { ready: false, reason: "permission_denied" }
  return {
    ready: false,
    reason: permission === "unsupported" ? "unsupported" : "folder_unavailable",
  }
}
