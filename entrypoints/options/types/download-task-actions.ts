import type { PendingUndoReceipt } from "@/src/domain/queue/state"

export type DownloadTaskActionResult =
  | { success: true; undo?: PendingUndoReceipt }
  | { success: false; error: string }
