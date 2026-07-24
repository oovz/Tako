import type { StateAction } from "@/src/types/state-actions"
import type { ErrorResponse } from "@/src/types/message-common"
import type { CommandEnvelope } from "@/src/types/command-envelope"

export interface StateActionMessage extends Partial<CommandEnvelope> {
  type: "STATE_ACTION"
  action: StateAction
  payload?: unknown
  tabId?: number
  windowId?: number
  requestId?: number
  timestamp?: number
}

export type StateActionResponse =
  { success: true; data?: unknown } | ErrorResponse
