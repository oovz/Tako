import type { StateAction } from '@/src/types/state-actions';
import type { ErrorResponse } from '@/src/types/message-common';

export interface StateActionMessage {
  type: 'STATE_ACTION';
  action: StateAction;
  payload?: unknown;
  tabId?: number;
  timestamp?: number;
}

export type StateActionResponse = ({ success: true; data?: unknown }) | ErrorResponse;
