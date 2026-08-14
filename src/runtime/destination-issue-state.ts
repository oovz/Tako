import { z } from "zod"
import type {
  DestinationIssue,
  DestinationIssueKind,
} from "@/src/domain/queue/state"

const DESTINATION_ISSUE_KINDS = [
  "fsa_permission_required",
  "fsa_folder_missing",
  "fsa_write_failed",
  "fsa_unsupported",
  "disk_full",
] as const satisfies readonly DestinationIssueKind[]

export const DestinationIssueSchema = z.strictObject({
  id: z.string().min(1),
  taskId: z.string().min(1),
  chapterId: z.string().min(1).optional(),
  kind: z.enum(DESTINATION_ISSUE_KINDS),
  occurredAt: z.number().finite().nonnegative(),
  acknowledgedAt: z.number().finite().nonnegative().optional(),
})

export const DestinationIssuesSchema = z.array(DestinationIssueSchema)

/**
 * Parse the current durable destination issue document. An absent key denotes
 * an empty issue list; a present malformed value is a durable-state failure.
 */
export function parseDestinationIssues(raw: unknown): DestinationIssue[] {
  if (raw === undefined) return []
  const parsed = DestinationIssuesSchema.parse(raw)
  return structuredClone(parsed)
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
