import type { DownloadTaskState } from '@/src/types/queue-state';

export interface UpdateDownloadTaskPayload {
  taskId: string;
  updates: {
    status?: DownloadTaskState['status'];
    errorMessage?: string;
    errorCategory?: DownloadTaskState['errorCategory'];
    started?: number;
    completed?: number;
    isRetried?: boolean;
    isRetryTask?: boolean;
    lastSuccessfulDownloadId?: number;
  };
}

export interface RemoveDownloadTaskPayload {
  taskId: string;
}

export interface CancelDownloadTaskPayload {
  taskId: string;
}
