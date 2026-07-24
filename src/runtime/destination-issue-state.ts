import { isRecord } from "@/src/shared/type-guards"
import type {
  DestinationIssue,
  DestinationIssueKind,
} from "@/src/types/queue-state"

const DESTINATION_ISSUE_KINDS = new Set<DestinationIssueKind>([
  "fsa_permission_required",
  "fsa_folder_missing",
  "fsa_write_failed",
  "fsa_unsupported",
  "disk_full",
])

export function normalizeDestinationIssues(raw: unknown): DestinationIssue[] {
  if (!Array.isArray(raw)) return []

  return raw
    .map((candidate): DestinationIssue | null => {
      if (!isRecord(candidate)) return null
      if (
        typeof candidate.id !== "string" ||
        typeof candidate.taskId !== "string" ||
        typeof candidate.kind !== "string" ||
        !DESTINATION_ISSUE_KINDS.has(candidate.kind as DestinationIssueKind) ||
        typeof candidate.occurredAt !== "number"
      ) {
        return null
      }

      return {
        id: candidate.id,
        taskId: candidate.taskId,
        chapterId:
          typeof candidate.chapterId === "string"
            ? candidate.chapterId
            : undefined,
        kind: candidate.kind as DestinationIssueKind,
        occurredAt: candidate.occurredAt,
        acknowledgedAt:
          typeof candidate.acknowledgedAt === "number"
            ? candidate.acknowledgedAt
            : undefined,
      }
    })
    .filter((issue): issue is DestinationIssue => issue !== null)
    .sort((left, right) => left.occurredAt - right.occurredAt)
}

export function getDestinationIssueMessageKey(
  kind: DestinationIssueKind
): string {
  switch (kind) {
    case "fsa_permission_required":
      return "destinationIssue_permissionRequired"
    case "fsa_folder_missing":
      return "destinationIssue_folderMissing"
    case "fsa_write_failed":
      return "destinationIssue_writeFailed"
    case "fsa_unsupported":
      return "destinationIssue_unsupported"
    case "disk_full":
      return "destinationIssue_diskFull"
  }
}
