import { z } from "zod"

const DESTINATION_ISSUE_KINDS = [
  "fsa_permission_required",
  "fsa_folder_missing",
  "fsa_write_failed",
  "fsa_unsupported",
  "disk_full",
] as const

export const DestinationIssueSchema = z.strictObject({
  id: z.string().min(1),
  taskId: z.string().min(1),
  chapterId: z.string().min(1).optional(),
  kind: z.enum(DESTINATION_ISSUE_KINDS),
  occurredAt: z.number().finite().nonnegative(),
  acknowledgedAt: z.number().finite().nonnegative().optional(),
})

export type DestinationIssue = z.infer<typeof DestinationIssueSchema>
export type DestinationIssueKind = DestinationIssue["kind"]
